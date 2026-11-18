import { describe, expect, it } from 'vitest';
import { U_MEASURING, U_TOP, VELODROME, VelodromeTrack } from './velodrome-track';

describe('piste du vélodrome', () => {
  const track = new VelodromeTrack();

  it('mesure 499,75 m à la corde et se referme', () => {
    let len = 0;
    let prev = track.point(0, U_MEASURING);
    for (let s = 0.5; s <= VELODROME.lapM + 1e-9; s += 0.5) {
      const p = track.point(s, U_MEASURING);
      len += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    expect(len).toBeCloseTo(VELODROME.lapM, 0);
    const a = track.frame(0);
    const b = track.frame(VELODROME.lapM);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.01);
  });

  it('est centrée, symétrique, avec la ligne droite d’arrivée au sud vers l’est', () => {
    const home = track.frame(0);
    const back = track.frame(VELODROME.lapM / 2);
    expect(home.x).toBeCloseTo(0, 3);
    expect(home.z).toBeGreaterThan(30);
    expect(back.z).toBeCloseTo(-home.z, 3);
    expect(home.dirX).toBeCloseTo(1, 6);
    expect(back.dirX).toBeCloseTo(-1, 6);
  });

  it('se relève à 15,4° dans les virages, sans saut', () => {
    const apex = VELODROME.straightM / 2 + VELODROME.transitionM + track.arcM / 2;
    expect((track.bank(apex) * 180) / Math.PI).toBeCloseTo(15.4, 6);
    expect((track.bank(0) * 180) / Math.PI).toBeCloseTo(VELODROME.straightBankDeg, 6);
    expect(track.height(apex, U_TOP)).toBeCloseTo(6.7 * Math.tan((15.4 * Math.PI) / 180), 6);
    for (let s = 0; s < VELODROME.lapM; s += 0.5) expect(Math.abs(track.bank(s + 0.5) - track.bank(s))).toBeLessThan(0.005); // au plus 1,5 × 9,4° / 28 m en milieu de raccordement
  });

  it('a des virages d’environ 43 m de rayon', () => {
    expect(track.radiusM).toBeGreaterThan(40);
    expect(track.radiusM).toBeLessThan(47);
  });
});
