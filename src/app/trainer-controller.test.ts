import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SensorHub } from '../infra/sensors/hub';
import type { ConnectionState, SensorEvents, SimulationParams, TrainerAdapter, TrainerCapabilities } from '../infra/sensors/types';
import { GradeController } from './grade-controller';
import { TrainerController } from './trainer-controller';

class FakeAdapter implements TrainerAdapter {
  private readonly handlers: Partial<{ [K in keyof SensorEvents]: SensorEvents[K][] }> = {};
  connect = vi.fn(async () => {});
  disconnect = vi.fn(async () => {});
  setTargetPower = vi.fn(async () => {});
  setSimulation = vi.fn(async () => {});
  constructor(
    readonly name = 'Trainer de test',
    readonly capabilities: TrainerCapabilities = { targetPower: true, simulation: true },
  ) {}
  on<K extends keyof SensorEvents>(ev: K, fn: SensorEvents[K]): void {
    (this.handlers[ev] ??= [] as never).push(fn as never);
  }
  setState(s: ConnectionState, detail?: string) {
    for (const fn of this.handlers.state ?? []) fn(s, detail);
  }
}

function setup(caps?: TrainerCapabilities) {
  const hub = {
    attachTrainer: vi.fn(),
    setTargetPower: vi.fn(async (_w: number) => {}),
    setSimulation: vi.fn(async (_p: SimulationParams) => {}),
  };
  const grade = new GradeController();
  const log = vi.fn();
  const ctl = new TrainerController({ hub: hub as unknown as SensorHub, grade, log });
  const adapter = new FakeAdapter('Trainer de test', caps);
  ctl.attach(adapter);
  const connect = () => adapter.setState('connected');
  return { ctl, hub, grade, log, adapter, connect };
}

