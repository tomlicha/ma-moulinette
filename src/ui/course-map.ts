import type { CourseDef, RoadNetwork } from '../sim/network';
import { renderCourseProfile, renderNetworkMap } from '../sim/network-map';
import { courseSummary } from './course-selection';

export interface CourseMap {
  /** Met la carte à jour pour le parcours retenu. */
  show(course: CourseDef): void;
}

interface Elements {
  /** Touche de la carte miniature, dans la carte « Monde » : elle ouvre la grande carte. */
  thumb: HTMLButtonElement;
  dialog: HTMLDialogElement;
  title: HTMLElement;
  description: HTMLElement;
  plan: HTMLElement;
  profile: HTMLElement;
  close: HTMLButtonElement;
}

/**
 * Taille voulue du dessin de la grande carte, en pixels de hauteur : le plus grand qui tient dans la fenêtre, sans
 * descendre sous un minimum lisible (la fenêtre défile alors : téléphone en paysage).
 */
/** Hauteur du dessin de la carte en unités du SVG, et plus petit texte voulu à l'écran, en pixels. */
const PLAN_UNITS = 1500;
const MIN_TEXT_PX = 12.5;

export function planHeight(windowHeight: number): number {
  return Math.round(Math.min(760, Math.max(520, windowHeight - 200)));
}

/**
 * Cartes du parcours sur l'écran de choix : une miniature dans la carte « Monde » (le parcours retenu en couleur, l'autre en
 * retrait), qui s'agrandit en une carte avec les noms des carrefours, les kilomètres et le profil d'altitude.
 */
export function setupCourseMap(network: RoadNetwork, el: Elements): CourseMap {
  let current: CourseDef | undefined;

  const openFull = () => {
    if (!current) return;
    const height = planHeight(window.innerHeight);
    // Les textes se grossissent pour rester d'environ 13 px une fois la carte ramenée à `height` pixels.
    const fontScale = Math.max(1, Math.min(3, 1220 / height));
    el.title.textContent = network.name;
    el.description.textContent = `${current.name} · ${courseSummary(network.courseStats(current))}. ${current.description}`;
    // Aucun texte sous 12,5 px à l'écran, quelle que soit la hauteur de la carte.
    el.plan.innerHTML = renderNetworkMap(network, {
      layout: 'plan', selected: current.id, labels: 'nodes', fontScale, pxPerUnit: height / PLAN_UNITS, minTextPx: MIN_TEXT_PX,
    }).svg;
    el.plan.querySelector('svg')!.style.height = `${height}px`;
    if (!el.dialog.open) el.dialog.showModal();
    // Le profil est dessiné à la largeur de sa colonne : ses textes gardent leur taille (aucune réduction).
    const width = Math.max(260, Math.round(el.profile.clientWidth || 460));
    el.profile.innerHTML = renderCourseProfile(network, current.id, width, 1.1).svg;
  };

  el.thumb.addEventListener('click', openFull);
  el.close.addEventListener('click', () => el.dialog.close());
  // Un clic sur le fond (hors de la carte) ferme, comme Échap.
  el.dialog.addEventListener('click', (e) => {
    if (e.target === el.dialog) el.dialog.close();
  });

  return {
    show(course) {
      current = course;
      el.thumb.innerHTML = renderNetworkMap(network, { layout: 'plan', selected: course.id, labels: 'none', stepM: 60 }).svg;
      el.thumb.setAttribute('aria-label', `Agrandir la carte : ${course.name}`);
      // Si la grande carte est ouverte, elle suit.
      if (el.dialog.open) openFull();
    },
  };
}
