import { composeAccount } from './account';
import { composeDevices } from './devices';
import { composeGroup } from './group';
import { composeHud } from './hud';
import { composeLaunch } from './launch';
import { composeOnline } from './online';
import { composePlatform } from './platform';
import { composeRecap } from './recap';
import { composeRide } from './ride';
import { composeRider } from './rider';
import { composeScreens } from './screens';
import { composeTrainer } from './trainer';
import { composeWhatsNew } from './whatsnew';
import { composeWorkout } from './workout';
import type { Wiring } from './wiring';

/**
 * Compose l'application : chaque module crée ses objets et les range dans `Wiring`, les modules suivants les lisent.
 * L'ordre compte : un module ne lit tout de suite que ce que les précédents ont rangé (le reste, à l'usage, dans une
 * fonction ou un écouteur). Le routeur (`screens`) vient presque en dernier : il applique l'écran courant dès sa création.
 */
export function composeApp(): void {
  const w = {} as Wiring;
  composePlatform(w); // stockage, journal, paramètres de la page, écran allumé
  composeRider(w); // les champs de FTP et de masse, la fiche du coureur
  composeTrainer(w); // capteurs, trainer et l'état qu'il répercute
  composeDevices(w); // l'écran Appareils
  composeRide(w); // la sortie : trajet, session, vue 3D, commandes
  composeWorkout(w); // la séance, son choix, les bibliothèques et l'éditeur
  composeHud(w); // le HUD posé sur la vue 3D, son chargement
  composeRecap(w); // l'export de la sortie et son récapitulatif
  composeScreens(w); // l'accueil, le menu de la sortie, le routeur
  composeAccount(w); // synchronisation, compte, salle temps réel
  composeGroup(w); // suivre un coureur, être suivi : bandeau, bouton de l'encart, réglage « me rejoindre »
  composeOnline(w); // la pastille « En ligne », le panneau, la séance de groupe
  composeWhatsNew(w); // la carte et le journal des nouveautés ; leurs repères rejoignent la synchronisation d'account
  composeLaunch(w); // la première connexion
}
