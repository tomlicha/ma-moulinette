import { RideRecorder, type Recording } from './recorder';
import { setBlocked } from '../ui/blocked';
import { getLoginUrl, getOwnerKey, getStatus, sendToStrava, setOwnerKey, waitForLogin, type StravaStatus } from './strava/client';
import type { SensorHub } from '../sensors/hub';
import type { ConnectionState } from '../sensors/types';
import type { RideSnapshot } from '../sim/ride';

/**
 * Où en est Strava pour cet appareil :
 * - `none` : pas de relais (build statique) ou relais non configuré, rien à proposer ;
 * - `locked` : le relais attend la clé du propriétaire ;
 * - `login` : il faut se connecter à Strava (fenêtre ouverte dans le geste de l'utilisateur) ;
 * - `ready` : connecté, l'envoi peut partir sans geste.
 */
export type StravaReadiness = 'none' | 'locked' | 'login' | 'ready';

export type StravaOutcome =
  | { ok: true; activityUrl?: string; processing?: boolean; name: string }
  | { ok: false; message: string; /** La sortie est gardée en mémoire : un nouvel essai a un sens. */ kept: boolean };

export interface ExportWiring {
  /** À appeler à chaque snapshot de la sortie virtuelle. */
  onRide(s: RideSnapshot): void;
  /** À appeler à chaque changement d'état du trainer : l'enregistrement se met en pause hors connexion. */
  onTrainerState(s: ConnectionState): void;
  /** Consigne et palier de la séance en cours, à chaque pas de la séance : notés dans l'enregistrement pour le récapitulatif. */
  onWorkoutState(targetW: number | undefined, stepIndex: number): void;
  /** Séance menée jusqu'au bout du dernier palier : la sortie est figée à cet instant pour l'export. */
  onWorkoutFinished(): void;
  /** Sortie arrêtée à la main : figée à cet instant, comme une séance terminée. */
  onRideStopped(): void;
  /** Nouvelle séance : l'instantané de la précédente ne vaut plus ; son nom devient celui de la sortie. */
  onWorkoutStarted(name: string): void;
  /** Sortie que l'export prendrait maintenant : la sortie figée, sinon l'enregistrement en cours. */
  current(): Recording | undefined;
  /** Le cycliste choisit de continuer : la sortie figée (si elle n'est pas déjà partie) cède la place à toute la sortie. */
  releaseFrozen(): void;
  /** Nom proposé pour l'activité Strava. */
  defaultName(): string;
  strava(): StravaReadiness;
  /**
   * Envoie la sortie à Strava sous le nom donné. À appeler dans le geste de l'utilisateur si `strava()` n'est pas
   * `ready` : la fenêtre de connexion doit s'ouvrir avant tout `await`.
   */
  sendToStrava(name?: string): Promise<StravaOutcome>;
  downloadFit(): Promise<void>;
}

/**
 * Après une sortie figée (fin de séance, arrêt), un arrêt puis ces secondes pédalées d'affilée font juger le cycliste
 * reparti : le récapitulatif se ferme, et l'export reprend toute la sortie s'il n'est pas déjà parti.
 */
