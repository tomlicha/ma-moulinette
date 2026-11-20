import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_WORKOUTS } from '../domain/workout/samples';
import { parseWorkout } from '../domain/workout/runner';
import { WorkoutSession, type CompletedWorkout } from './workout-session';

const sample = SAMPLE_WORKOUTS.find((s) => s.id === 'sweet-spot')!;
const workout = () => parseWorkout(sample.fileName, sample.text);

function setup(over: { connected?: boolean } = {}) {
  const trainer = {
    connected: over.connected ?? true,
    ergActive: false,
    setErgActive: vi.fn((on: boolean) => void (trainer.ergActive = on)),
    setTargetPower: vi.fn(async (_w: number) => {}),
    releaseErg: vi.fn(),
  };
  const log = vi.fn();
  let rideActive = false;
  const session = new WorkoutSession({
    trainer,
    ftpW: () => 200,
    rideActive: () => rideActive,
    manualGradePct: () => 3,
    log,
  });
  const events: string[] = [];
  for (const e of ['state', 'changed', 'intensity', 'started', 'stepped', 'completing', 'ended'] as const) {
    session.on(e, (() => events.push(e)) as never);
  }
  return { session, trainer, log, events, setRide: (v: boolean) => (rideActive = v) };
}

/** Laisse passer les promesses en attente (l'envoi de la consigne). */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('WorkoutSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('part sans séance, ni choisie ni en cours', () => {
    const { session } = setup();
    expect(session.workout).toBeUndefined();
    expect(session.running).toBe(false);
    expect(session.paused).toBe(false);
    expect(session.state).toBeUndefined();
  });

  it('choisit une séance, et efface l\'état affiché', () => {
    const { session, events } = setup();
    expect(session.select(workout())).toBe(true);
    expect(session.workout?.name).toBe(workout().name);
    expect(events).toEqual(['state']);
  });

  it('refuse de changer de séance pendant qu\'elle tourne', () => {
    const { session } = setup();
    const w = workout();
    session.select(w);
    session.start();
    expect(session.select(undefined)).toBe(false);
    expect(session.workout).toBe(w);
  });

  describe('départ', () => {
    it('ne démarre pas sans séance choisie', () => {
      const { session, events } = setup();
      session.start();
      expect(session.running).toBe(false);
      expect(events).toEqual([]);
    });

    it('démarre avec la FTP du coureur, à 100 %, et le dit dans l\'ordre', () => {
      const { session, events, log } = setup();
      session.select(workout());
      events.length = 0;
      session.start();
      expect(session.running).toBe(true);
      expect(session.runner?.ftpW).toBe(200);
      expect(session.runner?.intensity).toBe(1);
      expect(events.slice(0, 3)).toEqual(['intensity', 'changed', 'started']);
      expect(events).toContain('state'); // premier pas aussitôt
      expect(log).toHaveBeenCalledWith(`séance démarrée : ${workout().name}, FTP 200 W`);
    });

    it('en démarrage différé, le chronomètre attend le premier coup de pédale', () => {
      const { session } = setup();
      session.select(workout());
      session.start(undefined, true);
      expect(session.running).toBe(true);
      expect(session.state?.elapsedS).toBe(0);
      vi.advanceTimersByTime(5000);
      expect(session.state?.elapsedS).toBe(0);
      session.onMeasurement({ powerW: 150 });
      vi.advanceTimersByTime(2000);
      expect(session.state!.elapsedS).toBeGreaterThan(1.5);
    });

    it('après arrêt, une nouvelle séance peut démarrer son propre chronomètre', () => {
      const { session } = setup();
      session.select(workout());
      session.start(undefined, true);
      session.onMeasurement({ cadenceRpm: 80 });
      session.stop();
      session.start(undefined, true);
      session.onMeasurement({ powerW: 100 });
      vi.advanceTimersByTime(1000);
      expect(session.state!.elapsedS).toBeGreaterThan(0.5);
    });

    it('ignore un second départ', () => {
      const { session, events } = setup();
      session.select(workout());
      session.start();
      const before = events.length;
      session.start();
      expect(events.length).toBe(before);
    });

    it('envoie la première consigne et engage l\'ERG', async () => {
      const { session, trainer, log } = setup();
      session.select(workout());
      session.start();
      await flush();
      expect(trainer.setTargetPower).toHaveBeenCalledTimes(1);
      const w = trainer.setTargetPower.mock.calls[0]![0];
      expect(w).toBeGreaterThan(0);
      expect(trainer.setErgActive).toHaveBeenCalledWith(true);
      expect(log).toHaveBeenCalledWith(`séance : ERG engagé à ${w} W`);
    });
  });

  describe('temps de séance', () => {
    it('avance avec le temps réel quand le trainer est connecté', () => {
      const { session } = setup();
      session.select(workout());
      session.start();
      vi.advanceTimersByTime(5000);
      expect(session.state!.elapsedS).toBeGreaterThan(4);
      expect(session.state!.elapsedS).toBeLessThan(6);
    });

    it('s\'arrête sans trainer connecté, et n\'envoie rien', async () => {
      const { session, trainer } = setup({ connected: false });
      session.select(workout());
      session.start();
      vi.advanceTimersByTime(5000);
      await flush();
      expect(session.state!.elapsedS).toBe(0);
      expect(trainer.setTargetPower).not.toHaveBeenCalled();
    });

    it('la pause fige le temps et l\'ERG ; la reprise repart', async () => {
      const { session, trainer, events } = setup();
      session.select(workout());
      session.start();
      await flush();
      vi.advanceTimersByTime(2000);
      events.length = 0;
      session.togglePause();
      expect(session.paused).toBe(true);
      expect(events).toEqual(['changed']);
      const frozen = session.state!.elapsedS;
      trainer.setTargetPower.mockClear();
      vi.advanceTimersByTime(5000);
      expect(session.state!.elapsedS).toBe(frozen);
      session.togglePause();
      expect(session.paused).toBe(false);
      vi.advanceTimersByTime(2000);
      expect(session.state!.elapsedS).toBeGreaterThan(frozen);
    });

    it('pause sans séance : rien', () => {
      const { session, events } = setup();
      session.togglePause();
      expect(session.paused).toBe(false);
      expect(events).toEqual([]);
    });
  });

  describe('commandes', () => {
    it('passer au palier suivant avance l\'index et renvoie la consigne', async () => {
      const { session, trainer } = setup();
      session.select(workout());
      session.start();
      await flush();
      const before = session.state!.stepIndex;
      trainer.setTargetPower.mockClear();
      session.skip();
      await flush();
      expect(session.state!.stepIndex).toBe(before + 1);
      expect(trainer.setTargetPower).toHaveBeenCalledTimes(1);
    });

    it('règle l\'intensité par pas, entre 50 et 150 %', () => {
      const { session } = setup();
      const seen: number[] = [];
      session.on('intensity', (f) => seen.push(f));
      session.select(workout());
      session.start();
      session.adjustIntensity(0.05);
      session.adjustIntensity(0.05);
      expect(session.runner?.intensity).toBe(1.1);
      for (let i = 0; i < 30; i++) session.adjustIntensity(0.05);
      expect(session.runner?.intensity).toBe(1.5);
      for (let i = 0; i < 60; i++) session.adjustIntensity(-0.05);
      expect(session.runner?.intensity).toBe(0.5);
      expect(seen[0]).toBe(1); // celle du départ
    });

    it('la nouvelle FTP s\'applique à la séance en cours', () => {
      const { session } = setup();
      session.select(workout());
      session.start();
      session.setFtp(250);
      expect(session.runner?.ftpW).toBe(250);
    });

    it('commandes sans séance en cours : rien ne se passe', () => {
      const { session, events } = setup();
      session.skip();
      session.adjustIntensity(0.05);
      session.setFtp(300);
      session.stop();
      expect(events).toEqual([]);
    });
  });

  describe('ERG', () => {
    it('désengagé à la main, la séance ne renvoie plus de consigne ; réengagé, elle la renvoie aussitôt', async () => {
      const { session, trainer, log } = setup();
      session.select(workout());
      session.start();
      await flush();
      trainer.setTargetPower.mockClear();
      trainer.ergActive = false;
      session.optOutErg();
      expect(log).toHaveBeenCalledWith('ERG désengagé : la séance continue sans imposer de consigne');
      vi.advanceTimersByTime(3000);
      await flush();
      expect(trainer.setTargetPower).not.toHaveBeenCalled();
      session.reengageErg();
      await flush();
      expect(trainer.setTargetPower).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('ERG réengagé : la séance reprend sa consigne');
    });

    it('un envoi refusé est journalisé, puis réessayé après 2 s', async () => {
      const { session, trainer, log } = setup();
      trainer.setTargetPower.mockRejectedValueOnce(new Error('BLE occupé'));
      session.select(workout());
      session.start();
      await flush();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('non envoyée (BLE occupé)'));
      expect(trainer.setTargetPower).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1500);
      expect(trainer.setTargetPower).toHaveBeenCalledTimes(1); // on attend
      await vi.advanceTimersByTimeAsync(1000);
      expect(trainer.setTargetPower).toHaveBeenCalledTimes(2);
    });

    it('reprend l\'ERG de lui-même s\'il a été relâché ailleurs', async () => {
      const { session, trainer } = setup();
      session.select(workout());
      session.start();
      await flush();
      expect(trainer.ergActive).toBe(true);
      trainer.ergActive = false; // fin de sortie, reconnexion…
      trainer.setTargetPower.mockClear();
      vi.advanceTimersByTime(500);
      await flush();
      expect(trainer.setTargetPower).toHaveBeenCalled();
      expect(trainer.setErgActive).toHaveBeenLastCalledWith(true);
    });
  });

  describe('fin', () => {
    it('arrêtée à la main : l\'ERG est relâché, sans récapitulatif', async () => {
      const { session, trainer, setRide } = setup();
      setRide(true);
      session.select(workout());
      session.start();
      await flush();
      const info: unknown[] = [];
      session.on('ended', (i) => info.push(i));
      session.stop();
      expect(session.running).toBe(false);
      expect(session.paused).toBe(false);
      expect(session.state).toBeUndefined();
      expect(trainer.releaseErg).toHaveBeenCalledWith('séance arrêtée', { rideActive: true, gradePct: 3 });
      expect(info).toEqual([{ reason: 'séance arrêtée' }]);
    });

    it('sans ERG engagé, la fin se contente de se journaliser', () => {
      const { session, trainer, log } = setup({ connected: false });
      session.select(workout());
      session.start();
      session.stop();
      expect(trainer.releaseErg).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('séance arrêtée');
    });

    it('arrêt, puis plus aucun pas', async () => {
      const { session, trainer } = setup();
      session.select(workout());
      session.start();
      await flush();
      session.stop();
      trainer.setTargetPower.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      expect(trainer.setTargetPower).not.toHaveBeenCalled();
    });

    it('menée au bout : annonce la fin avant de nettoyer, puis rend de quoi faire le récapitulatif', async () => {
      const { session, events } = setup();
      const w = workout();
      session.select(w);
      session.start();
      let completed: CompletedWorkout | undefined;
      session.on('ended', (i) => (completed = i.completed));
      await vi.advanceTimersByTimeAsync((w.steps.reduce((t, s) => t + s.durationS, 0) + 5) * 1000);
      expect(session.running).toBe(false);
      expect(completed).toEqual({ workout: w, ftpW: 200 });
      const iCompleting = events.indexOf('completing');
      const iEnded = events.indexOf('ended');
      expect(iCompleting).toBeGreaterThan(-1);
      expect(iEnded).toBeGreaterThan(iCompleting);
      expect(events.filter((e) => e === 'ended')).toHaveLength(1);
    });
  });

  describe('séance de groupe (horloge extérieure)', () => {
    it("arrive au bon palier, avec la FTP de ce coureur, même en retard", () => {
      const { session, trainer } = setup();
      session.select(workout());
      let elapsedS = 600; // dix minutes après le départ du groupe
      session.start(() => elapsedS);
      expect(session.synced).toBe(true);
      expect(session.state?.elapsedS).toBe(600);
      const target = session.state?.targetW;
      expect(target).toBeGreaterThan(0);
      elapsedS = 601;
      vi.advanceTimersByTime(250);
      expect(session.state?.elapsedS).toBe(601);
      expect(trainer.connected).toBe(true);
    });

    it("suit l'horloge du groupe, pas le temps de ce coureur (le temps passe même sans trainer)", () => {
      const { session, trainer } = setup({ connected: false });
      session.select(workout());
      let elapsedS = 0;
      session.start(() => elapsedS);
      elapsedS = 120;
      vi.advanceTimersByTime(250);
      expect(session.state?.elapsedS).toBe(120);
      expect(trainer.setTargetPower).not.toHaveBeenCalled(); // pas de trainer : pas de consigne
    });

    it("ne se met pas en pause et ne saute pas de palier à la main", () => {
      const { session } = setup();
      session.select(workout());
      session.start(() => 30);
      session.togglePause();
      expect(session.paused).toBe(false);
      const step = session.state?.stepIndex;
      session.skip();
      expect(session.state?.stepIndex).toBe(step);
    });

    it("se termine quand l'horloge du groupe dépasse la séance, et redevient libre", () => {
      const { session, events } = setup();
      session.select(workout());
      session.start(() => 1e6);
      expect(events).toContain('ended');
      expect(session.running).toBe(false);
      expect(session.synced).toBe(false);
    });
  });
});
