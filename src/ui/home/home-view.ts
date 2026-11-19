import type { CourseDef, RoadNetwork } from '../../domain/course/network';
import { setBlocked, type BlockReason } from '../shared/blocked';
import { byId } from '../shared/dom';
import { setupCourseMap } from './course-map';
import { setupCoursePicker, type CoursePicker } from './course-picker';
import { HOME_SCENES } from './home-scenes';
import { setupHomeBackground } from './home-background';

/** Ce que le coureur peut demander depuis l'accueil. */
export interface HomeViewActions {
  /** Le parcours retenu change (y compris le premier, au chargement de la page). */
  courseSelected(course: CourseDef): void;
  /** « Partir », dans le menu du parcours : ouvre la sortie et la lance. */
  startRide(): void;
  /** « Rouler » alors qu'une sortie est déjà en cours : on la reprend, sans menu. */
  resumeRide(): void;
}

/** La scène de fond qui ressemble à chaque parcours (par le nom de la scène). */
const COURSE_SCENE: Record<string, string> = { col: 'Col des Érables', rive: 'Rive du lac', 'arc-en-ciel': 'Route arc-en-ciel' };

/**
 * L'accueil : le parcours retenu (nom, description, scène de fond qui lui ressemble, sans rotation), le menu qui le
 * choisit (avec sa carte), et le bouton « Rouler ». On choisit le parcours dans le menu que « Rouler » ouvre : la carte
 * de l'accueil n'a pas la place d'un sélecteur. Il demande (`HomeViewActions`) ; ce que le choix change est dans main.ts.
 */
export class HomeView {
  private readonly picker: CoursePicker;
  private readonly dialog = byId<HTMLDialogElement>('course-dialog');
  private readonly rideBtn = byId<HTMLButtonElement>('home-ride');

  constructor(
    network: RoadNetwork,
    prefs: Pick<Storage, 'getItem' | 'setItem'>,
    rideActive: () => boolean,
    actions: HomeViewActions,
  ) {
    const scenes = network.courses.map((c) => HOME_SCENES.find((s) => s.name === COURSE_SCENE[c.id]) ?? HOME_SCENES[0]!);
    const background = setupHomeBackground(byId('home-scenes'), undefined, undefined, scenes, Infinity);
    // Carte du parcours : miniature dans le menu, agrandie dans sa propre boîte. Créée avant le menu, qui l'appelle d'emblée.
    const map = setupCourseMap(network, {
      thumb: byId<HTMLButtonElement>('course-map'),
      dialog: byId<HTMLDialogElement>('map-dialog'),
      title: byId('map-title'),
      description: byId('map-desc'),
      plan: byId('map-plan'),
      profile: byId('map-profile'),
      close: byId<HTMLButtonElement>('map-close'),
    });
    this.picker = setupCoursePicker({
      root: byId('course-options'),
      network,
      store: prefs,
      storeKey: 'mamoulinette.course',
      onSelect: (course) => {
        byId('home-title').textContent = course.name;
        byId('home-desc').textContent = course.description;
        background.show(network.courses.indexOf(course));
        map.show(course);
        actions.courseSelected(course);
      },
    });
    byId('course-cancel').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close(); // un clic sur le fond ferme, comme Échap
    });
    byId('course-go').addEventListener('click', () => {
      this.dialog.close();
      actions.startRide();
    });
    // « Rouler » : une sortie déjà en cours se reprend ; sinon on choisit le parcours, puis « Partir » lance la sortie.
    this.rideBtn.addEventListener('click', () => {
      if (rideActive()) {
        actions.resumeRide();
        return;
      }
      this.dialog.showModal();
      byId<HTMLButtonElement>('course-go').focus();
    });
  }

  /** Le parcours retenu (son identifiant). */
  selectedCourseId(): string {
    return this.picker.selected();
  }

  /** Le bouton « Rouler » dit pourquoi il est indisponible (un trainer manque), ou ne dit rien. */
  setRideBlock(reason: BlockReason | undefined): void {
    setBlocked(this.rideBtn, reason);
  }
}
