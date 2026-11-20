import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { FriendStore } from '../src/server/friends.ts';
import { createMemoryFriendStore } from '../src/server/memory-store.ts';
import type { D1Database } from './d1-store.ts';
import { createD1FriendStore } from './friend-store.ts';

/** D1 simulé avec le SQLite intégré à Node : exécute les vraies migrations et le vrai SQL du magasin. */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of ['0003_accounts.sql', '0006_friends.sql']) db.exec(readFileSync(new URL(`./migrations/${m}`, import.meta.url), 'utf8'));
  db.exec(
    "INSERT INTO users (id, display_name, name_confirmed, created_at) VALUES ('u1', 'Tom', 1, 0), ('u2', 'Léa', 1, 0), ('u3', 'Zoé', 1, 0), ('u4', 'Nouveau', 0, 0)",
  );
  const d1: D1Database = {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => db.prepare(sql).run(...(values as never[])),
        all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
      }),
    }),
  };
  return { d1, db };
}

function memory(): FriendStore {
  const users = new Map([
    ['u1', { id: 'u1', displayName: 'Tom', nameConfirmed: true }],
    ['u2', { id: 'u2', displayName: 'Léa', nameConfirmed: true }],
    ['u3', { id: 'u3', displayName: 'Zoé', nameConfirmed: true }],
    ['u4', { id: 'u4', displayName: 'Nouveau', nameConfirmed: false }],
  ]);
  return createMemoryFriendStore({ users });
}

for (const [name, make] of [
  ['D1', () => createD1FriendStore(fakeD1().d1)],
  ['mémoire', memory],
] as [string, () => FriendStore][]) {
  describe(`magasin d'amis (${name})`, () => {
    it("range les amis par compte, dans l'ordre d'ajout, sans réciprocité", async () => {
      const s = make();
      await s.add('u1', 'u3', 10);
      await s.add('u1', 'u2', 20);
      expect(await s.list('u1')).toEqual([{ id: 'u3', name: 'Zoé' }, { id: 'u2', name: 'Léa' }]);
      expect(await s.list('u2')).toEqual([]);
    });

    it("ajouter deux fois ne change rien, retirer retire", async () => {
      const s = make();
      await s.add('u1', 'u2', 10);
      await s.add('u1', 'u2', 99);
      expect(await s.list('u1')).toHaveLength(1);
      await s.remove('u1', 'u2');
      expect(await s.list('u1')).toEqual([]);
      await s.remove('u1', 'u2'); // déjà retiré : sans effet
    });

    it("décrit un compte tel que la salle le montre, seulement s'il a validé son nom", async () => {
      const s = make();
      expect(await s.describe('u2')).toEqual({ id: 'u2', name: 'Léa' });
      expect(await s.describe('u4')).toBeUndefined();
      expect(await s.describe('inconnu')).toBeUndefined();
    });

    it("ne montre pas un ami dont le nom n'est plus validé", async () => {
      const s = make();
      await s.add('u1', 'u4', 10); // ajouté avant que le nom ne soit validé : le serveur l'aurait refusé, la liste le tait quand même
      expect(await s.list('u1')).toEqual([]);
    });
  });
}

describe("magasin d'amis D1 : intégrité", () => {
  it("efface les amis d'un compte supprimé, dans les deux sens", async () => {
    const { d1, db } = fakeD1();
    const s = createD1FriendStore(d1);
    await s.add('u1', 'u2', 10);
    await s.add('u2', 'u3', 10);
    db.exec("DELETE FROM users WHERE id = 'u2'");
    expect(await s.list('u1')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM friends').get()).toEqual({ n: 0 });
  });
});
