'use strict';
// Compte du joueur (pastille en haut à droite) contre un serveur de comptes simulé : visiteur, connexion Strava par la page
// web ou par l'app (Android), connexion de développement, nom à valider (refusé, erreur serveur, accepté), menu, déconnexion.
const { openPage, sleep, Steps } = require('../lib.cjs');

const METHODS = { strava: true, dev: true };

// Un élément « se voit » s'il a une taille, n'est ni caché ni transparent, et tient dans la fenêtre : c'est ce que perçoit le cycliste.
// (Une règle CSS qui met `display: none` sur le compte, ou le pousse hors de l'écran, passerait un simple « existe dans la page ».)
const VISIBLE = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return `${selector} : absent de la page`;
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  if (!r.width || !r.height || st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) return `${selector} : caché (${Math.round(r.width)} × ${Math.round(r.height)}, display ${st.display})`;
  if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
    return `${selector} : déborde de l'écran (${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)} pour ${innerWidth} × ${innerHeight})`;
  }
  return null;
};

module.exports = async function account({ playwright, browser, url }) {
  const steps = [];
  const failures = [];
  const errors = [];
  const log = [];

  async function scene(label, contextOptions, run) {
    const { page, errors: errs } = await openPage(browser, { viewport: { width: 1280, height: 800 }, ...contextOptions }, url);
    // Le serveur de comptes : un petit état, comme le vrai (session, nom).
    const server = { user: null };
    await page.route('**/api/auth/**', async (route) => {
      const req = route.request();
      const name = new URL(req.url()).pathname.split('/').pop();
      const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : {};
      const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (name === 'me') return json(200, { user: server.user, methods: METHODS });
      if (name === 'dev-login') {
        server.user = { id: 'u1', displayName: body.name, nameConfirmed: false };
        return json(200, { user: server.user });
      }
      if (name === 'profile') {
        const n = String(body.displayName ?? '').trim();
        if (!n) return json(400, { error: 'invalid_name' });
        if (n === 'boom') return json(500, {});
        server.user = { ...server.user, displayName: n, nameConfirmed: true };
        return json(200, { user: server.user });
      }
      if (name === 'logout') {
        server.user = null;
        return json(200, {});
      }
      return json(404, {});
    });
    // La salle temps réel n'est pas l'affaire de ce scénario : sa connexion est refusée aussitôt.
    await page.routeWebSocket(/\/api\/world\/ws/, (ws) => ws.close());
    await page.reload();
    await sleep(1200);

    const snapshot = (label) =>
      page.evaluate((label) => {
        const slots = [...document.querySelectorAll('.account')];
        const dialog = document.querySelector('dialog.name-dialog');
        const err = document.getElementById('name-error');
        return {
          label,
          slots: slots.length,
          hidden: slots.map((s) => s.hidden),
          classes: slots.map((s) => s.className),
          // Le texte seul : la pastille et le menu sont comparés par leur contenu visible.
          text: slots.map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
          stravaHref: document.querySelector('.strava-connect')?.getAttribute('href') ?? null,
          chipLabel: document.querySelector('.account-chip')?.getAttribute('aria-label') ?? null,
          menuOpen: document.querySelector('.account-menu') ? !document.querySelector('.account-menu').hidden : null,
          nameDialogOpen: dialog?.open ?? false,
          nameValue: document.getElementById('name-input')?.value ?? null,
          nameError: err && !err.hidden ? err.textContent : null,
          appTry: (() => {
            try {
              return localStorage.getItem('mm.stravaAppTry') ? 'oui' : 'non';
            } catch {
              return '?';
            }
          })(),
        };
      }, label);
    const s = new Steps(snapshot);
    const waitFor = async (fn, arg, ms = 5000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await page.evaluate(fn, arg)) return true;
        await sleep(100);
      }
      return false;
    };
    // Un clic sur le lien Strava ne doit pas quitter la page : on l'annule une fois les gestionnaires passés.
    await page.evaluate(() => document.addEventListener('click', (e) => e.target.closest?.('.strava-connect') && e.preventDefault()));
    try {
      await run({ page, s, sleep, waitFor });
    } finally {
      for (const x of s.list) steps.push({ ...x, label: `${label} · ${x.label}` });
      failures.push(...s.failures.map((f) => `${label} : ${f}`));
      // Les refus 400 et 500 du nom sont voulus : le navigateur les note en erreur de ressource.
      errors.push(...errs.filter((e) => !/Failed to load resource: the server responded with a status of (400|500)/.test(e)));
      const raw = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
      log.push(...raw.split('\n').filter((l) => /compte :/.test(l)).map((l) => `${label} · ${l.replace(/^\d\d:\d\d:\d\d\s+/, '')}`));
      await page.context().close();
    }
  }

  // Visiteur sur ordinateur : la connexion Strava passe par la page web, à chaque fois.
  await scene('ordinateur', {}, async ({ page, s }) => {
    await s.mark('visiteur', { slots: (n) => n >= 1, stravaHref: '/api/auth/login' });
    await page.evaluate(() => document.querySelector('.strava-connect').click());
    await s.mark('connexion par la page web', { stravaHref: '/api/auth/login', appTry: 'non' });
  });

  // Android : la première fois par l'app Strava, puis (essai récent sans session) par la page web.
  await scene(
    'Android',
    { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' },
    async ({ page, s }) => {
      await page.evaluate(() => document.querySelector('.strava-connect').click());
      await s.mark('premier essai : par l’app', { stravaHref: '/api/auth/login?via=app', appTry: 'oui' });
      await page.evaluate(() => document.querySelector('.strava-connect').click());
      await s.mark('essai récent : par la page web', { stravaHref: '/api/auth/login', appTry: 'non' });
    },
  );

  // Connexion de développement, nom à valider, menu, déconnexion.
  await scene('développement', {}, async ({ page, s, sleep, waitFor }) => {
    await page.evaluate(() => document.querySelector('.account-dev').click());
    await waitFor(() => document.querySelector('dialog.name-dialog')?.open);
    await s.mark('connecté : le nom est à valider', { nameDialogOpen: true, nameValue: 'Bloc test' });
    // Vide : refusé par le serveur, puis une erreur du serveur, puis accepté.
    await page.evaluate(() => {
      document.getElementById('name-input').value = '   ';
      document.getElementById('name-save').click();
    });
    await waitFor(() => !document.getElementById('name-error').hidden);
    await s.mark('nom vide refusé', { nameDialogOpen: true, nameError: (e) => /1 à 32/.test(e ?? '') });
    await page.evaluate(() => {
      document.getElementById('name-input').value = 'boom';
      document.getElementById('name-save').click();
    });
    await waitFor(() => /Enregistrement impossible/.test(document.getElementById('name-error').textContent) && !document.getElementById('name-error').hidden);
    await s.mark('erreur du serveur', { nameDialogOpen: true, nameError: (e) => /Enregistrement impossible/.test(e ?? '') });
    await page.evaluate(() => {
      document.getElementById('name-input').value = 'Tom L.';
      document.getElementById('name-save').click();
    });
    await waitFor(() => !document.querySelector('dialog.name-dialog').open);
    await sleep(300);
    await s.mark('nom accepté', { nameDialogOpen: false, chipLabel: 'Compte de Tom L.' });

    // Le menu : ouvrir, changer de nom (réouvre la boîte), refermer, se déconnecter.
    await page.evaluate(() => document.querySelector('.account-chip').click());
    await s.mark('menu ouvert', { menuOpen: true });
    await page.evaluate(() => document.querySelector('.account-menu [data-act="name"]').click());
    await waitFor(() => document.querySelector('dialog.name-dialog')?.open);
    await s.mark('changer de nom', { nameDialogOpen: true, nameValue: 'Tom L.', menuOpen: false });
    await page.evaluate(() => document.getElementById('name-later').click());
    await page.evaluate(() => document.querySelector('.account-chip').click());
    await page.evaluate(() => document.querySelector('.account-menu [data-act="logout"]').click());
    await waitFor(() => document.querySelector('.strava-connect'));
    await s.mark('déconnecté', { stravaHref: '/api/auth/login', nameDialogOpen: false });
  });

  // iPhone couché en plein écran (844 × 390, sans bordures) : sur chaque écran qui porte le compte, le bouton Strava et le menu
  // (Final Surge) restent à portée. Une règle de l'accueil pour téléphone les avait cachés : on regarde ce que l'écran montre.
  const phone = {
    ...playwright.devices['iPhone 13 landscape'],
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
  };
  await scene('iPhone couché', phone, async ({ page, s, sleep, waitFor }) => {
    const seen = async (label, selectors) => {
      for (const selector of selectors) {
        const problem = await page.evaluate(VISIBLE, selector);
        if (problem) s.fail(`« ${label} » : ${problem}`);
      }
    };
    const goTo = async (view) => {
      await page.evaluate((v) => (location.hash = `#${v}`), view);
      await waitFor((v) => !document.querySelector(`[data-view="${v}"]`).hidden, view);
      await sleep(300);
    };

    // Visiteur. Accueil et Appareils portent le bouton Strava. Sur Séances, le rail de 54 px n'a pas la place de le loger
    // (account.css : « sans compte, rien dans le rail ») : on s'y connecte depuis un autre écran, rien à vérifier ici.
    for (const view of ['accueil', 'appareils']) {
      await goTo(view);
      await seen(`${view}, visiteur : bouton Strava`, [`[data-view="${view}"] .account .strava-connect`]);
    }
    if (s.failures.length) return; // bouton caché : la suite de la scène n'aurait plus de sens

    // Connexion de développement (le bouton Strava mène hors de la page), puis le nom.
    await page.evaluate(() => document.querySelector('[data-view="appareils"] .account-dev').click());
    await waitFor(() => document.querySelector('dialog.name-dialog')?.open);
    await page.evaluate(() => {
      document.getElementById('name-input').value = 'Tom L.';
      document.getElementById('name-save').click();
    });
    await waitFor(() => !document.querySelector('dialog.name-dialog').open);
    await sleep(300);

    // Connecté : la pastille, puis le menu ouvert au toucher, entièrement dans l'écran, avec Final Surge.
    for (const view of ['accueil', 'appareils', 'seances']) {
      await goTo(view);
      const root = `[data-view="${view}"]`;
      await seen(`${view}, connecté : pastille du compte`, [`${root} .account .account-chip`]);
      if (s.failures.length) return; // pastille introuvable : inutile d'essayer de la toucher
      await page.locator(`${root} .account-chip`).tap();
      await sleep(300);
      await seen(`${view}, menu du compte ouvert`, [`${root} .account-menu`, `${root} .account-menu [data-act="final-surge"]`, `${root} .account-menu [data-act="logout"]`]);
      await page.keyboard.press('Escape');
    }
  });

  if (errors.length) failures.push(`erreurs de la page : ${errors.join(' | ')}`);
  return { trace: { errors, steps, log }, failures };
};
