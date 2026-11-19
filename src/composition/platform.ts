import { LogView } from '../ui/devices/log-view';
import { Moulinette, isNativeShell } from '../infra/native/shell';
import { SensorHub } from '../infra/sensors/hub';
import { SettingsStore } from '../app/settings-store';
import { SyncJournal } from '../infra/sync/journal';
import { WebBluetoothTrainer } from '../infra/sensors/ble/web-bluetooth';
import { browserStore } from '../infra/storage/key-value-store';
import { chooseQuality } from '../render/core/quality';
import { createKeepAwake } from '../ui/shared/keep-awake';
import { installNativeBluetooth } from '../infra/sensors/ble/native-bluetooth';
import { migrateLegacyKeys } from '../infra/storage/legacy-storage';
import { openDeviceChooser } from '../ui/devices/device-chooser';
import { setupBlockedHints } from '../ui/shared/blocked';
import { setupTelemetry } from '../infra/telemetry/wiring';
import type { Wiring } from './wiring';

export function composePlatform(w: Wiring): void {
  w.log = log;

  // Données gardées sous l'ancien préfixe `zwift2.` : reprises sous `mamoulinette.` avant toute lecture.
  try {
    migrateLegacyKeys(localStorage);
  } catch {
    // stockage inaccessible : rien à reprendre
  }

  // Dans la coquille iOS/Android, Web Bluetooth n'existe pas : le pont natif le fournit (sinon, sans effet).
  installNativeBluetooth(openDeviceChooser);

  setupBlockedHints();

  const logView = new LogView();

  const hub = new SensorHub();
  w.hub = hub;

  const prefs = browserStore();
  w.prefs = prefs;

  /** FTP, masse et protocole de pilotage gardés sur l'appareil. */
  const settings = new SettingsStore(prefs);
  w.settings = settings;

  /** Journal de synchronisation avec le compte : FTP, masse, séances et blocs y notent chaque modification (src/infra/sync/). */
  const syncJournal = new SyncJournal(prefs);
  w.syncJournal = syncJournal;

  function log(msg: string) {
    logView.append(msg);
    telemetry.record(msg);
  }

  // Envoie le journal au serveur de logs dès qu'une erreur survient (voir src/infra/telemetry/). `devices.states` n’est lu qu’à l’envoi,
  // bien après l'évaluation du module.
  const telemetry = setupTelemetry({
    log,
    context: () => {
      const dev = w.trainerCtl.device;
      return {
        trainer: dev?.name,
        trainerState: w.trainerCtl.state,
        capabilities: dev?.capabilities,
        trainerIdentity: dev instanceof WebBluetoothTrainer ? dev.identity : undefined,
        heartRateState: w.devices.states.hr,
        rideRunning: w.rideSession.active,
      };
    },
  });
  w.telemetry = telemetry;

  // Écran allumé tant qu'on est sur l'application, quel que soit l'écran : pendant une séance ERG, on ne touche pas l'écran.
  const keepAwake = createKeepAwake({
    native: isNativeShell() ? Moulinette : undefined,
    wakeLock: (navigator as Navigator & { wakeLock?: Parameters<typeof createKeepAwake>[0]['wakeLock'] }).wakeLock,
    document,
    log: (m) => log(m),
  });

  void keepAwake.set(true);

  const params = new URLSearchParams(location.search);
  w.params = params;

  // HUD posé sur la vue 3D (docs/design/hud.md). En qualité réduite, panneaux sans flou.
  /** Profil de rendu : `?quality=high|low`, sinon `low` sur écran tactile (src/render/core/quality.ts). Le HUD le suit (sans flou en `low`). */
  const quality = chooseQuality(params.get('quality'), matchMedia('(pointer: coarse)').matches);
  w.quality = quality;

  // `?relief=1` : relief réel ; `?relief=2` : plus marqué. Par défaut 1,6 : un 6 % se voit comme un 10 %.
  const reliefParam = Number(params.get('relief'));

  const relief = params.get('relief') && Number.isFinite(reliefParam) ? Math.min(3, Math.max(1, reliefParam)) : undefined;
  w.relief = relief;

  // Service worker (build de production seulement) : relancement instantané et hors ligne. Il est généré au build avec la
  // liste des fichiers de la version (tools/offline/). En développement, il servirait des fichiers périmés.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e: unknown) => log(`hors ligne indisponible : ${e instanceof Error ? e.message : e}`));
    });
  }
}
