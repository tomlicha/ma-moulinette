import type { Tokens } from '../export/strava/api';
import type { AccountStore, Provider, User } from './accounts';

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
