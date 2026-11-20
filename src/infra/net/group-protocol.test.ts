import { describe, expect, it } from 'vitest';
import { MAX_FRIENDS } from '../../shared/protocol/friends';
import { parseClientMessage, parseServerMessage } from './group-protocol';

describe('message « friends »', () => {
  it("lit la liste d'amis, sans doublons", () => {
    expect(parseClientMessage(JSON.stringify({ type: 'friends', ids: ['u1', 'u2', 'u1'] }))).toEqual({ type: 'friends', ids: ['u1', 'u2'] });
    expect(parseClientMessage(JSON.stringify({ type: 'friends', ids: [] }))).toEqual({ type: 'friends', ids: [] });
  });

  it("accepte une liste de la taille maximale, malgré la limite des petits ordres", () => {
    const ids = Array.from({ length: MAX_FRIENDS }, (_, i) => `compte-${String(i).padStart(30, '0')}`);
    expect(parseClientMessage(JSON.stringify({ type: 'friends', ids }))?.type).toBe('friends');
  });

  it.each([
    ['trop d\'amis', { type: 'friends', ids: Array.from({ length: MAX_FRIENDS + 1 }, (_, i) => `u${i}`) }],
    ['pas une liste', { type: 'friends', ids: 'u1' }],
    ['un nombre', { type: 'friends', ids: [3] }],
    ['un identifiant avec espace', { type: 'friends', ids: ['a b'] }],
    ['un identifiant trop long', { type: 'friends', ids: ['x'.repeat(41)] }],
    ['sans liste', { type: 'friends' }],
  ])('refuse : %s', (_label, msg) => {
    expect(parseClientMessage(JSON.stringify(msg))).toBeUndefined();
  });
});

describe('réponse « who »', () => {
  const rider = { slot: 2, name: 'Léa', riding: true, uid: 'u2', friend: true, open: false };
  it("lit le compte, « ami » et « ouvert » de chaque coureur", () => {
    const m = parseServerMessage({ type: 'who', riders: [rider], groups: [], total: 1 });
    expect(m).toEqual({ type: 'who', riders: [rider], groups: [], total: 1 });
  });
  it.each([
    ['sans compte', { ...rider, uid: undefined }],
    ['compte invalide', { ...rider, uid: 'a b' }],
    ['« ami » absent', { ...rider, friend: undefined }],
    ['« ouvert » absent', { ...rider, open: 'oui' }],
  ])('refuse un coureur %s', (_label, r) => {
    expect(parseServerMessage({ type: 'who', riders: [r], groups: [], total: 1 })).toBeUndefined();
  });
});
