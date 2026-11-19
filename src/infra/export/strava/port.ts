import { isNativeShell, Moulinette } from '../../native/shell';
import { nativeStravaLogin } from '../../net/account';
import { getLoginUrl, getOwnerKey, getStatus, sendToStrava, setOwnerKey, waitForLogin, type SendResult, type StravaStatus } from './client';

/**
 * Tout ce que l'export demande à Strava et au système, en un seul objet : le vrai (`browserStravaPort`) parle au relais
 * du Worker, un faux suffit aux tests (aucun réseau, aucune fenêtre).
 */
export interface StravaPort {
  status(): Promise<StravaStatus>;
  loginUrl(): Promise<string>;
  ownerKey(): string;
  setOwnerKey(key: string): void;
  /** Attend la fin de la connexion dans la fenêtre ouverte par l'appelant ; `true` si le relais a reçu l'accès. */
  waitForLogin(win: Window): Promise<boolean>;
  send(fit: Uint8Array, meta: { name: string; externalId: string }): Promise<SendResult>;
  /** Coquille native : session d'authentification système, sans fenêtre. */
  nativeLogin(): Promise<boolean>;
  isNative(): boolean;
}

export const browserStravaPort: StravaPort = {
  status: () => getStatus(),
  loginUrl: () => getLoginUrl(),
  ownerKey: getOwnerKey,
  setOwnerKey,
  waitForLogin: (win) => waitForLogin(win),
  send: (fit, meta) => sendToStrava(fit, meta),
  nativeLogin: () => nativeStravaLogin((x) => Moulinette.authenticate(x)),
  isNative: isNativeShell,
};
