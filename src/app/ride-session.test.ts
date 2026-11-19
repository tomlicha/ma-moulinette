import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import { Journey } from '../domain/sim/journey';
import { GradeController } from './grade-controller';
import { RideSession, type NearbyRider, type RideFrame, type RideTrainer } from './ride-session';
import { SensorReadings } from './sensor-readings';

function setup(over: { riders?: () => NearbyRider[]; canSimulate?: boolean } = {}) {
  const journey = new Journey(COL_DES_ERABLES);
  const readings = new SensorReadings();
  const grade = new GradeController();
  const trainer = {
    canSimulate: over.canSimulate ?? true,
    capabilities: { targetPower: true, simulation: true },
    setErgActive: vi.fn(),
    sendCourseGrade: vi.fn(),
    resetToFlat: vi.fn(),
  } satisfies RideTrainer;
  const session = new RideSession({
    journey,
    readings,
    grade,
    trainer,
    gearing: () => ({ enabled: false, virtualRatio: 2.4, realRatio: 2.43 }),
    riders: over.riders ?? (() => []),
  });
  return { session, journey, readings, grade, trainer };
}

const COURSE = COL_DES_ERABLES.courses[0]!.id;

describe('RideSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('est inactive tant qu\'on n\'a pas démarré', () => {
    const { session } = setup();
    expect(session.active).toBe(false);
    expect(session.snapshot).toBeUndefined();
    expect(session.rider).toBeUndefined();
    expect(session.climbM).toBe(0);
  });

  it('démarre : annonce la masse, garde le cycliste et un premier état', () => {
    const { session } = setup();
    const started = vi.fn();
    session.on('started', started);
    session.start(72, COURSE);
    expect(started).toHaveBeenCalledWith(72);
    expect(session.active).toBe(true);
    expect(session.rider?.massKg).toBe(72);
    expect(session.snapshot?.distanceM).toBe(0);
  });

  it('repart du départ du parcours choisi', () => {
    const { session, journey } = setup();
    const other = COL_DES_ERABLES.courses[1]!;
    session.start(80, other.id);
    expect(journey.name).toBe(other.name);
  });

  it('ignore un second départ pendant une sortie', () => {
    const { session } = setup();
    const started = vi.fn();
    session.on('started', started);
    session.start(80, COURSE);
    session.start(60, COURSE);
    expect(started).toHaveBeenCalledTimes(1);
    expect(session.rider?.massKg).toBe(80);
  });

  it('avance toutes les 100 ms avec la puissance mesurée', () => {
    const { session, readings } = setup();
    const frames: RideFrame[] = [];
    session.on('tick', (f) => frames.push(f));
    readings.record({ powerW: 250, cadenceRpm: 90 });
    session.start(80, COURSE);
    vi.advanceTimersByTime(1000);
    readings.record({ powerW: 250, cadenceRpm: 90 });
    vi.advanceTimersByTime(100);
    expect(frames.length).toBeGreaterThanOrEqual(10);
    expect(frames[0]!.powerW).toBe(250);
    expect(frames[0]!.cadenceRpm).toBe(90);
    expect(session.snapshot!.distanceM).toBeGreaterThan(0);
    expect(session.snapshot!.speedKmh).toBeGreaterThan(0);
  });

  it('sans pédaler, le cycliste reste immobile', () => {
    const { session } = setup();
    session.start(80, COURSE);
    vi.advanceTimersByTime(2000);
    expect(session.snapshot!.distanceM).toBe(0);
  });

  it('envoie la pente du parcours au trainer dès le premier pas', () => {
    const { session, trainer } = setup();
    session.start(80, COURSE);
    vi.advanceTimersByTime(100);
    expect(trainer.sendCourseGrade).toHaveBeenCalledTimes(1);
    expect(trainer.sendCourseGrade.mock.calls[0]![0]).toMatchObject({ massKg: 80 });
  });

  it('n\'envoie rien à un trainer qui ne simule pas', () => {
    const { session, trainer } = setup({ canSimulate: false });
    session.start(80, COURSE);
    vi.advanceTimersByTime(500);
    expect(trainer.sendCourseGrade).not.toHaveBeenCalled();
  });

  describe('pause et reprise', () => {
    it('la pause arrête les pas sans finir la sortie, et dit où le cycliste s\'arrête', () => {
      const { session, readings } = setup();
      const paused = vi.fn();
      const ticks = vi.fn();
      session.on('paused', paused);
      readings.record({ powerW: 250 });
      session.start(80, COURSE);
      vi.advanceTimersByTime(500);
      session.on('tick', ticks);
      session.pause();
      expect(paused).toHaveBeenCalledWith(session.snapshot!.distanceM);
      expect(session.paused).toBe(true);
      expect(session.active).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(ticks).not.toHaveBeenCalled();
      session.pause(); // sans effet
      expect(paused).toHaveBeenCalledTimes(1);
    });

    it('la reprise relance les pas et renvoie la pente', () => {
      const { session, trainer } = setup();
      const resumed = vi.fn();
      const ticks = vi.fn();
      session.on('resumed', resumed);
      session.start(80, COURSE);
      vi.advanceTimersByTime(100);
      session.pause();
      trainer.sendCourseGrade.mockClear();
      session.resume();
      session.on('tick', ticks);
      vi.advanceTimersByTime(100);
      expect(resumed).toHaveBeenCalledTimes(1);
      expect(session.paused).toBe(false);
      expect(ticks).toHaveBeenCalled();
      expect(trainer.sendCourseGrade).toHaveBeenCalledTimes(1); // le trainer reconnecté repart de zéro
    });

    it('pause et reprise sans sortie, ou sans pause, ne font rien', () => {
      const { session } = setup();
      const spy = vi.fn();
      session.on('paused', spy);
      session.on('resumed', spy);
      session.pause();
      session.resume();
      session.start(80, COURSE);
      session.resume();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('arrêt', () => {
    it('termine la sortie : relâche l\'ERG, annonce la distance et remet le trainer à plat', () => {
      const { session, readings, trainer } = setup();
      let activeDuringEvent: boolean | undefined;
      const stopped = vi.fn(() => (activeDuringEvent = session.active));
      session.on('stopped', stopped);
      readings.record({ powerW: 250 });
      session.start(80, COURSE);
      vi.advanceTimersByTime(500);
      const at = session.snapshot!.distanceM;
      session.stop();
      expect(stopped).toHaveBeenCalledWith(at);
      expect(activeDuringEvent).toBe(false); // déjà terminée pendant l'événement
      expect(session.active).toBe(false);
      expect(trainer.setErgActive).toHaveBeenCalledWith(false);
      expect(trainer.resetToFlat).toHaveBeenCalledTimes(1);
    });

    it('ne remet pas le trainer à plat si on repart aussitôt', () => {
      const { session, trainer } = setup();
      session.start(80, COURSE);
      session.stop(false);
      expect(trainer.resetToFlat).not.toHaveBeenCalled();
    });

    it('plus aucun pas après l\'arrêt', () => {
      const { session } = setup();
      const ticks = vi.fn();
      session.start(80, COURSE);
      session.stop();
      session.on('tick', ticks);
      vi.advanceTimersByTime(1000);
      expect(ticks).not.toHaveBeenCalled();
    });

    it('arrêter sans sortie ne fait rien', () => {
      const { session, trainer } = setup();
      const stopped = vi.fn();
      session.on('stopped', stopped);
      session.stop();
      expect(stopped).not.toHaveBeenCalled();
      expect(trainer.setErgActive).not.toHaveBeenCalled();
    });

    it('arrêtée en pause, la sortie s\'arrête bien aussi', () => {
      const { session } = setup();
      session.start(80, COURSE);
      session.pause();
      session.stop();
      expect(session.active).toBe(false);
      expect(session.paused).toBe(false);
    });
  });

  describe('aspiration', () => {
    it('est nulle seul sur la route', () => {
      const { session, readings } = setup();
      readings.record({ powerW: 250 });
      session.start(80, COURSE);
      vi.advanceTimersByTime(300);
      expect(session.draft).toBe(0);
    });

    it('profite d\'un coureur juste devant, sur la même route et dans le même sens', () => {
      const { session, readings, journey } = setup({
        riders: () => {
          const me = journey.pointAt(session.snapshot?.distanceM ?? 0);
          return [{ point: { x: me.x + 3 * Math.cos(me.heading), z: me.z + 3 * Math.sin(me.heading), heading: me.heading }, speedMs: 9, riding: true }];
        },
      });
      readings.record({ powerW: 250 });
      session.start(80, COURSE);
      vi.advanceTimersByTime(300);
      expect(session.draft).toBeGreaterThan(0.2);
    });
  });
});
