import { GroupSession, type GroupLeaveReason } from '../app/group-session';
import { GroupDrift } from '../domain/group/drift';
import { GroupPace } from '../domain/group/group-pace';
import type { Workout } from '../domain/workout/model';
import { lazyOnline } from '../ui/online/lazy-online';
import { setupOnlineChip } from '../ui/online/online-chip';
import { groupPill, leftText } from '../ui/online/online-model';
import { followEndText } from '../ui/ride/follow-view';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

/**
 * Rouler avec d'autres, côté accueil et séance de groupe (docs/design/groupe.md) : la pastille « En ligne », le panneau
 * (coureurs en ligne avec recherche, séances de groupe, salle d'attente) et le départ commun. Vient après `group` (le suivi),
 * dont il réutilise le geste « rejoindre ». La règle est dans `app/group-session.ts` ; ici, on la branche à la sortie, à la
 * séance, à la salle et à l'écran.
 */
export function composeOnline(w: Wiring): void {
  const groups = new GroupSession({ world: w.world, selfSlot: () => w.world.slot });
  w.group = groups;

  // La salle : ce qu'elle dit des groupes (le suivi lit le sien dans `group.ts`, sur le même message), et sa connexion perdue.
  const followHandle = w.world.onGroup;
  w.world.onGroup = (msg) => {
    followHandle?.(msg);
    groups.handle(msg);
  };
  const previousOnStatus = w.world.onStatus;
  w.world.onStatus = (s) => {
    previousOnStatus?.(s);
    if (s !== 'online') groups.worldLost();
  };

  const courseName = (id: string) => w.journey.network.course(id)?.name ?? id;

  /** Pourquoi on ne peut ni rejoindre un coureur ni un groupe maintenant ; `undefined` : on peut. */
  const blockReason = (): string | undefined =>
    w.rideSession.active
      ? 'Une sortie est en cours : termine-la avant de rejoindre quelqu’un.'
      : !w.trainerCtl.connected
        ? 'Connecte ton home trainer pour rouler avec d’autres.'
        : undefined;

  const planNow = () => ({ workoutName: w.workoutSession.workout?.name, courseName: courseName(w.home.selectedCourseId()) });

  const online = lazyOnline(
    $<HTMLDialogElement>('online-panel'),
    {
      search: (q) => groups.refreshOnline(q),
      joinRider: (slot, name) => {
        online.panel?.notice('');
        online.panel?.close();
        w.follow.request(slot, name, 'place');
      },
      joinGroup: (id) => {
        online.panel?.notice('');
        if (!w.trainerCtl.canErg) return online.panel?.notice('Une séance de groupe pilote ton trainer en ERG : il doit savoir le faire.');
        groups.join(id);
      },
      createGroup: (startInS) => {
        const workout = w.workoutSession.workout;
        online.panel?.notice('');
        if (!workout) return;
        if (!w.trainerCtl.canErg) return online.panel?.notice('Une séance de groupe pilote ton trainer en ERG : il doit savoir le faire.');
        // Le groupe prend l'allure de son créateur : sa FTP et sa masse du moment fixent la vitesse de tous.
        groups.create(workout, w.home.selectedCourseId(), startInS, { ftpW: w.readFtp(), massKg: w.riderInputs.rideMassKg });
      },
      leaveGroup: () => groups.leave('manual'),
      onClose: () => undefined,
    },
    { serverNow: () => groups.serverNow(), courseName },
    (panel) => {
      panel.setBlock(blockReason());
      panel.setPlan(planNow());
      panel.setGroup(groups.group);
      panel.render(groups.online.riders, groups.online.groups, groups.online.total);
    },
  );

  const chip = setupOnlineChip($('home-online-chip'), () => {
    if (w.router.current() !== 'accueil') w.router.go('accueil'); // le panneau vit dans l'écran d'accueil
    online.open();
  });

  // Pastille et panneau suivent l'état de la salle, de la séance et du trainer : un coup d'œil par seconde suffit.
  setInterval(() => {
    chip.setOthers(w.world.status === 'online' ? Math.max(0, w.world.population - 1) : undefined);
    online.whenLoaded((panel) => {
      panel.setBlock(blockReason());
      panel.setPlan(planNow());
    });
  }, 1000);

  /** Se compare aux autres membres du groupe : seul hors du peloton, il se recale (docs/design/groupe.md). */
  const drift = new GroupDrift();
  groups.on('resync', (plan) => {
    w.journey.refreshRouting();
    w.rideSession.repace(new GroupPace(plan.workout, () => groups.elapsedMs(), plan.ref));
    drift.reset();
    w.log('séance de groupe : recalé sur le groupe');
    w.followNotice('Recalé sur le groupe.');
  });

  // Un choix du créateur est arrivé : le prolongement de la route déjà calculé par défaut n'est plus le bon.
  groups.on('routes', () => w.journey.refreshRouting());

  groups.on('online', (d) => online.whenLoaded((panel) => panel.render(d.riders, d.groups, d.total)));
  groups.on('changed', (g) => {
    online.whenLoaded((panel) => panel.setGroup(g));
    w.crowd.setGroupLine(g && groups.running ? groupPill(g.members.length) : undefined);
  });

  // Les refus du suivi (« n'accepte pas d'être rejoint ») se lisent aussi dans le panneau, d'où l'on a demandé.
  w.follow.on('ended', (reason, name) => online.whenLoaded((panel) => panel.notice(followEndText(reason, name))));

  /** La séance choisie sur l'accueil avant le départ du groupe : on la remet à la fin. */
  let before: Workout | undefined;

  /** Le départ : même séance, même parcours, au même instant. */
  groups.on('go', (plan) => {
    if (w.rideSession.active || w.workoutSession.running) return groups.leave('busy');
    if (!w.trainerCtl.connected) return groups.leave('missed');
    w.autoStart.disarm();
    before = w.workoutSession.workout;
    w.workoutSession.select(plan.workout);
    // Le même trajet pour tous, donc la même simulation : au carrefour, le choix du créateur du groupe, relayé par la salle.
    w.journey.setGroupRouting({
      choiceFor: (leg) => groups.routeFor(leg),
      get decides() {
        return groups.isLeader;
      },
      decide: (leg, index) => groups.decide(leg, index),
    });
    online.panel?.close();
    w.router.go('sortie');
    const pace = new GroupPace(plan.workout, () => groups.elapsedMs(), plan.ref);
    w.rideSession.start(w.riderInputs.rideMassKg, plan.courseId, undefined, pace);
    w.workoutSession.start(() => groups.elapsedS());
    w.crowd.setGroupLine(groupPill(groups.members().length));
    w.log(`séance de groupe : ${plan.name}, ${plan.workout.name}`);
  });

  /** On n'est plus dans le groupe (choix, décrochage, fin, connexion perdue) : la sortie redevient libre. */
  groups.on('left', (reason: GroupLeaveReason, name: string) => {
    w.crowd.setGroupLine(undefined);
    const wasRiding = w.rideSession.paced || w.workoutSession.synced;
    if (w.workoutSession.synced) w.workoutSession.stop('séance de groupe quittée');
    if (w.rideSession.paced) w.rideSession.releasePacing();
    w.journey.setGroupRouting(undefined);
    if (wasRiding && before !== undefined) w.workoutSession.select(before);
    before = undefined;
    const text = leftText(reason, name);
    if (text) {
      w.log(`séance de groupe : ${text}`);
      online.whenLoaded((panel) => panel.notice(text));
      w.followNotice(text);
    }
  });

  // La séance de groupe va jusqu'au bout, ou on l'arrête : dans les deux cas, on quitte le groupe.
  w.workoutSession.on('ended', () => {
    if (groups.group) groups.leave('manual');
  });
  w.rideSession.on('stopped', () => {
    if (groups.group) groups.leave('manual');
  });

  // Chaque pas de la sortie en groupe : sans pédaler pendant une minute, on sort du groupe.
  let lastMs = performance.now();
  w.rideSession.on('started', () => {
    lastMs = performance.now();
    drift.reset();
  });
  w.rideSession.on('tick', ({ snapshot, powerW }) => {
    const now = performance.now();
    const dtS = Math.min(1, (now - lastMs) / 1000);
    lastMs = now;
    if (!groups.running) return;
    groups.update(dtS, powerW);
    // Les autres membres qui roulent et que la salle nous montre : on doit être avec eux.
    const me = w.world.slot;
    const others = groups.members().filter((m) => m.slot !== me);
    const seen = w.world.riders().filter((r) => r.riding && others.some((m) => m.slot === r.slot));
    const p = w.journey.pointAt(snapshot.distanceM);
    if (drift.update(dtS, p, seen.map((r) => r.point), others.length)) groups.resync();
  });
}
