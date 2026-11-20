'use strict';
// Rouler avec d'autres (docs/design/groupe.md) : sur iPhone 13 en paysage plein écran, avec un compte connecté et une salle
// simulée où Lucie roule devant. Le coureur la suit depuis l'encart (« Suivre »), voit l'écart, est suivi à son tour par Marc
// et le renvoie, arrête, puis apprend que le coureur suivi est parti. Le réglage « me rejoindre » part à la salle.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, sleep, Steps } = require('../lib.cjs');

const METHODS = { strava: true, dev: false };
const USER = { id: 'u1', displayName: 'Tom L.', nameConfirmed: true };

/** Un instantané binaire de la salle (protocole : src/infra/net/protocol.ts) avec un seul coureur. */
function snapshot({ slot, edgeRank, forward, sM, speedMs, tMs }) {
  const buf = Buffer.alloc(2 + 20);
  buf[0] = 0x81;
  buf[1] = 1;
  buf.writeUInt16LE(slot, 2);
  buf[4] = (forward ? 1 : 0) | 8; // sens + « en sortie »
  buf.writeUInt16LE(edgeRank, 5);
  buf.writeUInt16LE(0xffff, 7);
  buf.writeUInt32LE(Math.round(sM * 100), 9);
  buf.writeUInt32LE(tMs >>> 0, 13);
  buf.writeUInt16LE(Math.round(speedMs * 100), 17);
  buf.writeUInt16LE(240, 19);
  buf[21] = 90;
  return buf;
}

