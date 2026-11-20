'use strict';
// Démarrage au premier coup de pédale : sur l'écran Sortie, tant que rien n'a été lancé à la main, la première puissance
// démarre la séance choisie (et la sortie qui la porte), ou la sortie libre ; un arrêt volontaire n'est pas défait par
// le pédalage qui continue (le trainer simulé pédale en continu).
const { openPage, sleep, Steps } = require('../lib.cjs');

const RIDE_START = 'Démarrer la sortie';
const RIDE_STOP = 'Arrêter la sortie';

module.exports = async function autostart({ browser, url }) {
  const { page, errors } = await openPage(browser, { viewport: { width: 1280, height: 800 } }, url);
  await sleep(1500);

  const click = (id) => page.evaluate((id) => document.getElementById(id)?.click(), id);
  const text = (id) => page.evaluate((id) => document.getElementById(id)?.textContent?.trim() ?? null, id);
  const go = (hash) => page.evaluate((h) => (location.hash = h), hash);
  /** Attend que le texte d'un élément corresponde (le démarrage automatique suit la première mesure). */
  async function waitText(id, want, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await text(id)) === want) return;
      await sleep(100);
    }
  }

  const steps = new Steps((label) =>
    page.evaluate((label) => {
      const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
      return {
        label,
        state: t('state'),
        ride: t('ride-toggle'),
        woStartHidden: document.getElementById('wo-start')?.hidden ?? null,
        woName: t('wo-name'),
      };
    }, label),
  );

  await click('connect-sim');
  await waitText('state', 'Connecté');
  await steps.mark('trainer simulé connecté', { state: 'Connecté', ride: RIDE_START });

  // 1. Sortie libre : on arrive sur l'écran Sortie, la première puissance la démarre.
  await go('#sortie');
  await waitText('ride-toggle', RIDE_STOP);
  await steps.mark('sortie démarrée au premier coup de pédale', { ride: RIDE_STOP, woStartHidden: false });

  // 2. Arrêt volontaire : le pédalage continue, rien ne repart.
  await click('ride-toggle');
  await sleep(1500);
  await steps.mark('arrêt volontaire non défait', { ride: RIDE_START });

  // 3. Séance choisie sur l'accueil, puis écran Sortie : la première puissance démarre la séance.
  await go('#accueil');
  await sleep(300);
  await page.evaluate(() => {
    document.querySelector('[data-wo="sample:sweet-spot"]').click();
  });
  await sleep(300);
  await steps.mark('séance choisie', { woName: /sweet spot/i, ride: RIDE_START });
  await go('#sortie');
  await waitText('ride-toggle', RIDE_STOP);
  await sleep(500);
  await steps.mark('séance démarrée au premier coup de pédale', { ride: RIDE_STOP, woStartHidden: true });

  // 4. Séance arrêtée : le pédalage qui continue ne la relance pas.
  await click('wo-stop');
  await sleep(1500);
  await steps.mark('séance arrêtée, pas relancée', { woStartHidden: false });

  const raw = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
  const log = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^\d\d:\d\d:\d\d\s+/, ''));
  const count = (re) => log.filter((l) => re.test(l)).length;
  if (count(/^premier coup de pédale : démarrage de la sortie$/) !== 1) steps.fail(`journal : « démarrage de la sortie » ${count(/^premier coup de pédale : démarrage de la sortie$/)} fois, attendu 1`);
  if (count(/^premier coup de pédale : démarrage de la séance$/) !== 1) steps.fail(`journal : « démarrage de la séance » ${count(/^premier coup de pédale : démarrage de la séance$/)} fois, attendu 1`);
  if (count(/^séance démarrée : /) !== 1) steps.fail(`journal : « séance démarrée » ${count(/^séance démarrée : /)} fois, attendu 1`);
  if (errors.length) steps.fail(`erreurs de la page : ${errors.join(' | ')}`);

  return { trace: { errors, steps: steps.list, log }, failures: steps.failures };
};
