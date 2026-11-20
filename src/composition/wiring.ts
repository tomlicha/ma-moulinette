import type { AutoStart } from '../app/auto-start';
import type { BlockLibrary } from '../domain/workout/block-library';
import type { BlockReason } from '../ui/shared/blocked';
import type { ConnectionState } from '../infra/sensors/types';
import type { DeviceManager } from '../app/device-manager';
import type { DevicesView } from '../ui/devices/devices-view';
import type { GradeController } from '../app/grade-controller';
import type { HomeView } from '../ui/home/home-view';
import type { Journey } from '../domain/sim/journey';
import type { ManualControl } from '../app/manual-control';
import type { RideControlsView } from '../ui/ride/ride-controls-view';
import type { RideExport } from '../app/ride-export';
import type { RideHud } from '../ui/ride/hud';
import type { RidePanel } from '../ui/ride/ride-panel';
import type { RideSession } from '../app/ride-session';
import type { RideViewLoader } from '../app/ride-view-loader';
import type { RiderInputs } from '../ui/ride/rider-inputs';
import type { RiderTags } from '../ui/ride/rider-tags';
import type { SensorHub } from '../infra/sensors/hub';
import type { SensorReadings } from '../app/sensor-readings';
import type { SettingsStore } from '../app/settings-store';
import type { SyncJournal } from '../infra/sync/journal';
import type { SyncSource } from '../infra/sync/client';
import type { TrainerController } from '../app/trainer-controller';
import type { WebBluetoothTrainer } from '../infra/sensors/ble/web-bluetooth';
import type { Workout } from '../domain/workout/model';
import type { HomeWorkoutsView } from '../ui/home/home-workouts-view';
import type { WorkoutControlsView } from '../ui/ride/workout-controls-view';
import type { WorkoutLibrary } from '../domain/workout/library';
import type { WorkoutSession } from '../app/workout-session';
import type { WorldClient } from '../infra/net/world-client';
import type { KeyValueStore } from '../shared/util/key-value-store';
import type { Quality } from '../render/core/quality';
import type { LazyWorkoutEditor } from '../ui/editor/lazy-editor';
import type { setupRecap } from '../ui/recap/recap';
import type { setupRideMenu } from '../ui/ride/ride-menu';
import type { setupRiderProfile } from '../ui/devices/rider-profile';
import type { setupRouter } from '../ui/shared/router';
import type { setupTelemetry } from '../infra/telemetry/wiring';

/**
 * Ce que les modules de composition se passent : chacun crée ses objets, les range ici, et lit ceux des autres.
 * L'objet est rempli module après module (voir index.ts) ; un module ne lit tout de suite que ce que les modules
 * précédents ont rangé, le reste à l'usage (dans une fonction ou un écouteur).
 */
export interface Wiring {
  /** Le compte est connu et la première synchronisation passée (ou sans compte : tout de suite). Rangé par `account`. */
  accountSettled: Promise<void>;
  autoStart: AutoStart;
  blockLibrary: BlockLibrary;
  chooseWorkout: (value: string) => void;
  devices: DeviceManager;
  devicesView: DevicesView;
  editor: LazyWorkoutEditor;
  exporter: RideExport;
  ftpChanged: () => void;
  grade: GradeController;
  home: HomeView;
  homeWorkouts: HomeWorkoutsView;
  hub: SensorHub;
  hud: RideHud;
  journey: Journey;
  library: WorkoutLibrary;
  log: (msg: string) => void;
  manual: ManualControl;
  needTrainer: (text: string) => BlockReason;
  newBleTrainer: () => WebBluetoothTrainer;
  noControl: (what: string) => BlockReason;
  offerRecap: (done?: { workout: Workout; ftpW: number }) => void;
  params: URLSearchParams;
  prefs: KeyValueStore;
  quality: Quality;
  readFtp: () => number;
  readings: SensorReadings;
  recap: ReturnType<typeof setupRecap>;
  refreshWorkoutButtons: () => void;
  refreshWorkoutChoices: () => void;
  relief: number | undefined;
  renderDevices: () => void;
  rideControls: RideControlsView;
  rideMenu: ReturnType<typeof setupRideMenu>;
  ridePanel: RidePanel;
  rideSession: RideSession;
  rideViews: RideViewLoader;
  riderInputs: RiderInputs;
  riderProfile: ReturnType<typeof setupRiderProfile>;
  riderTags: RiderTags;
  router: ReturnType<typeof setupRouter>;
  setState: (s: ConnectionState, detail?: string) => void;
  settings: SettingsStore;
  startRide: () => void;
  stopRide: (resetTrainer?: boolean) => void;
  syncJournal: SyncJournal;
  /** Ce que la synchronisation avec le compte porte : FTP et masse, séances, blocs, puis ce que les modules suivants y ajoutent (avant la première synchronisation, qui attend le réseau). */
  syncSources: SyncSource[];
  telemetry: ReturnType<typeof setupTelemetry>;
  trainerCtl: TrainerController;
  workoutControls: WorkoutControlsView;
  workoutSession: WorkoutSession;
  world: WorldClient;
}
