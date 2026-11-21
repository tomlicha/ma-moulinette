import type { RideSnapshot } from '../domain/sim/ride';
import { RideRecorder, type Recording } from '../infra/export/recorder';
import { browserStravaPort, type StravaPort } from '../infra/export/strava/port';
import type { StravaStatus } from '../infra/export/strava/client';
import type { SensorHub } from '../infra/sensors/hub';
import type { ConnectionState } from '../infra/sensors/types';
import { TypedEmitter } from '../shared/util/typed-emitter';

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
  | {
      ok: false;
      message: string;
      /** La sortie est gardée en mémoire : un nouvel essai a un sens. */
      kept: boolean;
      /** Le nouvel essai passera par la connexion à Strava (accès révoqué, rafraîchissement refusé). */
      login: boolean;
    };

/** Ce que l'export demande au navigateur (fenêtres, fichier) : un faux suffit aux tests. */
export interface ExportPlatform {
  /** Demande la clé d'accès du propriétaire ; `null` ou vide si le coureur renonce. */
  askOwnerKey(current: string): string | null;
  /** Ouvre la fenêtre de connexion à Strava. À appeler dans le geste de l'utilisateur ; `null` si le navigateur la bloque. */
  openLoginWindow(): Window | null;
  /** Donne le fichier au coureur. */
  saveFile(name: string, bytes: Uint8Array): void;
}

/** Où en est l'export, de quoi dessiner les deux boutons. */
export interface ExportStatus {
  /** Secondes enregistrées depuis le dernier export. */
  samples: number;
  /** L'enregistrement est en pause (trainer perdu). */
  paused: boolean;
  /** Secondes de la sortie figée, si elle l'est. */
  frozenSamples: number | undefined;
  /** Une sortie encodée attend d'arriver chez Strava (nouvel essai possible). */
  kept: boolean;
  stravaConfigured: boolean;
  /** Un export ou un envoi est en cours. */
  busy: boolean;
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

export interface FitEncoder {
  encodeActivity(rec: Recording): Uint8Array;
  fitFileName(startMs: number): string;
}

export interface RideExportDeps {
  hub: Pick<SensorHub, 'on'>;
  /** Nom de la route de la sortie virtuelle : nom de l'activité quand aucune séance n'a été menée. */
  routeName: string;
  log: (message: string) => void;
  platform: ExportPlatform;
  strava?: StravaPort;
  /** Le SDK FIT pèse environ 380 Ko : chargé seulement à l'export. */
  loadEncoder?: () => Promise<FitEncoder>;
  clock?: () => number;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * L'export de la sortie : enregistrement à 1 Hz, sortie figée à la fin d'une séance ou à l'arrêt, fichier FIT, envoi à Strava.
 *
 * Une seule responsabilité : garder la sortie et la remettre au coureur (fichier ou Strava). Il ne dessine rien :
 * il publie `changed` (de quoi redessiner les boutons) et `resumed` (le cycliste est reparti après la sortie figée,
 * à dire avant que la sortie figée soit abandonnée).
 */
export class RideExport extends TypedEmitter<{ changed: []; resumed: [] }> {
  private readonly recorder = new RideRecorder();
  private exported?: Exported;
  /**
   * Sortie figée à la fin du dernier palier ou à l'arrêt de la sortie, exportée à la place de l'enregistrement tant
   * que le cycliste n'est pas reparti.
   */
  private frozen?: Recording;
  /** Instant de la dernière sortie figée, d'où l'on guette la reprise ; il survit à l'envoi de la sortie figée. */
  private watchFrom?: number;
  private stravaStatus?: StravaStatus;
  /** Séance démarrée depuis le dernier export ; sans elle, la sortie porte le nom de la route. */
  private workoutName?: string;
  private busy = false;
  /** Aucun échantillon avant le premier vrai coup de pédale (même si cardio/vitesse arrivent déjà). */
  private recordingStarted = false;
  private readonly port: StravaPort;
  private readonly clock: () => number;

  constructor(private readonly deps: RideExportDeps) {
    super();
    this.port = deps.strava ?? browserStravaPort;
    this.clock = deps.clock ?? (() => Date.now());
  }

  /** Commence à enregistrer les mesures, à un pas d'une seconde, et demande à Strava où on en est. */
  start(): void {
    void this.refreshStrava();
    this.deps.hub.on('measurement', (m) => {
      const now = this.clock();
      const firstPedal = !this.recordingStarted && ((m.powerW ?? 0) > 0 || (m.cadenceRpm ?? 0) > 0);
      if (firstPedal) {
        // Les mesures capteur pré-départ sont ignorées ; on conserve les derniers snapshots route/séance,
        // déjà actualisés indépendamment, pour les inclure dans le tout premier échantillon.
        this.recordingStarted = true;
      }
      if (!this.recordingStarted) return;
      this.recorder.update({ powerW: m.powerW, cadenceRpm: m.cadenceRpm, heartRateBpm: m.heartRateBpm }, now);
      // Le premier point est pris immédiatement, sans attendre le prochain tick 1 Hz.
      if (firstPedal) this.recorder.tick(now);
    });
    setInterval(() => this.tick(), 1000);
  }

