/**
 * Image de repli du portrait du coureur (src/assets/rider-portrait.jpg), refaite d'après l'avatar 3D actuel.
 *
 * L'application rend le portrait au premier lancement d'une version (src/render/rider-portrait.ts) ; d'ici là, ou si le
 * rendu échoue (pas de WebGL), c'est cette image qui s'affiche dans le médaillon du radar. Elle doit donc montrer le même
 * coureur, avec le même cadrage : on la produit avec le code de rendu de l'application lui-même. À relancer après tout
 * changement de l'avatar, du vélo ou du cadrage (`npm run assets` ne le fait pas : il faut un navigateur).
 *
 *   npx vite --port 5199 &   puis   node tools/assets/rider-portrait-fallback.cjs
 *
 * Utilise le Chromium de Playwright (rendu WebGL2 logiciel accepté).
 */
const { chromium } = require('playwright');
const fs = require('fs');

const PORT = process.env.PORT ?? '5199';
const SIZE = 512;
const OUT = 'src/assets/rider-portrait.jpg';

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('erreur de la page :', e.message));
  // N'importe quelle page du serveur de dev : on n'a besoin que de son origine pour importer le module de rendu.
  await page.goto(`http://localhost:${PORT}/robots.txt`);
  const dataUrl = await page.evaluate(async (size) => {
    const { renderRiderPortrait } = await import('/src/render/rider-portrait-render.ts');
    const blob = await renderRiderPortrait(size);
    const img = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.86);
  }, SIZE);
  fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`${OUT} : ${SIZE} × ${SIZE}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} Kio`);
  await browser.close();
})();
