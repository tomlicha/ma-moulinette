import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StravaStatus } from '../infra/export/strava/client';
import type { StravaPort } from '../infra/export/strava/port';
import type { Measurement } from '../infra/sensors/types';
import { RESUME_S, RideExport, type ExportPlatform, type FitEncoder } from './ride-export';

const T0 = 1_700_000_000_000;

function setup(initial: StravaStatus | Error = { configured: false, connected: false }, over: { native?: boolean } = {}) {
  const handlers: ((m: Measurement) => void)[] = [];
  const hub = { on: vi.fn((ev: string, fn: (m: Measurement) => void) => void (ev === 'measurement' && handlers.push(fn))) };
  const remote = { status: initial as StravaStatus | Error };
  const popup = { location: { href: '' }, close: vi.fn() };
  const strava = {
    status: vi.fn(async () => {
      if (remote.status instanceof Error) throw remote.status;
      return remote.status;
    }),
    loginUrl: vi.fn(async () => 'https://strava.test/login'),
    ownerKey: vi.fn(() => 'ancienne-clé'),
    setOwnerKey: vi.fn(),
    waitForLogin: vi.fn(async (_w: Window) => true),
    send: vi.fn(async (_fit: Uint8Array, _meta: { name: string; externalId: string }): Promise<Awaited<ReturnType<StravaPort['send']>>> => ({ ok: true, activityUrl: 'https://strava.test/a/1' })),
    nativeLogin: vi.fn(async () => true),
    isNative: vi.fn(() => over.native ?? false),
  } satisfies StravaPort;
  const platform = {
    askOwnerKey: vi.fn((_current: string): string | null => 'clé'),
    openLoginWindow: vi.fn((): Window | null => popup as unknown as Window),
    saveFile: vi.fn(),
  } satisfies ExportPlatform;
  const encoder: FitEncoder = {
    encodeActivity: vi.fn((rec) => new Uint8Array(rec.samples.length * 100)),
    fitFileName: (ms) => `sortie-${ms}.fit`,
  };
  const log = vi.fn();
  const exporter = new RideExport({ hub: hub as never, routeName: 'Col des Érables', log, platform, strava, loadEncoder: async () => encoder });
  const changed = vi.fn();
  const resumed = vi.fn();
  exporter.on('changed', changed);
  exporter.on('resumed', resumed);
  /** Pédale `seconds` secondes à `powerW` (0 : on s'arrête de pédaler). */
  const pedal = (seconds: number, powerW = 200) => {
    for (let i = 0; i < seconds; i++) {
      for (const h of handlers) h({ t: Date.now(), powerW, cadenceRpm: powerW ? 90 : 0 });
      vi.advanceTimersByTime(1000);
    }
  };
  const flush = () => vi.advanceTimersByTimeAsync(0);
  return { exporter, hub, remote, strava, platform, popup, encoder, log, changed, resumed, pedal, flush };
}

async function started(...args: Parameters<typeof setup>) {
  const ctx = setup(...args);
  ctx.exporter.start();
  await ctx.flush();
  return ctx;
}

