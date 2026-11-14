import { RideRecorder, type Recording } from './recorder';
import { setBlocked } from '../ui/blocked';
import { getLoginUrl, getOwnerKey, getStatus, sendToStrava, setOwnerKey, waitForLogin, type StravaStatus } from './strava/client';
import type { SensorHub } from '../sensors/hub';
import type { ConnectionState } from '../sensors/types';
import type { RideSnapshot } from '../sim/ride';

export interface ExportWiring {
  /** À appeler à chaque snapshot de la sortie virtuelle. */
  onRide(s: RideSnapshot): void;
  /** À appeler à chaque changement d'état du trainer : l'enregistrement se met en pause hors connexion. */
  onTrainerState(s: ConnectionState): void;
  /** Séance menée jusqu'au bout du dernier palier : la sortie est figée à cet instant pour l'export. */
  onWorkoutFinished(): void;
  /** Nouvelle séance : l'instantané de la précédente ne vaut plus ; son nom devient celui de la sortie. */
  onWorkoutStarted(name: string): void;
}

/**
 * Secondes de pédalage après la fin de la séance au-delà desquelles le cycliste est jugé reparti : l'export
 * reprend alors toute la sortie au lieu de s'arrêter à la fin du dernier palier.
 */
const RESUMED_AFTER_S = 60;

