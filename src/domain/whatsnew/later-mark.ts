/**
 * Le plus récent de deux repères de lecture (ou l'un d'eux s'il est seul). Les ids de nouveautés commencent par leur date :
 * le plus grand est le plus récent. À part de `unseen.ts` : les repères font partie du lancement, la sélection non.
 */
export function laterMark(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a >= b ? a : b;
}
