import { COL_DES_ERABLES } from '../domain/course/courses/col-des-erables';
import { HomeView } from '../ui/home/home-view';
import { setupAppShell } from '../ui/shared/app-shell';
import { setupHomeBackground } from '../ui/home/home-background';
import { setupRideMenu } from '../ui/ride/ride-menu';
import { setupRouter } from '../ui/shared/router';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

export function composeScreens(w: Wiring): void {
  // --- Séance structurée ---

  // L'accueil : parcours retenu, menu du parcours, bouton « Rouler » (home-view.ts). Le HUD n'existe pas encore quand le menu
  // se crée (il annonce le premier choix d'emblée) : on ne le touche qu'ensuite.
  let courseUiReady = false;

  const home = new HomeView(COL_DES_ERABLES, w.prefs, () => w.rideSession.active, {
    courseSelected: (course) => {
      if (w.rideSession.active) return;
      w.journey.setCourse(course.id);
      if (courseUiReady) w.hud.refreshRoute();
    },
    startRide: () => {
      router.go('sortie');
      w.startRide();
    },
    resumeRide: () => router.go('sortie'),
  });
  w.home = home;
  w.refreshWorkoutChoices(); // la ligne « Ta sortie » attendait l'accueil

  courseUiReady = true;

  // L'écran Séances a le même fond, sans titre ni description.
  setupHomeBackground($('sea-scenes'));

  // Et l'écran Appareils.
  setupHomeBackground($('dev-scenes'));

  setupAppShell();

  const rideMenu = setupRideMenu({ prefs: w.prefs, opener: $<HTMLButtonElement>('ride-menu-open'), dialog: $<HTMLDialogElement>('ride-menu'), stats: $('view-stats') });
  w.rideMenu = rideMenu;

  const router = setupRouter((v) => {
    w.rideViews.view?.setActive(v === 'sortie');
    if (v === 'sortie') w.rideViews.hurry(); // la construction se presse, et démarre si le temps mort n'est pas encore venu
    else w.rideViews.calm(); // on a quitté la sortie avant la fin : la construction repasse derrière l'interface
    if (v !== 'sortie') {
      rideMenu.close();
      w.recap.close();
    }
    else w.autoStart.arm();
    if (v === 'seances') w.editor.sync();
  });
  w.router = router;
}
