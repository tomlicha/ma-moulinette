import { describe, expect, it } from 'vitest';
import { checkItem } from './protocol';

const item = (id: string, body: unknown) => ({ kind: 'setting', id, body, updatedAt: 1000 });

describe('réglages textuels (repères des nouveautés)', () => {
  it('accepte l\'id d\'une entrée du catalogue', () => {
    expect(checkItem(item('whatsnew-announced', '2026-11-18-route-arc-en-ciel'))).toBeDefined();
    expect(checkItem(item('whatsnew-read', '2026-11-16'))).toBeDefined();
  });

  it('refuse un contenu qui n\'est pas un id', () => {
    expect(checkItem(item('whatsnew-read', 12))).toBeUndefined();
    expect(checkItem(item('whatsnew-read', 'a b'))).toBeUndefined();
    expect(checkItem(item('whatsnew-read', 'x'.repeat(65)))).toBeUndefined();
    expect(checkItem(item('whatsnew-read', ''))).toBeUndefined();
  });

  it('un réglage inconnu reste refusé, et la FTP reste un nombre borné', () => {
    expect(checkItem(item('whatsnew-autre', '2026-11-16'))).toBeUndefined();
    expect(checkItem(item('ftp', 'abc'))).toBeUndefined();
    expect(checkItem(item('ftp', 230))).toBeDefined();
  });

  it('une suppression reste permise', () => {
    expect(checkItem(item('whatsnew-read', null))).toBeDefined();
  });
});
