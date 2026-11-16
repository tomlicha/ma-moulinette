const { chromium, devices } = require('playwright');
const fs = require('fs'); const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const OUT = process.argv[2]; const URL = process.env.AUDIT_URL ?? 'http://localhost:4173/';
const ONLY = process.argv[4]; const PROFILES0 = [
  { name: 'desktop-1280x800', ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  { name: 'desktop-1920x1080', ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 } },
  { name: 'laptop-1024x640', ctx: { viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 } },
  { name: 'pixel7-paysage', ctx: devices['Pixel 7 landscape'] },
  { name: 'iphone13-paysage', ctx: { ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } } },
  { name: 'iphone13-portrait', ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } } },
  { name: 'ipad-paysage', ctx: devices['iPad (gen 7) landscape'] },
];
const PROFILES = ONLY ? PROFILES0.filter(p => p.name.startsWith(ONLY)) : PROFILES0;
const SCREENS = ['accueil', 'appareils', 'seances', 'sortie'];
const MEASURE = () => {
  const W = innerWidth, H = innerHeight;
  const vis = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const small = []; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) { const t = n.textContent.trim(); const el = n.parentElement; if (!t || !el || !vis(el)) continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) continue;
    let s = 1; for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const tf = getComputedStyle(a).transform; if (tf && tf !== 'none') { const m = new DOMMatrixReadOnly(tf); s *= Math.hypot(m.a, m.b); } }
    const px = parseFloat(getComputedStyle(el).fontSize) * s; if (px && px < 12) small.push({ t: t.slice(0, 30), px: +px.toFixed(1) }); }
  const tiny = []; let targets = 0;
  for (const el of document.querySelectorAll('button, a[href], select, input:not([type=hidden]), [role=radio], [role=button], [role=slider]')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (!r.width || r.right < 0 || r.left > W || r.bottom < 0 || r.top > H) continue; targets++;
    if (r.width < 24 || r.height < 24) tiny.push({ t: (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }); }
  const under44 = [...document.querySelectorAll('button, a[href], select, input:not([type=hidden]), [role=radio], [role=button]')].filter(el => { if (!vis(el)) return false; const r = el.getBoundingClientRect(); return r.width && r.left < W && r.top < H && r.bottom > 0 && (r.width < 44 || r.height < 44); }).length;
  const de = document.documentElement;
  return { W, H, overflowX: de.scrollWidth > W + 1 ? de.scrollWidth - W : 0, overflowY: de.scrollHeight > H + 1 ? de.scrollHeight - H : 0,
    smallText: small, tinyTargets: tiny, targets, under44, domNodes: document.getElementsByTagName('*').length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    rotateHint: !document.getElementById('rotate-hint')?.hidden, installHint: !document.getElementById('install-hint')?.hidden,
    stats: document.getElementById('view-stats')?.textContent ?? '' };
};
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-unsafe-webgpu'] });
  const report = {};
  for (const prof of PROFILES) {
    const ctx = await b.newContext({ ...prof.ctx, locale: 'fr-FR' }); const p = await ctx.newPage();
    const errors = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`); }); p.on('pageerror', e => errors.push('[pageerror] ' + e.message.slice(0, 200)));
    const t0 = Date.now(); await p.goto(URL, { waitUntil: 'load' }); const loadMs = Date.now() - t0;
    await p.waitForTimeout(7000);
    const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null }; });
    report[prof.name] = { nav, screens: {} };
    for (const s of SCREENS) {
      await p.evaluate(v => { location.hash = v; }, s); await p.waitForTimeout(s === 'sortie' ? 5000 : 1200);
      await p.screenshot({ path: `${OUT}/${prof.name}-${s}.png` });
      const m = await p.evaluate(MEASURE);
      await p.addScriptTag({ content: axeSrc });
      const axe = await p.evaluate(async () => { const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] }); return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 3).map(x => x.target.join(' ')) })); });
      report[prof.name].screens[s] = { ...m, axe };
    }
    report[prof.name].errors = [...new Set(errors)];
    await ctx.close(); console.error('done', prof.name);
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 1));
  await b.close();
})();
