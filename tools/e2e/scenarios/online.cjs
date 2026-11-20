'use strict';
// Rouler avec d'autres, côté accueil (docs/design/groupe.md) : sur iPhone 13 en paysage plein écran, compte connecté, salle
// simulée. La pastille « En ligne », le panneau (coureurs, recherche, groupes), rejoindre un coureur en sortie, créer une
// séance de groupe, la salle d'attente, le départ commun, la séance verrouillée (ni pause ni palier), quitter le groupe.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, sleep, Steps } = require('../lib.cjs');

const USER = { id: 'u1', displayName: 'Tom L.', nameConfirmed: true };
const METHODS = { strava: true, dev: false };

module.exports = async function online({ playwright, browser, url }) {
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

  // La route de départ du vrai réseau : Lucie y roule devant le départ.
  await page.goto(url, { waitUntil: 'load' });
  const start = await page.evaluate(async () => {
    const { COL_DES_ERABLES } = await import('/src/domain/course/courses/col-des-erables.ts');
    const { Journey } = await import('/src/domain/sim/journey.ts');
    const at = new Journey(COL_DES_ERABLES).locate(0);
    return { edgeRank: [...COL_DES_ERABLES.edges.keys()].indexOf(at.edgeId), edgeId: at.edgeId, forward: at.forward, lengthM: COL_DES_ERABLES.edges.get(at.edgeId).lengthM };
  });
  const aheadM = Math.min(150, start.lengthM / 3);
  const toRoadS = (d) => (start.forward ? d : start.lengthM - d);
  const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  // La salle simulée : Lucie roule (numéro 2), Marc est au repos (numéro 3), un groupe est déjà ouvert.
  const heard = [];
  const t0 = Date.now();
  let socket;
  let timer;
  const riders = [
    { slot: 2, name: 'Lucie', riding: true },
    { slot: 3, name: 'Marc', riding: false },
  ];
  await page.routeWebSocket(/\/api\/world\/ws/, (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ type: 'welcome', slot: 1, members: [{ slot: 1, name: 'Tom L.' }, ...riders.map(({ slot, name }) => ({ slot, name }))] }));
    timer = setInterval(() => {
      const buf = Buffer.alloc(22);
      buf[0] = 0x81;
      buf[1] = 1;
      buf.writeUInt16LE(2, 2);
      buf[4] = (start.forward ? 1 : 0) | 8;
      buf.writeUInt16LE(start.edgeRank, 5);
      buf.writeUInt16LE(0xffff, 7);
      buf.writeUInt32LE(Math.round(toRoadS(aheadM + ((Date.now() - t0) / 1000) * 4) * 100), 9);
      buf.writeUInt32LE((Date.now() - t0) >>> 0, 13);
      buf.writeUInt16LE(400, 17);
      buf.writeUInt16LE(230, 19);
      buf[21] = 90;
      ws.send(buf);
    }, 250);
    ws.onClose(() => clearInterval(timer));
    ws.onMessage((raw) => {
      if (typeof raw !== 'string') return;
      const msg = JSON.parse(raw);
      heard.push(msg);
      const send = (m) => ws.send(JSON.stringify(m));
      if (msg.type === 'time') send({ type: 'time', c: msg.c, s: Date.now() });
      if (msg.type === 'who') {
        const q = fold(msg.q ?? '');
        send({
          type: 'who',
          riders: riders.filter((r) => !q || fold(r.name).includes(q)),
          groups: [{ id: 'g9', name: 'Séance de Lucie', workoutName: 'Sweet spot', courseId: 'col', t0: Date.now() + 120_000, durationS: 1500, count: 1 }],
          total: riders.length,
        });
      }
      if (msg.type === 'follow' && msg.slot === 2) {
        send({ type: 'followStart', slot: 2, name: 'Lucie', pos: { edgeId: start.edgeId, forward: start.forward, s: toRoadS(aheadM) } });
      }
      if (msg.type === 'groupCreate') {
        // Le départ est dans 4 s (la vraie salle borne à 30 s au moins : ici, on veut un scénario court).
        send({ type: 'groupState', group: { id: 'g1', name: 'Séance de Tom L.', workout: msg.workout, courseId: msg.courseId, t0: Date.now() + 4000, members: [{ slot: 1, name: 'Tom L.' }], ftpW: msg.ftpW, massKg: msg.massKg, leader: 1, routes: [] } });
        setTimeout(() => send({ type: 'groupMembers', id: 'g1', leader: 1, members: [{ slot: 1, name: 'Tom L.' }, { slot: 2, name: 'Lucie' }] }), 1000);
      }
    });
  });
  await page.reload({ waitUntil: 'load' });
  await sleep(1500);

  const click = (id) => page.evaluate((id) => document.getElementById(id)?.click(), id);
  const shot = (name) => {
    const dir = path.join(ROOT, '.e2e');
    fs.mkdirSync(dir, { recursive: true });
    return page.screenshot({ path: path.join(dir, `online-${name}.png`), timeout: 40_000 });
  };
  const waitFor = async (fn, ms = 8000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await page.evaluate(fn)) return true;
      await sleep(150);
    }
    return false;
  };
  const last = (type) => heard.filter((m) => m.type === type).at(-1);
  const snap = (label) =>
    page.evaluate((label) => {
      const t = (sel) => document.querySelector(sel)?.innerText?.replace(/\s+/g, ' ').trim() ?? null;
      const chip = document.getElementById('home-online-chip');
      const panel = document.getElementById('online-panel');
      return {
        label,
        hash: location.hash,
        chipHidden: chip?.hidden ?? null,
        chipCount: chip?.querySelector('.online-count')?.textContent ?? null,
        panelOpen: panel?.open ?? false,
        riders: [...document.querySelectorAll('[data-o="riders"] .op-who')].map((n) => n.textContent),
        joinRiders: [...document.querySelectorAll('[data-o="riders"] .op-btn')].map((b) => b.getAttribute('aria-label')),
        groups: [...document.querySelectorAll('[data-o="groups"] .op-group')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
        block: t('[data-o="block"]:not([hidden])'),
        lobbyHidden: document.querySelector('[data-o="lobby"]')?.hidden ?? null,
        lobbyCount: t('[data-o="lobby-count"]'),
        lobbyMembers: [...document.querySelectorAll('[data-o="lobby-members"] li')].map((n) => n.textContent),
        planText: t('[data-o="plan"]'),
        createDisabled: document.querySelector('[data-o="create"]')?.disabled ?? null,
        crowd: t('#crowd'),
        stopLabel: document.getElementById('wo-stop')?.textContent ?? null,
        pauseHidden: document.getElementById('wo-pause')?.hidden ?? null,
        skipHidden: document.getElementById('wo-skip')?.hidden ?? null,
        follow: t('#follow'),
      };
    }, label);
  const steps = new Steps(snap);

  await waitFor(() => document.getElementById('home-online-chip')?.hidden === false);
  await steps.mark('pastille « En ligne » : deux autres coureurs', { chipHidden: false, chipCount: '2' });

  // Sans trainer, rejoindre est bloqué avec la raison dite.
  await click('home-online-chip');
  await waitFor(() => document.querySelectorAll('[data-o="riders"] .op-who').length === 2);
  await steps.mark('panneau ouvert, sans trainer', (s) => {
    if (!s.panelOpen) return 'le panneau est fermé';
    if (s.riders.join() !== 'Lucie,Marc') return `coureurs = ${s.riders}`;
    if (!/home trainer/.test(s.block ?? '')) return `raison = ${s.block}`;
    if (!/Sweet spot · Col des Érables · 25 min · départ dans/.test(s.groups[0] ?? '')) return `groupe = ${s.groups[0]}`;
    if (s.joinRiders.length !== 1) return `un seul « Rejoindre » attendu (Lucie roule, Marc non) : ${s.joinRiders}`;
  });
  await shot('1-panneau');

  // La recherche ne tient compte ni des accents ni des majuscules.
  await page.fill('[data-o="q"]', 'MAR');
  await waitFor(() => document.querySelectorAll('[data-o="riders"] .op-who').length === 1);
  await steps.mark('recherche « MAR »', (s) => (s.riders.join() === 'Marc' ? undefined : `coureurs = ${s.riders}`));
  await page.fill('[data-o="q"]', '');
  await waitFor(() => document.querySelectorAll('[data-o="riders"] .op-who').length === 2);
  await page.evaluate(() => document.querySelector('.op-close')?.click());
  await sleep(300);

  // Trainer simulé : « Rejoindre » Lucie ouvre la sortie, 10 m derrière elle.
  await click('connect-sim');
  await waitFor(() => document.getElementById('state')?.textContent === 'Connecté');
  await click('home-online-chip');
  await waitFor(() => document.querySelector('[data-o="riders"] .op-btn') && !document.querySelector('[data-o="riders"] .op-btn').disabled);
  await steps.mark('panneau ouvert, trainer connecté', (s) => (s.block ? `raison = ${s.block}` : undefined));
  await page.evaluate(() => document.querySelector('[data-o="riders"] .op-btn')?.click());
  await waitFor(() => location.hash === '#sortie');
  await sleep(2500);
  await steps.mark('Lucie rejointe : la sortie est ouverte et suit Lucie', (s) => {
    if (s.hash !== '#sortie') return `écran = ${s.hash}`;
    if (!/Suit Lucie/.test(s.follow ?? '')) return `suivi = ${JSON.stringify(s.follow)}`;
    if (last('follow')?.slot !== 2) return 'la salle n’a pas reçu « follow »';
  });
  await shot('2-rejoint');
  await click('ride-toggle'); // arrête la sortie
  await sleep(500);
  await page.evaluate(() => (location.hash = '#accueil'));
  await sleep(500);

  // Une séance choisie, puis créée en groupe : salle d'attente, départ commun.
  await page.evaluate(() => document.querySelector('[data-wo="sample:sweet-spot"]')?.click());
  await sleep(300);
  await click('home-online-chip');
  await waitFor(() => !document.querySelector('[data-o="create"]')?.disabled);
  await steps.mark('créer : séance choisie', (s) => (/sweet spot · Col des Érables/i.test(s.planText ?? '') && !s.createDisabled ? undefined : `plan = ${s.planText}, bouton désactivé = ${s.createDisabled}`));
  await page.evaluate(() => document.querySelector('[data-o="create"]')?.click());
  await waitFor(() => !document.querySelector('[data-o="lobby"]')?.hidden);
  await sleep(1300);
  await steps.mark('salle d’attente', (s) => {
    if (s.lobbyHidden !== false) return 'la salle d’attente est cachée';
    if (!/Départ dans/.test(s.lobbyCount ?? '')) return `décompte = ${s.lobbyCount}`;
    if (s.lobbyMembers.join() !== 'Tom L.,Lucie') return `membres = ${s.lobbyMembers}`;
    const created = last('groupCreate');
    if (!/sweet spot/i.test(created?.workout?.name ?? '') || created?.courseId !== 'col') return `création = ${JSON.stringify(created && { w: created.workout?.name, c: created.courseId })}`;
  });
  await shot('3-attente');

  // Au départ : la sortie s'ouvre, la séance tourne avec l'horloge du groupe, sans pause ni palier suivant.
  await waitFor(() => location.hash === '#sortie', 9000);
  await sleep(2500);
  await steps.mark('départ du groupe : séance verrouillée', (s) => {
    if (s.hash !== '#sortie') return `écran = ${s.hash}`;
    if (!/Séance de groupe · 2 coureurs/.test(s.crowd ?? '')) return `pastille = ${s.crowd}`;
    if (s.pauseHidden !== true || s.skipHidden !== true) return `pause cachée = ${s.pauseHidden}, palier cachée = ${s.skipHidden}`;
    if (!/Quitter/.test(s.stopLabel ?? '')) return `bouton = ${s.stopLabel}`;
  });
  await shot('4-groupe');

  // Quitter le groupe : la salle le sait, la pastille redevient celle de la salle, la sortie redevient libre.
  await page.evaluate(() => document.getElementById('wo-stop')?.click());
  await sleep(600);
  await steps.mark('groupe quitté', (s) => {
    if (!last('groupLeave')) return 'la salle n’a pas reçu « groupLeave »';
    if (/Séance de groupe/.test(s.crowd ?? '')) return `pastille = ${s.crowd}`;
    if (/Quitter/.test(s.stopLabel ?? '')) return `bouton = ${s.stopLabel}`;
  });

  await click('ride-toggle');
  clearInterval(timer);
  const real = errors.filter((e) => !/Failed to load resource|WebSocket connection/.test(e));
  if (real.length) steps.fail(`erreurs de la page : ${real.slice(0, 3).join(' | ')}`);
  return { trace: { steps: steps.list, heard: heard.map((m) => m.type) }, failures: steps.failures };
};