export const RESUME_S = 5;

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
  /** Le cycliste est reparti après la sortie figée (voir `RESUME_S`). Appelé avant que la sortie figée soit abandonnée. */
  onResumed?: () => void;
}): ExportWiring {
  const { hub, button, stravaButton, routeName, log } = opts;
  const recorder = new RideRecorder();
  let exported: Exported | undefined;
  /**
   * Sortie figée à la fin du dernier palier ou à l'arrêt de la sortie, exportée à la place de l'enregistrement tant
   * que le cycliste n'est pas reparti.
   */
  let frozen: Recording | undefined;
  /** Instant de la dernière sortie figée, d'où l'on guette la reprise ; il survit à l'envoi de la sortie figée. */
  let watchFrom: number | undefined;
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
    setBlocked(button, busy ? 'Export en cours…' : n === 0 && !frozen ? nothing : undefined);
    button.textContent = frozen
      ? `Exporter FIT (${frozen.samples.length} s)`
      : n
        ? `Exporter FIT (${n} s${recorder.state === 'paused' ? ', en pause' : ''})`
        : 'Exporter FIT';
    stravaButton.hidden = !strava?.configured;
    setBlocked(stravaButton, busy ? 'Envoi en cours…' : n === 0 && !exported && !frozen ? nothing : undefined);
    stravaButton.textContent = n === 0 && exported ? 'Réessayer l’envoi à Strava' : 'Envoyer à Strava';
  }

  setInterval(() => {
    recorder.tick(Date.now());
    if (watchFrom !== undefined && recorder.resumedAfter(watchFrom, RESUME_S)) {
      watchFrom = undefined;
      // D'abord le récapitulatif : s'il avait un envoi programmé, il part avec la sortie figée, qu'il prend tout de suite.
      opts.onResumed?.();
      if (frozen) {
        frozen = undefined;
        log('pédalage repris : l’export couvrira toute la sortie');
      }
    }
    refreshButtons();
  }, 1000);

  const defaultName = () => `Ma Moulinette - ${workoutName ?? routeName}`;

  /**
   * Fige la sortie en cours en fichier FIT ; sans sortie en cours, reprend la dernière non envoyée. Juste après une
   * séance terminée ou une sortie arrêtée, la sortie s'arrête à cet instant : les secondes d'après sont écartées.
   */
  async function prepare(name?: string): Promise<Exported | undefined> {
    // La sortie figée est prise avant tout `await` : une reprise du pédalage pendant le chargement ne doit pas l'abandonner.
    const pending = frozen;
    frozen = undefined;
    // Le SDK FIT pèse environ 380 Ko : chargé seulement à l'export. Il l'est avant `finish`, qui vide l'enregistrement.
    const { encodeActivity } = await import('./fit-activity');
    const rec = pending ?? recorder.finish(Date.now());
    if (pending) recorder.reset();
    if (!rec) {
      if (exported && name) exported.name = name;
      return exported;
    }
    exported = {
      bytes: encodeActivity(rec),
      startMs: rec.startMs,
      samples: rec.samples.length,
      name: name || defaultName(),
    };
    workoutName = undefined;
    return exported;
  }

  async function downloadFit() {
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
  }

  async function send(name?: string): Promise<StravaOutcome> {
    const fail = (message: string, kept: boolean): StravaOutcome => {
      log(`Strava : ${message}`);
      return { ok: false, message, kept };
    };
    // La fenêtre de connexion doit s'ouvrir dans le geste utilisateur, avant tout `await`, sinon elle est bloquée.
    if (strava?.locked) {
      // Site public : le relais Strava n'obéit qu'au propriétaire, qui saisit sa clé une seule fois par appareil.
      const key = window.prompt('Clé d’accès Ma Moulinette (nécessaire pour envoyer à Strava)', getOwnerKey());
      if (!key) return { ok: false, message: 'clé d’accès non saisie', kept: true };
      setOwnerKey(key.trim());
      await refreshStrava();
      if (strava?.locked) {
        setOwnerKey('');
        return fail('clé d’accès refusée', true);
      }
    }
    const needsLogin = strava?.configured && !strava.connected;
    const popup = needsLogin ? window.open('', 'strava-login', 'width=520,height=720') : null;
    busy = true;
    refreshButtons();
    try {
      if (popup) popup.location.href = await getLoginUrl();
      const out = await prepare(name);
      if (!out) return fail('rien à envoyer', false);
      if (needsLogin) {
        if (!popup) return fail('fenêtre de connexion bloquée par le navigateur, autoriser les fenêtres puis réessayer', true);
        // Le succès se lit dans le statut du relais, pas dans le message de la fenêtre : Strava peut couper `window.opener`.
        await waitForLogin(popup);
        await refreshStrava();
        if (!strava?.connected) return fail('connexion non terminée, la sortie est gardée en mémoire pour un nouvel essai', true);
        log(`Strava : connecté${strava.athlete ? ` (${strava.athlete})` : ''}`);
      }

      log('Strava : envoi en cours…');
      const result = await sendToStrava(out.bytes, { name: out.name, externalId: `zwift2-${out.startMs}` });
      if (result.ok) {
        exported = undefined;
        log(
          result.processing
            ? 'Strava : fichier reçu, traitement en cours chez Strava'
            : `Strava : activité créée ${result.activityUrl ?? ''}`,
        );
        return { ok: true, name: out.name, ...(result.activityUrl ? { activityUrl: result.activityUrl } : {}), ...(result.processing ? { processing: true } : {}) };
      }
      if (result.reason === 'not_connected') await refreshStrava(); // le prochain clic rouvrira la connexion
      const duplicate = result.reason === 'rejected' && /duplicate/i.test(result.message);
      if (result.reason === 'rejected') exported = undefined; // Strava a statué : inutile de renvoyer le même fichier
      return fail(`${duplicate ? 'déjà envoyée' : 'échec'} (${result.message})`, result.reason !== 'rejected');
    } catch (e) {
      popup?.close();
      return fail(`échec (${errMsg(e)}), la sortie est gardée en mémoire`, true);
    } finally {
      busy = false;
      refreshButtons();
    }
  }

  button.addEventListener('click', () => void downloadFit());
  stravaButton.addEventListener('click', () => void send());

  const freeze = (why: string) => {
    const now = Date.now();
    recorder.tick(now); // la dernière seconde, si le tick à 1 Hz ne l'a pas encore prise
    frozen = recorder.snapshot(now);
    if (!frozen) return;
    watchFrom = frozen.endMs;
    log(`${why} : l’export s’arrêtera ici (${frozen.samples.length} s), sauf si tu repars (arrêt puis ${RESUME_S} s de pédalage)`);
    refreshButtons();
  };

  return {
    onRide: (s) =>
      recorder.update({ speedMs: s.speedKmh / 3.6, distanceM: s.distanceM, altitudeM: s.altitudeM }, Date.now()),
    onTrainerState: (s) => (s === 'connected' ? recorder.resume(Date.now()) : recorder.pause(Date.now())),
    onWorkoutState: (targetW, stepIndex) => recorder.update({ targetW, stepIndex }, Date.now()),
    onWorkoutFinished: () => freeze('séance terminée'),
    onRideStopped: () => freeze('sortie arrêtée'),
    onWorkoutStarted: (name) => {
      workoutName = name;
      frozen = undefined;
      watchFrom = undefined;
      refreshButtons();
    },
    current: () => frozen ?? recorder.snapshot(Date.now()),
    releaseFrozen: () => {
      if (!frozen) return;
      frozen = undefined;
      log('le cycliste continue : l’export couvrira toute la sortie');
      refreshButtons();
    },
    defaultName,
    strava: () =>
      !strava?.configured ? 'none' : strava.locked ? 'locked' : strava.connected ? 'ready' : 'login',
    sendToStrava: send,
    downloadFit,
  };
}