describe('RideExport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  describe('enregistrement', () => {
    it('part vide, sans Strava', () => {
      const { exporter } = setup();
      expect(exporter.status()).toEqual({ samples: 0, paused: false, frozenSamples: undefined, kept: false, stravaConfigured: false, busy: false });
      expect(exporter.current()).toBeUndefined();
      expect(exporter.strava()).toBe('none');
    });

    it('enregistre une seconde par seconde une fois démarré, et prévient à chaque pas', async () => {
      const { exporter, pedal, changed } = await started();
      pedal(5);
      expect(exporter.status().samples).toBeGreaterThanOrEqual(4);
      expect(changed.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it("ne commence le FIT qu'au premier coup de pédale, avec son timestamp exact", async () => {
      const { exporter, hub, pedal } = await started();
      const handlers = (hub.on.mock.calls as unknown as [string, (m: Measurement) => void][]).filter(([event]) => event === 'measurement').map(([, handler]) => handler);
      handlers.forEach((handler) => handler({ t: Date.now(), heartRateBpm: 130, powerW: 0, cadenceRpm: 0 } as Measurement));
      vi.advanceTimersByTime(5000);
      expect(exporter.status().samples).toBe(0);
      const firstPedalAt = Date.now();
      handlers.forEach((handler) => handler({ t: firstPedalAt, heartRateBpm: 131, powerW: 150, cadenceRpm: 80 } as Measurement));
      expect(exporter.current()?.startMs).toBe(firstPedalAt);
      expect(exporter.current()?.samples[0]).toMatchObject({ t: firstPedalAt, powerW: 150, cadenceRpm: 80, heartRateBpm: 131 });
      pedal(2);
    });

    it('se met en pause quand le trainer est perdu, et reprend à la reconnexion', async () => {
      const { exporter, pedal } = await started();
      pedal(3);
      exporter.onTrainerState('disconnected');
      expect(exporter.status().paused).toBe(true);
      exporter.onTrainerState('connected');
      expect(exporter.status().paused).toBe(false);
    });

    it('note les valeurs de la sortie et de la séance dans l\'enregistrement', async () => {
      const { exporter, pedal } = await started();
      exporter.onRide({ speedKmh: 36, distanceM: 120, altitudeM: 55 } as never);
      exporter.onWorkoutState(180, 2);
      pedal(2);
      const rec = exporter.current()!;
      expect(rec.samples.at(-1)).toMatchObject({ speedMs: 10, distanceM: 120, altitudeM: 55, targetW: 180, stepIndex: 2 });
    });
  });

  describe('sortie figée', () => {
    it('est figée à l\'arrêt de la sortie, avec un journal, et sert d\'export', async () => {
      const { exporter, pedal, log, changed } = await started();
      pedal(10);
      changed.mockClear();
      exporter.onRideStopped();
      const frozen = exporter.status().frozenSamples!;
      expect(frozen).toBeGreaterThanOrEqual(9);
      expect(exporter.current()!.samples).toHaveLength(frozen);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`sortie arrêtée : l’export s’arrêtera ici (${frozen} s)`));
      expect(changed).toHaveBeenCalled();
      pedal(5, 0); // la sortie figée ne bouge plus
      expect(exporter.status().frozenSamples).toBe(frozen);
    });

    it('une séance terminée fige aussi, avec son propre message', async () => {
      const { exporter, pedal, log } = await started();
      pedal(4);
      exporter.onWorkoutFinished();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('séance terminée : l’export s’arrêtera ici'));
    });

    it('sans rien d\'enregistré, rien n\'est figé', () => {
      const { exporter, log } = setup();
      exporter.onRideStopped();
      expect(exporter.status().frozenSamples).toBeUndefined();
      expect(log).not.toHaveBeenCalled();
    });

    it('« continuer » libère la sortie figée', async () => {
      const { exporter, pedal, log } = await started();
      pedal(5);
      exporter.onRideStopped();
      exporter.releaseFrozen();
      expect(exporter.status().frozenSamples).toBeUndefined();
      expect(log).toHaveBeenCalledWith('le cycliste continue : l’export couvrira toute la sortie');
      log.mockClear();
      exporter.releaseFrozen(); // déjà libérée
      expect(log).not.toHaveBeenCalled();
    });

    it('un arrêt puis quelques secondes de pédalage la font abandonner, en le disant d\'abord', async () => {
      const { exporter, pedal, resumed, log } = await started();
      pedal(10);
      exporter.onRideStopped();
      let frozenWhenResumed: number | undefined;
      resumed.mockImplementation(() => (frozenWhenResumed = exporter.status().frozenSamples));
      pedal(2, 0); // l'arrêt
      pedal(RESUME_S + 2); // le repart
      expect(resumed).toHaveBeenCalledTimes(1);
      expect(frozenWhenResumed).toBeDefined(); // annoncé avant l'abandon de la sortie figée
      expect(exporter.status().frozenSamples).toBeUndefined();
      expect(log).toHaveBeenCalledWith('pédalage repris : l’export couvrira toute la sortie');
    });

    it('le pédalage qui continue sans arrêt ne compte pas pour une reprise', async () => {
      const { exporter, pedal, resumed } = await started();
      pedal(10);
      exporter.onRideStopped();
      pedal(15);
      expect(resumed).not.toHaveBeenCalled();
      expect(exporter.status().frozenSamples).toBeDefined();
    });
  });

  describe('nom de l\'activité', () => {
    it('porte la route par défaut, la séance quand il y en a une', () => {
      const { exporter } = setup();
      expect(exporter.defaultName()).toBe('Ma Moulinette - Col des Érables');
      exporter.onWorkoutStarted('Sweet spot');
      expect(exporter.defaultName()).toBe('Ma Moulinette - Sweet spot');
    });

    it('une nouvelle séance abandonne la sortie figée', async () => {
      const { exporter, pedal } = await started();
      pedal(5);
      exporter.onRideStopped();
      exporter.onWorkoutStarted('Rampe');
      expect(exporter.status().frozenSamples).toBeUndefined();
    });
  });

  describe('fichier FIT', () => {
    it('donne le fichier au coureur, et le dit', async () => {
      const { exporter, pedal, platform, log } = await started();
      pedal(5);
      await exporter.downloadFit();
      expect(platform.saveFile).toHaveBeenCalledTimes(1);
      const [name, bytes] = platform.saveFile.mock.calls[0]!;
      expect(name).toMatch(/^sortie-\d+\.fit$/);
      expect(bytes.length).toBeGreaterThan(0);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^export FIT : \d+ échantillons/));
      expect(exporter.status().samples).toBe(0); // l'enregistrement est repartie à zéro
    });

    it('exporte la sortie figée, pas les secondes d\'après', async () => {
      const { exporter, pedal, encoder } = await started();
      pedal(8);
      exporter.onRideStopped();
      const frozen = exporter.status().frozenSamples!;
      pedal(5, 0);
      await exporter.downloadFit();
      expect(vi.mocked(encoder.encodeActivity).mock.calls[0]![0].samples).toHaveLength(frozen);
    });

    it('rien à exporter : le dit, sans fichier', async () => {
      const { exporter, platform, log } = await started();
      await exporter.downloadFit();
      expect(platform.saveFile).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('export FIT : rien à exporter');
    });

    it('prévient à la fin de l\'export, une fois libre', async () => {
      const { exporter, pedal, changed } = await started();
      pedal(3);
      changed.mockClear();
      await exporter.downloadFit();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(exporter.status().busy).toBe(false);
    });

    it('un encodage qui échoue est journalisé, sans planter', async () => {
      const { exporter, pedal, encoder, log } = await started();
      pedal(3);
      vi.mocked(encoder.encodeActivity).mockImplementationOnce(() => {
        throw new Error('FIT invalide');
      });
      await expect(exporter.downloadFit()).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith('export FIT impossible : FIT invalide');
      expect(exporter.status().busy).toBe(false);
    });
  });

  describe('Strava', () => {
    it('reflète l\'état du relais', async () => {
      const unlocked = await started({ configured: true, connected: true, athlete: 'Tom' });
      expect(unlocked.exporter.strava()).toBe('ready');
      expect(unlocked.exporter.status().stravaConfigured).toBe(true);
      expect((await started({ configured: true, connected: false })).exporter.strava()).toBe('login');
      expect((await started({ configured: true, connected: false, locked: true })).exporter.strava()).toBe('locked');
      expect((await started({ configured: false, connected: false })).exporter.strava()).toBe('none');
    });

    it('sans relais (build statique), tout reste caché', async () => {
      const { exporter } = await started(new Error('HTTP 404'));
      expect(exporter.status().stravaConfigured).toBe(false);
      expect(exporter.strava()).toBe('none');
    });

    describe('envoi', () => {
      it('connecté : envoie le fichier sous le nom proposé et rend l\'activité créée', async () => {
        const { exporter, pedal, strava, log } = await started({ configured: true, connected: true });
        pedal(6);
        exporter.onWorkoutStarted('Sweet spot');
        pedal(3);
        const out = await exporter.sendToStrava();
        expect(out).toEqual({ ok: true, name: 'Ma Moulinette - Sweet spot', activityUrl: 'https://strava.test/a/1' });
        expect(strava.send).toHaveBeenCalledTimes(1);
        const meta = strava.send.mock.calls[0]![1];
        expect(meta.name).toBe('Ma Moulinette - Sweet spot');
        expect(meta.externalId).toMatch(/^mamoulinette-\d+$/);
        expect(log).toHaveBeenCalledWith('Strava : envoi en cours…');
        expect(exporter.status().kept).toBe(false);
      });

      it('le nom donné par le récapitulatif l\'emporte', async () => {
        const { exporter, pedal, strava } = await started({ configured: true, connected: true });
        pedal(4);
        await exporter.sendToStrava('Ma sortie du matin');
        expect(strava.send.mock.calls[0]![1].name).toBe('Ma sortie du matin');
      });

      it('fichier reçu mais pas encore traité : le dit', async () => {
        const { exporter, pedal, strava } = await started({ configured: true, connected: true });
        pedal(4);
        strava.send.mockResolvedValueOnce({ ok: true, processing: true });
        expect(await exporter.sendToStrava()).toMatchObject({ ok: true, processing: true });
      });

      it('rien à envoyer : échoue sans garder de sortie', async () => {
        const { exporter, strava } = await started({ configured: true, connected: true });
        const out = await exporter.sendToStrava();
        expect(out).toMatchObject({ ok: false, message: 'rien à envoyer', kept: false });
        expect(strava.send).not.toHaveBeenCalled();
      });

      it('est occupé pendant l\'envoi', async () => {
        const { exporter, pedal } = await started({ configured: true, connected: true });
        pedal(4);
        const busy: boolean[] = [];
        exporter.on('changed', () => busy.push(exporter.status().busy));
        await exporter.sendToStrava();
        expect(busy[0]).toBe(true);
        expect(exporter.status().busy).toBe(false);
      });
    });

    describe('connexion', () => {
      it('ouvre la fenêtre dans le geste, y met l\'adresse de connexion, attend, puis envoie', async () => {
        const ctx = await started({ configured: true, connected: false });
        ctx.pedal(4);
        ctx.strava.waitForLogin.mockImplementationOnce(async () => {
          ctx.remote.status = { configured: true, connected: true, athlete: 'Tom' };
          return true;
        });
        const pending = ctx.exporter.sendToStrava();
        expect(ctx.platform.openLoginWindow).toHaveBeenCalledTimes(1); // avant tout `await`
        const out = await pending;
        expect(ctx.popup.location.href).toBe('https://strava.test/login');
        expect(ctx.strava.waitForLogin).toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith('Strava : connecté (Tom)');
        expect(out.ok).toBe(true);
      });

      it('connexion non terminée : la sortie est gardée pour un nouvel essai', async () => {
        const ctx = await started({ configured: true, connected: false });
        ctx.pedal(4);
        const out = await ctx.exporter.sendToStrava();
        expect(out).toMatchObject({ ok: false, kept: true, login: true });
        expect(ctx.strava.send).not.toHaveBeenCalled();
        expect(ctx.exporter.status().kept).toBe(true);
      });

      it('fenêtre bloquée par le navigateur : le dit, et garde la sortie', async () => {
        const ctx = await started({ configured: true, connected: false });
        ctx.pedal(4);
        ctx.platform.openLoginWindow.mockReturnValueOnce(null);
        const out = await ctx.exporter.sendToStrava();
        expect(out).toMatchObject({ ok: false, kept: true });
        expect((out as { message: string }).message).toContain('fenêtre de connexion bloquée');
      });

      it('coquille native : pas de fenêtre, une session système', async () => {
        const ctx = await started({ configured: true, connected: false }, { native: true });
        ctx.pedal(4);
        ctx.strava.nativeLogin.mockImplementationOnce(async () => {
          ctx.remote.status = { configured: true, connected: true };
          return true;
        });
        const out = await ctx.exporter.sendToStrava();
        expect(ctx.platform.openLoginWindow).not.toHaveBeenCalled();
        expect(ctx.strava.nativeLogin).toHaveBeenCalled();
        expect(out.ok).toBe(true);
      });
    });

    describe('relais verrouillé', () => {
      it('sans clé saisie : renonce', async () => {
        const ctx = await started({ configured: true, connected: true, locked: true });
        ctx.pedal(4);
        ctx.platform.askOwnerKey.mockReturnValueOnce(null);
        const out = await ctx.exporter.sendToStrava();
        expect(out).toEqual({ ok: false, message: 'clé d’accès non saisie', kept: true, login: false });
        expect(ctx.platform.askOwnerKey).toHaveBeenCalledWith('ancienne-clé');
        expect(ctx.strava.setOwnerKey).not.toHaveBeenCalled();
      });

      it('clé acceptée : elle est gardée (sans espaces) et l\'envoi part', async () => {
        const ctx = await started({ configured: true, connected: true, locked: true });
        ctx.pedal(4);
        ctx.platform.askOwnerKey.mockReturnValueOnce('  la-clé  ');
        ctx.strava.setOwnerKey.mockImplementationOnce(() => void (ctx.remote.status = { configured: true, connected: true }));
        const out = await ctx.exporter.sendToStrava();
        expect(ctx.strava.setOwnerKey).toHaveBeenCalledWith('la-clé');
        expect(out.ok).toBe(true);
      });

      it('clé refusée : elle est oubliée', async () => {
        const ctx = await started({ configured: true, connected: true, locked: true });
        ctx.pedal(4);
        const out = await ctx.exporter.sendToStrava();
        expect(ctx.strava.setOwnerKey).toHaveBeenLastCalledWith('');
        expect(out).toMatchObject({ ok: false, message: 'clé d’accès refusée', kept: true });
      });
    });

    describe('échecs de l\'envoi', () => {
      it('refus de Strava (déjà envoyée) : inutile de renvoyer, la sortie n\'est pas gardée', async () => {
        const { exporter, pedal, strava } = await started({ configured: true, connected: true });
        pedal(4);
        strava.send.mockResolvedValueOnce({ ok: false, reason: 'rejected', message: 'duplicate of activity 1' });
        const out = await exporter.sendToStrava();
        expect(out).toMatchObject({ ok: false, kept: false });
        expect((out as { message: string }).message).toBe('déjà envoyée (duplicate of activity 1)');
        expect(exporter.status().kept).toBe(false);
      });

      it('panne du relais : la sortie est gardée, et un nouvel essai renvoie le même fichier', async () => {
        const { exporter, pedal, strava } = await started({ configured: true, connected: true });
        pedal(4);
        strava.send.mockResolvedValueOnce({ ok: false, reason: 'error', message: 'relais injoignable' });
        const first = await exporter.sendToStrava();
        expect(first).toMatchObject({ ok: false, kept: true });
        expect(exporter.status().kept).toBe(true);
        const bytes = strava.send.mock.calls[0]![0];
        const retry = await exporter.sendToStrava('Autre nom');
        expect(retry).toMatchObject({ ok: true, name: 'Autre nom' });
        expect(strava.send.mock.calls[1]![0]).toBe(bytes);
      });

      it('connexion perdue côté Strava : le prochain essai passera par la connexion', async () => {
        const ctx = await started({ configured: true, connected: true });
        ctx.pedal(4);
        ctx.strava.send.mockImplementationOnce(async () => {
          ctx.remote.status = { configured: true, connected: false };
          return { ok: false, reason: 'not_connected', message: 'connexion Strava nécessaire' };
        });
        const out = await ctx.exporter.sendToStrava();
        expect(out).toMatchObject({ ok: false, kept: true, login: true });
        expect(ctx.exporter.strava()).toBe('login');
      });

      it('exception imprévue : journalisée, la fenêtre ouverte est fermée, la sortie gardée', async () => {
        const ctx = await started({ configured: true, connected: false });
        ctx.pedal(4);
        ctx.strava.loginUrl.mockRejectedValueOnce(new Error('boum'));
        const out = await ctx.exporter.sendToStrava();
        expect(out).toMatchObject({ ok: false, kept: true });
        expect(ctx.popup.close).toHaveBeenCalled();
        expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('échec (boum)'));
        expect(ctx.exporter.status().busy).toBe(false);
      });
    });
  });
});
