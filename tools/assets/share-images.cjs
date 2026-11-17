/**
 * Images de partage et icônes de l'application installée, refaites à la demande (pas à chaque build) :
 *   - public/og-image.jpg (1200 × 630) : aperçu des liens partagés, vue de la Rive du lac sans la ligne de statistiques ;
 *   - public/icon-192.png, icon-512.png : favicon.svg en PNG (Android n'accepte pas toujours le SVG à l'installation) ;
 *   - public/icon-maskable-512.png : fond plein, motif dans la zone sûre (cercle de 80 %) pour les icônes découpées.
 *
 *   npx vite --port 5199 &   puis   node tools/assets/share-images.cjs
 *
 * Utilise le Chromium de Playwright, en WebGL2 (rendu logiciel accepté).
 */
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('http://localhost:5199/tools/preview/index.html?shot=ride&course=rive&d=5900&renderer=webgl2');
  await p.waitForFunction(() => document.title === 'ready', null, { timeout: 180000 });
  await p.addStyleTag({ content: '#info{display:none!important}' });
  await p.waitForTimeout(1500);
  const c = await p.context().newCDPSession(p);
  const { data } = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 84 });
  fs.writeFileSync(process.argv[2] ?? 'public/og-image.jpg', Buffer.from(data, 'base64'));
  // Icônes PNG à partir du favicon : « any » (coins arrondis) et « maskable » (fond plein, motif dans la zone sûre).
  const svg = fs.readFileSync('public/favicon.svg', 'utf8');
  const glyph = svg.replace(/^[\s\S]*?<rect[^>]*\/>/, '').replace(/<\/svg>\s*$/, '');
  const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0B1422"/><g transform="translate(16 16) scale(.72) translate(-16 -16)">${glyph}</g></svg>`;
  for (const [name, src, size] of [['icon-192.png', svg, 192], ['icon-512.png', svg, 512], ['icon-maskable-512.png', maskable, 512]]) {
    const q = await b.newPage({ viewport: { width: size, height: size } });
    await q.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await q.screenshot({ path: `public/${name}`, omitBackground: true });
    await q.close();
  }
  await b.close();
})();
