'use strict';
// Démarrage : la composition (src/composition/) s'exécute en entier, sur ordinateur et sur iPhone en paysage, sans erreur
// de la page, et l'accueil est affiché dans son état de départ. Une lecture trop précoce d'un objet d'un autre module de
// composition (un `w.x` encore vide) se voit ici, à chaque poussée, avant tout autre scénario.
const { openPage, sleep, Steps } = require('../lib.cjs');

const PROFILES = (devices) => [
  { name: 'ordinateur', options: { viewport: { width: 1280, height: 800 } } },
  // Plein écran de l'iPhone 13 en paysage, jamais la fenêtre réduite de Safari (CLAUDE.md).
  { name: 'iPhone 13 paysage', options: { ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } } },
];

module.exports = async function boot({ playwright, browser, url }) {
  const steps = [];
  const failures = [];
  const errors = [];
  for (const profile of PROFILES(playwright.devices)) {
    const { page, errors: errs } = await openPage(browser, profile.options, url);
    await sleep(2500);
    const s = new Steps((label) =>
      page.evaluate(
        (label) => {
          const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
          const visible = (id) => {
            const e = document.getElementById(id);
            return !!e && e.getClientRects().length > 0;
          };
          return {
            label,
            state: t('state'),
            ride: t('ride-toggle'),
            homeVisible: visible('home-ride'),
            connectSim: !!document.getElementById('connect-sim'),
            hash: location.hash,
          };
        },
        label,
      ),
    );
    await s.mark(`${profile.name} : accueil au démarrage`, { state: 'Non connecté', ride: 'Démarrer la sortie', homeVisible: true, connectSim: true });
    // Chaque écran s'ouvre sans erreur : leurs vues sont toutes créées au démarrage.
    for (const hash of ['#appareils', '#seances', '#sortie', '#accueil']) {
      await page.evaluate((h) => (location.hash = h), hash);
      await sleep(400);
      await s.mark(`${profile.name} : ${hash}`, { hash });
    }
    steps.push(...s.list);
    failures.push(...s.failures);
    errors.push(...errs);
    await page.context().close();
  }
  if (errors.length) failures.push(`erreurs de la page : ${errors.join(' | ')}`);
  return { trace: { errors, steps, log: [] }, failures };
};
