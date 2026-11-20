import { describe, expect, it } from 'vitest';
import { BLIND_AFTER_S, DRIFT_AFTER_S, DRIFT_DISTANCE_M, GroupDrift, RESYNC_MAX, RESYNC_MIN_INTERVAL_S } from './drift';

const at = (x: number, z = 0) => ({ x, z });

/** Fait passer `s` secondes par pas d'une seconde ; renvoie le nombre de recalages demandés. */
function run(d: GroupDrift, s: number, self: { x: number; z: number }, others: { x: number; z: number }[], expected = others.length) {
  let n = 0;
  for (let i = 0; i < s; i++) if (d.update(1, self, others, expected)) n++;
  return n;
}

describe('GroupDrift', () => {
  it("ne dit rien quand on est avec les autres, ni quand on est seul dans le groupe", () => {
    const d = new GroupDrift();
    expect(run(d, 120, at(0), [at(5), at(-8)])).toBe(0);
    expect(run(d, 120, at(0), [], 0)).toBe(0);
  });

  it(`demande un recalage après ${DRIFT_AFTER_S} s hors du peloton, pas avant`, () => {
    const d = new GroupDrift();
    expect(run(d, DRIFT_AFTER_S - 1, at(0), [at(500), at(510)])).toBe(0);
    expect(run(d, 1, at(0), [at(500), at(510)])).toBe(1);
  });

  it(`reste tolérant jusqu'à ${DRIFT_DISTANCE_M} m, et compte les écarts passagers pour rien`, () => {
    const d = new GroupDrift();
    expect(run(d, 60, at(0), [at(DRIFT_DISTANCE_M - 1), at(DRIFT_DISTANCE_M - 2)])).toBe(0);
    // trois secondes loin, puis de nouveau avec les autres : le compte repart
    run(d, DRIFT_AFTER_S - 2, at(0), [at(500)]);
    run(d, 1, at(0), [at(5)]);
    expect(run(d, DRIFT_AFTER_S - 2, at(0), [at(500)])).toBe(0);
  });

  it("la majorité décide : seul contre deux, on est le fautif ; avec la moitié des autres, on reste dans le groupe", () => {
    const alone = new GroupDrift();
    expect(run(alone, DRIFT_AFTER_S, at(0), [at(500), at(505), at(510)])).toBe(1);
    const half = new GroupDrift();
    expect(run(half, 60, at(0), [at(5), at(500)])).toBe(0); // un sur deux est près : pas de dérive
  });

  it("sans voir personne alors qu'il y a du monde, attend plus longtemps avant de se recaler", () => {
    const d = new GroupDrift();
    expect(run(d, BLIND_AFTER_S - 1, at(0), [], 3)).toBe(0);
    expect(run(d, 1, at(0), [], 3)).toBe(1);
  });

  it(`n'insiste pas : un recalage au plus tous les ${RESYNC_MIN_INTERVAL_S} s, ${RESYNC_MAX} d'affilée au plus`, () => {
    const d = new GroupDrift();
    const far = [at(500), at(510)];
    expect(run(d, 200, at(0), far)).toBe(RESYNC_MAX);
    expect(run(d, 3600, at(0), far)).toBe(0); // il abandonne
  });

  it("recommence à croire à ses recalages après une minute passée dans le groupe", () => {
    const d = new GroupDrift();
    const far = [at(500), at(510)];
    run(d, 200, at(0), far);
    run(d, 61, at(0), [at(2), at(3)]); // de nouveau avec les autres
    expect(run(d, DRIFT_AFTER_S + 5, at(0), far)).toBe(1); // les trois essais sont de nouveau permis
  });
});
