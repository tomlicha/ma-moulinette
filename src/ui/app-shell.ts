/**
 * Comportement « application » sur mobile : plein écran, verrou en paysage, invitation à tourner l'appareil quand
 * le téléphone est tenu en portrait, et guide d'installation là où le plein écran n'existe pas autrement. Sur
 * ordinateur (pointeur précis), rien ne change.
 *
 * Deux chemins vers le plein écran :
 * - le navigateur le permet (Android, iPad, ordinateur) : `requestFullscreen` au premier toucher et sur le bouton ;
 * - il ne le permet pas (tous les navigateurs sur iPhone) : seule l'application lancée depuis l'écran d'accueil
 *   s'affiche sans barres. Le guide d'installation explique comment l'y ajouter ; il s'affiche à chaque lancement
 *   dans le navigateur, tant qu'on ne l'a pas écarté pour la session.
 *
 * La coquille native (iPad, iPhone) est déjà en plein écran : ni guide d'installation, ni bouton plein écran. Une fenêtre
 * plus haute que large sur un appareil tenu en paysage (Split View, Slide Over, fenêtre réduite) ne se corrige pas en
 * tournant l'appareil : l'invite demande alors d'élargir la fenêtre.
 */
import { isNativeShell } from '../native/shell';

/** Session en cours : le guide d'installation a été écarté (« Continuer dans le navigateur »). */
const SKIP_KEY = 'zwift2.installSkipped';

export interface ShellEnv {
  /** Écran tactile (`pointer: coarse`). */
  touch: boolean;
  /** Fenêtre plus haute que large. */
  portrait: boolean;
  /** Appareil tenu en paysage (`screen.orientation`), `undefined` si inconnu. */
  screenLandscape?: boolean;
  canFullscreen: boolean;
  /** Déjà sans barres : application installée, coquille native, ou plein écran en cours. */
  standalone: boolean;
  fullscreen: boolean;
  /** Guide d'installation écarté pour la session. */
  skipped: boolean;
}

export interface ShellHints {
  install: boolean;
  /** `rotate` : tourner l'appareil ; `widen` : élargir la fenêtre (multitâche). */
  rotate: 'none' | 'rotate' | 'widen';
  /** Bouton de l'invite : plein écran, réouverture du guide d'installation, ou aucun. */
  button: 'none' | 'fullscreen' | 'install-guide';
}

export function shellHints(e: ShellEnv): ShellHints {
  const install = e.touch && !e.canFullscreen && !e.standalone && !e.skipped;
  const rotate = !e.touch || !e.portrait || install ? 'none' : e.screenLandscape ? 'widen' : 'rotate';
  // En multitâche, le plein écran ne sort pas du partage d'écran : pas de bouton.
  const button = e.standalone || e.fullscreen || rotate === 'widen' ? 'none' : e.canFullscreen ? 'fullscreen' : 'install-guide';
  return { install, rotate, button };
}

export function setupAppShell() {
  const touch = matchMedia('(pointer: coarse)');
  const portrait = matchMedia('(orientation: portrait)');
  const hint = document.getElementById('rotate-hint');
  const btn = document.getElementById('fs-btn') as HTMLButtonElement | null;
  const install = document.getElementById('install-hint');
  const skip = document.getElementById('install-skip');
  // `navigator.standalone` : seul signal fiable sur les anciens iOS, où `display-mode` n'est pas renseigné.
  const standalone = () =>
    isNativeShell() ||
    matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const canFullscreen = !!document.documentElement.requestFullscreen;

  // Le stockage de session peut être refusé (navigation privée) : le choix vaut alors pour la page en cours.
  let skipped = false;
  try {
    skipped = sessionStorage.getItem(SKIP_KEY) === '1';
  } catch { /* stockage indisponible */ }
  const setSkipped = (on: boolean) => {
    skipped = on;
    try {
      if (on) sessionStorage.setItem(SKIP_KEY, '1');
      else sessionStorage.removeItem(SKIP_KEY);
    } catch { /* stockage indisponible */ }
  };

  const title = hint?.querySelector('h2');
  const lede = hint?.querySelector('p');
  const text = { title: title?.textContent ?? '', lede: lede?.textContent ?? '' };

  const update = () => {
    const h = shellHints({
      touch: touch.matches,
      portrait: portrait.matches,
      screenLandscape: screen.orientation?.type ? screen.orientation.type.startsWith('landscape') : undefined,
      canFullscreen,
      standalone: standalone(),
      fullscreen: !!document.fullscreenElement,
      skipped,
    });
    if (install) install.hidden = !h.install;
    // Le guide d'installation passe avant l'invite à tourner : il se suit dans les deux orientations.
    if (hint) hint.hidden = h.rotate === 'none';
    if (title && lede) {
      const widen = h.rotate === 'widen';
      title.textContent = widen ? 'Élargis la fenêtre' : text.title;
      lede.textContent = widen
        ? 'Ma Moulinette a besoin de toute la largeur de l’écran : quitte l’écran partagé, ou agrandis sa fenêtre.'
        : text.lede;
      hint?.classList.toggle('rotate-widen', widen);
    }
    // Le bouton passe en plein écran là où c'est possible, et rouvre le guide d'installation ailleurs.
    if (btn) {
      btn.hidden = h.button === 'none';
      btn.textContent = h.button === 'fullscreen' ? 'Passer en plein écran' : 'Comment passer en plein écran';
    }
  };
  update();
  portrait.addEventListener('change', update);
  touch.addEventListener('change', update);
  screen.orientation?.addEventListener?.('change', update);
  document.addEventListener('fullscreenchange', update);

  const lockLandscape = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {}); // refusé hors plein écran, ou non pris en charge (iOS)
  };

  const goFullscreen = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* refusé par le navigateur : l'application reste utilisable dans sa fenêtre */ }
    lockLandscape();
  };

  btn?.addEventListener('click', () => {
    if (canFullscreen) return void goFullscreen();
    setSkipped(false);
    update();
  });
  skip?.addEventListener('click', () => {
    setSkipped(true);
    update();
  });
  if (!touch.matches || standalone() || !canFullscreen) return;
  // Premier geste de l'utilisateur sur mobile : on passe en plein écran paysage.
  addEventListener('pointerup', () => void goFullscreen(), { once: true });
}
