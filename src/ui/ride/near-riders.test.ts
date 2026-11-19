import { describe, expect, it } from 'vitest';
import { draftText } from './near-riders';

describe('draftText', () => {
  it('montre l’aspiration à partir de 3 % d’air épargné, arrondi', () => {
    expect(draftText(0)).toBe('');
    expect(draftText(0.02)).toBe('');
    expect(draftText(0.03)).toBe('Aspiration 3 %');
    expect(draftText(0.224)).toBe('Aspiration 22 %');
    expect(draftText(0.35)).toBe('Aspiration 35 %');
  });
});
