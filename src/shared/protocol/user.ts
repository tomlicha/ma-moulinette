/** Le joueur connecté, tel que le serveur le décrit et que la page l'affiche. */
export interface User {
  id: string;
  displayName: string;
  /** Faux tant que le coureur n'a pas validé son nom : il n'apparaît pas aux autres avant. */
  nameConfirmed: boolean;
}
