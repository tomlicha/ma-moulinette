import { HudPresenter } from '../ui/ride/hud-presenter';
import { RideHud } from '../ui/ride/hud';
import { RideLoadingView } from '../ui/ride/ride-loading-view';
import { RidePanel } from '../ui/ride/ride-panel';
import { RiderTags } from '../ui/ride/rider-tags';
import { byId as $ } from '../ui/shared/dom';
import type { Wiring } from './wiring';

export function composeHud(w: Wiring): void {
  const hud = new RideHud($('hud'), w.journey, { flat: w.quality === 'low' });
  w.hud = hud;

  const riderTags = new RiderTags($('rider-tags'));
  w.riderTags = riderTags;

  const ridePanel = new RidePanel($('near'), { journey: w.journey, prefs: w.prefs });
  w.ridePanel = ridePanel;

  // Ce que le HUD et l'encart affichent à chaque instant, et les choix du coureur sur la route (hud-presenter.ts).
  new HudPresenter({
    hud,
    ridePanel,
    journey: w.journey,
    readings: w.readings,
    trainer: w.trainerCtl,
    devices: w.devices,
    rideSession: w.rideSession,
    workoutSession: w.workoutSession,
    readFtp: w.readFtp,
    rideScreenOpen: () => w.router.current() === 'sortie',
  });

  /** Écran de chargement de la sortie (index.html, sortie.css) : visible tant que la vue 3D n'a pas dessiné sa première image. */
  const rideLoading = new RideLoadingView();

  w.rideViews.on('progress', (done, step) => rideLoading.progress(done, step));

  w.rideViews.on('ready', (v) => {
    performance.mark('view-ready'); // relevé par tools/audit/startup.cjs
    void v.firstFrame.then(() => rideLoading.hide());
    v.setActive(w.router.current() === 'sortie');
    v.setOthers(() => w.world.riders());
    v.onTags = (tags) => riderTags.set(tags);
    v.onNearby = (n) => ridePanel.setNearby(n, w.rideSession.active ? w.rideSession.draft : 0);
    v.onStats = (s) => rideLoading.showStats(s);
    w.log(`rendu 3D : ${v.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · qualité ${w.quality}${w.rideViews.losses ? ` · reprise n° ${w.rideViews.losses}` : ''}`);
  });

  w.rideViews.on('lost', (loss, attempt, max) => w.log(`rendu 3D : GPU perdu (${loss.api} : ${loss.message}), reprise ${attempt}/${max}`));

  w.rideViews.on('retrying', () => rideLoading.retry());

  w.rideViews.on('unavailable', (e) => {
    rideLoading.unavailable();
    w.log(`rendu 3D indisponible : ${e instanceof Error ? e.message : e}`);
  });

  // three.js (~1 Mio) n'est demandé qu'après le premier affichage, pendant un temps mort : l'accueil répond tout de suite.
  const startViewBuild = () => w.rideViews.start();

  if (typeof requestIdleCallback === 'function') requestIdleCallback(startViewBuild, { timeout: 2000 });
  else setTimeout(startViewBuild, 300);
}
