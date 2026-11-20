import type { Tokens } from '../infra/export/strava/api';
import type { AccountStore, Provider, User } from './accounts';
import type { FriendStore } from './friends';
import type { SyncRow, SyncStore } from './sync';

/** Comptes en mémoire : pour les tests. Même comportement que le magasin D1 du Worker. */
export function createMemoryAccountStore(): AccountStore & { users: Map<string, User> } {
  const users = new Map<string, User>();
  const identities = new Map<string, string>();
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const tokens = new Map<string, Tokens>();
  let next = 1;
  return {
    users,
    async userByIdentity(provider: Provider, subject: string) {
      const id = identities.get(`${provider}:${subject}`);
      return id ? { ...users.get(id)! } : undefined;
    },
    async createUser(provider, subject, displayName, nameConfirmed) {
      const user = { id: `u${next++}`, displayName, nameConfirmed };
      users.set(user.id, user);
      identities.set(`${provider}:${subject}`, user.id);
      return { ...user };
    },
    async setDisplayName(userId, displayName) {
      const u = users.get(userId);
      if (u) users.set(userId, { ...u, displayName, nameConfirmed: true });
    },
    async createSession(tokenHash, userId, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    async userBySession(tokenHash, now) {
      const s = sessions.get(tokenHash);
      if (!s || s.expiresAt <= now) return undefined;
      const u = users.get(s.userId);
      return u ? { ...u } : undefined;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async saveStravaTokens(userId, t) {
      if (t) tokens.set(userId, t);
      else tokens.delete(userId);
    },
    async loadStravaTokens(userId) {
      return tokens.get(userId);
    },
  };
}

/** Données synchronisées en mémoire : pour les tests. Même comportement que le magasin D1 du Worker. */
export function createMemorySyncStore(): SyncStore {
  const rows = new Map<string, SyncRow & { userId: string }>();
  const of = (userId: string) => [...rows.values()].filter((r) => r.userId === userId);
  const maxRev = (userId: string) => of(userId).reduce((m, r) => Math.max(m, r.rev), 0);
  const copy = ({ userId: _, ...r }: SyncRow & { userId: string }): SyncRow => structuredClone(r);
  return {
    async put(userId, item) {
      const key = `${userId}\n${item.kind}/${item.id}`;
      const old = rows.get(key);
      if (old && old.updatedAt >= item.updatedAt) return;
      rows.set(key, { ...structuredClone(item), userId, rev: maxRev(userId) + 1 });
    },
    async changes(userId, since, limit) {
      return of(userId)
        .filter((r) => r.rev > since)
        .sort((a, b) => a.rev - b.rev)
        .slice(0, limit)
        .map(copy);
    },
    async get(userId, kind, id) {
      const r = rows.get(`${userId}\n${kind}/${id}`);
      return r && copy(r);
    },
    async maxRev(userId) {
      return maxRev(userId);
    },
    async countLive(userId) {
      return of(userId).filter((r) => r.body !== null).length;
    },
  };
}

/** Amis en mémoire : pour les tests. Même comportement que le magasin D1 du Worker (les noms viennent des comptes). */
export function createMemoryFriendStore(accounts: { users: Map<string, User> }): FriendStore {
  const rows: { userId: string; friendId: string; at: number }[] = [];
  const describe = (id: string) => {
    const u = accounts.users.get(id);
    return u && u.nameConfirmed ? { id: u.id, name: u.displayName } : undefined;
  };
  return {
    async list(userId) {
      return rows
        .filter((r) => r.userId === userId)
        .sort((a, b) => a.at - b.at || (a.friendId < b.friendId ? -1 : 1))
        .flatMap((r) => describe(r.friendId) ?? []);
    },
    async describe(id) {
      return describe(id);
    },
    async add(userId, friendId, now) {
      if (!rows.some((r) => r.userId === userId && r.friendId === friendId)) rows.push({ userId, friendId, at: now });
    },
    async remove(userId, friendId) {
      const i = rows.findIndex((r) => r.userId === userId && r.friendId === friendId);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}
