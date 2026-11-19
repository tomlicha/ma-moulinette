'use strict';
// Perte du GPU : on coupe le contexte WebGL de la vue 3D (extension WEBGL_lose_context). L'application doit reprendre sur
// un canevas neuf, trois fois au plus, puis annoncer que la vue 3D est indisponible, sans plus rien casser.
const { openPage, sleep } = require('../lib.cjs');

module.exports = async function gpu({ browser, url }) {
  // `?renderer=webgl2` : WebGL2 dès le départ, pour que l'extension de perte existe (WebGPU n'en a pas).
  const { page, errors } = await openPage(browser, { viewport: { width: 1280, height: 800 } }, `${url}?renderer=webgl2`);
  const failures = [];
  const renderLines = async () =>
    page.evaluate(() =>
      (document.getElementById('log')?.textContent ?? '')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.replace(/^\d\d:\d\d:\d\d\s+/, ''))
        .filter((l) => l.startsWith('rendu 3D')),
    );
  async function waitFor(pred, ms = 20_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred(await renderLines())) return true;
      await sleep(200);
    }
    return false;
  }
  const overlay = () =>
    page.evaluate(() => ({
      hidden: document.getElementById('ride-loading')?.hidden,
      state: document.getElementById('ride-loading')?.dataset.state ?? null,
      canvases: document.querySelectorAll('canvas#view').length,
    }));
  const lose = () =>
    page.evaluate(() => {
      const gl = document.getElementById('view').getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!gl;
    });
  const built = (n) => (lines) => lines.filter((l) => l.startsWith('rendu 3D : WebGL2')).length >= n;

  // La construction se presse quand l'écran Sortie s'ouvre.
  await page.evaluate(() => (location.hash = '#sortie'));
  const steps = { overlays: [] };
  if (!(await waitFor(built(1)))) failures.push('la vue 3D ne s’est pas construite');
  await sleep(1000);
  steps.overlays.push(await overlay());
  for (let loss = 1; loss <= 3; loss++) {
    if (!(await lose())) failures.push(`perte ${loss} : pas de contexte WebGL2 à couper`);
    if (!(await waitFor(built(loss + 1)))) failures.push(`reprise ${loss} : la vue 3D ne s’est pas reconstruite`);
    await sleep(1000);
    steps.overlays.push(await overlay());
  }
  await lose(); // la quatrième dépasse le maximum
  if (!(await waitFor((l) => l.some((x) => x.startsWith('rendu 3D indisponible'))))) failures.push('la vue n’a pas été déclarée indisponible');
  steps.final = await overlay();
  steps.stats = await page.evaluate(() => document.getElementById('view-stats')?.textContent);

  const log = await renderLines();
  const expected = [
    /^rendu 3D : WebGL2 · qualité \w+$/,
    /^rendu 3D : GPU perdu \(.+\), reprise 1\/3$/,
    /^rendu 3D : WebGL2 · qualité \w+ · reprise n° 1$/,
    /^rendu 3D : GPU perdu \(.+\), reprise 2\/3$/,
    /^rendu 3D : WebGL2 · qualité \w+ · reprise n° 2$/,
    /^rendu 3D : GPU perdu \(.+\), reprise 3\/3$/,
    /^rendu 3D : WebGL2 · qualité \w+ · reprise n° 3$/,
    /^rendu 3D : GPU perdu \(.+\), reprise 4\/3$/,
    /^rendu 3D indisponible : GPU perdu trop souvent$/,
  ];
  if (log.length !== expected.length) failures.push(`journal : ${log.length} lignes « rendu 3D », ${expected.length} attendues : ${log.join(' | ')}`);
  expected.forEach((re, i) => {
    if (!re.test(log[i] ?? '')) failures.push(`journal ligne ${i + 1} : « ${log[i]} », attendu ${re}`);
  });
  for (const [i, o] of steps.overlays.entries()) {
    if (!o.hidden || o.state !== null || o.canvases !== 1) failures.push(`après la construction ${i + 1} : écran de chargement ${JSON.stringify(o)}, attendu masqué avec un seul canevas`);
  }
  if (steps.final.hidden || steps.final.state !== 'error') failures.push(`état final : ${JSON.stringify(steps.final)}, attendu l’écran d’erreur affiché`);
  if (steps.stats !== 'rendu 3D indisponible') failures.push(`statistiques : « ${steps.stats} »`);
  // three.js signale lui-même chaque perte par une erreur de console : seules celles-là sont normales.
  const unexpected = errors.filter((e) => !/WebGL Device Lost/.test(e));
  if (unexpected.length) failures.push(`erreurs de la page : ${unexpected.join(' | ')}`);

  return { trace: { errors, steps, log }, failures };
};
