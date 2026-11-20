import { HOME_SCENES } from './home-scenes';

/** Vignette du vélodrome : la piste vue de dessus (pas de scène de fond qui lui ressemble). */
const VELODROME_ART = `
<rect width="800" height="420" fill="#EADFCB"/>
<rect x="150" y="70" width="500" height="280" rx="140" fill="#C98B55" stroke="#A86D3C" stroke-width="6"/>
<rect x="230" y="130" width="340" height="160" rx="80" fill="#8FBF7A"/>
<rect x="396" y="70" width="8" height="60" fill="#FFF"/>`;

/** La scène (corps d'un `<svg viewBox="0 0 800 420">`) qui illustre un parcours, par son identifiant. */
export function courseArt(courseId: string): string {
  if (courseId === 'velodrome') return VELODROME_ART;
  const name = { col: 'Col des Érables', rive: 'Rive du lac', 'arc-en-ciel': 'Route arc-en-ciel' }[courseId];
  return (HOME_SCENES.find((s) => s.name === name) ?? HOME_SCENES[0]!).svg;
}
