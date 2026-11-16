// Réactivité du démarrage : plus longue tâche du thread principal pendant le chargement (en restant sur l'accueil),
// temps jusqu'à la vue 3D prête, puis plus longue tâche à la première ouverture de la Sortie. Deux lancements par adresse : le
// premier sur un profil vierge (rien en cache), le second dans le même profil (cache du navigateur rempli).
//
//   node tools/audit/startup.cjs [ralentissement CPU] <adresse>...
//   node tools/audit/startup.cjs 4 http://localhost:4173/ http://localhost:4174/
//
// Le blocage est la plus longue tâche du thread principal (API Long Tasks) : un clic ou un défilement attend sa fin.
// Pas de minuteur témoin : three.js rend la main par `scheduler.yield()`, dont la suite passe avant les minuteurs ; un
// minuteur compterait comme une seule attente une suite de tâches courtes entre lesquelles la page reste réactive.
const { chromium } = require('playwright');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const args = process.argv.slice(2);
const rate = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 4;

const PROBE = () => {
  window.__lt = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
};
// Laisse à l'observateur le temps de livrer la dernière tâche avant de lire.
const worstSince = (from) =>
  new Promise((resolve) =>
    setTimeout(() => resolve(Math.round(Math.max(0, ...window.__lt.filter((x) => x[0] >= from).map((x) => x[1])))), 300),
  );

(async () => {
  for (const url of args) {
    const profile = mkdtempSync(join(tmpdir(), 'startup-'));
    for (const run of ['froid', 'chaud']) {
      const ctx = await chromium.launchPersistentContext(profile, {
        viewport: { width: 1280, height: 800 },
        // WebGPU : AUDIT_WEBGPU=1 (sans GPU, Chromium l'émule en logiciel ; sinon le rendu passe en WebGL2).
        args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...(process.env.AUDIT_WEBGPU ? ['--enable-unsafe-webgpu'] : [])],
      });
      const p = ctx.pages()[0] ?? (await ctx.newPage());
      const c = await ctx.newCDPSession(p);
      await c.send('Emulation.setCPUThrottlingRate', { rate });
      await p.addInitScript(PROBE);
      await p.goto(url);
      await p.waitForFunction(() => document.getElementById('log')?.textContent.includes('rendu 3D'), null, { timeout: 180000, polling: 100 });
      await p.waitForTimeout(3000); // le portrait et les derniers travaux de fond
      const load = await p.evaluate(`(${worstSince})(0)`);
      const ready = await p.evaluate(() => {
        const line = document.getElementById('log').textContent.match(/rendu 3D[^\n]*/)?.[0] ?? '';
        return line.replace(/^.*rendu 3D : /, '');
      });
      const readyAt = await p.evaluate(() => Math.round(performance.getEntriesByType('mark').find((m) => m.name === 'view-ready')?.startTime ?? NaN));
      const t0 = await p.evaluate(() => { const t = performance.now(); location.hash = 'sortie'; return t; });
      await p.waitForTimeout(8000);
      const sortie = await p.evaluate(`(${worstSince})(${t0})`);
      console.log(`${url.padEnd(24)} ${run.padEnd(5)} | ${ready.padEnd(7)} | chargement : plus longue tâche ${String(load).padStart(5)} ms${Number.isFinite(readyAt) ? ` | vue prête à ${readyAt} ms` : ''} | ouverture de la Sortie : plus longue tâche ${String(sortie).padStart(5)} ms`);
      await ctx.close();
    }
  }
})();
