import type { CourseDef, RoadNetwork } from '../../domain/course/network';
import { renderCourseSparkline } from '../../domain/course/network-map';
import { setBlocked, type BlockReason } from '../shared/blocked';
import { byId } from '../shared/dom';
import { setupCourseMap } from './course-map';
import { setupCoursePicker, type CoursePicker } from './course-picker';
import { courseSummary } from './course-selection';
import { HOME_SCENES } from './home-scenes';
import { setupHomeBackground } from './home-background';

/** Ce que le coureur peut demander depuis l'accueil. */
export interface HomeViewActions {
  /** Le parcours retenu change (y compris le premier, au chargement de la page). */
  courseSelected(course: CourseDef): void;
  /** « Rouler » : ouvre la sortie et la lance. */
  startRide(): void;
  /** « Rouler » alors qu'une sortie est déjà en cours : on la reprend. */
  resumeRide(): void;
}

/** La scène de fond qui ressemble à chaque parcours (par le nom de la scène). */
const COURSE_SCENE: Record<string, string> = { col: 'Col des Érables', rive: 'Rive du lac', 'arc-en-ciel': 'Route arc-en-ciel', velodrome: 'Vélodrome de Roubaix' };

/**
 * L'accueil (docs/design/accueil-refonte.md) : le monde du parcours retenu (nom, description, scène), la ligne « Ta sortie »
 * avec « Rouler », les parcours en vignettes et, sur téléphone, le sélecteur ‹ › qui les remplace. La colonne des séances
 * est dans `HomeWorkoutsView`. Il demande (`HomeViewActions`) ; ce que le choix change est dans composition/workout.ts.
 */
export class HomeView {
  private readonly picker: CoursePicker;
  private readonly rideBtn = byId<HTMLButtonElement>('home-ride');
  private workoutLine = '';

  constructor(
    private readonly network: RoadNetwork,
    prefs: Pick<Storage, 'getItem' | 'setItem'>,
    rideActive: () => boolean,
    actions: HomeViewActions,
  ) {
    const scenes = network.courses.map((c) => HOME_SCENES.find((s) => s.name === COURSE_SCENE[c.id]) ?? HOME_SCENES[0]!);
    const background = setupHomeBackground(byId('home-scenes'), undefined, undefined, scenes, Infinity);
    // La grande carte du monde : ouverte par « Voir la carte du monde » (la touche cachée `course-map` porte la miniature). Créée avant le choix, qui l'appelle d'emblée.
    const map = setupCourseMap(network, {
      thumb: byId<HTMLButtonElement>('course-map'),
      dialog: byId<HTMLDialogElement>('map-dialog'),
      title: byId('map-title'),
      description: byId('map-desc'),
      plan: byId('map-plan'),
      profile: byId('map-profile'),
      close: byId<HTMLButtonElement>('map-close'),
    });
    byId('home-map-link').addEventListener('click', () => byId('course-map').click());
    this.picker = setupCoursePicker({
      root: byId('course-thumbs'),
      network,
      store: prefs,
      storeKey: 'mamoulinette.course',
      onSelect: (course) => {
        byId('home-title').textContent = course.name;
        byId('home-desc').textContent = course.description;
        background.show(network.courses.indexOf(course));
        map.show(course);
        this.showCourse(course);
        actions.courseSelected(course);
      },
    });
    byId('home-course-prev').addEventListener('click', () => this.picker.step(-1));
    byId('home-course-next').addEventListener('click', () => this.picker.step(1));
    // « Rouler » : une sortie déjà en cours se reprend ; sinon on la lance sur le parcours retenu.
    this.rideBtn.addEventListener('click', () => (rideActive() ? actions.resumeRide() : actions.startRide()));
  }

  /** Le parcours retenu (son identifiant). */
  selectedCourseId(): string {
    return this.picker.selected();
  }

  /** « avec Sweet spot 2×20 · 50 min en ERG » : ce qu'on roulera, sous le parcours dans « Ta sortie ». */
  setWorkoutLine(text: string): void {
    this.workoutLine = text;
    byId('home-trip-workout').textContent = text;
  }

  /** Le bouton « Rouler » dit pourquoi il est indisponible (un trainer manque), ou ne dit rien. */
  setRideBlock(reason: BlockReason | undefined): void {
    setBlocked(this.rideBtn, reason);
  }

  private showCourse(course: CourseDef): void {
    const summary = courseSummary(this.network.courseStats(course));
    byId('home-trip-course').textContent = `${course.name} · ${summary}`;
    byId('home-trip-workout').textContent = this.workoutLine;
    // Appelée dès la création du sélecteur (premier choix) : `this.picker` n'existe pas encore, on compte sans lui.
    byId('home-course-rank').textContent = `Parcours ${this.network.courses.indexOf(course) + 1} / ${this.network.courses.length}`;
    byId('home-course-summary').textContent = summary;
    byId('home-course-spark').innerHTML = renderCourseSparkline(this.network, course.id).svg; // dessin issu de nos propres données
  }
}
