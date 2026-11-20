import { describe, expect, it, vi } from 'vitest';
import { ASSIST_REDUCTION, LEADER_PAUSE_END_S } from '../domain/group/follow';
import { FollowSession, type FollowedRider, type FollowWorld } from './follow-session';

function setup(riders: FollowedRider[] = []) {
  const world = {
    follow: vi.fn(),
    unfollow: vi.fn(),
    refuseFollower: vi.fn(),
    riders: vi.fn(() => riders),
  } satisfies FollowWorld;
  const session = new FollowSession({ world });
  return { session, world, riders };
}

const lucie = (x: number, over: Partial<FollowedRider> = {}): FollowedRider => ({ slot: 7, name: 'Lucie', point: { x, z: 0 }, speedMs: 10, riding: true, ...over });
const self = { x: 0, z: 0, heading: 0, powerW: 200 };
const pos = { edgeId: 'e', forward: true, s: 120 };

describe('FollowSession', () => {
  it('demande à la salle, puis annonce le départ avec la position quand elle accepte', () => {
    const { session, world } = setup();
    const started = vi.fn();
    session.on('started', started);
    session.request(7, 'Lucie', 'place');
    expect(world.follow).toHaveBeenCalledWith(7);
    expect(session.state?.phase).toBe('requesting');
    expect(session.assist).toBe(0);
    session.handle({ type: 'followStart', slot: 7, name: 'Lucie', pos });
    expect(started).toHaveBeenCalledWith({ slot: 7, name: 'Lucie', pos, mode: 'place' });
    expect(session.state?.phase).toBe('following');
  });

  it('ignore la réponse à une demande abandonnée', () => {
    const { session } = setup();
    const started = vi.fn();
    session.on('started', started);
    session.request(7, 'Lucie', 'chase');
    session.request(8, 'Marc', 'chase');
    session.handle({ type: 'followStart', slot: 7, name: 'Lucie', pos });
    expect(started).not.toHaveBeenCalled();
    expect(session.state?.slot).toBe(8);
  });

  it("une réponse négative met fin à la demande, sans renvoyer d'ordre d'arrêt", () => {
    const { session, world } = setup();
    const ended = vi.fn();
    session.on('ended', ended);
    session.request(7, 'Lucie', 'chase');
    session.handle({ type: 'followEnd', reason: 'denied' });
    expect(ended).toHaveBeenCalledWith('denied', 'Lucie');
    expect(session.state).toBeUndefined();
    expect(world.unfollow).not.toHaveBeenCalled();
  });

  it("publie l'écart et l'aide à chaque pas, et l'aide n'existe que pendant le suivi", () => {
    const { session } = setup([lucie(60)]);
    session.request(7, 'Lucie', 'chase');
    session.update(0.1, self); // pas encore accepté : rien
    expect(session.state?.gapM).toBe(0);
    session.handle({ type: 'followStart', slot: 7, name: 'Lucie', pos });
    session.update(0.1, self);
    expect(session.state?.gapM).toBeCloseTo(60);
    expect(session.state?.gapS).toBeCloseTo(6);
    expect(session.assist).toBeCloseTo(ASSIST_REDUCTION);
    session.stop();
    expect(session.assist).toBe(0);
  });

  it("n'émet `changed` que lorsque l'écart lu change à l'œil (par 5 m)", () => {
    const riders = [lucie(60)];
    const { session } = setup(riders);
    session.request(7, 'Lucie', 'chase');
    session.handle({ type: 'followStart', slot: 7, name: 'Lucie', pos });
    session.update(0.1, self);
    const changed = vi.fn();
    session.on('changed', changed);
    for (let i = 0; i < 20; i++) session.update(0.1, self);
    expect(changed).not.toHaveBeenCalled();
    riders[0] = lucie(75);
    session.update(0.1, self);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('met fin au suivi et prévient la salle quand les règles le décident', () => {
    const { session, world } = setup([lucie(40, { riding: false })]);
    const ended = vi.fn();
    session.on('ended', ended);
    session.request(7, 'Lucie', 'chase');
    session.handle({ type: 'followStart', slot: 7, name: 'Lucie', pos });
    session.update(LEADER_PAUSE_END_S, self);
    expect(ended).toHaveBeenCalledWith('leader-stopped', 'Lucie');
    expect(world.unfollow).toHaveBeenCalledTimes(1);
    expect(session.state).toBeUndefined();
  });

  it('arrête à la demande en prévenant la salle', () => {
    const { session, world } = setup([lucie(40)]);
    session.request(7, 'Lucie', 'chase');
    session.handle({ type: 'followStart', slot: 7, name: 'Lucie', pos });
    session.stop();
    expect(world.unfollow).toHaveBeenCalledTimes(1);
  });

  it('garde la liste de ceux qui nous suivent et peut en renvoyer un', () => {
    const { session, world } = setup();
    const followers = vi.fn();
    session.on('followers', followers);
    session.handle({ type: 'followedBy', slot: 3, name: 'Marc' });
    session.handle({ type: 'followedBy', slot: 3, name: 'Marc' }); // doublon ignoré
    expect(session.followers).toEqual([{ slot: 3, name: 'Marc' }]);
    expect(followers).toHaveBeenCalledTimes(1);
    expect(followers).toHaveBeenLastCalledWith([{ slot: 3, name: 'Marc' }], { joined: { slot: 3, name: 'Marc' } });
    session.refuse(3);
    expect(world.refuseFollower).toHaveBeenCalledWith(3);
    expect(session.followers).toEqual([]);
    session.handle({ type: 'followedBy', slot: 4, name: 'Zoé' });
    session.handle({ type: 'unfollowedBy', slot: 4 });
    expect(followers).toHaveBeenLastCalledWith([], { left: { slot: 4, name: 'Zoé' } });
  });

  it('la connexion perdue efface tout : le serveur a oublié qui suit qui', () => {
    const { session, world } = setup([lucie(40)]);
    session.request(7, 'Lucie', 'chase');
    session.handle({ type: 'followStart', slot: 7, name: 'Lucie', pos });
    session.handle({ type: 'followedBy', slot: 3, name: 'Marc' });
    const ended = vi.fn();
    session.on('ended', ended);
    session.worldLost();
    expect(ended).toHaveBeenCalledWith('offline', 'Lucie');
    expect(session.state).toBeUndefined();
    expect(session.followers).toEqual([]);
    expect(world.unfollow).not.toHaveBeenCalled();
  });
});
