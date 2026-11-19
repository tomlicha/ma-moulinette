'use strict';
// Outils communs des scénarios de bout en bout : serveur de dev, page pilotée, relevé des étapes.
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Playwright n'est pas une dépendance du projet (voir README.md) : on le charge à la demande. */
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    console.error('Playwright est absent. Installation : npm i --no-save playwright && npx playwright install chromium');
    process.exit(2);
  }
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Lance le serveur de dev Vite sur ce port ; `stop()` l'arrête. */
async function startServer(port) {
  // `vite/bin/vite.js` n'est pas dans les `exports` du paquet : on le désigne par son chemin.
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://localhost:${port}/`;
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    if (child.exitCode !== null) throw new Error(`Vite s'est arrêté (port ${port} déjà pris ?)`);
    if (await ping(url)) return { url, stop: () => child.kill() };
    await sleep(250);
  }
  child.kill();
  throw new Error('Vite ne répond pas');
}

/**
 * Ouvre la page dans un contexte neuf (stockage vide). Le serveur de comptes est simulé : visiteur déconnecté, comme en
 * ligne sans session. Les boîtes de dialogue sont acceptées et notées.
 */
async function openPage(browser, contextOptions, url) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text()));
  page.on('dialog', async (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    await (d.type() === 'prompt' ? d.accept('Bloc test') : d.accept());
  });
  await page.route('**/api/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, methods: { strava: true, dev: false } }) }),
  );
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, dialogs };
}

/**
 * Relevé des étapes d'un scénario. `mark(label, expect)` prend un instantané, le garde, et vérifie l'attente :
 * un objet `{ champ: valeur | RegExp | (valeur) => booléen }`, ou une fonction `(instantané, précédent, relevé) => message d'erreur | undefined`.
 */
class Steps {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.list = [];
    this.failures = [];
  }

  get last() {
    return this.list[this.list.length - 1];
  }

  byLabel(label) {
    return this.list.find((s) => s.label === label);
  }

  fail(message) {
    this.failures.push(message);
  }

  async mark(label, expect) {
    const previous = this.last;
    const snap = await this.snapshot(label);
    this.list.push(snap);
    if (!expect) return snap;
    if (typeof expect === 'function') {
      const problem = expect(snap, previous, this);
      if (problem) this.fail(`« ${label} » : ${problem}`);
      return snap;
    }
    for (const [key, want] of Object.entries(expect)) {
      const got = snap[key];
      const ok = want instanceof RegExp ? typeof got === 'string' && want.test(got) : typeof want === 'function' ? want(got) : got === want;
      if (!ok) this.fail(`« ${label} » : ${key} = ${JSON.stringify(got)}, attendu ${want instanceof RegExp ? want : typeof want === 'function' ? 'une valeur acceptée' : JSON.stringify(want)}`);
    }
    return snap;
  }
}

module.exports = { ROOT, sleep, loadPlaywright, startServer, openPage, Steps };
