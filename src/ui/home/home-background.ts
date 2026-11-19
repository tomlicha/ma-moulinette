import { HOME_SCENES, SCENE_ROTATION_MS, type HomeScene } from './home-scenes';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Scène suivante dans la liste, en repartant du début après la dernière. */
export const nextScene = (current: number, count: number) => (current + 1) % count;

/**
 * Fond de l'accueil : les scènes sont empilées et fondues l'une dans l'autre (le style est dans home.css).
 * Le titre et la description suivent l'image affichée quand ils sont fournis (l'écran Séances n'en a pas).
 * Retourne une fonction qui arrête le roulement ; elle porte aussi `show(i)` pour afficher une scène donnée.
 * Avec `everyMs` infini, aucune rotation : le fond ne change que par `show` (accueil, où il suit le parcours choisi).
 */
export function setupHomeBackground(
  container: HTMLElement,
  title?: HTMLElement,
  description?: HTMLElement,
  scenes: HomeScene[] = HOME_SCENES,
  everyMs = SCENE_ROTATION_MS,
): (() => void) & { show: (i: number) => void } {
  const layers = scenes.map((s) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'home-scene');
    svg.setAttribute('viewBox', '0 0 800 420');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = s.svg;
    container.append(svg);
    return svg;
  });
  let current = Math.floor(Math.random() * scenes.length);
  const show = (i: number) => {
    layers.forEach((l, k) => l.toggleAttribute('data-on', k === i));
    if (title) title.textContent = scenes[i]!.name;
    if (description) description.textContent = scenes[i]!.description;
    current = i;
  };
  show(current);
  // Un délai infini est lu comme 0 par `setInterval` : on ne programme alors rien.
  const timer = Number.isFinite(everyMs) ? setInterval(() => show(nextScene(current, scenes.length)), everyMs) : undefined;
  return Object.assign(() => clearInterval(timer), { show });
}
