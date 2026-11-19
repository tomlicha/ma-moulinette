import type { Wiring } from './wiring';

/** En dernier : tout l'état de la page est initialisé avant la première connexion. */
export function composeLaunch(w: Wiring): void {
  w.setState(w.trainerCtl.state); // chaque bouton reçoit dès le départ sa raison d'être indisponible
  void w.devices.reconnectKnown();
}
