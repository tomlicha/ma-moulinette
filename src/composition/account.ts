import { CrowdView } from '../ui/ride/crowd-view';
import { RiderSettingsSync } from '../app/rider-settings-sync';
import { WebBluetoothTrainer } from '../infra/sensors/ble/web-bluetooth';
import { WorldClient } from '../infra/net/world-client';
import { blockSource, workoutSource } from '../infra/sync/sources';
import { createSyncClient } from '../infra/sync/client';
import { AccountSession } from '../app/account-session';
import { importFinalSurgeWorkouts as mapAndSaveFinalSurgeWorkouts } from '../app/final-surge-import';
import { synchronizeFinalSurge } from '../app/final-surge-sync';
import { finalSurgeStatus, importFinalSurgeWorkouts as fetchFinalSurgeWorkouts } from '../infra/net/final-surge';
import { devLogin, fetchAccount, logout, nativeStravaLogin, saveDisplayName } from '../infra/net/account';
import { Moulinette, isNativeShell } from '../infra/native/shell';
import { setupAccount } from '../ui/account/account-chip';
import { setupFinalSurgeDialog } from '../ui/account/final-surge-dialog';
import { setupStravaDialog } from '../ui/account/strava-dialog';
import type { Wiring } from './wiring';

const FINAL_SURGE_ERG_KEY = 'mamoulinette.final-surge-erg';
const finalSurgeErgMode = (w: Wiring) => w.prefs.getItem(FINAL_SURGE_ERG_KEY) !== 'false';

