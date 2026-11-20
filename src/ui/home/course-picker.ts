import type { CourseDef, RoadNetwork } from '../../domain/course/network';
import { courseArt } from './home-course-art';
import { CourseSelection, courseSummary } from './course-selection';

export interface CoursePicker {
  /** Identifiant du parcours retenu. */
  selected(): string;
  /** Passe au parcours suivant (`1`) ou précédent (`-1`), en rebouclant. */
  step(delta: 1 | -1): void;
}

interface Options {
  /** Conteneur des vignettes (un `role="radiogroup"`). */
  root: HTMLElement;
  network: RoadNetwork;
  /** Mémoire des préférences : le choix survit au rechargement. */
  store: Pick<Storage, 'getItem' | 'setItem'>;
  storeKey: string;
  /** Appelée à chaque choix, y compris le premier (au chargement), avec le parcours retenu. */
  onSelect: (course: CourseDef) => void;
}

/** « 0,5 km le tour » pour la piste, « 20,5 km · de nuit » pour le ciel : ce que dit la vignette sous le nom. */
function thumbLine(network: RoadNetwork, c: CourseDef): string {
  const stats = network.courseStats(c);
  if (c.id === 'velodrome') return `${(stats.lengthM / 1000).toFixed(1).replace('.', ',')} km le tour`;
  return courseSummary(stats);
}

/**
 * Les parcours en vignettes illustrées, toujours visibles sous le monde : on choisit d'un toucher, sans ouvrir de menu.
 * Voir `CourseSelection` pour la logique.
 */
export function setupCoursePicker({ root, network, store, storeKey, onSelect }: Options): CoursePicker {
  const selection = new CourseSelection(network, store, storeKey);

  const buttons = network.courses.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'course-thumb';
    b.setAttribute('role', 'radio');
    b.dataset.course = c.id;
    const art = document.createElement('span');
    art.className = 'art';
    art.innerHTML = `<svg viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${courseArt(c.id)}</svg>`; // dessins issus de nos propres données
    const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: c.name });
    const meta = Object.assign(document.createElement('span'), { className: 'meta', textContent: thumbLine(network, c) });
    b.append(art, nm, meta);
    b.addEventListener('click', () => choose(c.id));
    root.append(b);
    return b;
  });

  function choose(id: string) {
    if (!selection.select(id)) return;
    render();
    onSelect(selection.selected);
  }

  function render() {
    buttons.forEach((b) => {
      const on = b.dataset.course === selection.selected.id;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
  }

  render();
  onSelect(selection.selected);
  return {
    selected: () => selection.selected.id,
    step(delta) {
      const count = network.courses.length;
      choose(network.courses[(network.courses.indexOf(selection.selected) + delta + count) % count]!.id);
    },
  };
}