describe('TrainerController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('part déconnecté, sans adaptateur', () => {
    const ctl = new TrainerController({ hub: {} as SensorHub, grade: new GradeController(), log: vi.fn() });
    expect(ctl.state).toBe('disconnected');
    expect(ctl.connected).toBe(false);
    expect(ctl.device).toBeUndefined();
    expect(ctl.name).toBeUndefined();
    expect(ctl.canErg).toBe(false);
    expect(ctl.canSimulate).toBe(false);
  });

  it('branche l\'adaptateur sur le hub et publie ses changements d\'état', () => {
    const { ctl, hub, adapter } = setup();
    expect(hub.attachTrainer).toHaveBeenCalledWith(adapter);
    const seen: [ConnectionState, string | undefined][] = [];
    ctl.on('state', (s, d) => seen.push([s, d]));
    adapter.setState('connecting');
    adapter.setState('connected', 'ok');
    expect(seen).toEqual([['connecting', undefined], ['connected', 'ok']]);
    expect(ctl.state).toBe('connected');
    expect(ctl.name).toBe('Trainer de test');
  });

  it('lâche l\'ancien adaptateur et ignore ses derniers états', () => {
    const { ctl, adapter } = setup();
    const next = new FakeAdapter('Autre');
    ctl.attach(next);
    expect(adapter.disconnect).toHaveBeenCalled();
    const seen: ConnectionState[] = [];
    ctl.on('state', (s) => seen.push(s));
    adapter.setState('connected'); // l'ancien, remplacé
    expect(seen).toEqual([]);
    expect(ctl.state).toBe('disconnected');
    next.setState('connected');
    expect(seen).toEqual(['connected']);
  });

  it('ne se déconnecte pas de lui-même quand on le rattache', () => {
    const { ctl, adapter } = setup();
    ctl.attach(adapter);
    expect(adapter.disconnect).not.toHaveBeenCalled();
  });

  it('connect : se connecte, et journalise un échec sans le relancer', async () => {
    const { ctl, log } = setup();
    const ok = new FakeAdapter();
    await ctl.connect(ok, 'KICKR');
    expect(ok.connect).toHaveBeenCalledWith('KICKR');
    const bad = new FakeAdapter();
    bad.connect.mockRejectedValueOnce(new Error('refusé'));
    await expect(ctl.connect(bad)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('échec de connexion : refusé');
  });

  it('canErg et canSimulate suivent la connexion et les capacités', () => {
    const { ctl, connect } = setup({ targetPower: true, simulation: false });
    expect(ctl.canErg).toBe(false); // pas encore connecté
    connect();
    expect(ctl.canErg).toBe(true);
    expect(ctl.canSimulate).toBe(false);
  });

  it('send journalise l\'envoi ou le refus', async () => {
    const { ctl, log } = setup();
    await expect(ctl.send('ERG 200 W', async () => {})).resolves.toBe(true);
    expect(log).toHaveBeenLastCalledWith('ERG 200 W envoyé');
    await expect(ctl.send('ERG 200 W', async () => Promise.reject(new Error('Aucun trainer connecté')))).resolves.toBe(false);
    expect(log).toHaveBeenLastCalledWith('ERG 200 W refusé : Aucun trainer connecté');
  });

  it('engageErg engage l\'ERG et le dit ; un refus le laisse relâché', async () => {
    const { ctl, hub } = setup();
    const events: boolean[] = [];
    ctl.on('erg', (e) => events.push(e));
    await expect(ctl.engageErg(180)).resolves.toBe(true);
    expect(hub.setTargetPower).toHaveBeenCalledWith(180);
    expect(ctl.ergActive).toBe(true);
    ctl.setErgActive(false);
    hub.setTargetPower.mockRejectedValueOnce(new Error('non'));
    await expect(ctl.engageErg(180)).resolves.toBe(false);
    expect(ctl.ergActive).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it('une pente imposée à la main remplace l\'ERG', async () => {
    const { ctl, hub } = setup();
    ctl.setErgActive(true);
    await ctl.setManualGrade(4);
    expect(hub.setSimulation).toHaveBeenCalledWith({ gradePct: 4 });
    expect(ctl.ergActive).toBe(false);
  });

  it('retargetErg change la cible sans toucher à l\'état de l\'ERG', async () => {
    const { ctl, hub } = setup();
    await ctl.retargetErg(220);
    expect(hub.setTargetPower).toHaveBeenCalledWith(220);
    expect(ctl.ergActive).toBe(false);
  });

  describe('releaseErg', () => {
    it('ne fait rien si l\'ERG n\'est pas engagé', () => {
      const { ctl, hub, log } = setup();
      ctl.releaseErg('fin', { rideActive: false, gradePct: 0 });
      expect(log).not.toHaveBeenCalled();
      expect(hub.setSimulation).not.toHaveBeenCalled();
    });

    it('pendant une sortie : relâche et journalise, la pente du parcours reprend', () => {
      const { ctl, hub, log, connect } = setup();
      connect();
      ctl.setErgActive(true);
      ctl.releaseErg('séance arrêtée', { rideActive: true, gradePct: 2 });
      expect(ctl.ergActive).toBe(false);
      expect(log).toHaveBeenCalledWith('séance arrêtée');
      expect(hub.setSimulation).not.toHaveBeenCalled();
    });

    it('sans sortie et connecté : envoie une pente pour quitter l\'ERG', () => {
      const { ctl, hub, connect } = setup();
      connect();
      ctl.setErgActive(true);
      ctl.releaseErg('séance arrêtée', { rideActive: false, gradePct: 2 });
      expect(hub.setSimulation).toHaveBeenCalledWith({ gradePct: 2 });
    });

    it('trainer perdu : relâche et journalise, sans rien envoyer', () => {
      const { ctl, hub, log } = setup();
      ctl.setErgActive(true);
      ctl.releaseErg('trainer perdu', { rideActive: false, gradePct: 0 });
      expect(ctl.ergActive).toBe(false);
      expect(log).toHaveBeenCalledWith('trainer perdu');
      expect(hub.setSimulation).not.toHaveBeenCalled();
    });
  });

  it('sendCourseGrade : un échec est journalisé, puis la pente est renvoyée après 2 s', async () => {
    const { ctl, hub, grade, log } = setup();
    const retry = vi.spyOn(grade, 'retry');
    hub.setSimulation.mockRejectedValueOnce(new Error('BLE occupé'));
    ctl.sendCourseGrade({ gradePct: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith('pente non envoyée : BLE occupé');
    expect(retry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('resetToFlat ne parle au trainer que s\'il est connecté', () => {
    const { ctl, hub, connect } = setup();
    ctl.resetToFlat();
    expect(hub.setSimulation).not.toHaveBeenCalled();
    connect();
    ctl.resetToFlat();
    expect(hub.setSimulation).toHaveBeenCalledWith({ gradePct: 0 });
  });

  it('resetToFlat n\'échoue jamais, même si le trainer refuse', async () => {
    const { ctl, hub, connect } = setup();
    connect();
    hub.setSimulation.mockRejectedValueOnce(new Error('non'));
    ctl.resetToFlat();
    await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow();
  });
});
