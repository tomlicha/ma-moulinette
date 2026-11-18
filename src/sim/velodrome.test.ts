import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from './courses/col-des-erables';
import { Journey } from './journey';
import { validateNetwork } from './network';
import { FINISH_S, GATE_S, LANE_U, U_TOP, VELODROME } from './velodrome-track';

/** Roule de `from` à `to` par pas de 10 m ; `pick` choisit (par identifiant de route) au carrefour annoncé. Renvoie les routes validées. */
function ride(j: Journey, from: number, to: number, pick?: (ids: string[], atM: number) => string | undefined): string[] {
  for (let d = from; d <= to; d += 10) {
    const p = j.pendingJunction(d);
    if (p && pick) {
      const want = pick(p.options.map((o) => o.edgeId), p.atM);
      const i = p.options.findIndex((o) => o.edgeId === want);
      if (i >= 0) j.choose(i);
    }
    j.update(d);
  }
  return legs(j, to);
}

/** Les routes du trajet jusqu'à `d`, dans l'ordre, sans doublon consécutif. */
function legs(j: Journey, d: number): string[] {
  const out: string[] = [];
  for (let x = 0; x <= d; x += 5) {
    const id = j.locate(x).edgeId;
    if (out[out.length - 1] !== id) out.push(id);
  }
  return out;
}

const site = COL_DES_ERABLES.velodromes[0]!;
/** Au Moulin (là où part aussi Le Col), prend l'Allée du Vélodrome ; ailleurs, laisse le choix par défaut. */
const toVelodrome = (ids: string[]) => (ids.includes('col') ? 'allee-velodrome' : undefined);
const MOULIN_M = COL_DES_ERABLES.edges.get('vallee')!.lengthM;
const ALLEE_M = COL_DES_ERABLES.edges.get('allee-velodrome')!.lengthM;
const LAP_M = COL_DES_ERABLES.edges.get('velodrome-piste-1')!.lengthM + COL_DES_ERABLES.edges.get('velodrome-piste-2')!.lengthM;

describe('le vélodrome dans le réseau', () => {
  it('garde le réseau jouable', () => {
    expect(validateNetwork(COL_DES_ERABLES)).toEqual([]);
  });

  it('a un tour d’environ 500 m, à plat', () => {
    expect(LAP_M).toBeGreaterThan(499);
    expect(LAP_M).toBeLessThan(506);
    for (const id of ['velodrome-piste-1', 'velodrome-piste-2', 'allee-velodrome']) {
      const e = COL_DES_ERABLES.edges.get(id)!;
      for (let s = 0; s <= e.lengthM; s += 5) expect(Math.abs(e.gradePctAt(s))).toBeLessThan(0.01);
    }
  });

  it('s’atteint depuis le Moulin, puis on tourne sans fin par défaut', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    const seen = ride(j, 0, MOULIN_M + ALLEE_M + 5 * LAP_M, toVelodrome);
    expect(seen.slice(0, 3)).toEqual(['vallee', 'allee-velodrome', 'velodrome-piste-1']);
    // Cinq tours plus tard, on est toujours sur la piste, à alterner ses deux moitiés.
    const track = seen.slice(2);
    expect(track.length).toBeGreaterThanOrEqual(9);
    track.forEach((id, i) => expect(id).toBe(i % 2 ? 'velodrome-piste-2' : 'velodrome-piste-1'));
  });

  it('n’annonce aucun carrefour une fois sur la piste, ni à la ligne ni à la porte, tour après tour', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    ride(j, 0, MOULIN_M + 50, toVelodrome);
    for (let d = MOULIN_M + 50; d < MOULIN_M + ALLEE_M + 3 * LAP_M; d += 10) {
      expect(j.pendingJunction(d)).toBeUndefined();
      j.update(d);
    }
  });

  it('dit si l’on est sur la piste et à quelle distance est la prochaine porte', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    const gateM = MOULIN_M + ALLEE_M;
    ride(j, 0, gateM + 100, toVelodrome);
    expect(j.onTrack(gateM - 100)).toBe(false);
    expect(j.trackExitInM(gateM - 100)).toBeUndefined();
    expect(j.onTrack(gateM + 100)).toBe(true);
    expect(j.trackExitInM(gateM + 100)).toBeCloseTo(LAP_M - 100, 0);
    // À 30 m de la porte, le tour suivant est déjà verrouillé : la sortie possible est celle du tour d'après.
    ride(j, gateM + 100, gateM + LAP_M - 30);
    expect(j.trackExitInM(gateM + LAP_M - 30)).toBeCloseTo(LAP_M + 30, 0);
  });

  it('sort à la prochaine porte quand on programme la sortie, et revient au Moulin', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    const gateM = MOULIN_M + ALLEE_M;
    // Un tour complet, puis la sortie programmée au milieu du second.
    ride(j, 0, gateM + LAP_M + 250, toVelodrome);
    expect(j.trackExitArmed).toBe(false);
    j.setTrackExit(true);
    expect(j.trackExitArmed).toBe(true);
    const seen = ride(j, gateM + LAP_M + 250, gateM + 2 * LAP_M + ALLEE_M + 300);
    expect(seen.slice(0, 7)).toEqual(['vallee', 'allee-velodrome', 'velodrome-piste-1', 'velodrome-piste-2', 'velodrome-piste-1', 'velodrome-piste-2', 'allee-velodrome']);
    expect(j.locate(gateM + 2 * LAP_M + 20).forward).toBe(false); // l'allée, à rebours
    expect(j.trackExitArmed).toBe(false); // sorti : la consigne s'efface
    expect(seen.length).toBeGreaterThan(7); // repart du Moulin sur une autre route
  });

  it('compte les tours : un par passage sur la ligne d’arrivée', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    const gateM = MOULIN_M + ALLEE_M;
    const lineM = gateM + COL_DES_ERABLES.edges.get('velodrome-piste-1')!.lengthM;
    ride(j, 0, gateM + 3 * LAP_M, toVelodrome);
    expect(j.lapsAt(gateM - 10)).toBe(0);
    expect(j.lapsAt(lineM - 1)).toBe(0);
    expect(j.lapsAt(lineM + 1)).toBe(1);
    expect(j.lapsAt(lineM + LAP_M + 1)).toBe(2);
    // Parcours « Vélodrome » : on part sur la ligne, le premier tour se boucle au passage suivant.
    const v = new Journey(COL_DES_ERABLES, 'velodrome');
    ride(v, 0, 2 * LAP_M + 20);
    expect(v.lapsAt(10)).toBe(0);
    expect(v.lapsAt(LAP_M + 5)).toBe(1);
    expect(v.lapsAt(2 * LAP_M + 5)).toBe(2);
  });

  it('annule une sortie programmée : on continue de tourner', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    const gateM = MOULIN_M + ALLEE_M;
    ride(j, 0, gateM + 100, toVelodrome);
    j.setTrackExit(true);
    j.setTrackExit(false);
    const seen = ride(j, gateM + 100, gateM + 3 * LAP_M);
    expect(seen.filter((id) => id === 'allee-velodrome')).toHaveLength(1);
    expect(j.onTrack(gateM + 3 * LAP_M)).toBe(true);
  });

  it('ne laisse jamais prendre la piste à contresens', () => {
    const j = new Journey(COL_DES_ERABLES, 'col');
    for (let d = 0; d < MOULIN_M + ALLEE_M + 3 * LAP_M; d += 10) {
      const p = j.pendingJunction(d);
      if (p) {
        for (const o of p.options) if (o.edgeId.startsWith('velodrome-piste')) expect(o.forward).toBe(true);
        const i = p.options.findIndex((o) => o.edgeId === 'allee-velodrome');
        if (i >= 0 && p.nodeId === 'moulin') j.choose(i);
      }
      j.update(d);
    }
    for (let d = MOULIN_M + ALLEE_M + 20; d < MOULIN_M + ALLEE_M + 3 * LAP_M; d += 25) expect(j.locate(d).forward).toBe(true);
  });
});

