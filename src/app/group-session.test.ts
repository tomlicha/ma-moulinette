import { describe, expect, it, vi } from 'vitest';
import type { Workout } from '../domain/workout/model';
import type { GroupState } from '../infra/net/group-protocol';
import { GROUP_IDLE_LEAVE_S, GroupSession, type GroupWorld } from './group-session';

const workout: Workout = { name: 'Sweet spot', steps: [{ kind: 'steady', durationS: 600, target: { kind: 'ftp', from: 0.9, to: 0.9 } }], messages: [], warnings: [] };

/** Une horloge et des minuteries à la main : un test avance le temps sans attendre. */
function setup(skewMs = 0, me: number | null = 1) {
  let t = 1_000_000; // heure de l'appareil
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const world = { who: vi.fn(), ping: vi.fn(), createGroup: vi.fn(), joinGroup: vi.fn(), leaveGroup: vi.fn(), routeGroup: vi.fn() } satisfies GroupWorld;
  const session = new GroupSession({
    world,
    selfSlot: () => me ?? undefined,
    now: () => t,
    setTimer: (fn, ms) => {
      timers.push({ at: t + ms, fn, id: nextId });
      return nextId++;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = Math.max(t, next.at);
      next.fn();
    }
    t = end;
  };
  /** Le serveur répond à la dernière mesure d'horloge, avec un aller-retour de `rttMs` : son heure est celle de l'appareil + `skewMs`. */
  const answerPing = (rttMs = 40) => {
    const c = world.ping.mock.calls.at(-1)![0] as number;
    t += rttMs / 2;
    const s = t + skewMs;
    t += rttMs / 2;
    session.handle({ type: 'time', c, s });
  };
  const state = (over: Partial<GroupState> = {}): GroupState => ({
    id: 'g1',
    name: 'Séance de Léa',
    workout,
    courseId: 'col',
    t0: 1_000_000 + skewMs + 60_000,
    members: [{ slot: 1, name: 'Léa' }],
    ftpW: 250,
    massKg: 75,
    leader: 1,
    routes: [],
    ...over,
  });
  return { session, world, advance, answerPing, state, now: () => t };
}

describe('GroupSession', () => {
  it("entre dans le groupe, mesure l'horloge, et dit `go` à l'heure du serveur, pas à celle de l'appareil", () => {
    const { session, world, advance, answerPing, state } = setup(5000); // le serveur avance de 5 s sur l'appareil
    const go = vi.fn();
    session.on('go', go);
    session.handle({ type: 'groupState', group: state() });
    expect(world.ping).toHaveBeenCalledTimes(1);
    answerPing();
    // le départ est dans 60 s sur l'horloge du serveur, moins les 40 ms de la mesure
    expect(session.elapsedMs()).toBeCloseTo(-60_000 + 40, -2);
    advance(58_000);
    expect(go).not.toHaveBeenCalled();
    advance(2500);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith({ id: 'g1', name: 'Séance de Léa', workout, courseId: 'col', ref: { ftpW: 250, massKg: 75 } });
    expect(session.running).toBe(true);
    expect(session.elapsedMs()).toBeGreaterThanOrEqual(0);
  });

  it("arrivé en retard, `go` part dès la première mesure d'horloge, une seule fois", () => {
    const { session, answerPing, state, advance } = setup();
    const go = vi.fn();
    session.on('go', go);
    session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 300_000 }) });
    expect(go).not.toHaveBeenCalled(); // pas encore d'horloge commune
    answerPing();
    expect(go).toHaveBeenCalledTimes(1);
    expect(session.elapsedS()).toBeGreaterThan(299);
    advance(10_000);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("sans réponse du serveur pendant 2 s, part avec l'heure de l'appareil", () => {
    const { session, state, advance } = setup();
    const go = vi.fn();
    session.on('go', go);
    session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000 }) });
    advance(2100);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("garde la meilleure mesure : l'aller-retour le plus court, jamais une plus longue", () => {
    const { session, answerPing, state } = setup(1000);
    session.handle({ type: 'groupState', group: state() });
    answerPing(20);
    const good = session.elapsedMs();
    answerPing(400); // une mesure plus lente ne remplace pas la bonne
    // (le temps a avancé de 400 ms entre-temps)
    expect(session.elapsedMs() - good).toBeGreaterThan(399);
    expect(session.elapsedMs() - good).toBeLessThan(421);
  });

  it('met à jour les membres sans toucher au départ', () => {
    const { session, state } = setup();
    const changed = vi.fn();
    session.on('changed', changed);
    session.handle({ type: 'groupState', group: state() });
    session.handle({ type: 'groupMembers', id: 'g1', leader: 1, members: [{ slot: 1, name: 'Léa' }, { slot: 2, name: 'Tom' }] });
    expect(session.members().map((m) => m.name)).toEqual(['Léa', 'Tom']);
    session.handle({ type: 'groupMembers', id: 'autre', leader: 1, members: [] }); // un autre groupe : ignoré
    expect(session.members()).toHaveLength(2);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('quitter prévient la salle et annule le départ', () => {
    const { session, world, state, answerPing, advance } = setup();
    const go = vi.fn();
    const left = vi.fn();
    session.on('go', go);
    session.on('left', left);
    session.handle({ type: 'groupState', group: state() });
    answerPing();
    session.leave();
    expect(world.leaveGroup).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledWith('manual', 'Séance de Léa');
    advance(120_000);
    expect(go).not.toHaveBeenCalled();
    expect(session.group).toBeUndefined();
  });

  it("un groupe fermé par la salle (fini, vide) est quitté sans lui renvoyer d'ordre", () => {
    const { session, world, state } = setup();
    const left = vi.fn();
    session.on('left', left);
    session.handle({ type: 'groupState', group: state() });
    session.handle({ type: 'groupClosed', id: 'g1', reason: 'over' });
    expect(left).toHaveBeenCalledWith('over', 'Séance de Léa');
    expect(world.leaveGroup).not.toHaveBeenCalled();
  });

  it('une demande refusée (groupe plein) est signalée même sans groupe', () => {
    const { session } = setup();
    const left = vi.fn();
    session.on('left', left);
    session.handle({ type: 'groupClosed', id: 'g9', reason: 'full' });
    expect(left).toHaveBeenCalledWith('full', '');
  });

  it("sort du groupe après 60 s sans pédaler, et le compte repart dès qu'on repédale", () => {
    const { session, state, answerPing } = setup();
    session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000 }) });
    answerPing();
    expect(session.running).toBe(true);
    session.update(GROUP_IDLE_LEAVE_S - 1, 0);
    session.update(1, 180); // il repédale
    session.update(GROUP_IDLE_LEAVE_S - 1, 0);
    expect(session.group).toBeDefined();
    const left = vi.fn();
    session.on('left', left);
    session.update(1, 0);
    expect(left).toHaveBeenCalledWith('self-stopped', 'Séance de Léa');
  });

  it('garde la liste des coureurs en ligne et des groupes', () => {
    const { session, world } = setup();
    const online = vi.fn();
    session.on('online', online);
    session.handle({ type: 'who', riders: [{ slot: 2, name: 'Léa', riding: true }], groups: [], total: 1 });
    expect(session.online.riders[0]!.name).toBe('Léa');
    expect(online).toHaveBeenCalledTimes(1);
    session.refreshOnline('le');
    expect(world.who).toHaveBeenCalledWith('le');
  });

  it('la connexion perdue sort du groupe, sans ordre à la salle', () => {
    const { session, world, state } = setup();
    session.handle({ type: 'groupState', group: state() });
    const left = vi.fn();
    session.on('left', left);
    session.worldLost();
    expect(left).toHaveBeenCalledWith('offline', 'Séance de Léa');
    expect(world.leaveGroup).not.toHaveBeenCalled();
  });

  describe('le créateur choisit la route aux carrefours', () => {
    it('sait si je suis le créateur, et qui il est', () => {
      const leader = setup(0, 1);
      leader.session.handle({ type: 'groupState', group: leader.state({ members: [{ slot: 1, name: 'Léa' }, { slot: 2, name: 'Tom' }] }) });
      expect(leader.session.isLeader).toBe(true);
      expect(leader.session.leaderName).toBe('Léa');
      const other = setup(0, 2);
      other.session.handle({ type: 'groupState', group: other.state({ members: [{ slot: 1, name: 'Léa' }, { slot: 2, name: 'Tom' }] }) });
      expect(other.session.isLeader).toBe(false);
      const offline = setup(0, null);
      offline.session.handle({ type: 'groupState', group: offline.state() });
      expect(offline.session.isLeader).toBe(false);
    });

    it('le créateur envoie son choix à la salle ; un autre coureur ne peut pas', () => {
      const leader = setup(0, 1);
      leader.session.handle({ type: 'groupState', group: leader.state() });
      leader.session.decide(12, 2);
      expect(leader.world.routeGroup).toHaveBeenCalledWith(12, 2);
      const other = setup(0, 2);
      other.session.handle({ type: 'groupState', group: other.state() });
      other.session.decide(12, 2);
      expect(other.world.routeGroup).not.toHaveBeenCalled();
    });

    it("garde les choix déjà faits à l'arrivée, et ceux qui arrivent ensuite ; le trajet est prévenu", () => {
      const { session, state } = setup(0, 2);
      const routes = vi.fn();
      session.on('routes', routes);
      session.handle({ type: 'groupState', group: state({ routes: [[3, 1], [7, 0]] }) });
      expect(session.routeFor(3)).toBe(1);
      expect(session.routeFor(7)).toBe(0);
      expect(session.routeFor(9)).toBeUndefined();
      session.handle({ type: 'groupRoute', leg: 9, index: 2 });
      expect(session.routeFor(9)).toBe(2);
      expect(routes).toHaveBeenCalledTimes(1);
      session.handle({ type: 'groupRoute', leg: 9, index: 0 }); // il change d'avis : le dernier compte
      expect(session.routeFor(9)).toBe(0);
    });

    it("le créateur parti, le plus ancien prend le relais", () => {
      const { session, state } = setup(0, 2);
      session.handle({ type: 'groupState', group: state({ members: [{ slot: 1, name: 'Léa' }, { slot: 2, name: 'Tom' }] }) });
      expect(session.isLeader).toBe(false);
      session.handle({ type: 'groupMembers', id: 'g1', leader: 2, members: [{ slot: 2, name: 'Tom' }] });
      expect(session.isLeader).toBe(true);
    });

    it('oublie les choix en quittant le groupe', () => {
      const { session, state } = setup(0, 1);
      session.handle({ type: 'groupState', group: state({ routes: [[3, 1]] }) });
      session.leave();
      expect(session.routeFor(3)).toBeUndefined();
    });
  });

  it("donne à la création la FTP et la masse du créateur, et au départ celles du groupe", () => {
    const { session, world, state, answerPing } = setup();
    session.create(workout, 'col', 300, { ftpW: 310, massKg: 82 });
    expect(world.createGroup).toHaveBeenCalledWith(workout, 'col', 300, { ftpW: 310, massKg: 82 });
    const go = vi.fn();
    session.on('go', go);
    session.handle({ type: 'groupState', group: state({ ftpW: 310, massKg: 82, t0: 1_000_000 - 1000 }) });
    answerPing();
    expect(go.mock.calls[0]![0].ref).toEqual({ ftpW: 310, massKg: 82 });
  });

  describe('recalage sur le groupe', () => {
    it("redemande l'état du groupe à la salle, relit tous les choix de route, et dit de rejouer la sortie", () => {
      const { session, world, state, answerPing } = setup(0, 2);
      session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000, routes: [[3, 1]] }) });
      answerPing();
      session.handle({ type: 'groupRoute', leg: 3, index: 1 });
      expect(session.running).toBe(true);
      const resync = vi.fn();
      const routes = vi.fn();
      session.on('resync', resync);
      session.on('routes', routes);
      session.resync();
      expect(world.joinGroup).toHaveBeenCalledWith('g1');
      expect(resync).not.toHaveBeenCalled(); // la réponse de la salle n'est pas encore là
      // La salle renvoie l'état : un choix de plus que ce qu'on avait (le message raté).
      session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000, routes: [[3, 1], [8, 2]] }) });
      expect(session.routeFor(8)).toBe(2);
      expect(routes).toHaveBeenCalledTimes(1);
      expect(resync).toHaveBeenCalledTimes(1);
      expect(resync.mock.calls[0]![0]).toMatchObject({ id: 'g1', courseId: 'col', ref: { ftpW: 250, massKg: 75 } });
    });

    it("ne rejoue qu'une fois par demande, et pas sans demande", () => {
      const { session, state, answerPing } = setup(0, 2);
      session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000 }) });
      answerPing();
      const resync = vi.fn();
      session.on('resync', resync);
      session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000 }) });
      expect(resync).not.toHaveBeenCalled();
      session.resync();
      session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000 }) });
      session.handle({ type: 'groupState', group: state({ t0: 1_000_000 - 1000 }) });
      expect(resync).toHaveBeenCalledTimes(1);
    });

    it("sans séance de groupe en cours, ne demande rien", () => {
      const { session, world, state } = setup(0, 2);
      session.resync();
      expect(world.joinGroup).not.toHaveBeenCalled();
      session.handle({ type: 'groupState', group: state() }); // dans la salle d'attente : pas encore parti
      session.resync();
      expect(world.joinGroup).not.toHaveBeenCalled();
    });
  });
});
