/** Codes de fermeture de la connexion à la salle, partagés par le serveur qui les envoie et la page qui les lit. */

/** Code de fermeture quand le même compte se connecte ailleurs. */
export const CLOSE_REPLACED = 4000;
/** Code de fermeture quand le client n'a pas la même version du protocole ou du réseau. */
export const CLOSE_OUTDATED = 4001;
/** Code de fermeture quand le coureur n'a pas encore validé le nom montré aux autres. */
export const CLOSE_NAME_PENDING = 4002;
/** Code de fermeture sans session valide : il faut se connecter. */
export const CLOSE_SIGNED_OUT = 4003;
