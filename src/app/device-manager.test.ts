import { describe, expect, it, vi } from 'vitest';
import { DeviceRegistry, type DeviceRole } from '../infra/sensors/device-registry';
import type { SensorHub } from '../infra/sensors/hub';
import type { ConnectionState, TrainerAdapter } from '../infra/sensors/types';
import type { KeyValueStore } from '../infra/storage/key-value-store';
import { DeviceManager, type BleDevice, type BluetoothAccess, type DeviceTrainer, type RecallStatus } from './device-manager';

type StateFn = (s: ConnectionState, d?: string) => void;

class FakeBle implements BleDevice {
  private readonly listeners: StateFn[] = [];
  deviceId: string | undefined;
  waitingForDevice = false;
  connect = vi.fn(async (_hint?: string) => {});
  connectDevice = vi.fn(async (_d: BluetoothDevice, _keep?: boolean) => {});
  disconnect = vi.fn(async () => {});
  constructor(
    readonly name: string,
    deviceId?: string,
  ) {
    this.deviceId = deviceId;
  }
  on(ev: string, fn: StateFn) {
    if (ev === 'state') this.listeners.push(fn);
  }
  setState(s: ConnectionState, d?: string) {
    for (const fn of this.listeners) fn(s, d);
  }
}

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

function setup(over: { bluetooth?: Partial<BluetoothAccess>; ble?: FakeBle[]; hr?: FakeBle[] } = {}) {
  const stateListeners: StateFn[] = [];
  const trainerState = { device: undefined as FakeBle | undefined };
  const trainer = {
    on: vi.fn((ev: string, fn: StateFn) => {
      if (ev === 'state') stateListeners.push(fn);
      return () => {};
    }),
    attach: vi.fn((t: unknown) => void (trainerState.device = t as FakeBle)),
    connect: vi.fn(async (t: unknown, _hint?: string) => void (trainerState.device = t as FakeBle)),
    get device() {
      return trainerState.device as unknown as TrainerAdapter | undefined;
    },
    get name() {
      return trainerState.device?.name;
    },
  };
  const hub = { attachHeartRate: vi.fn() };
  const log = vi.fn();
  const registry = new DeviceRegistry(memory());
  const bles = over.ble ?? [new FakeBle('KICKR', 'id-kickr')];
  const hrs = over.hr ?? [new FakeBle('HRM', 'id-hrm')];
  const bluetooth: BluetoothAccess = {
    available: () => true,
    canRecall: () => true,
    recall: async () => new Map(),
    ...over.bluetooth,
  };
  const manager = new DeviceManager({
    hub: hub as unknown as SensorHub,
    trainer: trainer as unknown as DeviceTrainer,
    registry,
    log,
    createBleTrainer: () => bles.shift()! as never,
    createHeartRateMonitor: () => hrs.shift()! as never,
    bluetooth,
  });
  const changed = vi.fn();
  const recalls: RecallStatus[] = [];
  const settled = vi.fn();
  manager.on('changed', changed);
  manager.on('recall', (s) => recalls.push(s));
  manager.on('launchSettled', settled);
  const trainerStates = (s: ConnectionState) => stateListeners.forEach((fn) => fn(s));
  return { manager, trainer, trainerState, trainerStates, hub, log, registry, changed, recalls, settled };
}

const device = (name: string) => ({ name }) as BluetoothDevice;