/** Sortie encodée, gardée en mémoire tant qu'elle n'est pas arrivée chez Strava (réessai possible sans rien perdre). */
interface Exported {
  bytes: Uint8Array;
  startMs: number;
  samples: number;
  /** Nom de l'activité chez Strava : « Ma Moulinette - » puis la séance suivie, ou la route à défaut. */
  name: string;
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000); // libérer tout de suite peut interrompre le téléchargement sur certains navigateurs
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Enregistre la sortie en continu et branche les boutons d'export FIT et d'envoi à Strava. */
export function setupExport(opts: {
  hub: SensorHub;
  button: HTMLButtonElement;
  stravaButton: HTMLButtonElement;
  /** Nom de la route de la sortie virtuelle : nom de l'activité quand aucune séance n'a été menée. */
  routeName: string;
  log: (msg: string) => void;
}): ExportWiring {
  const { hub, button, stravaButton, routeName, log } = opts;
  const recorder = new RideRecorder();
  let exported: Exported | undefined;
  /** Sortie figée à la fin du dernier palier, exportée à la place de l'enregistrement tant que le cycliste n'est pas reparti. */
  let finishedWorkout: Recording | undefined;
  let strava: StravaStatus | undefined;
  /** Séance démarrée depuis le dernier export ; sans elle, la sortie porte le nom de la route. */
  let workoutName: string | undefined;
  let busy = false;

  const refreshStrava = () =>
    getStatus()
      .then((s) => (strava = s))
      .catch(() => (strava = undefined)); // pas de relais (build statique) : le bouton Strava reste caché

  void refreshStrava();

  hub.on('measurement', (m) => {
    recorder.update({ powerW: m.powerW, cadenceRpm: m.cadenceRpm, heartRateBpm: m.heartRateBpm }, Date.now());
  });

  function refreshButtons() {
    const n = recorder.sampleCount;
    const nothing = 'Rien à exporter pour l’instant : l’enregistrement démarre dès qu’un trainer connecté envoie des mesures.';
    setBlocked(button, busy ? 'Export en cours…' : n === 0 ? nothing : undefined);
    button.textContent = finishedWorkout
      ? `Exporter FIT (séance, ${finishedWorkout.samples.length} s)`
      : n
        ? `Exporter FIT (${n} s${recorder.state === 'paused' ? ', en pause' : ''})`
        : 'Exporter FIT';
    stravaButton.hidden = !strava?.configured;
    setBlocked(stravaButton, busy ? 'Envoi en cours…' : n === 0 && !exported ? nothing : undefined);
    stravaButton.textContent = n === 0 && exported ? 'Réessayer l’envoi à Strava' : 'Envoyer à Strava';
  }

  setInterval(() => {
    recorder.tick(Date.now());
    if (finishedWorkout && recorder.pedalingSecondsAfter(finishedWorkout.endMs) >= RESUMED_AFTER_S) {
      finishedWorkout = undefined;
      log('pédalage repris après la séance : l’export couvrira toute la sortie');
    }
    refreshButtons();
  }, 1000);

  /**
   * Fige la sortie en cours en fichier FIT ; sans sortie en cours, reprend la dernière non envoyée. Juste après une
   * séance terminée, la sortie s'arrête à la fin du dernier palier : les secondes d'après sont écartées.
   */
  async function prepare(): Promise<Exported | undefined> {
    // Le SDK FIT pèse environ 380 Ko : chargé seulement à l'export. Il l'est avant `finish`, qui vide l'enregistrement.
    const { encodeActivity } = await import('./fit-activity');
    const rec = finishedWorkout ?? recorder.finish(Date.now());
    if (finishedWorkout) {
      finishedWorkout = undefined;
      recorder.reset();
    }
    if (!rec) return exported;
    exported = {
      bytes: encodeActivity(rec),
      startMs: rec.startMs,
      samples: rec.samples.length,
      name: `Ma Moulinette - ${workoutName ?? routeName}`,
    };
    workoutName = undefined;
    return exported;
  }

  button.addEventListener('click', async () => {
    busy = true;
    try {
      const out = await prepare();
      if (!out) {
        log('export FIT : rien à exporter');
        return;
      }
      const { fitFileName } = await import('./fit-activity');
      download(fitFileName(out.startMs), out.bytes);
      log(`export FIT : ${out.samples} échantillons, ${Math.round(out.bytes.length / 1024)} Ko`);
    } catch (e) {
      log(`export FIT impossible : ${errMsg(e)}`);
    } finally {
      busy = false;
      refreshButtons();
    }
  });

  stravaButton.addEventListener('click', async () => {
    // La fenêtre de connexion doit s'ouvrir dans le geste utilisateur, avant tout `await`, sinon elle est bloquée.
    if (strava?.locked) {
      // Site public : le relais Strava n'obéit qu'au propriétaire, qui saisit sa clé une seule fois par appareil.
      const key = window.prompt('Clé d’accès Ma Moulinette (nécessaire pour envoyer à Strava)', getOwnerKey());
      if (!key) return;
      setOwnerKey(key.trim());
      await refreshStrava();
      if (strava?.locked) {
        log('Strava : clé d’accès refusée');
        setOwnerKey('');
        return;
      }
    }
    const needsLogin = strava?.configured && !strava.connected;
    const popup = needsLogin ? window.open('', 'strava-login', 'width=520,height=720') : null;
    busy = true;
    refreshButtons();
    try {
      if (popup) popup.location.href = await getLoginUrl();
      const out = await prepare();
      if (!out) {
        log('Strava : rien à envoyer');
        return;
      }
      if (needsLogin) {
        if (!popup) {
          log('Strava : fenêtre de connexion bloquée par le navigateur, autoriser les fenêtres puis réessayer');
          return;
        }
        // Le succès se lit dans le statut du relais, pas dans le message de la fenêtre : Strava peut couper `window.opener`.
        await waitForLogin(popup);
        await refreshStrava();
        if (!strava?.connected) {
          log('Strava : connexion non terminée, la sortie est gardée en mémoire pour un nouvel essai');
          return;
        }
        log(`Strava : connecté${strava.athlete ? ` (${strava.athlete})` : ''}`);
      }

      const name = out.name;
      log('Strava : envoi en cours…');
      const result = await sendToStrava(out.bytes, { name, externalId: `zwift2-${out.startMs}` });
      if (result.ok) {
        exported = undefined;
        log(
          result.processing
            ? 'Strava : fichier reçu, traitement en cours chez Strava'
            : `Strava : activité créée ${result.activityUrl ?? ''}`,
        );
        return;
      }
      if (result.reason === 'not_connected') await refreshStrava(); // le prochain clic rouvrira la connexion
      const duplicate = result.reason === 'rejected' && /duplicate/i.test(result.message);
      if (duplicate || result.reason === 'rejected') exported = undefined; // Strava a statué : inutile de renvoyer le même fichier
      log(`Strava : ${duplicate ? 'déjà envoyée' : 'échec'} (${result.message})`);
    } catch (e) {
      popup?.close();
      log(`Strava : échec (${errMsg(e)}), la sortie est gardée en mémoire`);
    } finally {
      busy = false;
      refreshButtons();
    }
  });

  return {
    onRide: (s) =>
      recorder.update({ speedMs: s.speedKmh / 3.6, distanceM: s.distanceM, altitudeM: s.altitudeM }, Date.now()),
    onTrainerState: (s) => (s === 'connected' ? recorder.resume(Date.now()) : recorder.pause(Date.now())),
    onWorkoutFinished: () => {
      const now = Date.now();
      recorder.tick(now); // la dernière seconde du palier, si le tick à 1 Hz ne l'a pas encore prise
      finishedWorkout = recorder.snapshot(now);
      if (!finishedWorkout) return;
      log(
        `séance terminée : l’export s’arrêtera ici (${finishedWorkout.samples.length} s), sauf si tu continues à pédaler plus de ${RESUMED_AFTER_S} s`,
      );
      refreshButtons();
    },
    onWorkoutStarted: (name) => {
      workoutName = name;
      finishedWorkout = undefined;
      refreshButtons();
    },
  };
}
