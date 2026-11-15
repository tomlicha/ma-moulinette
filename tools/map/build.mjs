// Génère la carte des parcours : `npm run map` (écrit docs/design/parcours-carte.svg).
// Vite charge les modules TypeScript de src/ tels quels : la carte vient des vraies données du jeu.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, process.argv[2] ?? 'docs/design/parcours-carte.svg');

const server = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });
try {
  const { renderNetworkMap } = await server.ssrLoadModule('/src/sim/network-map.ts');
  const { COL_DES_ERABLES } = await server.ssrLoadModule('/src/sim/courses/col-des-erables.ts');
  const { svg, width, height } = renderNetworkMap(COL_DES_ERABLES);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, svg, 'utf8');
  console.log(`carte écrite : ${out} (${width} × ${height})`);
} finally {
  await server.close();
}
