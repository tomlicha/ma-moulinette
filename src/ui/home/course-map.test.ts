import { describe, expect, it } from 'vitest';
import { planHeight } from './course-map';

describe('planHeight', () => {
  it('prend la hauteur de la fenêtre moins l\u2019en-tête, plafonnée à 760 px', () => {
    expect(planHeight(900)).toBe(700);
    expect(planHeight(1440)).toBe(760);
  });

  it('ne descend pas sous 520 px : sur téléphone ou sur un écran de 720 px la fenêtre défile plutôt que de rendre la carte illisible', () => {
    expect(planHeight(720)).toBe(520);
    expect(planHeight(390)).toBe(520);
    expect(planHeight(100)).toBe(520);
  });
});
