import { describe, expect, it } from 'vitest';
import {
  ASSIST_FROM_M,
  ASSIST_RANGE_M,
  ASSIST_REDUCTION,
  DROP_AFTER_S,
  FollowTracker,
  LEADER_LOST_END_S,
  LEADER_PAUSE_END_S,
  LEADER_PAUSE_NOTICE_S,
  SELF_IDLE_END_S,
  type FollowLeader,
  type FollowSelf,
} from './follow';

const me = (over: Partial<FollowSelf> = {}): FollowSelf => ({ x: 0, z: 0, heading: 0, powerW: 200, ...over });
const lead = (x: number, over: Partial<FollowLeader> = {}): FollowLeader => ({ x, z: 0, speedMs: 10, riding: true, ...over });

describe('FollowTracker', () => {
  it("mesure l'écart signé par le cap et le temps qui le sépare", () => {
    const t = new FollowTracker();
    const ahead = t.update(0.1, me(), lead(50));
    expect(ahead.gapM).toBeCloseTo(50);
    expect(ahead.gapS).toBeCloseTo(5);
    expect(t.update(0.1, me(), lead(-30)).gapM).toBeCloseTo(-30);
  });

  it('ne donne pas de secondes quand le meneur est à l’arrêt', () => {
    expect(new FollowTracker().update(0.1, me(), lead(50, { speedMs: 0 })).gapS).toBeUndefined();
  });

  it("aide à revenir entre 15 et 150 m derrière, ni plus près ni plus loin", () => {
    const t = new FollowTracker();
    expect(t.update(0.1, me(), lead(ASSIST_FROM_M - 1)).assist).toBe(0);
    expect(t.update(0.1, me(), lead(ASSIST_FROM_M + 1)).assist).toBeCloseTo(ASSIST_REDUCTION);
    expect(t.update(0.1, me(), lead(ASSIST_RANGE_M - 1)).assist).toBeCloseTo(ASSIST_REDUCTION);
    expect(t.update(0.1, me(), lead(ASSIST_RANGE_M + 1)).assist).toBe(0);
  });

  it("n'aide jamais quand le meneur est derrière ou à l'arrêt", () => {
    const t = new FollowTracker();
    expect(t.update(0.1, me(), lead(-60)).assist).toBe(0);
    expect(t.update(0.1, me(), lead(60, { riding: false })).assist).toBe(0);
    expect(t.update(0.1, me(), lead(60, { speedMs: 1 })).assist).toBe(0);
  });

  it("l'aide reste modérée : de l'ordre de 15 % de la traînée", () => {
    expect(ASSIST_REDUCTION).toBeGreaterThan(0.1);
    expect(ASSIST_REDUCTION).toBeLessThan(0.2);
  });

  it('décroche après 60 s à plus de 150 m, et reprend dès qu’on recolle', () => {
    const t = new FollowTracker();
    let s = t.update(DROP_AFTER_S - 1, me(), lead(300));
    expect(s.phase).toBe('following');
    s = t.update(1, me(), lead(300));
    expect(s.phase).toBe('dropped');
    expect(s.assist).toBe(0);
    expect(t.update(1, me(), lead(100)).phase).toBe('following');
    // le compte repart de zéro après avoir recollé
    expect(t.update(DROP_AFTER_S - 1, me(), lead(300)).phase).toBe('following');
  });

  it("signale la pause du meneur, puis met fin au suivi", () => {
    const t = new FollowTracker();
    expect(t.update(LEADER_PAUSE_NOTICE_S - 1, me(), lead(40, { riding: false })).phase).toBe('following');
    expect(t.update(1, me(), lead(40, { riding: false })).phase).toBe('leader-paused');
    expect(t.update(1, me(), lead(40)).phase).toBe('following'); // il repart
    const s = t.update(LEADER_PAUSE_END_S, me(), lead(40, { riding: false }));
    expect(s.ended).toBe('leader-stopped');
  });

  it("met fin au suivi si le meneur n'est plus reçu", () => {
    const t = new FollowTracker();
    expect(t.update(LEADER_LOST_END_S - 1, me(), undefined).ended).toBeUndefined();
    expect(t.update(1, me(), undefined).ended).toBe('leader-lost');
  });

  it("met fin au suivi si on s'arrête soi-même 60 s", () => {
    const t = new FollowTracker();
    expect(t.update(SELF_IDLE_END_S - 1, me({ powerW: 0 }), lead(40)).ended).toBeUndefined();
    expect(t.update(1, me({ powerW: 0 }), lead(40)).ended).toBe('self-stopped');
    const t2 = new FollowTracker();
    t2.update(SELF_IDLE_END_S - 1, me({ powerW: 0 }), lead(40));
    t2.update(1, me({ powerW: 150 }), lead(40)); // il repédale : le compte repart
    expect(t2.update(SELF_IDLE_END_S - 1, me({ powerW: 0 }), lead(40)).ended).toBeUndefined();
  });
});
