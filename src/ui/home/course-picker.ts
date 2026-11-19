import type { CourseDef, RoadNetwork } from '../../domain/course/network';
import { renderCourseSparkline } from '../../domain/course/network-map';
import { CourseSelection, courseSummary } from './course-selection';

export interface CoursePicker {
  /** Identifiant du parcours retenu. */
  selected(): string;
}

interface Options {
  /** Conteneur des touches (un `role="radiogroup"`). */
  root: HTMLElement;
  network: RoadNetwork;
  /** Mémoire des préférences : le choix survit au rechargement. */
  store: Pick<Storage, 'getItem' | 'setItem'>;
  storeKey: string;
  /** Appelée à chaque choix, y compris le premier (au chargement), avec le parcours retenu. */
  onSelect: (course: CourseDef) => void;
}

/**
 * Menu de choix du parcours, dans la boîte de dialogue ouverte par « Rouler » : une grande touche par parcours (nom,
 * longueur et montée, description, profil d'altitude à l'échelle commune). Voir `CourseSelection` pour la logique.
 */
export function setupCoursePicker({ root, network, store, storeKey, onSelect }: Options): CoursePicker {
  const selection = new CourseSelection(network, store, storeKey);

  const buttons = network.courses.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'course-opt';
    b.setAttribute('role', 'radio');
    b.dataset.course = c.id;
    const spark = document.createElement('span');
    spark.className = 'spark';
    spark.innerHTML = renderCourseSparkline(network, c.id).svg; // dessin issu de nos propres données
    b.append(
      Object.assign(document.createElement('span'), { className: 'nm', textContent: c.name }),
      spark,
      Object.assign(document.createElement('span'), { className: 'meta', textContent: courseSummary(network.courseStats(c)) }),
      Object.assign(document.createElement('span'), { className: 'desc', textContent: c.description }),
    );
    b.addEventListener('click', () => {
      if (!selection.select(c.id)) return;
      render();
      onSelect(selection.selected);
    });
    root.append(b);
    return b;
  });

  function render() {
    buttons.forEach((b) => {
      const on = b.dataset.course === selection.selected.id;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
  }

  render();
  onSelect(selection.selected);
  return { selected: () => selection.selected.id };
}