  /** Le pas d'une seconde (public pour les tests). */
  tick(): void {
    if (this.recordingStarted) this.recorder.tick(this.clock());
    if (this.recordingStarted && this.watchFrom !== undefined && this.recorder.resumedAfter(this.watchFrom, RESUME_S)) {
      this.watchFrom = undefined;
      // D'abord le récapitulatif : s'il avait un envoi programmé, il part avec la sortie figée, qu'il prend tout de suite.
      this.emit('resumed');
      if (this.frozen) {
        this.frozen = undefined;
        this.deps.log('pédalage repris : l’export couvrira toute la sortie');
      }
    }
    this.emit('changed');
  }

  status(): ExportStatus {
    return {
      samples: this.recorder.sampleCount,
      paused: this.recorder.state === 'paused',
      frozenSamples: this.frozen?.samples.length,
      kept: this.exported !== undefined,
      stravaConfigured: !!this.stravaStatus?.configured,
      busy: this.busy,
    };
  }

  /** À appeler à chaque snapshot de la sortie virtuelle. */
  onRide(s: RideSnapshot): void {
    this.recorder.update({ speedMs: s.speedKmh / 3.6, distanceM: s.distanceM, altitudeM: s.altitudeM }, this.clock());
  }

  /** À appeler à chaque changement d'état du trainer : l'enregistrement se met en pause hors connexion. */
  onTrainerState(s: ConnectionState): void {
    if (!this.recordingStarted) return;
    if (s === 'connected') this.recorder.resume(this.clock());
    else this.recorder.pause(this.clock());
  }

  /** Consigne et palier de la séance en cours, à chaque pas de la séance : notés dans l'enregistrement pour le récapitulatif. */
  onWorkoutState(targetW: number | undefined, stepIndex: number): void {
    this.recorder.update({ targetW, stepIndex }, this.clock());
  }

  /** Séance menée jusqu'au bout du dernier palier : la sortie est figée à cet instant pour l'export. */
  onWorkoutFinished(): void {
    this.freeze('séance terminée');
  }

  /** Sortie arrêtée à la main : figée à cet instant, comme une séance terminée. */
  onRideStopped(): void {
    this.freeze('sortie arrêtée');
  }

  /** Nouvelle séance : l'instantané de la précédente ne vaut plus ; son nom devient celui de la sortie. */
  onWorkoutStarted(name: string): void {
    this.workoutName = name;
    this.frozen = undefined;
    this.watchFrom = undefined;
    this.emit('changed');
  }

  /** Sortie que l'export prendrait maintenant : la sortie figée, sinon l'enregistrement en cours. */
  current(): Recording | undefined {
    return this.frozen ?? this.recorder.snapshot(this.clock());
  }

  /** Le cycliste choisit de continuer : la sortie figée (si elle n'est pas déjà partie) cède la place à toute la sortie. */
  releaseFrozen(): void {
    if (!this.frozen) return;
    this.frozen = undefined;
    this.deps.log('le cycliste continue : l’export couvrira toute la sortie');
    this.emit('changed');
  }

  /** Nom proposé pour l'activité Strava. */
  defaultName(): string {
    return `Ma Moulinette - ${this.workoutName ?? this.deps.routeName}`;
  }

  /** Où en est Strava pour cet appareil (voir `StravaReadiness`). */
  strava(): StravaReadiness {
    const s = this.stravaStatus;
    return !s?.configured ? 'none' : s.locked ? 'locked' : s.connected ? 'ready' : 'login';
  }

  async downloadFit(): Promise<void> {
    const { log } = this.deps;
    this.busy = true;
    try {
      const out = await this.prepare();
      if (!out) {
        log('export FIT : rien à exporter');
        return;
      }
      const { fitFileName } = await this.encoder();
      this.deps.platform.saveFile(fitFileName(out.startMs), out.bytes);
      log(`export FIT : ${out.samples} échantillons, ${Math.round(out.bytes.length / 1024)} Ko`);
    } catch (e) {
      log(`export FIT impossible : ${errMsg(e)}`);
    } finally {
      this.busy = false;
      this.emit('changed');
    }
  }

