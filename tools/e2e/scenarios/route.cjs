'use strict';
// Séance de groupe, carrefour (docs/design/groupe.md) : le créateur du groupe choisit la route, les autres la suivent.
// Le groupe est créé « en retard » (départ dans le passé) : la sortie rejoue la simulation d'un trait et arrive à 300 m du
// premier carrefour. Deux fois : d'abord en créateur (je choisis, mon choix part à la salle et me revient), puis en suiveur
// (les touches sont grisées, la route du créateur s'affiche). iPhone 13 en paysage, plein écran.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, sleep, Steps } = require('../lib.cjs');

const USER = { id: 'u1', displayName: 'Tom L.', nameConfirmed: true };
const METHODS = { strava: true, dev: false };

module.exports = async function route({ playwright, browser, url }) {
  const context = await browser.newContext({
    ...playwright.devices['iPhone 13 landscape'],
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text()));
  await page.route('**/api/**', (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop();
    return r.fulfill({ status: name === 'me' ? 200 : 404, contentType: 'application/json', body: JSON.stringify(name === 'me' ? { user: USER, methods: METHODS } : {}) });
  });
  await page.goto(url, { waitUntil: 'load' });

  /** Où est le premier carrefour, et combien de temps de groupe il faut pour arriver à 300 m de lui avec cette séance. */
  const plan = (workout, ref) =>
    page.evaluate(async ({ workout, ref }) => {
      const { COL_DES_ERABLES } = await import('/src/domain/course/courses/col-des-erables.ts');
      const { Journey } = await import('/src/domain/sim/journey.ts');
      const { Ride } = await import('/src/domain/sim/ride.ts');
      const { GroupPace, groupRider } = await import('/src/domain/group/group-pace.ts');
      const probe = new Journey(COL_DES_ERABLES);
      let junction;
      for (let d = 0; d < 20_000 && !junction; d += 5) {
        probe.update(d);
        const p = probe.pendingJunction(d);
        if (p) junction = { atM: p.atM, legIndex: p.legIndex, count: p.options.length, selected: p.selected };
      }
      const journey = new Journey(COL_DES_ERABLES);
      const ride = new Ride(journey, groupRider(ref));
      let t = 0;
      const pace = new GroupPace(workout, () => t, ref);
      while (t < 3_600_000 && ride.snapshot().distanceM < junction.atM - 300) {
        t += 1000;
        pace.advance(ride);
      }
      return { elapsedMs: t, junction };
    }, { workout, ref });

  // La salle simulée : un groupe est créé « en retard » ; le créateur est moi (numéro 1) ou Lucie (numéro 2).
  const heard = [];
  let leaderSlot = 1;
  let junction;
  let theirChoice = 0;
  let socket;
  await page.routeWebSocket(/\/api\/world\/ws/, (ws) => {
    socket = ws;
    const send = (m) => ws.send(JSON.stringify(m));
    send({ type: 'welcome', slot: 1, members: [{ slot: 1, name: 'Tom L.' }, { slot: 2, name: 'Lucie' }] });
    ws.onMessage(async (raw) => {
      if (typeof raw !== 'string') return;
      const msg = JSON.parse(raw);
      heard.push(msg);
      if (msg.type === 'time') send({ type: 'time', c: msg.c, s: Date.now() });
      if (msg.type === 'who') send({ type: 'who', riders: [], groups: [], total: 0 });
      if (msg.type === 'groupCreate') {
        let p;
        try {
          p = await plan(msg.workout, { ftpW: msg.ftpW, massKg: msg.massKg });
        } catch (e) {
          heard.push({ type: 'plan-error', message: String(e) });
          return;
        }
        junction = p.junction;
        const members = leaderSlot === 1 ? [{ slot: 1, name: 'Tom L.' }] : [{ slot: 1, name: 'Tom L.' }, { slot: 2, name: 'Lucie' }];
        send({ type: 'groupState', group: { id: 'g1', name: 'Séance', workout: msg.workout, courseId: msg.courseId, t0: Date.now() - p.elapsedMs, members, ftpW: msg.ftpW, massKg: msg.massKg, leader: leaderSlot, routes: [] } });
        if (leaderSlot === 2) {
          // Lucie choisit une route qui n'est pas celle par défaut, un peu après le départ.
          theirChoice = [...Array(p.junction.count).keys()].find((i) => i !== p.junction.selected);
          setTimeout(() => send({ type: 'groupRoute', leg: p.junction.legIndex, index: theirChoice }), 1500);
        }
      }
      if (msg.type === 'groupRoute') send({ type: 'groupRoute', leg: msg.leg, index: msg.index }); // la salle renvoie le choix à tous
    });
  });
  await page.reload({ waitUntil: 'load' });
  await sleep(1500);

  const click = (id) => page.evaluate((id) => document.getElementById(id)?.click(), id);
  const shot = (name) => {
    const dir = path.join(ROOT, '.e2e');
    fs.mkdirSync(dir, { recursive: true });
    return page.screenshot({ path: path.join(dir, `route-${name}.png`), timeout: 40_000 });
  };
  const waitFor = async (fn, ms = 15_000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await page.evaluate(fn)) return true;
      await sleep(150);
    }
    return false;
  };
  const snap = (label) =>
    page.evaluate((label) => {
      const panel = document.querySelector('[data-h="junction"]');
      const opts = [...(panel?.querySelectorAll('.hud-junction-opt') ?? [])];
      return {
        label,
        hash: location.hash,
        shown: panel ? !panel.hidden : false,
        hint: panel?.querySelector('[data-role="hint"]')?.textContent ?? null,
        disabled: opts.map((b) => b.disabled),
        selected: opts.findIndex((b) => b.classList.contains('on')),
        count: opts.length,
      };
    }, label);
  const steps = new Steps(snap);
  const last = (type) => heard.filter((m) => m.type === type).at(-1);

  // Séance choisie, trainer simulé, puis créer le groupe depuis le panneau.
  await click('connect-sim');
  await waitFor(() => document.getElementById('state')?.textContent === 'Connecté');
  await page.evaluate(() => document.querySelector('[data-wo="sample:sweet-spot"]')?.click());
  await sleep(300);

  async function startGroup() {
    await click('home-online-chip');
    await waitFor(() => document.querySelector('[data-o="create"]') && !document.querySelector('[data-o="create"]').disabled);
    await page.evaluate(() => document.querySelector('[data-o="create"]')?.click());
    await waitFor(() => location.hash === '#sortie', 12_000);
    await waitFor(() => {
      const p = document.querySelector('[data-h="junction"]');
      return p && !p.hidden;
    }, 40_000);
    await sleep(500);
  }

  // 1. Je suis le créateur : je choisis.
  leaderSlot = 1;
  await startGroup();
  await steps.mark('créateur : le carrefour est annoncé, les touches sont ouvertes', (s) => {
    if (!s.shown) return 'le panneau du carrefour n’est pas affiché';
    if (!/Tu choisis pour le groupe/.test(s.hint ?? '')) return `indication = ${s.hint}`;
    if (s.disabled.some(Boolean)) return `touches grisées : ${s.disabled}`;
  });
  await shot('1-createur');
  if (!junction) throw new Error('la salle n’a pas reçu la création du groupe : ' + JSON.stringify(heard.map((m) => m.type + (m.message ? ' ' + m.message : ''))) + ' ' + errors.slice(0, 3).join(' | '));
  const pick = [...Array(junction.count).keys()].find((i) => i !== junction.selected);
  await page.evaluate((i) => document.querySelectorAll('.hud-junction-opt')[i]?.click(), pick);
  await waitFor((p) => document.querySelectorAll('.hud-junction-opt')[p]?.classList.contains('on'), 5000).catch(() => false);
  await sleep(600);
  await steps.mark('créateur : mon choix est parti à la salle, et me revient', (s) => {
    const sent = last('groupRoute');
    if (!sent || sent.leg !== junction.legIndex || sent.index !== pick) return `salle = ${JSON.stringify(sent)}, attendu leg ${junction.legIndex} option ${pick}`;
    if (s.selected !== pick) return `route retenue = ${s.selected}, attendu ${pick}`;
  });
  await click('wo-stop');
  await sleep(600);
  await click('ride-toggle');
  await sleep(600);
  await page.evaluate(() => (location.hash = '#accueil'));
  await sleep(600);
  await page.evaluate(() => document.querySelector('[data-wo="sample:sweet-spot"]')?.click());
  await sleep(300);

  // 2. Lucie est la créatrice : je suis sa route.
  leaderSlot = 2;
  await startGroup();
  await waitFor((c) => document.querySelectorAll('.hud-junction-opt')[c]?.classList.contains('on'), 8000).catch(() => false);
  await sleep(2500);
  await steps.mark('suiveur : touches grisées, la route de Lucie est retenue', (s) => {
    if (!s.shown) return 'le panneau du carrefour n’est pas affiché';
    if (!/Le créateur du groupe choisit/.test(s.hint ?? '')) return `indication = ${s.hint}`;
    if (!s.disabled.every(Boolean)) return `touches ouvertes : ${s.disabled}`;
    if (s.selected !== theirChoice) return `route retenue = ${s.selected}, attendu ${theirChoice} (choix de Lucie)`;
  });
  await shot('2-suiveur');
  await click('wo-stop');
  await sleep(500);
  await click('ride-toggle');
  clearInterval(undefined);
  const real = errors.filter((e) => !/Failed to load resource|WebSocket connection/.test(e));
  if (real.length) steps.fail(`erreurs de la page : ${real.slice(0, 3).join(' | ')}`);
  void socket;
  return { trace: { steps: steps.list, heard: heard.map((m) => m.type), junction }, failures: steps.failures };
};
