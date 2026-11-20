import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from './physics';
import { DEFAULT_FTP_W, FTP_LIMITS, MASS_LIMITS, clampValue, normalizeFtp, normalizeMass, wattsPerKg } from './rider-limits';

describe('wattsPerKg', () => {
  it('écrit le rapport à la française, avec deux décimales', () => {
    expect(wattsPerKg(230, 78)).toBe('2,95');
    expect(wattsPerKg(200, 80)).toBe('2,50');
    expect(wattsPerKg(300, 75)).toBe('4,00');
  });
});

describe('clampValue', () => {
  it('garde une valeur dans les bornes, arrondie', () => {
    expect(clampValue(78.4, MASS_LIMITS.min, MASS_LIMITS.max, 70)).toBe(78);
    expect(clampValue(78.6, MASS_LIMITS.min, MASS_LIMITS.max, 70)).toBe(79);
  });

  it('ramène à la borne la plus proche', () => {
    expect(clampValue(5, FTP_LIMITS.min, FTP_LIMITS.max, 200)).toBe(FTP_LIMITS.min);
    expect(clampValue(9000, FTP_LIMITS.min, FTP_LIMITS.max, 200)).toBe(FTP_LIMITS.max);
  });

  it('une saisie illisible redonne la valeur de repli', () => {
    expect(clampValue(Number.NaN, 50, 600, 123)).toBe(123);
    expect(clampValue(Number.POSITIVE_INFINITY, 50, 600, 123)).toBe(123);
  });
});

describe('normalizeFtp et normalizeMass', () => {
  it('gardent une valeur plausible, sinon la valeur par défaut', () => {
    expect(normalizeFtp(250)).toBe(250);
    expect(normalizeFtp(0)).toBe(DEFAULT_FTP_W);
    expect(normalizeFtp(Number.NaN)).toBe(DEFAULT_FTP_W);
    expect(normalizeMass(80)).toBe(80);
    expect(normalizeMass(10)).toBe(DEFAULT_RIDER.massKg);
  });
});