module.exports = async function group({ playwright, browser, url }) {
  const context = await browser.newContext({
    ...playwright.devices['iPhone 13 landscape'],
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text()));
  await page.route('**/api/**', (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop();
    return r.fulfill({ status: name === 'me' ? 200 : 404, contentType: 'application/json', body: JSON.stringify(name === 'me' ? { user: USER, methods: METHODS } : {}) });
  });

  // Où Lucie roule : sur la route de départ du parcours, 150 m devant le départ (calculé avec le vrai réseau de la page).
  await page.goto(url, { waitUntil: 'load' });
  const start = await page.evaluate(async () => {
    const { COL_DES_ERABLES } = await import('/src/domain/course/courses/col-des-erables.ts');
    const { Journey } = await import('/src/domain/sim/journey.ts');
    const j = new Journey(COL_DES_ERABLES);
    const at = j.locate(0);
    return { edgeRank: [...COL_DES_ERABLES.edges.keys()].indexOf(at.edgeId), edgeId: at.edgeId, forward: at.forward, lengthM: COL_DES_ERABLES.edges.get(at.edgeId).lengthM };
  });
  // La route de départ doit être assez longue pour que Lucie y roule pendant le scénario.
  const aheadM = Math.min(150, start.lengthM / 3);
  const lucieS = (elapsedMs) => Math.min(start.lengthM - 5, aheadM + (elapsedMs / 1000) * 5);
  const toRoadS = (d) => (start.forward ? d : start.lengthM - d); // distance de marche → abscisse sur la route

  // La salle simulée : Lucie (numéro 2) roule à 5 m/s ; elle note ce que le client lui dit.
  const heard = [];
  const t0 = Date.now();
  let socket;
  let timer;
  await page.routeWebSocket(/\/api\/world\/ws/, (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ type: 'welcome', slot: 1, members: [{ slot: 1, name: 'Tom L.' }, { slot: 2, name: 'Lucie' }] }));
    timer = setInterval(() => {
      const elapsed = Date.now() - t0;
      ws.send(snapshot({ slot: 2, edgeRank: start.edgeRank, forward: start.forward, sM: toRoadS(lucieS(elapsed)), speedMs: 5, tMs: elapsed }));
    }, 250);
    ws.onMessage((m) => {
      if (typeof m !== 'string') return;
      const msg = JSON.parse(m);
      heard.push(msg);
      if (msg.type === 'follow' && msg.slot === 2) {
        ws.send(JSON.stringify({ type: 'followStart', slot: 2, name: 'Lucie', pos: { edgeId: start.edgeId, forward: start.forward, s: toRoadS(lucieS(Date.now() - t0)) } }));
      }
    });
    ws.onClose(() => clearInterval(timer));
  });
  await page.reload({ waitUntil: 'load' });
  await sleep(1500);

  const click = (id) => page.evaluate((id) => document.getElementById(id)?.click(), id);
  const shot = (name) => {
    const dir = path.join(ROOT, '.e2e');
    fs.mkdirSync(dir, { recursive: true });
    return page.screenshot({ path: path.join(dir, `group-${name}.png`), timeout: 40_000 });
  };
  const snap = (label) =>
    page.evaluate((label) => {
      const t = (id) => document.getElementById(id)?.innerText?.replace(/\s+/g, ' ').trim() ?? null;
      const follow = document.getElementById('follow');
      return {
        label,
        crowd: t('crowd'),
        followHidden: follow?.hidden ?? null,
        followText: follow && !follow.hidden ? t('follow') : '',
        followButtons: [...document.querySelectorAll('.rn-follow')].filter((b) => !b.hidden).map((b) => b.getAttribute('aria-label')),
        followedRows: [...document.querySelectorAll('.rn-followed .rn-name')].map((n) => n.textContent),
        joinable: document.getElementById('joinable-select')?.value ?? null,
      };
    }, label);
  const steps = new Steps(snap);
  const waitFor = async (fn, ms = 6000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await page.evaluate(fn)) return true;
      await sleep(150);
    }
    return false;
  };
  const last = (type) => heard.filter((m) => m.type === type).at(-1);

  await steps.mark('salle connectée', { crowd: /1 autre coureur/i, joinable: 'all' });

  // Trainer simulé, sortie libre ; l'encart ouvre sa liste (un toucher), Lucie y a son bouton « Suivre ».
  await click('connect-sim');
  await waitFor(() => document.getElementById('state')?.textContent === 'Connecté');
  await page.evaluate(() => (location.hash = '#sortie'));
  await sleep(500);
  await click('ride-toggle');
  await sleep(2500);
  await page.evaluate(() => document.querySelector('[data-tab="list"]')?.click());
  await waitFor(() => document.querySelector('.rn-follow'));
  await steps.mark('Lucie proche, bouton Suivre', (s) => (s.followButtons.some((b) => /Lucie/.test(b ?? '')) ? undefined : `pas de bouton Suivre pour Lucie : ${JSON.stringify(s.followButtons)}`));
  await shot('1-encart');

  await page.evaluate(() => document.querySelector('.rn-follow')?.click());
  await waitFor(() => /Suit Lucie/.test(document.getElementById('follow')?.innerText ?? ''));
  await steps.mark('Lucie suivie : écart affiché', (s) => {
    if (!/Suit Lucie · [+−]?\d+ m/.test(s.followText)) return `bandeau = ${JSON.stringify(s.followText)}`;
    if (!s.followedRows.includes('Lucie')) return 'la ligne de Lucie n’est pas marquée';
    if (s.followButtons.some((b) => /Lucie/.test(b ?? ''))) return 'Lucie garde son bouton Suivre';
    if (last('follow')?.slot !== 2) return 'la salle n’a pas reçu « follow »';
  });
  await shot('2-suivi');

  // Marc se met à suivre le coureur : le bandeau le dit, « Refuser » renvoie l'ordre à la salle.
  socket.send(JSON.stringify({ type: 'followedBy', slot: 3, name: 'Marc' }));
  await waitFor(() => /Marc te suit/.test(document.getElementById('follow')?.innerText ?? ''));
  await steps.mark('Marc le suit', (s) => (/Marc te suit/.test(s.followText) ? undefined : `bandeau = ${JSON.stringify(s.followText)}`));
  await shot('3-suiveur');
  await page.evaluate(() => [...document.querySelectorAll('.rf-btn')].find((b) => b.textContent === 'Refuser')?.click());
  await sleep(300);
  await steps.mark('Marc renvoyé', (s) => (last('refuse')?.slot === 3 && !/Marc/.test(s.followText) ? undefined : `refuse = ${JSON.stringify(last('refuse'))}, bandeau = ${JSON.stringify(s.followText)}`));

  // Arrêter de suivre.
  await page.evaluate(() => [...document.querySelectorAll('.rf-btn')].find((b) => b.textContent === 'Arrêter')?.click());
  await sleep(300);
  await steps.mark('suivi arrêté', (s) => {
    if (s.followText) return `bandeau = ${JSON.stringify(s.followText)}`;
    if (!last('unfollow')) return 'la salle n’a pas reçu « unfollow »';
    if (!s.followButtons.some((b) => /Lucie/.test(b ?? ''))) return 'Lucie n’a pas retrouvé son bouton Suivre';
  });

  // Elle est partie pendant le suivi : un message le dit, puis il s'efface.
  await page.evaluate(() => document.querySelector('.rn-follow')?.click());
  await waitFor(() => /Suit Lucie/.test(document.getElementById('follow')?.innerText ?? ''));
  socket.send(JSON.stringify({ type: 'followEnd', reason: 'left' }));
  await waitFor(() => /parti/.test(document.getElementById('follow')?.innerText ?? ''));
  await steps.mark('le coureur suivi est parti', (s) => (/Lucie est parti/.test(s.followText) ? undefined : `bandeau = ${JSON.stringify(s.followText)}`));
  await shot('4-fin');

  // Le réglage « me rejoindre » part à la salle.
  await page.evaluate(() => {
    const e = document.getElementById('joinable-select');
    e.value = 'friends';
    e.dispatchEvent(new Event('change'));
  });
  await sleep(300);
  await steps.mark('réglage : mes amis', (s) => (s.joinable === 'friends' && last('joinable')?.who === 'friends' ? undefined : `joinable = ${s.joinable}, salle = ${JSON.stringify(last('joinable'))}`));

  await click('ride-toggle');
  clearInterval(timer);
  // Bruit attendu : la synchronisation du compte (404 de la maquette) et la première connexion, avant la salle simulée.
  const real = errors.filter((e) => !/Failed to load resource|WebSocket connection/.test(e));
  if (real.length) steps.fail(`erreurs de la page : ${real.slice(0, 3).join(' | ')}`);
  return { trace: { steps: steps.list, heard }, failures: steps.failures };
};