describe('surface du vélodrome', () => {
  const t = site.track;
  const apex = VELODROME.straightM / 2 + VELODROME.transitionM + t.arcM / 2;

  it('porte le coureur sur le béton relevé et le penche dans le virage', () => {
    const p = t.point(apex, 3);
    const [x, z] = site.toWorld(p.x, p.z);
    const s = site.surface(x, z);
    expect(s.lift).toBeCloseTo(t.height(apex, 3), 2);
    expect((s.bank * 180) / Math.PI).toBeCloseTo(15.4, 1);
  });

  it('retrouve s et u depuis un point du monde', () => {
    for (const [s, u] of [[apex, 2], [FINISH_S, LANE_U], [GATE_S, 5], [300, -10], [100, 15]] as const) {
      const p = t.point(s, u);
      const loc = t.locate(p.x, p.z);
      expect(loc.s).toBeCloseTo(s, 1);
      expect(loc.u).toBeCloseTo(u, 1);
    }
  });

  it('monte la rampe de la porte jusqu’au haut de la piste, sans marche', () => {
    let prev = -1;
    for (let b = 60; b >= U_TOP; b -= 0.5) {
      const [x, z] = site.accessPoint(b);
      const lift = site.surface(x, z).lift;
      if (prev >= 0) expect(Math.abs(lift - prev)).toBeLessThan(0.12);
      prev = lift;
    }
    const [x, z] = site.accessPoint(U_TOP - 0.2);
    expect(Math.abs(site.surface(x, z).lift - prev)).toBeLessThan(0.05);
  });

  it('couvre la piste et la route d’accès, pas le reste du monde', () => {
    const [cx, cz] = site.toWorld(0, 0);
    expect(site.covers(cx, cz)).toBe(true);
    const [ax, az] = site.accessPoint(80);
    expect(site.covers(ax, az)).toBe(true);
    const [fx, fz] = site.accessPoint(160);
    expect(site.covers(fx, fz)).toBe(false);
    expect(site.covers(2400, -300)).toBe(false);
  });
});
