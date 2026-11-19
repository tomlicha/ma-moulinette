'use strict';
// Récapitulatif de fin de sortie et envoi à Strava, par l'aperçu `?recap=…` du serveur de dev (envoi simulé : rien ne part) :
// compte à rebours, envoi automatique, suspension par un geste (passer, FIT, nom), « Continuer » et Échap qui envoient tout de
// suite, Strava à connecter, envoi refusé puis réessayé, pas de relais Strava.
const { openPage, sleep, Steps } = require('../lib.cjs');

const KEYS = ['status', 'send', 'view', 'nameRow', 'skip', 'finish', 'count'];

module.exports = async function recap({ browser, url }) {
  const errors = [];
  const steps = [];
  const failures = [];
  const log = [];

  async function scene(mode, run) {
    const { page, errors: errs } = await openPage(browser, { viewport: { width: 1280, height: 800 } }, new URL(`?recap=${mode}`, url).href);
    await sleep(1500);
    const tick = (ms) => sleep(ms);
    const snapshot = (label) =>
      page.evaluate(
        ({ label, KEYS, mode }) => {
          const all = document.querySelectorAll('dialog.recap');
          const d = all[all.length - 1]; // le dernier : celui de l'aperçu (le premier est celui de l'application)
          const r = (k) => d?.querySelector(`[data-r="${k}"]`);
          const out = {
            label: `${mode || 'séance'} · ${label}`,
            open: d?.open ?? null,
            state: r('actions')?.dataset.state ?? null,
            sendLabel: r('sendLabel')?.textContent ?? null,
            sendDisabled: r('send')?.disabled ?? null,
            statusTitle: r('statusTitle')?.textContent ?? null,
            statusSub: r('statusSub')?.textContent ?? null,
            continueLabel: r('continueLabel')?.textContent ?? null,
            name: r('name')?.value ?? null,
            viewHref: r('view')?.getAttribute('href') ?? null,
            draining: r('drain')?.classList.contains('run') ?? null,
            badge: r('badge')?.innerHTML.length ?? null,
          };
          for (const k of KEYS) out[`hidden_${k}`] = r(k)?.hidden ?? null;
          return out;
        },
        { label, KEYS, mode },
      );
    const s = new Steps(snapshot);
    const click = (k) => page.evaluate((k) => [...document.querySelectorAll('dialog.recap')].at(-1)?.querySelector(`[data-r="${k}"]`)?.click(), k);
    /** Attend que le récapitulatif de l'aperçu soit dans cet état (la page, chargée de rendu 3D, tient mal les délais). */
    const until = async (state, ms = 60000) => {
      for (let i = 0; i < ms / 100; i++) {
        const now = await page.evaluate(() => [...document.querySelectorAll('dialog.recap')].at(-1)?.querySelector('[data-r="actions"]')?.dataset.state);
        if (now === state) return;
        await sleep(100);
      }
    };
    try {
      await run({ page, s, click, until, tick });
    } finally {
      steps.push(...s.list);
      failures.push(...s.failures);
      errors.push(...errs);
      await page.context().close();
    }
  }

  // Séance, Strava connecté : le compte à rebours part, puis l'envoi.
  await scene('', async ({ s, click, until, tick }) => {
    await s.mark('compte à rebours', { open: true, state: 'countdown', hidden_count: false, hidden_skip: false, draining: true });
    await tick(3000);
    await s.mark('3 s plus tard', { state: 'countdown' });
    await click('skip');
    await s.mark('« Ne pas envoyer » suspend', { state: 'manual', hidden_count: true, hidden_skip: true });
    await click('send');
    await s.mark('envoi demandé', { state: 'sending', sendDisabled: true, sendLabel: 'Envoi…' });
    await until('sent');
    await s.mark('envoyée', { state: 'sent', hidden_view: false, hidden_status: false });
  });

  // Sortie libre : modifier le nom suspend ; le FIT aussi.
  await scene('libre', async ({ page, s }) => {
    await s.mark('compte à rebours', { state: 'countdown' });
    await page.evaluate(() => {
      const n = [...document.querySelectorAll('dialog.recap')].at(-1).querySelector('[data-r="name"]');
      n.value = 'Ma sortie du soir';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await s.mark('nom modifié : suspendu', { state: 'manual', name: 'Ma sortie du soir' });
  });
  await scene('libre', async ({ s, click }) => {
    await s.mark('compte à rebours', { state: 'countdown' });
    await click('fit');
    await s.mark('FIT demandé : suspendu', { state: 'manual' });
  });

  // L'envoi automatique part tout seul au bout du compte à rebours.
  await scene('', async ({ s, until }) => {
    await until('sending');
    await until('sent');
    await s.mark('envoi automatique terminé', { state: 'sent' });
  });

  // « Continuer » pendant le compte à rebours : l'envoi part tout de suite, la boîte se ferme.
  await scene('', async ({ s, click, until, tick }) => {
    await tick(500);
    await click('continue');
    await s.mark('Continuer : la boîte se ferme', { open: false });
    await until('sent');
    await s.mark('l’envoi est parti', { state: 'sent' });
  });

  // Échap pendant le compte à rebours : pareil.
  await scene('', async ({ page, s, until, tick }) => {
    await tick(500);
    await page.keyboard.press('Escape');
    await s.mark('Échap : la boîte se ferme', { open: false });
    await until('sent');
    await s.mark('l’envoi est parti', { state: 'sent' });
  });

  // Strava à connecter : pas de compte à rebours, le bouton le dit.
  await scene('connexion', async ({ s, click, until }) => {
    await s.mark('Strava à connecter', { state: 'manual', sendLabel: 'Connecter Strava et envoyer', hidden_count: true });
    await click('send');
    await s.mark('envoi demandé', { state: 'sending' });
    await until('sent');
    await s.mark('envoyée', { state: 'sent' });
  });

  // Envoi refusé : l'erreur reste, « Réessayer » aussi.
  await scene('echec', async ({ s, click, until }) => {
    await s.mark('compte à rebours', { state: 'countdown' });
    await until('error');
    await s.mark('envoi refusé', { state: 'error', sendLabel: 'Réessayer', hidden_status: false });
    await click('send');
    await s.mark('nouvel essai', { state: 'sending' });
    await until('error');
    await s.mark('refusé de nouveau', { state: 'error', sendLabel: 'Réessayer' });
  });

  // Pas de relais Strava : rien à envoyer.
  await scene('aucun', async ({ s }) => {
    await s.mark('pas de relais', { state: 'none', hidden_send: true, hidden_count: true, hidden_finish: false });
  });

  if (errors.length) failures.push(`erreurs de la page : ${errors.join(' | ')}`);
  return { trace: { errors, steps, log }, failures };
};
