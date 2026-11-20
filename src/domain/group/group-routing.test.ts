import { describe, expect, it, vi } from 'vitest';
import { COL_DES_ERABLES } from '../course/courses/col-des-erables';
import { DECIDE_CLOSE_M, Journey, LOCK_M, type GroupRouting, type PendingJunction } from '../sim/journey';
import { Ride } from '../sim/ride';
import type { Workout } from '../workout/model';
import { GROUP_RIDER, GroupPace } from './group-pace';

/** Le premier carrefour du parcours : sa distance, son rang de route, et combien de routes il propose. */
function firstJunction(): PendingJunction & { reachedAtM: number } {
  const j = new Journey(COL_DES_ERABLES);
  for (let d = 0; d < 20_000; d += 5) {
    j.update(d);
    const p = j.pendingJunction(d);
    if (p) return { ...p, reachedAtM: d };
  }
  throw new Error('aucun carrefour trouvé');
}

/** Un routage de groupe à la main : les choix sont une table, `decides` se règle. */
function routing(choices: Map<number, number>, decides = false) {
  const decide = vi.fn<(legIndex: number, index: number) => void>();
  const r: GroupRouting = { choiceFor: (i) => choices.get(i), decides, decide };
  return { r, decide };
}

describe('Journey en séance de groupe', () => {
  it("annonce le carrefour à tous, dit qui choisit, et la route retenue est le choix du groupe", () => {
    const first = firstJunction();
    const choices = new Map<number, number>();
    const j = new Journey(COL_DES_ERABLES);
    j.setGroupRouting(routing(choices, false).r);
    for (let d = 0; d <= first.reachedAtM; d += 5) j.update(d);
    const p = j.pendingJunction(first.reachedAtM)!;
    expect(p.legIndex).toBe(first.legIndex);
    expect(p.group).toEqual({ decides: false, closed: false });
    const others = p.options.map((_, i) => i).filter((i) => i !== p.selected);
    choices.set(p.legIndex, others[0]!);
    expect(j.pendingJunction(first.reachedAtM)!.selected).toBe(others[0]);
  });

  it("un coureur qui ne décide pas ne peut pas choisir, ni sortir de la piste", () => {
    const first = firstJunction();
    const j = new Journey(COL_DES_ERABLES);
    const { r, decide } = routing(new Map(), false);
    j.setGroupRouting(r);
    for (let d = 0; d <= first.reachedAtM; d += 5) j.update(d);
    j.pendingJunction(first.reachedAtM);
    expect(j.choose(0)).toBe(false);
    expect(decide).not.toHaveBeenCalled();
    j.setTrackExit(true);
    expect(j.trackExitArmed).toBe(false);
  });

  it("le créateur choisit : son choix part au groupe, mais ne s'applique qu'à son retour", () => {
    const first = firstJunction();
    const choices = new Map<number, number>();
    const j = new Journey(COL_DES_ERABLES);
    const { r, decide } = routing(choices, true);
    j.setGroupRouting(r);
    for (let d = 0; d <= first.reachedAtM; d += 5) j.update(d);
    const p = j.pendingJunction(first.reachedAtM)!;
    const pick = p.options.length - 1;
    expect(j.choose(pick)).toBe(true);
    expect(decide).toHaveBeenCalledWith(p.legIndex, pick);
    expect(j.pendingJunction(first.reachedAtM)!.selected).toBe(p.selected); // pas encore : rien n'est revenu
    choices.set(p.legIndex, pick); // le groupe le renvoie
    j.refreshRouting();
    expect(j.pendingJunction(first.reachedAtM)!.selected).toBe(pick);
  });

  it(`le choix se ferme à ${DECIDE_CLOSE_M} m du carrefour : le message arrive chez tous avant le verrou de ${LOCK_M} m`, () => {
    const first = firstJunction();
    const j = new Journey(COL_DES_ERABLES);
    const { r, decide } = routing(new Map(), true);
    j.setGroupRouting(r);
    const nodeAtM = first.atM;
    for (let d = 0; d <= nodeAtM - DECIDE_CLOSE_M + 1; d += 1) j.update(d);
    j.pendingJunction(nodeAtM - DECIDE_CLOSE_M + 1);
    expect(j.pendingJunction(nodeAtM - DECIDE_CLOSE_M + 1)!.group!.closed).toBe(true);
    expect(j.choose(0)).toBe(false);
    expect(decide).not.toHaveBeenCalled();
    j.pendingJunction(nodeAtM - DECIDE_CLOSE_M - 30);
    expect(j.pendingJunction(nodeAtM - DECIDE_CLOSE_M - 30)!.group!.closed).toBe(false);
    expect(j.choose(0)).toBe(true);
  });

  it("un choix hors des routes proposées est ignoré : le parcours reprend la main", () => {
    const first = firstJunction();
    const j = new Journey(COL_DES_ERABLES);
    const ref = new Journey(COL_DES_ERABLES);
    j.setGroupRouting(routing(new Map([[first.legIndex, 99]])).r);
    for (let d = 0; d <= first.atM + 200; d += 5) {
      j.update(d);
      ref.update(d);
    }
    expect(j.locate(first.atM + 150)).toEqual(ref.locate(first.atM + 150));
  });

  it("deux coureurs qui reçoivent le même choix font le même trajet, qu'ils soient là depuis le départ ou arrivés en retard", () => {
    const first = firstJunction();
    const workout: Workout = { name: 'Plat', steps: [{ kind: 'steady', durationS: 1800, target: { kind: 'ftp', from: 0.8, to: 0.8 } }], messages: [], warnings: [] };
    const defaultPath = (() => {
      const j = new Journey(COL_DES_ERABLES);
      const ride = new Ride(j, GROUP_RIDER);
      new GroupPace(workout, () => 1_500_000).advance(ride);
      return j.locate(ride.snapshot().distanceM);
    })();
    // L'option qui n'est pas celle par défaut au premier carrefour.
    const other = first.options.map((_, i) => i).find((i) => i !== first.selected)!;
    const choices = new Map([[first.legIndex, other]]);
    const run = (stepsMs: number[]) => {
      const j = new Journey(COL_DES_ERABLES);
      j.setGroupRouting(routing(choices).r);
      const ride = new Ride(j, GROUP_RIDER);
      let t = 0;
      const pace = new GroupPace(workout, () => t);
      for (const ms of stepsMs) {
        t = ms;
        pace.advance(ride);
      }
      return j.locate(ride.snapshot().distanceM);
    };
    const present = run(Array.from({ length: 15_000 }, (_, i) => (i + 1) * 100));
    const late = run([1_500_000]);
    expect(late).toEqual(present);
    expect(present).not.toEqual(defaultPath); // le choix du créateur a bien changé le trajet
  });

  it("un coureur qui a raté le choix du créateur dérive, et se recale en rejouant avec tous les choix : même point que les autres", () => {
    const first = firstJunction();
    const workout: Workout = { name: 'Plat', steps: [{ kind: 'steady', durationS: 1800, target: { kind: 'ftp', from: 0.8, to: 0.8 } }], messages: [], warnings: [] };
    const other = first.options.map((_, i) => i).find((i) => i !== first.selected)!;
    const choices = new Map([[first.legIndex, other]]);
    const play = (known: Map<number, number>, ms: number) => {
      const journey = new Journey(COL_DES_ERABLES);
      journey.setGroupRouting(routing(known).r);
      const ride = new Ride(journey, GROUP_RIDER);
      new GroupPace(workout, () => ms).advance(ride);
      return { journey, ride };
    };
    const ms = 1_200_000;
    const right = play(choices, ms);
    const missed = play(new Map(), ms); // le message du créateur n'est jamais arrivé
    const where = (p: { journey: Journey; ride: Ride }) => p.journey.pointAt(p.ride.snapshot().distanceM);
    const gap = Math.hypot(where(right).x - where(missed).x, where(right).z - where(missed).z);
    expect(gap).toBeGreaterThan(100); // il n'est plus du tout avec les autres : la dérive est détectable
    // Recalage : le trajet repart du début, avec tous les choix, et la simulation rejoue d'un trait.
    const resynced = play(choices, ms);
    expect(where(resynced)).toEqual(where(right));
    expect(resynced.ride.snapshot().distanceM).toBe(right.ride.snapshot().distanceM);
  });
});
