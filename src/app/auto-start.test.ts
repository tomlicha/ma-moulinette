import { describe, expect, it, vi } from 'vitest';
import type { Workout } from '../domain/workout/model';
import { AutoStart } from './auto-start';

function setup(over: { rideActive?: boolean; running?: boolean; workout?: boolean; connected?: boolean; screen?: boolean; blocked?: boolean } = {}) {
  const state = {
    rideActive: over.rideActive ?? false,
    running: over.running ?? false,
    workout: over.workout ? ({ name: 'séance' } as Workout) : undefined,
    connected: over.connected ?? true,
    screen: over.screen ?? true,
    blocked: over.blocked ?? false,
  };
  const startWorkout = vi.fn();
  const startRide = vi.fn();
  const log = vi.fn();
  const auto = new AutoStart({
    rideSession: { get active() { return state.rideActive; } },
    workoutSession: { get running() { return state.running; }, get workout() { return state.workout; } },
    trainer: { get connected() { return state.connected; } },
    rideScreenOpen: () => state.screen,
    workoutBlocked: () => state.blocked,
    startWorkout,
    startRide,
    log,
  });
  return { auto, state, startWorkout, startRide, log };
}

describe('AutoStart', () => {
  it('n\'est pas armé au départ : rien ne démarre', () => {
    const { auto, startRide } = setup();
    auto.onMeasurement({ powerW: 150 });
    expect(startRide).not.toHaveBeenCalled();
  });

  it('armé, la première puissance démarre la sortie libre', () => {
    const { auto, startRide, startWorkout, log } = setup();
    auto.arm();
    auto.onMeasurement({ powerW: 150 });
    expect(startRide).toHaveBeenCalledTimes(1);
    expect(startWorkout).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('premier coup de pédale : démarrage de la sortie');
  });

  it('la cadence seule suffit', () => {
    const { auto, startRide } = setup();
    auto.arm();
    auto.onMeasurement({ cadenceRpm: 80 });
    expect(startRide).toHaveBeenCalledTimes(1);
  });

  it('une mesure à zéro ou sans puissance ni cadence ne démarre rien', () => {
    const { auto, startRide } = setup();
    auto.arm();
    auto.onMeasurement({ powerW: 0, cadenceRpm: 0 });
    auto.onMeasurement({});
    expect(startRide).not.toHaveBeenCalled();
  });

  it('avec une séance choisie, c\'est la séance qui démarre', () => {
    const { auto, startRide, startWorkout, log } = setup({ workout: true });
    auto.arm();
    auto.onMeasurement({ powerW: 150 });
    expect(startWorkout).toHaveBeenCalledTimes(1);
    expect(startRide).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('premier coup de pédale : démarrage de la séance');
  });

  it('séance choisie mais impossible à démarrer (trainer sans ERG) : on roule sans elle', () => {
    const { auto, startRide, startWorkout } = setup({ workout: true, blocked: true });
    auto.arm();
    auto.onMeasurement({ powerW: 150 });
    expect(startWorkout).not.toHaveBeenCalled();
    expect(startRide).toHaveBeenCalledTimes(1);
  });

  it('sans trainer connecté, la sortie libre ne démarre pas', () => {
    const { auto, startRide } = setup({ connected: false });
    auto.arm();
    auto.onMeasurement({ powerW: 150 });
    expect(startRide).not.toHaveBeenCalled();
  });

  it('ailleurs que sur l\'écran Sortie, rien ne démarre', () => {
    const { auto, startRide } = setup({ screen: false });
    auto.arm();
    auto.onMeasurement({ powerW: 150 });
    expect(startRide).not.toHaveBeenCalled();
  });

  it('ne s\'arme pas si une sortie ou une séance tourne déjà', () => {
    const a = setup({ rideActive: true });
    a.auto.arm();
    expect(a.auto.isArmed).toBe(false);
    const b = setup({ running: true });
    b.auto.arm();
    expect(b.auto.isArmed).toBe(false);
  });

  it('désarmé, un arrêt volontaire n\'est pas défait par le pédalage qui continue', () => {
    const { auto, startRide } = setup();
    auto.arm();
    auto.disarm();
    auto.onMeasurement({ powerW: 150 });
    expect(startRide).not.toHaveBeenCalled();
  });

  it('une séance en cours n\'est jamais relancée', () => {
    const { auto, startRide, startWorkout, state } = setup({ workout: true });
    auto.arm();
    state.running = true;
    auto.onMeasurement({ powerW: 150 });
    expect(startRide).not.toHaveBeenCalled();
    expect(startWorkout).not.toHaveBeenCalled();
  });

  it('une sortie déjà en cours n\'est pas relancée', () => {
    const { auto, startRide, state } = setup();
    auto.arm();
    state.rideActive = true;
    auto.onMeasurement({ powerW: 150 });
    expect(startRide).not.toHaveBeenCalled();
  });
});
