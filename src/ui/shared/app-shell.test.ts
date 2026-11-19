import { describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}) }));
import { shellHints, type ShellEnv } from './app-shell';

const base: ShellEnv = { touch: true, portrait: false, canFullscreen: true, standalone: false, fullscreen: false, skipped: false };

describe('shellHints', () => {
  it('coquille native (iPhone, iPad) : ni guide d’installation ni bouton plein écran, même sans API plein écran', () => {
    expect(shellHints({ ...base, canFullscreen: false, standalone: true })).toEqual({ install: false, rotate: 'none', button: 'none' });
    expect(shellHints({ ...base, canFullscreen: false, standalone: true, portrait: true, screenLandscape: false }).rotate).toBe('rotate');
  });

  it('Safari sur iPhone : guide d’installation', () => {
    expect(shellHints({ ...base, canFullscreen: false }).install).toBe(true);
  });

  it('tablette en portrait : tourner, avec le bouton plein écran', () => {
    expect(shellHints({ ...base, portrait: true, screenLandscape: false })).toEqual({ install: false, rotate: 'rotate', button: 'fullscreen' });
  });

  it('Split View : fenêtre haute sur un iPad couché, élargir, sans bouton', () => {
    expect(shellHints({ ...base, portrait: true, screenLandscape: true })).toEqual({ install: false, rotate: 'widen', button: 'none' });
  });

  it('ordinateur : rien', () => {
    expect(shellHints({ ...base, touch: false, portrait: true })).toEqual({ install: false, rotate: 'none', button: 'fullscreen' });
  });
});
