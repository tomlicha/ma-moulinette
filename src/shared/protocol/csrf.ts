/**
 * En-tête anti-CSRF des requêtes de la page qui modifient quelque chose (comptes, synchronisation, envoi à Strava) :
 * un autre site ne peut pas l'envoyer sans préalerte CORS, que le serveur ne lui accorde pas.
 */
export const CSRF_HEADER = 'x-mamoulinette';

/**
 * Ancien nom de l'en-tête, encore accepté : le service worker sert la version déjà installée au premier lancement qui
 * suit une mise à jour, et cette page-là l'envoie encore. À retirer une fois la nouvelle version installée partout.
 */
const LEGACY_CSRF_HEADER = 'x-zwift2';

export const hasCsrfHeader = (req: Request) => !!(req.headers.get(CSRF_HEADER) || req.headers.get(LEGACY_CSRF_HEADER));
