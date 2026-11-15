/**
 * Captures de la page d'aperçu dans Chrome sans fenêtre, pilotées par le protocole DevTools : la photo est prise quand
 * la page a fini de construire sa scène (elle met alors son titre à « ready »), pas après un délai deviné.
 *
 *   node tools/preview/shoot.mjs <sortie.png> <requête> [largeur] [hauteur]
 *   node tools/preview/shoot.mjs --ref <dossier> [requête ajoutée à chaque vue]
 *
 * `--ref` prend les vues de référence du monde (`REFERENCE`), dans une seule session de Chrome : à relancer avant et
 * après un changement graphique pour comparer. Le serveur de dev doit tourner (`PORT`, 5199 par défaut).
 * `CHROME` donne le chemin de Chrome. `CLIP=x,y,largeur,hauteur,échelle` ne garde qu'une zone, agrandie.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Vues de référence : un point de chaque ambiance du réseau. */
export const REFERENCE = {
  '1-depart': 'shot=ride&d=150',
  '2-vallee': 'shot=ride&d=1200',
  '3-col': 'shot=ride&route=col&d=4400',
  '4-epingle': 'shot=ride&route=col&d=6200',
  '5-sommet': 'shot=ride&route=col&d=8950',
  '6-descente': 'shot=ride&route=col&d=11500',
  '7-pres': 'shot=ride&course=rive&d=4200',
  '8-canal': 'shot=ride&course=rive&d=6500',
  '9-rive': 'shot=ride&course=rive&d=5900',
  '10-village': 'shot=ride&course=rive&d=9080',
  '11-moulin': 'shot=ride&d=2330',
  '12-erables': 'shot=ride&route=col&d=3600',
};

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = process.env.PORT ?? '5199';
const READY_TIMEOUT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lance Chrome et renvoie l'adresse de son port DevTools, lue sur sa sortie d'erreur. */
function launch(profile) {
  const child = spawn(
    CHROME,
    ['--headless=new', '--enable-unsafe-webgpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = new Promise((resolve, reject) => {
    let buf = '';
    child.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf);
      if (m) resolve(m[1]);
    });
    child.on('exit', () => reject(new Error('Chrome s’est arrêté avant d’ouvrir son port DevTools')));
    setTimeout(() => reject(new Error('Chrome ne répond pas')), 30_000);
  });
  return { child, endpoint };
}

/** Session DevTools sur l'onglet ouvert : `send(méthode, paramètres)` et les erreurs de la page dans `errors`. */
async function attach(browserWs) {
  const httpBase = browserWs.replace(/^ws:/, 'http:').replace(/\/devtools\/.*$/, '');
  const targets = await (await fetch(`${httpBase}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('Connexion DevTools refusée'));
  });
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      waiting.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, errors, close: () => ws.close() };
}

async function shoot(session, out, query, width, height) {
  const { send, errors } = session;
  errors.length = 0;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${PORT}/tools/preview/index.html?${query}` });
  const t0 = Date.now();
  for (;;) {
    await sleep(200);
    let title = '';
    try {
      title = (await send('Runtime.evaluate', { expression: 'document.title' })).result.value;
    } catch {
      /* la page change de document : on réessaie */
    }
    if (title === 'ready') break;
    if (Date.now() - t0 > READY_TIMEOUT_MS) throw new Error(`« ${query} » : la page n’a pas fini en ${READY_TIMEOUT_MS / 1000} s. ${errors.join(' | ')}`);
  }
  // Quelques images de plus : les ombres et les lots d'instances sont à jour.
  await send('Runtime.evaluate', {
    expression: 'new Promise((r) => { let n = 6; const f = () => (--n ? requestAnimationFrame(f) : r(true)); requestAnimationFrame(f); })',
    awaitPromise: true,
  });
  const info = (await send('Runtime.evaluate', { expression: 'document.getElementById("info")?.textContent ?? ""' })).result.value;
  // `CLIP=x,y,largeur,hauteur,échelle` : ne garde qu'une zone de la page, agrandie (pour juger un détail).
  const clip = process.env.CLIP?.split(',').map(Number);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    ...(clip?.length === 5 ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: clip[4] } } : {}),
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`${out} · ${info}`);
  for (const e of errors) console.log(`  erreur de la page : ${e}`);
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage : shoot.mjs <sortie.png> <requête> [largeur] [hauteur]  |  shoot.mjs --ref <dossier> [requête ajoutée]');
  process.exit(2);
}
const jobs =
  args[0] === '--ref'
    ? Object.entries(REFERENCE).map(([name, q]) => ({ out: join(args[1] ?? 'captures', `${name}.png`), query: args[2] ? `${q}&${args[2]}` : q, w: 1600, h: 900 }))
    : [{ out: args[0], query: args[1] ?? '', w: Number(args[2] ?? 1600), h: Number(args[3] ?? 900) }];

const profile = mkdtempSync(join(tmpdir(), 'apercu-chrome-'));
const { child, endpoint } = launch(profile);
let failed = false;
try {
  const session = await attach(await endpoint);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  for (const j of jobs) {
    // Le serveur de dev recharge la page quand un fichier vient de changer : on reprend la vue, trois fois au plus.
    for (let attempt = 1; ; attempt++) {
      try {
        await shoot(session, j.out, j.query, j.w, j.h);
        break;
      } catch (e) {
        const msg = String(e.message ?? e);
        if (attempt < 3 && /navigated or closed|Execution context was destroyed|Cannot find context/.test(msg)) continue;
        failed = true;
        console.error(msg);
        break;
      }
    }
  }
  session.close();
} finally {
  child.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* Chrome tient encore un fichier : le dossier temporaire sera nettoyé par le système */
  }
}
process.exit(failed ? 1 : 0);
