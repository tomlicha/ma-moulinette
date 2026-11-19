'use strict';
// Parcours de l'application avec le trainer simulé : connexion, sortie libre, ERG manuel, séance (intensité, pause, palier
// suivant, ERG relâché puis repris), arrêt, perte du trainer en pleine sortie et reprise, récapitulatif.
const { openPage, sleep, Steps } = require('../lib.cjs');

const ERG_ON = "Désengager l'ERG";
const ERG_OFF = "Engager l'ERG";
const RIDE_START = 'Démarrer la sortie';
const RIDE_STOP = 'Arrêter la sortie';

module.exports = async function app({ browser, url }) {
  const { page, errors } = await openPage(browser, { viewport: { width: 1280, height: 800 } }, url);
  await sleep(1500);

  const click = (id) => page.evaluate((id) => document.getElementById(id)?.click(), id);
  const closeRecap = () => page.evaluate(() => document.querySelector('#recap')?.close?.());
  const text = (id) => page.evaluate((id) => document.getElementById(id)?.textContent?.trim() ?? null, id);
  /** Attend que le texte d'un élément corresponde (les reconnexions du trainer simulé prennent un temps variable). */
  async function waitText(id, want, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await text(id)) === want) return;
      await sleep(100);
    }
  }

  /** Attend que l'enregistrement atteigne ce nombre de secondes (affiché par le bouton d'export). */
  async function waitRecording(seconds, ms = 120_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = /\((\d+) s/.exec((await text('export-fit')) ?? '');
      if (m && Number(m[1]) >= seconds) return;
      await sleep(500);
    }
  }

  const steps = new Steps((label) =>
    page.evaluate((label) => {
      const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
      const h = (id) => document.getElementById(id)?.hidden ?? null;
      const d = (id) => document.getElementById(id)?.dataset?.s ?? null;
      const blocked = (id) => {
        const e = document.getElementById(id);
        return e?.getAttribute('aria-disabled') ?? (e?.disabled ? 'disabled' : null);
      };
      return {
        label,
        state: t('state'),
        stateS: d('state'),
        ride: t('ride-toggle'),
        rideBlocked: blocked('ride-toggle'),
        erg: t('erg-send'),
        ergBlocked: blocked('erg-send'),
        woName: t('wo-name'),
        woStartHidden: h('wo-start'),
        woPause: t('wo-pause'),
        woIntensity: t('wo-intensity'),
        rideQuickHidden: h('ride-quick'),
        massReadOnly: document.getElementById('mass')?.readOnly,
        caps: t('caps'),
        exportFit: t('export-fit'),
        exportFitBlocked: blocked('export-fit'),
        exportStravaHidden: h('export-strava'),
        route: document.getElementById('hud')?.innerText?.replace(/\s+/g, ' ').slice(0, 200) ?? null,
        // L'écran Appareils en entier (cartes, boutons, radars), sans son fond animé.
        devices: (() => {
          const copy = document.querySelector('[data-view="appareils"]')?.cloneNode(true);
          copy?.querySelector('#dev-scenes')?.remove();
          return (copy?.innerHTML ?? '').replace(/\s+/g, ' ');
        })(),
      };
    }, label),
  );

  await steps.mark('chargé', { state: 'Non connecté', ride: RIDE_START, erg: ERG_OFF });
  await click('connect-sim');
  await waitText('state', 'Connecté');
  await steps.mark('trainer simulé connecté', { state: 'Connecté', stateS: 'connected' });

  // Une séance se choisit sur l'accueil. On y reste : sur l'écran Sortie, le premier coup de pédale démarrerait tout seul la
  // sortie (ou la séance) et se disputerait avec nos clics. On ne rejoint la Sortie qu'une fois la sortie lancée : c'est là que
  // s'ouvre le récapitulatif.
  await page.evaluate(() => {
    const s = document.getElementById('home-wo-select');
    s.value = 'sample:sweet-spot';
    s.dispatchEvent(new Event('change'));
  });
  await sleep(300);
  await steps.mark('séance choisie', { woName: /sweet spot/i });

  await click('ride-toggle');
  await sleep(2500);
  await steps.mark('sortie libre démarrée', { ride: RIDE_STOP, massReadOnly: true });

  // ERG manuel pendant une sortie libre, puis relâché.
  await page.evaluate(() => {
    const e = document.getElementById('erg');
    if (e) {
      e.value = '150';
      e.dispatchEvent(new Event('change'));
    }
  });
  await click('erg-send');
  await sleep(600);
  await steps.mark('ERG engagé', { erg: ERG_ON });
  await click('erg-send');
  await sleep(600);
  await steps.mark('ERG désengagé', { erg: ERG_OFF });

  await click('ride-toggle');
  await sleep(800);
  await steps.mark('sortie arrêtée', { ride: RIDE_START, massReadOnly: false, exportFit: /^Exporter FIT \(\d+ s\)$/ });
  await closeRecap(); // le récapitulatif s'ouvre

  await click('wo-start');
  await sleep(2500);
  await steps.mark('séance démarrée', { ride: RIDE_STOP, woStartHidden: true, rideQuickHidden: false, woIntensity: '100 %', erg: ERG_ON });
  await click('wo-harder');
  await click('wo-harder');
  await steps.mark('séance +10 %', { woIntensity: '110 %' });
  await click('wo-easier');
  await steps.mark('séance -5 %', { woIntensity: '105 %' });
  await click('wo-pause');
  await sleep(500);
  await steps.mark('séance en pause', { woPause: 'Reprendre' });
  await click('wo-pause');
  await click('wo-skip');
  await sleep(800);
  await steps.mark('palier suivant', { woPause: 'Pause' });
  await click('erg-send'); // désengage l'ERG pris par la séance
  await sleep(600);
  await steps.mark('ERG relâché pendant la séance', { erg: ERG_OFF });
  await click('erg-send'); // le réengage
  await sleep(800);
  await steps.mark('ERG réengagé pendant la séance', { erg: ERG_ON });
  await click('wo-stop');
  await sleep(800);
  await steps.mark('séance arrêtée', { rideQuickHidden: true, erg: ERG_OFF, ride: RIDE_STOP });
  await waitRecording(62); // le récapitulatif n'apparaît qu'au-delà de 60 s de sortie enregistrée
  await page.evaluate(() => (location.hash = '#sortie'));
  await sleep(300);
  await click('ride-toggle');
  await sleep(500);
  await steps.mark('sortie de la séance arrêtée', { ride: RIDE_START });
  await closeRecap();

  // Déconnexion du trainer : l'état change, rien ne plante.
  await click('disconnect');
  await sleep(800);
  await steps.mark('trainer déconnecté', { state: 'Non connecté' });

  // Sortie en pause faute de trainer, puis reprise à la reconnexion.
  await click('connect-sim');
  await waitText('state', 'Connecté');
  await click('ride-toggle');
  await sleep(2500);
  await steps.mark('2e sortie démarrée', { ride: RIDE_STOP });
  await click('disconnect');
  await sleep(800);
  await steps.mark('trainer perdu en sortie', { state: 'Non connecté', ride: RIDE_STOP });
  await click('connect-sim');
  await waitText('state', 'Connecté');
  await sleep(500);
  await steps.mark('trainer revenu, sortie reprise', { state: 'Connecté', ride: RIDE_STOP });
  await sleep(1500);
  await steps.mark('sortie reprise, 1,5 s plus tard', { state: 'Connecté', ride: RIDE_STOP });
  await click('ride-toggle');
  await sleep(600);
  await steps.mark('2e sortie arrêtée', { ride: RIDE_START });
  await closeRecap();

  // Le journal : heures retirées ; ce qui doit y être, et ce qui ne doit pas y être.
  const raw = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
  const log = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^\d\d:\d\d:\d\d\s+/, ''));
  for (const re of [
    /^trainer : connected/,
    /^sortie virtuelle démarrée \(\d+ kg\)/,
    /^séance démarrée : /,
    /^séance : ERG engagé à \d+ W/,
    /^ERG désengagé : la séance continue sans imposer de consigne/,
    /^ERG réengagé : la séance reprend sa consigne/,
    /^trainer perdu : sortie en pause/,
    /^trainer reconnecté : sortie reprise/,
    /^récapitulatif : \d+ s/,
  ]) {
    if (!log.some((l) => re.test(l))) steps.fail(`journal : aucune ligne ne correspond à ${re}`);
  }
  const bad = log.filter((l) => /échec|impossible|non envoyée|illisible|refusé/i.test(l) && !/^écran allumé/.test(l));
  if (bad.length) steps.fail(`journal : lignes d'échec : ${bad.join(' | ')}`);
  if (errors.length) steps.fail(`erreurs de la page : ${errors.join(' | ')}`);

  return { trace: { errors, steps: steps.list, log }, failures: steps.failures };
};
