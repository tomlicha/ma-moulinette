import { HOME_SCENES } from './home-scenes';

/**
 * La scène (corps d'un `<svg viewBox="0 0 800 420">`) qui illustre un parcours, par son identifiant.
 * Les vignettes et le fond cohabitent dans le même document : leurs identifiants SVG doivent être distincts.
 */
export function courseArt(courseId: string): string {
  const name = { col: 'Col des Érables', rive: 'Rive du lac', 'arc-en-ciel': 'Route arc-en-ciel', velodrome: 'Vélodrome de Roubaix' }[courseId];
  const svg = (HOME_SCENES.find((s) => s.name === name) ?? HOME_SCENES[0]!).svg;
  const prefix = `course-thumb-${courseId}-`;
  const ids = new Map<string, string>();

  // Renomme les déclarations d'identifiants, puis toutes leurs références internes.
  const withPrefixedIds = svg.replace(/\\bid=(["'])([^"']+)\\1/g, (_match, quote: string, id: string) => {
    const prefixed = `${prefix}${id}`;
    ids.set(id, prefixed);
    return `id=${quote}${prefixed}${quote}`;
  });

  return withPrefixedIds
    .replace(/url\\(\\s*(["']?)#([^)"']+)\\1\\s*\\)/g, (match, quote: string, id: string) => {
      const prefixed = ids.get(id);
      return prefixed ? `url(${quote}#${prefixed}${quote})` : match;
    })
    .replace(/(\\b(?:href|xlink:href)\\s*=\\s*)(["'])#([^"']+)\\2/g, (match, attr: string, quote: string, id: string) => {
      const prefixed = ids.get(id);
      return prefixed ? `${attr}${quote}#${prefixed}${quote}` : match;
    });
}
