import { CrowdView } from '../ui/ride/crowd-view';
import { RiderSettingsSync } from '../app/rider-settings-sync';
import { WebBluetoothTrainer } from '../infra/sensors/ble/web-bluetooth';
import { WorldClient } from '../infra/net/world-client';
import { blockSource, workoutSource } from '../infra/sync/sources';
import { createSyncClient } from '../infra/sync/client';
import { AccountSession } from '../app/account-session';
import { devLogin, fetchAccount, logout, nativeStravaLogin, saveDisplayName } from '../infra/net/account';
import { Moulinette, isNativeShell } from '../infra/native/shell';
import { setupAccount } from '../ui/account/account-chip';
import type { Wiring } from './wiring';

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
    const before = w.workoutControls.choice;
    w.refreshWorkoutChoices();
    const changed = w.workoutControls.choice !== before || (before.startsWith('lib:') && (ids.size === 0 || ids.has(before.slice(4))));
    if (changed && !w.workoutSession.running) w.chooseWorkout(w.workoutControls.choice);
  }

  const sync = createSyncClient({
    journal: w.syncJournal,
    sources: [riderSettingsSync, workoutSource(w.library, workoutsChanged), blockSource(w.blockLibrary, () => w.editor.libraryChanged())],
    log: w.log,
  });

  // Retour sur la page, retour du réseau, et toutes les deux minutes tant qu'elle est visible : les autres appareils ont pu changer quelque chose.
  document.addEventListener('visibilitychange', () => {
    void sync.now();
    // Retour au premier plan avec un trainer perdu : la reconnexion est retentée sans attendre son prochain signal.
    const dev = w.trainerCtl.device;
    if (document.visibilityState === 'visible' && dev instanceof WebBluetoothTrainer) dev.retryNow();
  });

  addEventListener('online', () => void sync.now());

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
  // Après l'écran, qui se dessine d'abord : puis la salle temps réel et la synchronisation suivent le compte.
  session.on('changed', (s) => {
    if (s.kind === 'signed-in' && s.user.nameConfirmed) world.connect();
    else world.disconnect();
    void sync.setUser(s.kind === 'signed-in' ? s.user : undefined);
  });
  void session.refresh();

  /** Pastille de l'écran Sortie : visible seulement avec un compte connecté à la salle. */
  const crowdView = new CrowdView(w.riderTags, w.ridePanel);

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
