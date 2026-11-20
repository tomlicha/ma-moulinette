import { describe, expect, it, vi } from 'vitest';
import type { FriendsResult } from '../infra/net/friends';
import { FriendsList, type FriendsApi } from './friends-list';

const ok = (...names: [string, string][]): FriendsResult => ({ ok: true, friends: names.map(([id, name]) => ({ id, name })) });

function setup(over: Partial<FriendsApi> = {}) {
  const api: FriendsApi = {
    list: vi.fn(async () => ok()),
    add: vi.fn(async (id: string) => ok([id, 'Nom'])),
    remove: vi.fn(async () => ok()),
    ...over,
  };
  const world = { setFriends: vi.fn() };
  const list = new FriendsList({ api, world });
  return { list, api, world };
}

describe('FriendsList', () => {
  it("relit la liste du compte et la dit à la salle", async () => {
    const { list, world } = setup({ list: vi.fn(async () => ok(['u2', 'Léa'], ['u3', 'Zoé'])) });
    const changed = vi.fn();
    list.on('changed', changed);
    await list.load();
    expect(list.friends.map((f) => f.name)).toEqual(['Léa', 'Zoé']);
    expect(list.has('u2')).toBe(true);
    expect(world.setFriends).toHaveBeenLastCalledWith(['u2', 'u3']);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("sans serveur ou sans compte, la liste ne change pas", async () => {
    const { list, world } = setup({ list: vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const })) });
    await list.load();
    expect(list.friends).toEqual([]);
    expect(world.setFriends).not.toHaveBeenCalled();
  });

  it("ajoute tout de suite, puis prend la liste du serveur", async () => {
    let resolve!: (r: FriendsResult) => void;
    const { list, world } = setup({ add: vi.fn(() => new Promise<FriendsResult>((r) => (resolve = r))) });
    const pending = list.add('u2', 'Léa');
    expect(list.has('u2')).toBe(true); // le geste se voit avant la réponse
    expect(world.setFriends).toHaveBeenLastCalledWith(['u2']);
    resolve(ok(['u2', 'Léa Dupont']));
    expect(await pending).toBe('ok');
    expect(list.friends).toEqual([{ id: 'u2', name: 'Léa Dupont' }]); // le nom du serveur est celui qui compte
  });

  it("revient en arrière quand le serveur refuse, et dit pourquoi", async () => {
    const { list, world } = setup({ add: vi.fn(async () => ({ ok: false as const, reason: 'too-many' as const })) });
    const changed = vi.fn();
    list.on('changed', changed);
    expect(await list.add('u2', 'Léa')).toBe('too-many');
    expect(list.has('u2')).toBe(false);
    expect(world.setFriends).toHaveBeenLastCalledWith([]);
    expect(changed).toHaveBeenCalledTimes(2); // ajoutée, puis retirée
  });

  it("ajouter un ami déjà ajouté ne demande rien au serveur", async () => {
    const { list, api } = setup({ list: vi.fn(async () => ok(['u2', 'Léa'])) });
    await list.load();
    expect(await list.add('u2', 'Léa')).toBe('ok');
    expect(api.add).not.toHaveBeenCalled();
  });

  it("retire, avec retour en arrière si le serveur échoue", async () => {
    const failing = setup({ list: vi.fn(async () => ok(['u2', 'Léa'], ['u3', 'Zoé'])), remove: vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const })) });
    await failing.list.load();
    expect(await failing.list.remove('u2')).toBe('unavailable');
    expect(failing.list.friends.map((f) => f.id)).toEqual(['u2', 'u3']);
    const working = setup({ list: vi.fn(async () => ok(['u2', 'Léa'], ['u3', 'Zoé'])), remove: vi.fn(async () => ok(['u3', 'Zoé'])) });
    await working.list.load();
    expect(await working.list.remove('u2')).toBe('ok');
    expect(working.list.friends.map((f) => f.id)).toEqual(['u3']);
    expect(await working.list.remove('u9')).toBe('ok'); // pas dans la liste : sans effet
    expect(working.api.remove).toHaveBeenCalledTimes(1);
  });

  it("se vide quand on perd la salle ou le compte, sans rien demander au serveur", async () => {
    const { list, api, world } = setup({ list: vi.fn(async () => ok(['u2', 'Léa'])) });
    await list.load();
    list.clear();
    expect(list.friends).toEqual([]);
    expect(world.setFriends).toHaveBeenLastCalledWith([]);
    expect(api.remove).not.toHaveBeenCalled();
  });
});
