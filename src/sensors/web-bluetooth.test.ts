import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebBluetoothTrainer } from './web-bluetooth';
import type { ConnectionState } from './types';
import { dv, FakeChar, FakeDevice, FakeService, install, uuid } from './testing/fake-gatt';

const WAHOO_SVC = 'a026ee01-0a7d-4ab3-97fa-f1500f9feb8b';
const WAHOO_CHAR = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';

/** Control Point FTMS : répond succès (ou le résultat imposé) à chaque commande. */
function ftmsDevice(result = 1) {
  const bikeData = new FakeChar(uuid(0x2ad2));
  const cp = new FakeChar(uuid(0x2ad9), (data, self) => {
    queueMicrotask(() => self.emit(0x80, data[0]!, result));
  });
  // Feature : machine 0, cibles = puissance (bit 3) + simulation (bit 13)
  const feature = new FakeChar(uuid(0x2acc), undefined, dv(0, 0, 0, 0, 0x08, 0x20, 0, 0));
  const device = new FakeDevice([new FakeService(uuid(0x1826), [feature, bikeData, cp])]);
  return { device, bikeData, cp };
}

function trainer() {
  const t = new WebBluetoothTrainer();
  t.reconnectDelaysMs = [0];
  t.wahooResponseTimeoutMs = 10;
  t.writeRetryDelayMs = 0;
  t.fecRefreshMs = 60_000;
  const states: ConnectionState[] = [];
  const logs: string[] = [];
  t.on('state', (s) => states.push(s));
  t.on('log', (l) => logs.push(l));
  return { t, states, logs };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('WebBluetoothTrainer, chemin FTMS', () => {
  it('lit les capacités et décode les mesures', async () => {
    const { device, bikeData } = ftmsDevice();
    install(device);
    const { t } = trainer();
    const got: number[] = [];
    t.on('measurement', (m) => got.push(m.powerW ?? -1));
    await t.connect();
    expect(t.capabilities).toMatchObject({ targetPower: true, simulation: true });
    bikeData.emit(0x44, 0x00, 0xb8, 0x0b, 0xaa, 0x00, 0xfa, 0x00);
    expect(got).toEqual([250]);
  });

  it('prend le contrôle avant la première commande, une seule fois', async () => {
    const { device, cp } = ftmsDevice();
    install(device);
    const { t } = trainer();
    await t.connect();
    await t.setTargetPower(200);
    await t.setTargetPower(220);
    // 0x00 prise de contrôle, 0x07 démarrage, puis les deux cibles (0x05)
    expect(cp.writes).toEqual([[0x00], [0x07], [0x05, 200, 0], [0x05, 220, 0]]);
  });

  it('remonte un contrôle refusé', async () => {
    const { device } = ftmsDevice(5);
    install(device);
    const { t } = trainer();
    await t.connect();
    await expect(t.setTargetPower(200)).rejects.toThrow('contrôle non accordé');
  });
});

describe('WebBluetoothTrainer, reconnexion', () => {
  it('se reconnecte seul après une coupure et rejoue la dernière consigne', async () => {
    const { device, cp } = ftmsDevice();
    install(device);
    const { t, states, logs } = trainer();
    await t.connect();
    await t.setTargetPower(200);

    device.drop();
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    await vi.waitFor(() => expect(cp.writes.filter((w) => w[0] === 0x05)).toHaveLength(2));

    expect(states).toEqual(['connecting', 'connected', 'connecting', 'connected']);
    expect(logs.some((l) => l.includes('reconnecté en'))).toBe(true);
    // le contrôle est repris sur la nouvelle session avant la consigne rejouée
    expect(cp.writes.slice(-3)).toEqual([[0x00], [0x07], [0x05, 200, 0]]);
  });

  it('ne se reconnecte pas après une déconnexion voulue', async () => {
    const { device } = ftmsDevice();
    install(device);
    const { t, states } = trainer();
    await t.connect();
    await t.disconnect();
    await new Promise((r) => setTimeout(r, 20));
    expect(states).toEqual(['connecting', 'connected', 'disconnected']);
    expect(device.connected).toBe(false);
  });

  it("abandonne après le délai maximal, puis se reconnecte quand l'appareil se signale de nouveau", async () => {
    const { device } = ftmsDevice();
    device.enableAdvertisements();
    install(device);
    const { t, states } = trainer();
    t.reconnectTimeoutMs = 50;
    t.reconnectDelaysMs = [10];
    await t.connect();
    const realConnect = device.gatt.connect;
    device.gatt.connect = async () => {
      throw new Error('hors de portée');
    };
    device.drop();
    await vi.waitFor(() => expect(states.at(-1)).toBe('error'));
    expect(t.waitingForDevice).toBe(true);
    expect(states.filter((s) => s === 'error')).toHaveLength(1);

    device.gatt.connect = realConnect; // trainer rallumé
    device.advertise();
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    expect(t.waitingForDevice).toBe(false);
    expect(device.watching).toBe(0); // surveillance arrêtée une fois l'appareil revenu
  });

  it("borne une connexion GATT restée sans réponse, puis réessaie", async () => {
    const { device } = ftmsDevice();
    install(device);
    const { t, states, logs } = trainer();
    t.connectTimeoutMs = 20;
    await t.connect();
    const realConnect = device.gatt.connect;
    let calls = 0;
    device.gatt.connect = () => (++calls === 1 ? new Promise(() => {}) : realConnect()); // le premier essai ne répond jamais
    device.drop();
    await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    expect(calls).toBe(2);
    expect(logs.some((l) => l.includes('pas de réponse'))).toBe(true);
  });
});

describe('WebBluetoothTrainer, abonnements et sélecteur', () => {
  it("garde un seul écouteur par caractéristique après plusieurs reconnexions", async () => {
    const { device, bikeData, cp } = ftmsDevice();
    install(device);
    const { t, states } = trainer();
    const got: number[] = [];
    t.on('measurement', (m) => got.push(m.powerW ?? -1));
    await t.connect();
    for (let i = 0; i < 3; i++) {
      device.drop();
      await vi.waitFor(() => expect(states.at(-1)).toBe('connected'));
    }
    expect(bikeData.listenerCount).toBe(1);
    expect(cp.listenerCount).toBe(1);
    bikeData.emit(0x44, 0x00, 0xb8, 0x0b, 0xaa, 0x00, 0xfa, 0x00);
    expect(got).toEqual([250]);
  });

  it("n'émet que les champs portés par la trame", async () => {
    const { device, bikeData } = ftmsDevice();
    install(device);
    const { t } = trainer();
    const got: object[] = [];
    t.on('measurement', ({ t: _, ...m }) => got.push(m));
    await t.connect();
    bikeData.emit(0x44, 0x00, 0xb8, 0x0b, 0xaa, 0x00, 0xfa, 0x00); // vitesse, cadence, puissance
    bikeData.emit(0x01, 0x00); // « More Data » : aucun champ
    expect(got).toEqual([{ speedKmh: 30, cadenceRpm: 85, powerW: 250 }, {}]);
  });

  it("traite la fermeture du sélecteur comme un abandon, pas comme une erreur", async () => {
    install(undefined);
    const { t, states } = trainer();
    await expect(t.connect()).resolves.toBeUndefined();
    expect(states).toEqual(['connecting', 'disconnected']);
  });
});

describe('WebBluetoothTrainer, chemin Wahoo', () => {
  it('pilote ERG et SIM par le service propriétaire', async () => {
    const power = new FakeChar(uuid(0x2a63));
    const wahooCp = new FakeChar(WAHOO_CHAR);
    const device = new FakeDevice([
      new FakeService(uuid(0x1818), [power]),
      new FakeService(WAHOO_SVC, [wahooCp]),
    ]);
    install(device);
    const { t } = trainer();
    await t.connect();
    expect(t.capabilities).toMatchObject({ targetPower: true, simulation: true });

    power.emit(0x00, 0x00, 0xc8, 0x00);
    await t.setTargetPower(150);
    await t.setSimulation({ gradePct: 0 });
    expect(wahooCp.writes).toEqual([
      [0x20, 0xee, 0xfc], // déverrouillage, envoyé à la connexion
      [0x42, 0x96, 0x00],
      [0x43, 0x40, 0x1f, 0x28, 0x00, 0xfe, 0x01],
      [0x46, 0x00, 0x80],
    ]);
  });

  it('renvoie le mode simulation une seule fois, puis seulement la pente', async () => {
    const power = new FakeChar(uuid(0x2a63));
    const wahooCp = new FakeChar(WAHOO_CHAR);
    install(new FakeDevice([new FakeService(uuid(0x1818), [power]), new FakeService(WAHOO_SVC, [wahooCp])]));
    const { t } = trainer();
    await t.connect();
    await t.setSimulation({ gradePct: 2, massKg: 80 });
    await t.setSimulation({ gradePct: 3, massKg: 80 });
    expect(wahooCp.writes.map((w) => w[0])).toEqual([0x20, 0x43, 0x46, 0x46]);

    await t.setSimulation({ gradePct: 3, massKg: 90 }); // masse changée : mode renvoyé
    await t.setTargetPower(150); // l'ERG sort du mode simulation
    await t.setSimulation({ gradePct: 3, massKg: 90 });
    expect(wahooCp.writes.map((w) => w[0])).toEqual([0x20, 0x43, 0x46, 0x46, 0x43, 0x46, 0x42, 0x43, 0x46]);
  });

  it('passe la cadence à 0 quand les compteurs de manivelle ne bougent plus', async () => {
    const power = new FakeChar(uuid(0x2a63));
    install(new FakeDevice([new FakeService(uuid(0x1818), [power])]));
    const { t } = trainer();
    t.cadenceTimeoutMs = 30;
    const rpm: (number | undefined)[] = [];
    t.on('measurement', (m) => rpm.push(m.cadenceRpm));
    await t.connect();

    // flags 0x0020 : manivelle ; 100 W ; tours puis temps en 1/1024 s
    power.emit(0x20, 0x00, 100, 0, 10, 0, 0x00, 0x00);
    power.emit(0x20, 0x00, 100, 0, 11, 0, 0x00, 0x04); // 1 tour en 1 s : 60 rpm
    expect(rpm.at(-1)).toBeCloseTo(60);

    power.emit(0x20, 0x00, 100, 0, 11, 0, 0x00, 0x04); // compteurs inchangés, délai pas écoulé
    expect(rpm.at(-1)).toBeUndefined(); // pas de nouvelle cadence : le consommateur garde 60 tant qu'elle est fraîche

    await new Promise((r) => setTimeout(r, 50));
    power.emit(0x20, 0x00, 0, 0, 11, 0, 0x00, 0x04); // toujours inchangés, délai écoulé
    expect(rpm.at(-1)).toBe(0);
  });
});

const FEC_SVC = '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e';
const FEC_NOTIFY = '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e';
const FEC_WRITE = '6e40fec3-b5a3-f393-e0a9-e50e24dcca9e';

const text = (s: string) => new DataView(new TextEncoder().encode(s).buffer);

/** Service Device Information : fabricant et firmware. */
const deviceInfo = (manufacturer: string, firmware: string) =>
  new FakeService(uuid(0x180a), [
    new FakeChar(uuid(0x2a29), undefined, text(manufacturer)),
    new FakeChar(uuid(0x2a26), undefined, text(`${firmware}\0`)),
  ]);

/** Service FTMS complet ; `respond` choisit le résultat de chaque commande. */
function ftmsService(respond: (op: number, n: number) => number = () => 1) {
  let n = 0;
  const bikeData = new FakeChar(uuid(0x2ad2));
  const status = new FakeChar(uuid(0x2ada));
  const cp = new FakeChar(uuid(0x2ad9), (data, self) => {
    const result = respond(data[0]!, n++);
    queueMicrotask(() => self.emit(0x80, data[0]!, result));
  });
  const feature = new FakeChar(uuid(0x2acc), undefined, dv(0, 0, 0, 0, 0x08, 0x20, 0, 0));
  return { service: new FakeService(uuid(0x1826), [feature, bikeData, status, cp]), bikeData, status, cp };
}

function fecService() {
  const notify = new FakeChar(FEC_NOTIFY);
  const write = new FakeChar(FEC_WRITE);
  return { service: new FakeService(FEC_SVC, [notify, write]), notify, write };
}

const named = (name: string, ...services: FakeService[]) => {
  const d = new FakeDevice(services);
  d.name = name;
  return d;
};

describe('WebBluetoothTrainer, chemin FE-C over BLE (Tacx)', () => {
  it('lit les mesures et pilote ERG et SIM, pente plafonnée au modèle', async () => {
    const fec = fecService();
    install(named('Tacx Vortex 12345', fec.service));
    const { t } = trainer();
    const got: { powerW?: number; cadenceRpm?: number }[] = [];
    t.on('measurement', (m) => got.push(m));
    await t.connect();
    expect(t.capabilities).toMatchObject({ targetPower: true, simulation: true });
    expect(t.identity).toMatchObject({ protocol: 'fec', profile: { id: 'tacx-vortex' } });

    const page = [0xa4, 0x09, 0x4e, 0x05, 0x19, 0x01, 90, 0, 0, 0xfa, 0x00, 0x00];
    fec.notify.emit(...page, page.reduce((x, b) => x ^ b, 0));
    expect(got.at(-1)).toMatchObject({ powerW: 250, cadenceRpm: 90 });

    await t.setTargetPower(200);
    await t.setSimulation({ gradePct: 12, massKg: 80 });
    await t.setSimulation({ gradePct: 3, massKg: 80 });
    // chaque consigne est suivie d'une demande d'état de commande (page 70 pour la page 71)
    expect(fec.write.writes.map((w) => w[4])).toEqual([0x31, 0x46, 0x37, 0x32, 0x33, 0x46, 0x33, 0x46]);
    expect(fec.write.writes[1]!.slice(4, 12)).toEqual([0x46, 0xff, 0xff, 0xff, 0xff, 0x01, 0x47, 0x01]);
    const grade = fec.write.writes[4]!;
    expect((grade[9]! | (grade[10]! << 8)) / 100 - 200).toBe(7); // Vortex : 7 % au plus
  });

  it('préfère FTMS quand un Tacx expose les deux', async () => {
    const ftms = ftmsService();
    const fec = fecService();
    install(named('Tacx Neo 2T 12345', ftms.service, fec.service));
    const { t } = trainer();
    await t.connect();
    await t.setTargetPower(200);
    expect(t.identity?.protocol).toBe('ftms');
    expect(ftms.cp.writes.at(-1)).toEqual([0x05, 200, 0]);
    expect(fec.write.writes).toEqual([]);
  });
});

describe('WebBluetoothTrainer, choix du protocole', () => {
  it('garde le contrôle Wahoo sur un KICKR qui expose aussi FTMS', async () => {
    const ftms = ftmsService();
    const wahooCp = new FakeChar(WAHOO_CHAR);
    install(
      named(
        'KICKR CORE 1A2B',
        ftms.service,
        new FakeService(uuid(0x1818), [new FakeChar(uuid(0x2a63))]),
        new FakeService(WAHOO_SVC, [wahooCp]),
      ),
    );
    const { t } = trainer();
    await t.connect();
    await t.setTargetPower(150);
    expect(t.identity?.protocol).toBe('wahoo');
    expect(wahooCp.writes.at(-1)).toEqual([0x42, 0x96, 0x00]);
    expect(ftms.cp.writes).toEqual([]);
  });

  it('respecte le protocole imposé, et se replie quand il manque', async () => {
    const ftms = ftmsService();
    const wahooCp = new FakeChar(WAHOO_CHAR);
    install(named('KICKR 81B5', ftms.service, new FakeService(WAHOO_SVC, [wahooCp])));
    const { t, logs } = trainer();
    t.forcedProtocol = 'ftms';
    await t.connect();
    expect(t.identity?.protocol).toBe('ftms');

    const other = trainer();
    other.t.forcedProtocol = 'fec';
    install(named('KICKR 81B5', ftmsService().service, new FakeService(WAHOO_SVC, [new FakeChar(WAHOO_CHAR)])));
    await other.t.connect();
    expect(other.t.identity?.protocol).toBe('wahoo');
    expect(other.logs.some((l) => l.includes('repli automatique'))).toBe(true);
    expect(logs.some((l) => l.includes('repli'))).toBe(false);
  });

  it("lit le fabricant et le firmware, et conseille une mise à jour quand rien n'est pilotable", async () => {
    const power = new FakeChar(uuid(0x2a63));
    install(named('KICKR 81B5', new FakeService(uuid(0x1818), [power]), deviceInfo('Wahoo Fitness', '3.2.1')));
    const { t, logs } = trainer();
    await t.connect();
    expect(t.capabilities).toMatchObject({ targetPower: false, simulation: false });
    expect(t.identity?.info).toEqual({ manufacturer: 'Wahoo Fitness', firmware: '3.2.1' });
    expect(t.identity?.advice).toContain("l'app Wahoo");
    expect(logs.some((l) => l.startsWith('Identifié : Wahoo KICKR (Wahoo Fitness, firmware 3.2.1)'))).toBe(true);
  });

  it('reste en lecture seule sans erreur quand FTMS n’a pas de Control Point', async () => {
    const bikeData = new FakeChar(uuid(0x2ad2));
    install(new FakeDevice([new FakeService(uuid(0x1826), [bikeData])]));
    const { t } = trainer();
    const got: number[] = [];
    t.on('measurement', (m) => got.push(m.powerW ?? -1));
    await t.connect();
    expect(t.capabilities).toMatchObject({ targetPower: false, simulation: false });
    bikeData.emit(0x44, 0x00, 0xb8, 0x0b, 0xaa, 0x00, 0xfa, 0x00);
    expect(got).toEqual([250]);
  });
});

describe('WebBluetoothTrainer, robustesse FTMS', () => {
  it('reprend le contrôle quand le trainer signale sa perte', async () => {
    const ftms = ftmsService();
    install(new FakeDevice([ftms.service]));
    const { t } = trainer();
    await t.connect();
    await t.setTargetPower(200);
    ftms.status.emit(0xff); // une autre application a pris la main
    await t.setTargetPower(210);
    expect(ftms.cp.writes).toEqual([[0x00], [0x07], [0x05, 200, 0], [0x00], [0x07], [0x05, 210, 0]]);
  });

  it('redemande le contrôle une fois quand une consigne est refusée', async () => {
    // la première consigne de puissance est refusée (contrôle perdu sans notification), le reste passe
    const ftms = ftmsService((op, n) => (op === 0x05 && n === 2 ? 5 : 1));
    install(new FakeDevice([ftms.service]));
    const { t } = trainer();
    await t.connect();
    await t.setTargetPower(200);
    expect(ftms.cp.writes).toEqual([[0x00], [0x07], [0x05, 200, 0], [0x00], [0x07], [0x05, 200, 0]]);
  });

  it('envoie quand même les consignes si la prise de contrôle n’est pas supportée', async () => {
    const ftms = ftmsService((op) => (op === 0x00 ? 2 : 1));
    install(new FakeDevice([ftms.service]));
    const { t, logs } = trainer();
    await t.connect();
    await t.setTargetPower(180);
    expect(ftms.cp.writes.at(-1)).toEqual([0x05, 180, 0]);
    expect(logs.some((l) => l.includes('consignes tentées quand même'))).toBe(true);
  });
});

/** Message ANT de diffusion portant une page FE-C, somme XOR comprise. */
const fecFrame = (...page: number[]) => {
  const m = [0xa4, 0x09, 0x4e, 0x05, ...page];
  return [...m, m.reduce((x, b) => x ^ b, 0)];
};

/** KICKR sans FTMS, comme celui de test : Cycling Power pour les mesures, contrôle propriétaire. */
const kickr = (cp: FakeChar) =>
  named('KICKR 81B5', new FakeService(uuid(0x1818), [new FakeChar(uuid(0x2a63))]), new FakeService(WAHOO_SVC, [cp]));

describe('WebBluetoothTrainer, reprise Wahoo', () => {
  /** Control Point Wahoo qui accuse chaque commande par `01 <opcode> <statut>`. */
  const ackingWahoo = (status: (op: number, n: number) => number) => {
    let n = 0;
    return new FakeChar(WAHOO_CHAR, (data, self) => {
      const s = status(data[0]!, n++);
      queueMicrotask(() => self.emit(0x01, data[0]!, s));
    });
  };

  it('rejoue une commande refusée après un nouveau déverrouillage', async () => {
    // 0 : déverrouillage accepté ; 1 : ERG refusé ; ensuite tout passe
    const cp = ackingWahoo((_, n) => (n === 1 ? 0x02 : 0x01));
    install(kickr(cp));
    const { t, logs } = trainer();
    await t.connect();
    await t.setTargetPower(150);
    expect(cp.writes).toEqual([[0x20, 0xee, 0xfc], [0x42, 0x96, 0x00], [0x20, 0xee, 0xfc], [0x42, 0x96, 0x00]]);
    expect(logs.some((l) => l.includes('refusée (statut 0x02)'))).toBe(true);
  });

  it("ne rejoue pas une commande acceptée, et n'attend plus un trainer qui n'accuse pas", async () => {
    const cp = ackingWahoo(() => 0x01);
    install(kickr(cp));
    const { t } = trainer();
    await t.connect();
    await t.setTargetPower(150);
    expect(cp.writes).toHaveLength(2);

    const silent = new FakeChar(WAHOO_CHAR);
    install(kickr(silent));
    const other = trainer();
    await other.t.connect();
    const started = performance.now();
    await other.t.setTargetPower(150);
    await other.t.setTargetPower(160);
    expect(performance.now() - started).toBeLessThan(10); // plus d'attente après le premier silence
    expect(other.logs.filter((l) => l.includes("pas d'accusé"))).toHaveLength(1);
  });

  it('réessaie une écriture refusée par la pile Bluetooth', async () => {
    let failures = 1;
    const cp = new FakeChar(WAHOO_CHAR, (data) => {
      if (data[0] === 0x42 && failures-- > 0) throw new Error('GATT operation already in progress');
    });
    install(kickr(cp));
    const { t, logs } = trainer();
    await t.connect();
    await t.setTargetPower(150);
    expect(cp.writes.filter((w) => w[0] === 0x42)).toHaveLength(2);
    expect(logs.some((l) => l.includes('essai 2/3'))).toBe(true);
  });

  it('abandonne après le nombre maximal d’essais', async () => {
    const cp = new FakeChar(WAHOO_CHAR, (data) => {
      if (data[0] === 0x42) throw new Error('GATT error');
    });
    install(kickr(cp));
    const { t } = trainer();
    await t.connect();
    await expect(t.setTargetPower(150)).rejects.toThrow('GATT error');
    expect(cp.writes.filter((w) => w[0] === 0x42)).toHaveLength(3);
  });
});

describe('WebBluetoothTrainer, reprise FE-C', () => {
  it('lit la puissance par Cycling Power quand le Tacx l’expose, comme les clients de référence', async () => {
    const fec = fecService();
    const power = new FakeChar(uuid(0x2a63));
    install(named('Tacx Flux S 1', new FakeService(uuid(0x1818), [power]), fec.service));
    const { t } = trainer();
    const got: (number | undefined)[] = [];
    t.on('measurement', (m) => got.push(m.powerW));
    await t.connect();
    expect(t.identity?.protocol).toBe('fec');
    power.emit(0x00, 0x00, 0xc8, 0x00);
    fec.notify.emit(...fecFrame(0x19, 0x01, 90, 0, 0, 0x2c, 0x01, 0x00)); // 300 W par FE-C : ignorés
    expect(got).toEqual([200]);
  });

  it('renvoie une fois une consigne que le trainer déclare échouée (page 71)', async () => {
    const fec = fecService();
    install(named('Tacx Vortex 1', fec.service));
    const { t, logs } = trainer();
    await t.connect();
    await t.setTargetPower(200);
    const target = () => fec.write.writes.filter((w) => w[4] === 0x31);
    fec.notify.emit(...fecFrame(0x47, 0x31, 0x00, 0x01, 0xff, 0xff, 0xff, 0xff)); // échouée
    await vi.waitFor(() => expect(target()).toHaveLength(2));
    fec.notify.emit(...fecFrame(0x47, 0x31, 0x01, 0x01, 0xff, 0xff, 0xff, 0xff)); // encore : pas de boucle
    await new Promise((r) => setTimeout(r, 20));
    expect(target()).toHaveLength(2);
    expect(logs.some((l) => l.includes('commande 0x31 échouée'))).toBe(true);

    fec.notify.emit(...fecFrame(0x47, 0x31, 0x02, 0x00, 0xff, 0xff, 0xff, 0xff)); // réussie : rien à faire
    await new Promise((r) => setTimeout(r, 20));
    expect(target()).toHaveLength(2);
  });

  it('renvoie poids et traînée quand le trainer les réclame (page 25), puis la consigne', async () => {
    const fec = fecService();
    install(named('Tacx Vortex 1', fec.service));
    const { t, logs } = trainer();
    await t.connect();
    await t.setSimulation({ gradePct: 4, massKg: 90 });
    const before = fec.write.writes.length;
    // octet 6, bit 6 : configuration utilisateur requise
    fec.notify.emit(...fecFrame(0x19, 0x01, 85, 0, 0, 0xc8, 0x40, 0x30));
    await vi.waitFor(() => expect(fec.write.writes.length).toBe(before + 3));
    expect(fec.write.writes.slice(before).map((w) => w[4])).toEqual([0x37, 0x32, 0x33]);
    const rider = fec.write.writes[before]!;
    expect((rider[5]! | (rider[6]! << 8)) / 100).toBe(82); // 90 kg moins 8 kg de vélo

    fec.notify.emit(...fecFrame(0x19, 0x02, 85, 0, 0, 0xc8, 0x40, 0x30)); // réclamé à nouveau aussitôt : pas de rafale
    await new Promise((r) => setTimeout(r, 20));
    expect(fec.write.writes.length).toBe(before + 3);
    expect(logs.filter((l) => l.includes('réclame poids'))).toHaveLength(1);
  });

  it('renvoie périodiquement la dernière consigne', async () => {
    const fec = fecService();
    install(named('Tacx Vortex 1', fec.service));
    const { t } = trainer();
    t.fecRefreshMs = 15;
    await t.connect();
    await t.setTargetPower(220);
    await vi.waitFor(() => expect(fec.write.writes.filter((w) => w[4] === 0x31).length).toBeGreaterThanOrEqual(3));
    await t.disconnect(); // arrête le renvoi
    const n = fec.write.writes.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(fec.write.writes.length).toBe(n);
  });
});

describe('WebBluetoothTrainer, protocole Zwift', () => {
  const ZWIFT_SVC = '00000001-19ca-4651-86e5-fa29dcdd09d1';
  const zchar = (n: number) => `0000000${n}-19ca-4651-86e5-fa29dcdd09d1`;
  const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e];

  /** Trainer à Zwift Cog : répond « RideOn » sur la caractéristique d'indication ; `accepts` filtre la forme acceptée. */
  function zwiftDevice(accepts: (frame: number[]) => boolean = () => true) {
    const response = new FakeChar(zchar(4));
    const control = new FakeChar(zchar(3), (data) => {
      if (RIDE_ON.every((c, i) => data[i] === c) && accepts(data)) queueMicrotask(() => response.emit(...RIDE_ON, 0x02, 0x00));
    });
    const power = new FakeChar(uuid(0x2a63));
    const ftms = ftmsDevice();
    const device = new FakeDevice([
      new FakeService(uuid(0x1818), [power]),
      ...ftms.device.services,
      new FakeService(ZWIFT_SVC, [new FakeChar(zchar(2)), control, response]),
    ]);
    return { device, control, ftmsCp: ftms.cp };
  }

  it("n'est pas retenu de lui-même quand un autre protocole pilote le trainer", async () => {
    const { device, control } = zwiftDevice();
    install(device);
    const { t } = trainer();
    await t.connect();
    expect(t.identity?.protocol).toBe('ftms');
    expect(t.capabilities.virtualGears).toBeUndefined();
    expect(control.writes).toEqual([]);
  });

  it('choisi comme prioritaire : poignée de main, puis pente et braquet envoyés au trainer', async () => {
    const { device, control, ftmsCp } = zwiftDevice();
    install(device);
    const { t } = trainer();
    t.forcedProtocol = 'zwift';
    await t.connect();
    expect(t.identity?.protocol).toBe('zwift');
    expect(t.capabilities).toMatchObject({ targetPower: true, simulation: true, virtualGears: true });
    expect(control.writes).toEqual([[...RIDE_ON, 0x02, 0x01], [0x41, 0x08, 0x05], [0x00, 0x08, 0x00], [0x00, 0x08, 0x88, 0x04]]);

    control.writes.length = 0;
    await t.setSimulation({ gradePct: 0, massKg: 83, gearRatio: 2.4 });
    await t.setSimulation({ gradePct: -1.5, massKg: 83, gearRatio: 2.4 });
    await t.setSimulation({ gradePct: -1.5, massKg: 83, gearRatio: 2.61 });
    expect(control.writes).toEqual([
      // simulation : vent 0, pente 0, traînée 5100, roulement 400
      [0x04, 0x22, 0x0a, 0x08, 0x00, 0x10, 0x00, 0x18, 0xec, 0x27, 0x20, 0x90, 0x03],
      // physique : braquet 24000, vélo 800, cycliste 7500
      [0x04, 0x2a, 0x0a, 0x10, 0xc0, 0xbb, 0x01, 0x20, 0xa0, 0x06, 0x28, 0xcc, 0x3a],
      // même braquet : la pente seule (-150, soit 299 en zigzag)
      [0x04, 0x22, 0x0b, 0x08, 0x00, 0x10, 0xab, 0x02, 0x18, 0xec, 0x27, 0x20, 0x90, 0x03],
      // changement de vitesse : pente puis braquet 26100
      [0x04, 0x22, 0x0b, 0x08, 0x00, 0x10, 0xab, 0x02, 0x18, 0xec, 0x27, 0x20, 0x90, 0x03],
      [0x04, 0x2a, 0x0a, 0x10, 0xf4, 0xcb, 0x01, 0x20, 0xa0, 0x06, 0x28, 0xcc, 0x3a],
    ]);
    expect(ftmsCp.writes).toEqual([]); // FTMS n'est pas sollicité en parallèle
  });

  it('ERG par le champ de puissance cible ; au retour en simulation, braquet renvoyé', async () => {
    const { device, control } = zwiftDevice();
    install(device);
    const { t } = trainer();
    t.forcedProtocol = 'zwift';
    await t.connect();
    await t.setSimulation({ gradePct: 0, gearRatio: 2.4 });
    control.writes.length = 0;
    await t.setTargetPower(200);
    await t.setSimulation({ gradePct: 0, gearRatio: 2.4 });
    expect(control.writes[0]).toEqual([0x04, 0x18, 0xc8, 0x01]);
    expect(control.writes.map((w) => w[1])).toEqual([0x18, 0x22, 0x2a]);
  });

  it('essaie la poignée de main courte si la longue reste sans réponse', async () => {
    const { device, control } = zwiftDevice((frame) => frame.length === 6);
    install(device);
    const { t } = trainer();
    t.forcedProtocol = 'zwift';
    t.zwiftHandshakeTimeoutMs = 10;
    await t.connect();
    expect(t.identity?.protocol).toBe('zwift');
    expect(control.writes.slice(0, 2)).toEqual([[...RIDE_ON, 0x02, 0x01], RIDE_ON]);
  });

  it('sans réponse à « RideOn », se replie sur un autre protocole', async () => {
    const { device } = zwiftDevice(() => false);
    install(device);
    const { t, logs } = trainer();
    t.forcedProtocol = 'zwift';
    t.zwiftHandshakeTimeoutMs = 10;
    await t.connect();
    expect(t.identity?.protocol).toBe('ftms');
    expect(logs.some((l) => l.includes('Zwift (Cog) inutilisable'))).toBe(true);
    expect(logs.some((l) => l.includes('repli automatique'))).toBe(true);
  });
});
