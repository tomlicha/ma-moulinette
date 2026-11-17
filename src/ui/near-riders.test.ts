import { describe, expect, it } from 'vitest';
import { draftText } from './near-riders';

describe('draftText', () => {
  it('montre l’abri à partir de 3 % d’air épargné, arrondi', () => {
    expect(draftText(0)).toBe('');
    expect(draftText(0.02)).toBe('');
    expect(draftText(0.03)).toBe('Abri 3 %');
    expect(draftText(0.224)).toBe('Abri 22 %');
    expect(draftText(0.35)).toBe('Abri 35 %');
  });
});
