import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from './courses/col-des-erables';
import { Journey } from '../sim/journey';
import { RoadNetwork } from './network';
import { RemoteTrack } from './remote-track';

/** Même T que dans journey.test.ts : on arrive de l'ouest au carrefour J. */
const T = new RoadNetwork({
  name: 'T',
  nodes: [
    { id: 's', name: 'Départ', x: 0, z: 0, altitude: 0 },
    { id: 'j', name: 'Carrefour', x: 1000, z: 0, altitude: 20 },
    { id: 'n', name: 'Nord', x: 1800, z: -800, altitude: 80 },
    { id: 'e', name: 'Est', x: 2000, z: 0, altitude: 40 },
    { id: 'm', name: 'Sud', x: 1800, z: 800, altitude: 5 },
  ],
  edges: [
    { id: 'sj', name: 'Entrée', from: 's', to: 'j', plan: [], profile: [] },
    { id: 'jn', name: 'Vers le nord', from: 'j', to: 'n', plan: [[1300, -150]], profile: [] },
    { id: 'je', name: 'Tout droit', from: 'j', to: 'e', plan: [], profile: [] },
    { id: 'jm', name: 'Vers le sud', from: 'j', to: 'm', plan: [[1300, 150]], profile: [] },
  ],
  start: { edge: 'sj', forward: true },
});

/** Fait rouler un trajet et renvoie ce que verrait un autre joueur : la piste reconstruite et les écarts relevés. */
function follow(journey: Journey, opts: { untilM: number; stepM: number; keep?: (i: number) => boolean }) {
  const track = new RemoteTrack(journey.network);
  let worst = 0;
  let resets = 0;
  let prevD = -Infinity;
  let i = 0;
  for (let d = 0; d <= opts.untilM; d += opts.stepM, i++) {
    journey.update(d);
    if (opts.keep && !opts.keep(i)) continue;
    const obs = track.observe(journey.locate(d))!;
    if (obs.reset) resets++;
    else expect(obs.d).toBeGreaterThan(prevD);
    prevD = obs.d;
    const a = journey.pointAt(d);
    const b = track.pointAt(obs.d);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.z - b.z), Math.abs(a.y - b.y));
  }
  return { track, worst, resets };
}

describe('RemoteTrack', () => {
  it("place l'autre coureur exactement là où il est, à chaque sortie du carrefour", () => {
    for (const choice of [0, 1, 2]) {
      const j = new Journey(T);
      j.choose(choice);
      const { worst, resets } = follow(j, { untilM: 1900, stepM: 3 });
      expect(resets).toBe(1); // la première position seulement
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it('arrondit le virage comme le coureur lui-même, grâce à la route suivante annoncée', () => {
    const j = new Journey(T);
    j.choose(0);
    const track = new RemoteTrack(T);
    for (let d = 0; d <= 1000 - 15; d += 5) {
      j.update(d);
      track.observe(j.locate(d));
    }
    // 15 m avant le nœud, le joueur distant ne sait que ça ; à 5 m du nœud, il est déjà dans l'arc.
    const at = 1000 - 5;
    const local = j.pointAt(at);
    const remote = track.pointAt(at);
    expect(Math.hypot(local.x - remote.x, local.z - remote.z)).toBeLessThan(1e-6);
    expect(local.heading).toBeCloseTo(remote.heading, 9);
  });

  it('suit un tour du Col des Érables avec un message sur trois perdu', () => {
    const j = new Journey(COL_DES_ERABLES);
    const { worst, resets, track } = follow(j, { untilM: 30_000, stepM: 4, keep: (i) => i % 3 !== 1 });
    expect(resets).toBe(1);
    expect(worst).toBeLessThan(1e-6);
    expect(track.empty).toBe(false);
  });

  it('recommence la piste quand le coureur saute plusieurs routes ou repart en arrière', () => {
    const j = new Journey(COL_DES_ERABLES);
    const track = new RemoteTrack(COL_DES_ERABLES);
    j.update(100);
    expect(track.observe(j.locate(100))!.reset).toBe(true);
    for (let d = 100; d < 9000; d += 50) j.update(d);
    // Des minutes sans nouvelles : la route reçue ne prolonge plus la piste.
    expect(track.observe(j.locate(8950))!.reset).toBe(true);
    // Nouvelle sortie : retour au départ, sur la même route ou non.
    j.reset();
    j.update(20);
    const back = track.observe(j.locate(20))!;
    expect(back.reset).toBe(true);
    const p = track.pointAt(back.d);
    const q = j.pointAt(20);
    expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(1e-6);
  });

  it('ignore une route inconnue et reste au bout de la piste connue', () => {
    const track = new RemoteTrack(T);
    expect(track.observe({ edgeId: 'nulle-part', forward: true, s: 10 })).toBeUndefined();
    expect(track.empty).toBe(true);
    const obs = track.observe({ edgeId: 'sj', forward: true, s: 990 })!;
    const end = track.pointAt(obs.d + 500); // au-delà : la suite n'est pas connue
    expect(end.edgeId).toBe('sj');
    expect(end.x).toBeCloseTo(1000, 3);
  });

  it('donne une pente lisible pour animer le coureur', () => {
    const track = new RemoteTrack(T);
    const obs = track.observe({ edgeId: 'sj', forward: true, s: 500 })!;
    expect(track.gradeAt(obs.d)).toBeGreaterThan(0);
  });
});