  /**
   * Envoie la sortie à Strava sous le nom donné. À appeler dans le geste de l'utilisateur si `strava()` n'est pas
   * `ready` : la fenêtre de connexion doit s'ouvrir avant tout `await`.
   */
  async sendToStrava(name?: string): Promise<StravaOutcome> {
    const { log, platform } = this.deps;
    const strava = this.port;
    const fail = (message: string, kept: boolean): StravaOutcome => {
      log(`Strava : ${message}`);
      return { ok: false, message, kept, login: !!this.stravaStatus?.configured && !this.stravaStatus.connected };
    };
    // La fenêtre de connexion doit s'ouvrir dans le geste utilisateur, avant tout `await`, sinon elle est bloquée.
    if (this.stravaStatus?.locked) {
      // Site public : le relais Strava n'obéit qu'au propriétaire, qui saisit sa clé une seule fois par appareil.
      const key = platform.askOwnerKey(strava.ownerKey());
      if (!key) return { ok: false, message: 'clé d’accès non saisie', kept: true, login: false };
      strava.setOwnerKey(key.trim());
      await this.refreshStrava();
      if (this.stravaStatus?.locked) {
        strava.setOwnerKey('');
        return fail('clé d’accès refusée', true);
      }
    }
    const needsLogin = this.stravaStatus?.configured && !this.stravaStatus.connected;
    // Coquille native : pas de fenêtre, une session d'authentification système.
    const native = strava.isNative();
    const popup = needsLogin && !native ? platform.openLoginWindow() : null;
    this.busy = true;
    this.emit('changed');
    try {
      if (popup) popup.location.href = await strava.loginUrl();
      const out = await this.prepare(name);
      if (!out) return fail('rien à envoyer', false);
      if (needsLogin && native) {
        await strava.nativeLogin();
        await this.refreshStrava();
        if (!this.stravaStatus?.connected) return fail('connexion non terminée, la sortie est gardée en mémoire pour un nouvel essai', true);
        log(`Strava : connecté${this.stravaStatus.athlete ? ` (${this.stravaStatus.athlete})` : ''}`);
      } else if (needsLogin) {
        if (!popup) return fail('fenêtre de connexion bloquée par le navigateur, autoriser les fenêtres puis réessayer', true);
        // Le succès se lit dans le statut du relais, pas dans le message de la fenêtre : Strava peut couper `window.opener`.
        await strava.waitForLogin(popup);
        await this.refreshStrava();
        if (!this.stravaStatus?.connected) return fail('connexion non terminée, la sortie est gardée en mémoire pour un nouvel essai', true);
        log(`Strava : connecté${this.stravaStatus.athlete ? ` (${this.stravaStatus.athlete})` : ''}`);
      }

      log('Strava : envoi en cours…');
      const result = await strava.send(out.bytes, { name: out.name, externalId: `mamoulinette-${out.startMs}` });
      if (result.ok) {
        this.exported = undefined;
        log(
          result.processing
            ? 'Strava : fichier reçu, traitement en cours chez Strava'
            : `Strava : activité créée ${result.activityUrl ?? ''}`,
        );
        return { ok: true, name: out.name, ...(result.activityUrl ? { activityUrl: result.activityUrl } : {}), ...(result.processing ? { processing: true } : {}) };
      }
      if (result.reason === 'not_connected') await this.refreshStrava(); // le prochain clic rouvrira la connexion
      const duplicate = result.reason === 'rejected' && /duplicate/i.test(result.message);
      if (result.reason === 'rejected') this.exported = undefined; // Strava a statué : inutile de renvoyer le même fichier
      return fail(`${duplicate ? 'déjà envoyée' : 'échec'} (${result.message})`, result.reason !== 'rejected');
    } catch (e) {
      popup?.close();
      return fail(`échec (${errMsg(e)}), la sortie est gardée en mémoire`, true);
    } finally {
      this.busy = false;
      this.emit('changed');
    }
  }

  private refreshStrava(): Promise<void> {
    return this.port
      .status()
      .then((s) => void (this.stravaStatus = s))
      .catch(() => void (this.stravaStatus = undefined)); // pas de relais (build statique) : le bouton Strava reste caché
  }

  private encoder(): Promise<FitEncoder> {
    return this.deps.loadEncoder ? this.deps.loadEncoder() : import('../infra/export/fit-activity');
  }

  /**
   * Fige la sortie en cours en fichier FIT ; sans sortie en cours, reprend la dernière non envoyée. Juste après une
   * séance terminée ou une sortie arrêtée, la sortie s'arrête à cet instant : les secondes d'après sont écartées.
   */
  private async prepare(name?: string): Promise<Exported | undefined> {
    // La sortie figée est prise avant tout `await` : une reprise du pédalage pendant le chargement ne doit pas l'abandonner.
    const pending = this.frozen;
    this.frozen = undefined;
    // Le SDK FIT est chargé avant `finish`, qui vide l'enregistrement.
    const { encodeActivity } = await this.encoder();
    const rec = pending ?? this.recorder.finish(this.clock());
    if (pending) this.recorder.reset();
    this.recordingStarted = false;
    if (!rec) {
      if (this.exported && name) this.exported.name = name;
      return this.exported;
    }
    this.exported = {
      bytes: encodeActivity(rec),
      startMs: rec.startMs,
      samples: rec.samples.length,
      name: name || this.defaultName(),
    };
    this.workoutName = undefined;
    return this.exported;
  }

  private freeze(why: string): void {
    const now = this.clock();
    this.recorder.tick(now); // la dernière seconde, si le tick à 1 Hz ne l'a pas encore prise
    this.frozen = this.recorder.snapshot(now);
    if (!this.frozen) return;
    this.watchFrom = this.frozen.endMs;
    this.deps.log(`${why} : l’export s’arrêtera ici (${this.frozen.samples.length} s), sauf si tu repars (arrêt puis ${RESUME_S} s de pédalage)`);
    this.emit('changed');
  }
}