describe('DeviceManager', () => {
  it('part sans appareil connecté', () => {
    const { manager } = setup();
    expect(manager.states).toEqual({ trainer: 'disconnected', hr: 'disconnected' });
    expect(manager.heartRate).toBeUndefined();
    expect(manager.known('trainer')).toBeUndefined();
  });

  describe('trainer', () => {
    it('suit l\'état du trainer et prévient l\'écran', () => {
      const { manager, trainerStates, changed } = setup();
      trainerStates('connecting');
      expect(manager.states.trainer).toBe('connecting');
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('retient un trainer Bluetooth connecté, pas un trainer sans identifiant (le simulé)', () => {
      const { manager, trainerStates, trainerState } = setup();
      trainerState.device = new FakeBle('KICKR', 'id-kickr');
      trainerStates('connected');
      expect(manager.known('trainer')).toMatchObject({ role: 'trainer', id: 'id-kickr', name: 'KICKR' });
      const sim = setup();
      sim.trainerState.device = new FakeBle('Trainer simulé');
      sim.trainerStates('connected');
      expect(sim.manager.known('trainer')).toBeUndefined();
    });

    it('connectTrainer prend un trainer Bluetooth neuf, avec le nom connu', async () => {
      const { manager, trainer } = setup();
      await manager.connectTrainer('KICKR');
      expect(trainer.connect).toHaveBeenCalledTimes(1);
      expect(trainer.connect.mock.calls[0]![1]).toBe('KICKR');
    });

    it('un trainer qui attend son appareil n\'occupe pas le rôle', () => {
      const { manager, trainerState } = setup();
      expect(manager.trainerWaiting).toBe(false);
      trainerState.device = Object.assign(new FakeBle('KICKR'), { waitingForDevice: true });
      expect(manager.trainerWaiting).toBe(true);
    });
  });

  describe('ceinture cardio', () => {
    it('se connecte, s\'attache au hub et publie ses états', () => {
      const { manager, hub, log, registry, changed } = setup();
      const states: [ConnectionState, string | undefined][] = [];
      manager.on('heartRateState', (s, d) => states.push([s, d]));
      manager.connectHeartRate('HRM');
      const hr = manager.heartRate as unknown as FakeBle;
      expect(hr.connect).toHaveBeenCalledWith('HRM');
      expect(hub.attachHeartRate).toHaveBeenCalledWith(hr);
      hr.setState('connected', 'ok');
      expect(manager.states.hr).toBe('connected');
      expect(states).toEqual([['connected', 'ok']]);
      expect(log).toHaveBeenCalledWith('cardio : connected (ok)');
      expect(registry.get('hr')).toMatchObject({ id: 'id-hrm', name: 'HRM' });
      expect(changed).toHaveBeenCalled();
    });

    it('lâche l\'ancienne ceinture et ignore ses derniers états', () => {
      const { manager } = setup({ hr: [new FakeBle('A', 'a'), new FakeBle('B', 'b')] });
      manager.connectHeartRate();
      const first = manager.heartRate as unknown as FakeBle;
      manager.connectHeartRate();
      const second = manager.heartRate as unknown as FakeBle;
      expect(first.disconnect).toHaveBeenCalled();
      first.setState('connected');
      expect(manager.states.hr).toBe('disconnected');
      second.setState('connected');
      expect(manager.states.hr).toBe('connected');
    });

    it('un échec de connexion est journalisé', async () => {
      const bad = new FakeBle('HRM');
      bad.connect.mockRejectedValueOnce(new Error('refusé'));
      const { manager, log } = setup({ hr: [bad] });
      manager.connectHeartRate();
      await Promise.resolve();
      await Promise.resolve();
      expect(log).toHaveBeenCalledWith('échec cardio : refusé');
    });

    it('se déconnecte à la demande, et sans ceinture ne fait rien', () => {
      const { manager } = setup();
      expect(() => manager.disconnectHeartRate()).not.toThrow();
      manager.connectHeartRate();
      manager.disconnectHeartRate();
      expect((manager.heartRate as unknown as FakeBle).disconnect).toHaveBeenCalled();
    });
  });

  describe('appareils connus', () => {
    it('oublier retire l\'appareil, le journalise et prévient l\'écran', () => {
      const { manager, registry, log, changed } = setup();
      registry.remember('trainer', { id: 'x', name: 'KICKR' });
      manager.forget('trainer');
      expect(manager.known('trainer')).toBeUndefined();
      expect(log).toHaveBeenCalledWith('appareil oublié : KICKR');
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('oublier un appareil inconnu ne fait rien', () => {
      const { manager, log, changed } = setup();
      manager.forget('hr');
      expect(log).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
    });
  });

  describe('reconnexion du lancement', () => {
    it('sans Bluetooth : rien à dire, seulement redessiner', async () => {
      const { manager, recalls, changed } = setup({ bluetooth: { available: () => false } });
      await manager.reconnectKnown();
      expect(recalls).toEqual([]);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('première utilisation : aucun appareil connu', async () => {
      const { manager, recalls } = setup();
      await manager.reconnectKnown();
      expect(recalls).toEqual([{ kind: 'first-use' }]);
    });

    it('navigateur sans getDevices : le dit et le journalise', async () => {
      const { manager, registry, recalls, log } = setup({ bluetooth: { canRecall: () => false } });
      registry.remember('trainer', { id: 'x', name: 'KICKR' });
      await manager.reconnectKnown();
      expect(recalls).toEqual([{ kind: 'unavailable' }]);
      expect(log).toHaveBeenCalledWith('reconnexion automatique indisponible : navigator.bluetooth.getDevices() absent');
    });

    it('getDevices échoue : le dit et le journalise', async () => {
      const { manager, registry, recalls, log } = setup({
        bluetooth: { recall: async () => Promise.reject(new Error('boum')) },
      });
      registry.remember('trainer', { id: 'x', name: 'KICKR' });
      await manager.reconnectKnown();
      expect(recalls).toEqual([{ kind: 'searching' }, { kind: 'failed' }]);
      expect(log).toHaveBeenCalledWith('getDevices() a échoué : boum');
    });

    it('autorisations perdues : l\'indique, appareil par appareil dans le journal', async () => {
      const { manager, registry, recalls, log } = setup();
      registry.remember('trainer', { id: 'x', name: 'KICKR' });
      await manager.reconnectKnown();
      expect(recalls).toEqual([{ kind: 'searching' }, { kind: 'permissions-lost' }]);
      expect(log).toHaveBeenCalledWith("KICKR : autorisation du site perdue, à reconnecter d'un clic");
    });

    it('retrouve le trainer et la ceinture, et les reconnecte en patientant', async () => {
      const found = new Map<DeviceRole, BluetoothDevice>([
        ['trainer', device('KICKR')],
        ['hr', device('HRM')],
      ]);
      const ble = new FakeBle('KICKR', 'id-kickr');
      const hr = new FakeBle('HRM', 'id-hrm');
      const { manager, registry, trainer, hub, recalls } = setup({ ble: [ble], hr: [hr], bluetooth: { recall: async () => found } });
      registry.remember('trainer', { id: 'id-kickr', name: 'KICKR' });
      registry.remember('hr', { id: 'id-hrm', name: 'HRM' });
      await manager.reconnectKnown();
      expect(trainer.attach).toHaveBeenCalledWith(ble);
      expect(ble.connectDevice).toHaveBeenCalledWith(found.get('trainer'), true);
      expect(hub.attachHeartRate).toHaveBeenCalledWith(hr);
      expect(hr.connectDevice).toHaveBeenCalledWith(found.get('hr'), true);
      expect(recalls.at(-1)).toEqual({ kind: 'reconnecting', names: ['KICKR', 'HRM'] });
    });

    describe('fin de la reconnexion', () => {
      async function launch(roles: DeviceRole[]) {
        const found = new Map<DeviceRole, BluetoothDevice>(roles.map((r) => [r, device(r)]));
        const hr = new FakeBle('HRM', 'id-hrm');
        const ctx = setup({ hr: [hr], bluetooth: { recall: async () => found } });
        for (const r of roles) ctx.registry.remember(r, { id: r, name: r });
        await ctx.manager.reconnectKnown();
        return { ...ctx, hr };
      }

      it('le trainer seul connecté suffit s\'il est seul à retrouver', async () => {
        const { trainerStates, settled } = await launch(['trainer']);
        trainerStates('connected');
        expect(settled).toHaveBeenCalledTimes(1);
      });

      it('attend la ceinture, tant qu\'elle n\'a pas abouti', async () => {
        const { trainerStates, settled, hr } = await launch(['trainer', 'hr']);
        trainerStates('connected');
        expect(settled).not.toHaveBeenCalled();
        hr.setState('connecting');
        expect(settled).not.toHaveBeenCalled();
        hr.setState('connected');
        expect(settled).toHaveBeenCalledTimes(1);
      });

      it('une ceinture en échec compte comme aboutie', async () => {
        const { trainerStates, settled, hr } = await launch(['trainer', 'hr']);
        hr.setState('error');
        expect(settled).not.toHaveBeenCalled(); // le trainer n'est pas encore connecté
        trainerStates('connected');
        expect(settled).toHaveBeenCalledTimes(1);
      });

      it('ne se déclare qu\'une fois', async () => {
        const { trainerStates, settled } = await launch(['trainer']);
        trainerStates('connected');
        trainerStates('connected');
        expect(settled).toHaveBeenCalledTimes(1);
      });

      it('sans reconnexion du lancement, une connexion à la main ne déclenche rien', () => {
        const { trainerStates, settled } = setup();
        trainerStates('connected');
        expect(settled).not.toHaveBeenCalled();
      });
    });
  });
});
