import { describe, expect, it } from 'vitest';
import { POWER_STALE_MS, SensorReadings } from './sensor-readings';

function readings() {
  let now = 10_000;
  const r = new SensorReadings(() => now);
  return { r, advance: (ms: number) => (now += ms) };
}

describe('SensorReadings', () => {
  it('rend 0 et « pas de mesure » tant que rien n\'est arrivé', () => {
    const { r } = readings();
    expect(r.powerW()).toBe(0);
    expect(r.cadenceRpm()).toBe(0);
    expect(r.liveCadenceRpm()).toBeUndefined();
    expect(r.heartRateBpm()).toBeUndefined();
    expect(r.speedKmh()).toBeUndefined();
    expect(r.averagePowerW()).toBeUndefined();
  });

  it('rend les dernières valeurs reçues', () => {
    const { r } = readings();
    r.record({ powerW: 210, cadenceRpm: 88, heartRateBpm: 142, speedKmh: 31.5 });
    expect(r.powerW()).toBe(210);
    expect(r.cadenceRpm()).toBe(88);
    expect(r.liveCadenceRpm()).toBe(88);
    expect(r.heartRateBpm()).toBe(142);
    expect(r.speedKmh()).toBe(31.5);
  });

  it('une mesure partielle ne touche pas aux autres champs', () => {
    const { r, advance } = readings();
    r.record({ powerW: 200, cadenceRpm: 90 });
    advance(1000);
    r.record({ heartRateBpm: 130 });
    expect(r.powerW()).toBe(200);
    expect(r.cadenceRpm()).toBe(90);
    expect(r.heartRateBpm()).toBe(130);
  });

  it('chaque valeur périme séparément après le délai de silence', () => {
    const { r, advance } = readings();
    r.record({ powerW: 200, cadenceRpm: 90 });
    advance(2000);
    r.record({ heartRateBpm: 130 });
    advance(POWER_STALE_MS - 2000 + 1); // puissance et cadence ont 3 001 ms, la FC 1 001 ms
    expect(r.powerW()).toBe(0);
    expect(r.cadenceRpm()).toBe(0);
    expect(r.liveCadenceRpm()).toBeUndefined();
    expect(r.heartRateBpm()).toBe(130);
  });

  it('une valeur de 3 s pile est encore bonne', () => {
    const { r, advance } = readings();
    r.record({ powerW: 180 });
    advance(POWER_STALE_MS);
    expect(r.powerW()).toBe(180);
    advance(1);
    expect(r.powerW()).toBe(0);
  });

  it('distingue une cadence de 0 tr/min mesurée d\'une cadence absente', () => {
    const { r } = readings();
    r.record({ cadenceRpm: 0 });
    expect(r.liveCadenceRpm()).toBe(0);
  });

  it('moyenne la puissance sur 3 s et se tait avec le capteur', () => {
    const { r, advance } = readings();
    r.record({ powerW: 100 });
    advance(1000);
    r.record({ powerW: 200 });
    advance(1000);
    r.record({ powerW: 300 });
    expect(r.averagePowerW()).toBe(200);
    advance(POWER_STALE_MS + 1);
    expect(r.averagePowerW()).toBeUndefined();
  });
});
