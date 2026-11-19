import { describe, expect, it } from 'vitest';
import { chooseQuality, pixelRatioFor } from './quality';

describe('chooseQuality', () => {
  it('suit le paramètre ?quality quand il est valide', () => {
    expect(chooseQuality('high', true)).toBe('high');
    expect(chooseQuality('low', false)).toBe('low');
  });

  it('sinon, écran tactile en low et souris en high', () => {
    expect(chooseQuality(null, true)).toBe('low');
    expect(chooseQuality(null, false)).toBe('high');
    expect(chooseQuality('ultra', true)).toBe('low');
  });
});

describe('pixelRatioFor', () => {
  it('plafonne à 2 en high et 1,5 en low, sans jamais dépasser la densité de l’écran', () => {
    expect(pixelRatioFor('high', 3)).toBe(2);
    expect(pixelRatioFor('low', 3)).toBe(1.5);
    expect(pixelRatioFor('low', 1)).toBe(1);
    expect(pixelRatioFor('high', 1.25)).toBe(1.25);
  });
});
