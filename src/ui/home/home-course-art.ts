import { HOME_SCENES } from './home-scenes';

/** La scène (corps d'un `<svg viewBox="0 0 800 420">`) qui illustre un parcours, par son identifiant. */
export function courseArt(courseId: string): string {
  const name = { col: 'Col des Érables', rive: 'Rive du lac', 'arc-en-ciel': 'Route arc-en-ciel', velodrome: 'Vélodrome de Roubaix' }[courseId];
  return (HOME_SCENES.find((s) => s.name === name) ?? HOME_SCENES[0]!).svg;
}
