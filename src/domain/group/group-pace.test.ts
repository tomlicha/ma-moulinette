import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../course/courses/col-des-erables';
import { Journey } from '../sim/journey';
import { Ride } from '../sim/ride';
import type { Workout } from '../workout/model';
import { GROUP_REF_FTP_W, GROUP_RIDER, GROUP_TICK_MS, GroupPace, groupRider, type GroupRef } from './group-pace';

const workout: Workout = {
  name: 'Test',
  steps: [
    { kind: 'warmup', durationS: 120, target: { kind: 'ftp', from: 0.5, to: 0.8 } },
    { kind: 'steady', durationS: 300, target: { kind: 'ftp', from: 0.9, to: 0.9 } },
    { kind: 'free', durationS: 60, target: { kind: 'free' } },
    { kind: 'on', durationS: 120, target: { kind: 'watts', from: 300, to: 300 } },
  ],
  messages: [],
  warnings: [],
};
const TOTAL_S = 600;

/** Un coureur du groupe : son trajet, sa sortie, et l'horloge commune qu'on règle à la main. */
function rider() {
  let elapsedMs = 0;
  const journey = new Journey(COL_DES_ERABLES);
  const ride = new Ride(journey, GROUP_RIDER);
  const pace = new GroupPace(workout, () => elapsedMs);
  return {
    ride,
    pace,
    journey,
    at: (ms: number) => {
      elapsedMs = ms;
      pace.advance(ride);
      return ride.snapshot();
    },
  };
}

describe('GroupPace', () => {
  it("n'avance pas avant le départ", () => {
    const a = rider();
    expect(a.at(-5000).distanceM).toBe(0);
    expect(a.at(0).distanceM).toBe(0);
    expect(a.pace.playedS).toBe(0);
  });

  it('avance de pas fixes de 100 ms : le temps joué suit le temps du groupe', () => {
    const a = rider();
    a.at(10_050);
    expect(a.pace.playedS).toBeCloseTo(10, 5);
    expect(GROUP_TICK_MS).toBe(100);
  });

  it("donne exactement le même point quelle que soit la cadence des appels, et pour un coureur arrivé en retard", () => {
    const steady = rider(); // présent depuis le départ : un appel tous les 100 ms
    const jittery = rider(); // des appels irréguliers (onglet endormi puis réveillé)
    const late = rider(); // arrive après 5 minutes, rejoue tout d'un trait
    let last = steady.at(0);
    for (let ms = 100; ms <= 330_000; ms += 100) last = steady.at(ms);
    for (const ms of [137, 900, 4_020, 4_021, 61_000, 61_050, 200_000, 330_000]) jittery.at(ms);
    const lateSnap = late.at(330_000);
    expect(jittery.ride.snapshot().distanceM).toBe(last.distanceM);
    expect(lateSnap.distanceM).toBe(last.distanceM);
    expect(lateSnap.speedKmh).toBe(last.speedKmh);
    expect(last.distanceM).toBeGreaterThan(1000);
  });

  it("la position ne dépend que du temps du groupe : même point à la même seconde, quel que soit le trajet des appels", () => {
    const a = rider();
    const b = rider();
    a.at(250_000);
    for (let ms = 0; ms <= 250_000; ms += 1000) b.at(ms);
    expect(a.journey.locate(a.ride.snapshot().distanceM)).toEqual(b.journey.locate(b.ride.snapshot().distanceM));
  });

  it("s'arrête à la fin de la séance et ne bouge plus", () => {
    const a = rider();
    const end = a.at(TOTAL_S * 1000 + 5000);
    expect(a.pace.done).toBe(true);
    expect(a.pace.playedS).toBeCloseTo(TOTAL_S, 5);
    expect(a.at(TOTAL_S * 1000 + 600_000).distanceM).toBe(end.distanceM);
  });

  it('roule tranquille sur un palier libre, et plus vite sur un palier dur', () => {
    const a = rider();
    const steady = a.at(300_000).speedKmh; // fin du palier à 90 %
    const afterFree = a.at(420_000).speedKmh; // après 60 s libres
    expect(steady).toBeGreaterThan(afterFree);
  });

  it('la FTP de référence fixe l’allure : 90 % de 250 W sur le plat donne une vitesse de peloton', () => {
    expect(GROUP_REF_FTP_W).toBe(250);
    const a = rider();
    const v = a.at(250_000).speedKmh;
    expect(v).toBeGreaterThan(15);
    expect(v).toBeLessThan(45);
  });
});

describe("GroupPace : l'allure est celle du créateur", () => {
  const at = (ref: GroupRef, ms: number) => {
    const ride = new Ride(new Journey(COL_DES_ERABLES), groupRider(ref));
    const pace = new GroupPace(workout, () => ms, ref);
    pace.advance(ride);
    return { snap: ride.snapshot(), ride, pace };
  };

  it("un créateur à la FTP plus haute fait avancer le groupe plus vite et plus loin", () => {
    const slow = at({ ftpW: 200, massKg: 75 }, 250_000);
    const fast = at({ ftpW: 320, massKg: 75 }, 250_000);
    expect(fast.snap.distanceM).toBeGreaterThan(slow.snap.distanceM * 1.2);
    expect(fast.snap.speedKmh).toBeGreaterThan(slow.snap.speedKmh);
  });

  it("sa masse compte aussi : plus lourd, le groupe monte moins vite", () => {
    const light = at({ ftpW: 250, massKg: 60 }, 250_000);
    const heavy = at({ ftpW: 250, massKg: 95 }, 250_000);
    expect(light.snap.distanceM).toBeGreaterThan(heavy.snap.distanceM);
  });

  it("la sortie simule le cycliste du créateur, pas celui de l'appareil", () => {
    const { pace } = at({ ftpW: 300, massKg: 88 }, 1000);
    expect(pace.rider.massKg).toBe(88);
  });

  it("sans créateur connu, repli sur le coureur de référence", () => {
    const ride = new Ride(new Journey(COL_DES_ERABLES), GROUP_RIDER);
    const pace = new GroupPace(workout, () => 250_000);
    pace.advance(ride);
    expect(ride.snapshot().distanceM).toBe(at({ ftpW: GROUP_REF_FTP_W, massKg: 75 }, 250_000).snap.distanceM);
  });

  it("reste déterministe : présent depuis le départ ou arrivé en retard, même distance pour la même référence", () => {
    const ref = { ftpW: 310, massKg: 82 };
    const present = (() => {
      let t = 0;
      const ride = new Ride(new Journey(COL_DES_ERABLES), groupRider(ref));
      const pace = new GroupPace(workout, () => t, ref);
      for (; t <= 330_000; t += 100) pace.advance(ride);
      return ride.snapshot().distanceM;
    })();
    expect(at(ref, 330_000).snap.distanceM).toBe(present);
  });

});
