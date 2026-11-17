/**
 * Coquille native (Capacitor, iPad et iPhone) : détection, et plugin propre à l'application (`ios/App/App/MoulinettePlugin.swift`).
 *
 * - `keepAwake` : empêche la mise en veille de l'écran (`UIApplication.isIdleTimerDisabled`) ;
 * - `authenticate` : ouvre une session d'authentification système (`ASWebAuthenticationSession`) et rend l'adresse de
 *   retour (`moulinette://…`). Sert à la connexion Strava, que Google refuse dans une WebView intégrée.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface MoulinettePlugin {
  keepAwake(options: { on: boolean }): Promise<void>;
  authenticate(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
}

export const Moulinette = registerPlugin<MoulinettePlugin>('Moulinette');

/** Schéma d'adresse du retour de connexion, reconnu par la session d'authentification (pas besoin de le déclarer). */
export const AUTH_SCHEME = 'moulinette';

/** Dans la coquille native, et non dans un navigateur. */
export const isNativeShell = (): boolean => Capacitor.isNativePlatform();