export function composeAccount(w: Wiring): void {
  // Données du coureur synchronisées avec son compte : FTP, masse, séances, « Mes blocs » (docs/design/compte.md).
  const riderSettingsSync = new RiderSettingsSync({
    settings: w.settings,
    journal: w.syncJournal,
    inputs: w.riderInputs,
    ftpChanged: w.ftpChanged,
    refreshProfile: () => w.riderProfile.refresh(),
  });

  /** Séances changées depuis un autre appareil : l'éditeur et la liste de la sortie suivent, la séance choisie aussi. */
  function workoutsChanged(ids: Set<string>) {
    w.editor.libraryChanged();
    const before = w.homeWorkouts.choice;
    w.refreshWorkoutChoices();
    const changed = w.homeWorkouts.choice !== before || (before.startsWith('lib:') && (ids.size === 0 || ids.has(before.slice(4))));
    if (changed && !w.workoutSession.running) w.chooseWorkout(w.homeWorkouts.choice);
  }

  // Le tableau reste ouvert : les modules suivants (nouveautés) y ajoutent leurs sources avant la première synchronisation,
  // qui attend la réponse du compte, donc commence après la composition.
  w.syncSources = [riderSettingsSync, workoutSource(w.library, workoutsChanged), blockSource(w.blockLibrary, () => w.editor.libraryChanged())];

  const sync = createSyncClient({
    journal: w.syncJournal,
    sources: w.syncSources,
    log: w.log,
  });

  let signedIn = false;
  let finalSurgeSyncInFlight: Promise<void> | undefined;
  const synchronizeConnectedFinalSurge = (): Promise<void> => {
    if (!signedIn) return Promise.resolve();
    if (finalSurgeSyncInFlight) return finalSurgeSyncInFlight;
    finalSurgeSyncInFlight = (async () => {
      const state = await finalSurgeStatus();
      if (!state.connected) return;
      const result = await synchronizeFinalSurge({
        fetchWorkouts: fetchFinalSurgeWorkouts,
        importWorkouts: (workouts) => mapAndSaveFinalSurgeWorkouts({ library: w.library, workouts, ftpW: w.readFtp(), ergMode: finalSurgeErgMode(w) }),
      });
      if (result.created || result.updated) w.refreshWorkoutChoices();
      const message = `Final Surge : ${result.created} créée(s), ${result.updated} mise(s) à jour, ${result.unchanged} inchangée(s), ${result.skipped} ignorée(s).`;
      w.log(message);
      for (const error of result.errors) w.log(`Final Surge : ${error}`);
    })().catch((error) => {
      w.log(`Synchronisation Final Surge impossible : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
    }).finally(() => {
      finalSurgeSyncInFlight = undefined;
    });
    return finalSurgeSyncInFlight;
  };

  // À chaque retour au premier plan, les données du compte et les séances Final Surge peuvent avoir changé.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void synchronizeConnectedFinalSurge();
    void sync.now();
    const dev = w.trainerCtl.device;
    if (document.visibilityState === 'visible' && dev instanceof WebBluetoothTrainer) dev.retryNow();
  });

  addEventListener('online', () => {
    void sync.now();
    void synchronizeConnectedFinalSurge();
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') void sync.now();
  }, 120_000);

  // Compte (connexion Strava, facultative) et salle temps réel : sans compte, on roule seul et l'export FIT reste là.
  const world = new WorldClient(w.journey.network);
  w.world = world;

  /** Le compte : qui est connecté et les gestes qui changent cela (app/account-session.ts). */
  const session = new AccountSession({
    api: {
      fetchAccount: () => fetchAccount(),
      saveDisplayName: (name) => saveDisplayName(name),
      logout: () => logout(),
      devLogin: (name) => devLogin(name),
      nativeStravaLogin: () => nativeStravaLogin((x) => Moulinette.authenticate(x)),
    },
    store: w.prefs,
    env: () => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      return { userAgent: navigator.userAgent, platform: nav.userAgentData?.platform };
    },
    native: isNativeShell(),
    log: w.log,
  });
  const account = setupAccount({ hosts: [...document.querySelectorAll<HTMLElement>('.home-top')], session });
  setupStravaDialog({ session });
  const syncFinalSurge = () => synchronizeFinalSurge({
    fetchWorkouts: fetchFinalSurgeWorkouts,
    importWorkouts: (workouts) => mapAndSaveFinalSurgeWorkouts({ library: w.library, workouts, ftpW: w.readFtp(), ergMode: finalSurgeErgMode(w) }),
  });
  setupFinalSurgeDialog({
    syncWorkouts: syncFinalSurge,
    onImported: w.refreshWorkoutChoices,
    log: w.log,
    ergMode: () => finalSurgeErgMode(w),
    setErgMode: (enabled) => w.prefs.setItem(FINAL_SURGE_ERG_KEY, String(enabled)),
  });

  // La première synchronisation du compte précède l'import Final Surge, afin que les séances déjà synchronisées
  // depuis un autre appareil soient présentes avant la déduplication.
  let firstSync: Promise<void> = Promise.resolve();
  session.on('changed', (s) => {
    signedIn = s.kind === 'signed-in';
    if (s.kind === 'signed-in' && s.user.nameConfirmed) world.connect();
    else world.disconnect();
    firstSync = sync.setUser(s.kind === 'signed-in' ? s.user : undefined);
    if (signedIn) void firstSync.then(synchronizeConnectedFinalSurge);
  });
  // Qui est connecté, puis la première synchronisation : ce qui dépend du compte attend cela.
  w.accountSettled = session
    .refresh()
    .catch(() => undefined)
    .then(() => firstSync)
    .catch(() => undefined);

  const crowdView = new CrowdView(w.riderTags, w.ridePanel);
  w.crowd = crowdView;
  const showCrowd = () => crowdView.render(world.status, world.population);
  world.onStatus = (s) => {
    account.setWorld(s, world.population);
    showCrowd();
    w.log(`multijoueur : ${s}`);
  };
  world.onRoster = (event, name) => w.log(`multijoueur : ${name} ${event === 'join' ? 'arrive' : 'part'}`);
  setInterval(() => {
    account.setWorld(world.status, world.population);
    showCrowd();
  }, 1000);
}
