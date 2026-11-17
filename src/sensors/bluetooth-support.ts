/**
 * Pourquoi le Bluetooth manque, dit au coureur. Sur iPad et iPhone, aucun navigateur n'a Web Bluetooth (Chrome et Edge
 * y utilisent WebKit, comme Safari) : seule l'application iOS (coquille native) se connecte au trainer. Conseiller
 * Chrome y mènerait à une impasse.
 */
export interface UaEnv {
  userAgent: string;
  /** `navigator.maxTouchPoints` : un iPad en mode « ordinateur » se présente comme un Mac, mais tactile. */
  maxTouchPoints?: number;
}

export function isAppleMobile(env: UaEnv): boolean {
  return /\b(iPad|iPhone|iPod)\b/.test(env.userAgent) || (/\bMacintosh\b/.test(env.userAgent) && (env.maxTouchPoints ?? 0) > 1);
}

/** Message court, pour l'aide d'un bouton bloqué. */
export function noBluetoothHint(env: UaEnv): string {
  return isAppleMobile(env)
    ? 'Sur iPad et iPhone, aucun navigateur n’a le Bluetooth : il faut l’application Ma Moulinette pour iOS. Ici, seul le trainer simulé est disponible.'
    : 'Le Bluetooth web n’existe que dans Chrome ou Edge, sur ordinateur ou Android. Ici, seul le trainer simulé est disponible.';
}

/** Ligne d'état de l'écran Appareils. */
export function noBluetoothStatus(env: UaEnv): string {
  return isAppleMobile(env)
    ? 'Pas de Bluetooth dans les navigateurs d’iPad et d’iPhone : il faut l’application iOS. Le trainer simulé reste utilisable.'
    : 'Web Bluetooth indisponible ici (Chrome ou Edge, en HTTPS ou sur localhost). Le trainer simulé reste utilisable.';
}

export const browserUa = (): UaEnv =>
  typeof navigator === 'undefined' ? { userAgent: '' } : { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
