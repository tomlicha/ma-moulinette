// Validation mobile : émule un téléphone en paysage (Chromium, écran tactile, zones sûres), prend des captures et mesure la
// lisibilité : taille réelle de chaque texte, cibles tactiles, chevauchements et débordements des panneaux.
// Usage (le serveur de dev doit tourner : `npm run dev`) :
//   node tools/mobile/check.mjs <url> <dossierSortie> <iphone13|pixel9> [--no-ride] [--course=<id>]
//   `--course=velodrome` : la sortie part sur ce parcours ; sur la piste, l'encart et sa touche de sortie, avant et après l'appui.
//   `--advance=<ms>` : temps virtuel roulé avant la capture de la sortie (300 000 par défaut) ; `--course=arc-en-ciel
//   --advance=115000` : dans l'ascenseur céleste.
//   node tools/mobile/summary.mjs <dossierSortie>
// Chrome : variable CHROME, sinon l'installation Windows habituelle. Limite : c'est Chromium, pas WebKit (iOS).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outDir, deviceName] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const DEVICES = {
  // CSS px en paysage ; zones sûres de l'iPhone 13 couché : encoche à gauche (47), barre d'accueil en bas (21).
  // `ios` : pas d'API plein écran (Safari iPhone), donc le guide d'installation s'affiche tant qu'on ne l'a pas passé.
  // `standalone` : application lancée depuis l'écran d'accueil (invite suivie) : plein écran, sans barres de Safari.
  'iphone13-pwa': {
    label: 'iPhone 13 installé (plein écran)', width: 844, height: 390, dpr: 3, ios: true, standalone: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    insets: { top: 0, bottom: 21, left: 47, right: 47 },
  },
  iphone13: {
    ios: true,
    label: 'iPhone 13', width: 844, height: 390, dpr: 3,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    insets: { top: 0, bottom: 21, left: 47, right: 47 },
  },
  // iPhone 13 dans Safari (pas en plein écran) : les barres du navigateur mangent de la hauteur. Valeurs usuelles en paysage.
  'iphone13-safari': {
    ios: true,
    label: 'iPhone 13 (Safari, barres visibles)', width: 844, height: 340, dpr: 3,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    insets: { top: 0, bottom: 0, left: 47, right: 47 },
  },
  'iphone13-safari-bas': {
    ios: true,
    label: 'iPhone 13 (Safari, barre du bas + haut)', width: 844, height: 300, dpr: 3,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    insets: { top: 0, bottom: 0, left: 47, right: 47 },
  },
  pixel9: {
    label: 'Pixel 9', width: 915, height: 412, dpr: 2.625,
    ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  },
};
const dev = DEVICES[deviceName];
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = { iphone13: 9335, pixel9: 9336, 'iphone13-safari': 9337, 'iphone13-safari-bas': 9338, 'iphone13-pwa': 9339 }[deviceName];
const proc = spawn(chrome, [
  '--headless=new', '--enable-unsafe-webgpu', '--hide-scrollbars', '--window-size=1280,900',
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chrome-mobile-'))}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* démarrage */ }
  await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) errors.push('EVAL ' + (r.result.exceptionDetails.exception?.description ?? 'erreur'));
  return r.result?.result?.value;
};
const shot = async (name) => writeFileSync(join(outDir, `${deviceName}-${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const advance = async (ms) => {
  await send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: ms });
  await new Promise((resolve) => {
    const h = (m) => { if (JSON.parse(m.data).method === 'Emulation.virtualTimeBudgetExpired') { ws.removeEventListener('message', h); resolve(); } };
    ws.addEventListener('message', h);
  });
};
const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);

/** Mesures exécutées dans la page : textes, cibles tactiles, panneaux. `scope` : sélecteur de la zone à examiner. */
const MEASURE = (scope) => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)}) ?? document.body;
  const W = innerWidth, H = innerHeight;
  const visible = (el) => el.checkVisibility ? el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) : true;
  const texts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    const t = n.textContent.trim();
    const el = n.parentElement;
    if (!t || !el || !visible(el) || el.closest('script,style,title')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) continue;
    let size;
    if (el instanceof SVGElement) {
      const ctm = el.getScreenCTM();
      size = parseFloat(getComputedStyle(el).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
    } else {
      // Échelle exacte : produit des transformations des ancêtres (le HUD est mis à l'échelle de la fenêtre).
      let scale = 1;
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const tf = getComputedStyle(a).transform;
        if (tf && tf !== 'none') { const m = new DOMMatrixReadOnly(tf); scale *= Math.hypot(m.a, m.b); }
      }
      size = parseFloat(getComputedStyle(el).fontSize) * scale;
    }
    if (size === 0) continue; // texte tracé par ::after (pastilles abrégées) : mesuré à part
    texts.push({ t: t.slice(0, 40), px: Math.round(size * 10) / 10, cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 40) || el.tagName.toLowerCase() });
  }
  const targets = [];
  for (const el of root.querySelectorAll('button, a[href], select, input, [role=radio]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right < 0 || r.left > W || r.bottom < 0 || r.top > H) continue;
    targets.push({ t: (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 36), w: Math.round(r.width), h: Math.round(r.height), id: el.id || el.className.toString().slice(0, 24) });
  }
  const panels = {};
  for (const sel of ['[data-view="sortie"]', '.ride', '.ride canvas', '.hud', '.hud-left', '.hud-center', '.hud-bottom', '.hud-junction', '.hud-message', '.ride-near', '.rn-exit', '#ride-menu-btn', '.ride-menu-btn', '.ride-quick', '.map-card', '.course-card', '.home-hero-body', '.home-nav', 'a.home-radar', '.home-workout']) {
    // Plusieurs écrans partagent des classes (ex. .home-nav) : on prend le premier élément visible, pas le premier du document.
    const el = [...document.querySelectorAll(sel)].find(visible);
    if (el) { const r = el.getBoundingClientRect(); if (r.width) panels[sel] = { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; }
  }
  return { viewport: { W, H }, coarse: matchMedia('(pointer: coarse)').matches, landscape: matchMedia('(orientation: landscape)').matches, phone: matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 600px)').matches, texts, targets, panels };
})()`;

const report = { device: dev.label, steps: {} };
const measure = async (name, scope) => { report.steps[name] = await evaluate(MEASURE(scope)); };

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setUserAgentOverride', { userAgent: dev.ua });
await send('Emulation.setDeviceMetricsOverride', {
  width: dev.width, height: dev.height, deviceScaleFactor: 2, mobile: true,
  screenOrientation: { angle: 90, type: 'landscapePrimary' },
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const insets = await send('Emulation.setSafeAreaInsetsOverride', { insets: dev.insets });
report.safeAreaApplied = !insets.error;
if (dev.ios) {
  // iOS n'a pas d'API plein écran ; installée, l'application voit `navigator.standalone` vrai.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;${dev.standalone ? ' Object.defineProperty(navigator, "standalone", { get: () => true });' : ''}`,
  });
}
if (dev.standalone) await send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
await send('Page.navigate', { url });
await sleep(5000);
// 0. Guide d'installation : visible sur iPhone tant qu'on n'a pas installé l'application ; on le mesure, puis on le passe.
if (await evaluate("!document.getElementById('install-hint').hidden")) {
  await shot('0-installation');
  await measure('installation', '#install-hint');
  await click('#install-skip'); await sleep(500);
}
report.installGuideShown = await evaluate("!document.getElementById('install-hint').hidden");
report.fsButtonVisible = await evaluate("(() => { const b = document.getElementById('fs-btn'); return !!b && !b.hidden && b.checkVisibility(); })()");

// Mode séance (--workout) : on lance une vraie séance, on attend le carrefour, on mesure le HUD de séance avec l'invite.
if (process.argv.includes('--workout')) {
  await click('#connect-sim'); await sleep(800);
  await evaluate(`document.querySelectorAll('.wo-item-head[data-wo]:not([data-wo=""])')[0].click()`);
  await sleep(600);
  await evaluate(`document.querySelector('.wo-start').click()`);
  await sleep(1500);
  let seen = false;
  for (let i = 0; i < 24 && !seen; i++) {
    await advance(30_000);
    await evaluate('1'); await sleep(300);
    seen = await evaluate("(() => { const j = document.querySelector('.hud-junction'); return !!j && !j.hidden; })()");
  }
  report.workoutMode = await evaluate("document.querySelector('.hud').dataset.mode");
  report.junctionSeen = seen;
  await shot('7-seance-carrefour');
  await measure('seance-carrefour', '.hud');
  await evaluate(`(() => { const m = document.querySelector('.hud-message'); m.hidden = false; m.textContent = 'Reste assis, cadence 90 : message de séance'; })()`);
  await sleep(300);
  await shot('8-seance-carrefour-et-message');
  await measure('seance-carrefour-message', '.hud');
  report.errors = errors;
  writeFileSync(join(outDir, `${deviceName}-rapport.json`), JSON.stringify(report, null, 1));
  ws.close(); proc.kill();
  console.log('terminé (séance)');
  process.exit(0);
}

// 1. Accueil.
await shot('1-accueil');
await measure('accueil', 'body');
// 2. Le menu du parcours n'existe plus : les parcours sont des vignettes (tools/mobile : panneau des séances à part).
await click('#connect-sim'); await sleep(800);
await shot('2-accueil-connecte');
// 3. L'autre parcours, puis la carte agrandie.
await evaluate(`document.getElementById('home-map-link').click()`); await sleep(1000);
await shot('4-carte');
await measure('carte', '#map-dialog');
await click('#map-close'); await sleep(400);
await click('[data-course="col"]'); await sleep(400);
const course = process.argv.find((a) => a.startsWith('--course='))?.slice('--course='.length);
if (course) { await click(`[data-course="${course}"]`); await sleep(400); }

if (course === 'velodrome' && !process.argv.includes('--no-ride')) {
  // 5. Vélodrome : on tourne ; l'encart porte la touche « Sortir du vélodrome », sans panneau « Carrefour ».
  await evaluate(`document.getElementById('home-ride').click()`);
  // La vue 3D se construit (plus lentement sans fenêtre) : on attend que l'écran de chargement s'efface.
  for (let i = 0; i < 120 && !(await evaluate("document.getElementById('ride-loading')?.hidden ?? true")); i++) await sleep(500);
  await advance(120_000);
  await evaluate('1'); await sleep(800);
  report.junctionShown = await evaluate("(() => { const j = document.querySelector('.hud-junction'); return !!j && !j.hidden; })()");
  report.exitLabel = await evaluate("document.querySelector('.rn-exit')?.textContent");
  await shot('5-piste');
  await measure('piste', '.ride');
  // 6. Appui : la sortie est programmée, la touche donne la distance de la porte.
  await click('.rn-exit'); await sleep(600);
  report.exitArmedLabel = await evaluate("document.querySelector('.rn-exit')?.textContent");
  await shot('6-piste-sortie');
  await measure('piste-sortie', '.ride');
} else if (!process.argv.includes('--no-ride')) {
  // 5. Sortie : « Partir », puis le carrefour annoncé.
  await evaluate(`document.getElementById('home-ride').click()`);
  await sleep(1500);
  const adv = process.argv.find((a) => a.startsWith('--advance='))?.slice('--advance='.length);
  // Avance précise : on laisse d'abord la vue finir de se construire, sinon la photo tombe sur l'écran de chargement.
  if (adv) for (let i = 0; i < 120 && !(await evaluate("document.getElementById('ride-loading')?.hidden ?? true")); i++) await sleep(500);
  await advance(Number(adv ?? 300_000));
  await evaluate('1'); await sleep(500); // laisse la page se redessiner après le saut de temps virtuel
  await shot('5-carrefour');
  report.canvas = await evaluate("(() => { const c = document.querySelector('.ride canvas'); return [c.width, c.height, c.clientWidth, c.clientHeight, devicePixelRatio, getComputedStyle(document.body).paddingLeft]; })()");
  await measure('carrefour', '.hud');
  // 6. Le pire cas : un message de séance affiché en même temps que le carrefour.
  await evaluate(`(() => { const m = document.querySelector('.hud-message'); m.hidden = false; m.textContent = 'Reste assis, cadence 90 : message de séance'; })()`);
  await sleep(300);
  await shot('6-carrefour-et-message');
  await measure('carrefour-message', '.hud');
}

report.errors = errors;
writeFileSync(join(outDir, `${deviceName}-rapport.json`), JSON.stringify(report, null, 1));
ws.close(); proc.kill();
console.log('terminé');
process.exit(0);
