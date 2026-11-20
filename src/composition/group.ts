import { FollowSession } from '../app/follow-session';
import type { JoinableBy } from '../infra/net/group-protocol';
import { FollowView, followEndText } from '../ui/ride/follow-view';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

const JOINABLE_KEY = 'mamoulinette.joinable';

/**
 * Rouler avec d'autres : suivre un coureur de la salle et être suivi (docs/design/groupe.md). Vient après `account`,
 * qui crée la salle, et avant `launch`. Le suivi lui-même est dans `app/follow-session.ts`, son bandeau dans
 * `ui/ride/follow-view.ts` ; ici, on les branche à la sortie, à la salle et à l'encart des coureurs proches.
 */
export function composeGroup(w: Wiring): void {
  const follow = new FollowSession({ world: w.world });
  w.follow = follow;
  const view = new FollowView($('follow'));
  w.followNotice = (text) => view.notice(text);

  // La salle : ce qu'elle dit du suivi, et sa connexion perdue (le serveur oublie alors qui suit qui).
  w.world.onGroup = (msg) => follow.handle(msg);
  const accountOnStatus = w.world.onStatus;
  w.world.onStatus = (s) => {
    accountOnStatus?.(s);
    if (s !== 'online') follow.worldLost();
  };

  /** « Suivre » sur un coureur proche : on le rattrape si on roule déjà, sinon la sortie repart derrière lui. */
  const request = (slot: number, name: string) => {
    if (!w.rideSession.active && !w.trainerCtl.connected) {
      view.notice('Connecte ton home trainer pour rejoindre quelqu’un.');
      return;
    }
    follow.request(slot, name, w.rideSession.active ? 'chase' : 'place');
  };
  w.ridePanel.onFollow = request;

  // Le suivi est une affaire de sortie libre : une séance fixe la puissance, on n'y rattrape personne.
  const syncWithWorkout = () => w.ridePanel.setFollowEnabled(!w.workoutSession.running);
  w.workoutSession.on('started', () => {
    follow.stop('manual');
    syncWithWorkout();
  });
  w.workoutSession.on('ended', syncWithWorkout);
  syncWithWorkout();

  view.onStop = () => follow.stop('manual');
  view.onRefuse = (slot) => follow.refuse(slot);

  follow.on('started', ({ name, pos, mode }) => {
    w.log(`suivi : ${name} rejoint`);
    if (mode === 'place') {
      w.router.go('sortie');
      w.startRideBehind(pos);
    }
  });
  follow.on('changed', (state) => {
    view.render(state);
    w.ridePanel.setFollowed(state?.slot);
  });
  follow.on('ended', (reason, name) => {
    w.log(`suivi : terminé (${reason})`);
    view.notice(followEndText(reason, name));
  });
  follow.on('followers', (list, change) => {
    view.setFollowers(list);
    if (change.joined) w.log(`suivi : ${change.joined.name} te suit`);
  });

  // À chaque pas de la sortie : les règles du suivi (écart, aide, décrochage) avec la position du coureur.
  let lastMs = performance.now();
  const clock = () => {
    const now = performance.now();
    const dtS = Math.min(1, (now - lastMs) / 1000);
    lastMs = now;
    return dtS;
  };
  w.rideSession.on('started', () => void clock());
  w.rideSession.on('resumed', () => void clock());
  w.rideSession.on('tick', ({ snapshot, powerW }) => {
    const dtS = clock();
    if (!follow.state) return;
    const p = w.journey.pointAt(snapshot.distanceM);
    follow.update(dtS, { x: p.x, z: p.z, heading: p.heading, powerW });
  });
  // Quand on arrête sa sortie, on ne suit plus personne : le coureur suivi n'a plus à nous attendre.
  w.rideSession.on('stopped', () => follow.stop('manual'));

  // Qui peut me rejoindre : un réglage du menu de la sortie, retenu sur l'appareil. Tout le monde par défaut ; « mes amis » :
  // ceux que j'ai ajoutés depuis la liste « En ligne » (la salle l'applique, voir `Room`) ; ou personne.
  const select = $<HTMLSelectElement>('joinable-select');
  let who: JoinableBy = 'all';
  try {
    const saved = w.prefs.getItem(JOINABLE_KEY);
    if (saved === 'none' || saved === 'friends') who = saved;
  } catch {
    // préférence illisible : tout le monde
  }
  select.value = who;
  w.world.setJoinable(who);
  select.addEventListener('change', () => {
    who = select.value === 'none' || select.value === 'friends' ? select.value : 'all';
    w.world.setJoinable(who);
    try {
      w.prefs.setItem(JOINABLE_KEY, who);
    } catch {
      // préférence non mémorisée : valable jusqu'à la fermeture de la page
    }
  });
}
