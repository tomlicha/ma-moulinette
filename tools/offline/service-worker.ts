/**
 * Génération du service worker au build (plugin Vite) : `dist/sw.js` = constantes de la version + gabarit `sw.js`.
 * Comportement du service worker : voir l'en-tête de `tools/offline/sw.js`.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/** Fichiers de public/ inutiles hors ligne : aperçu de partage, robots, configuration de l'hébergeur. */
const PUBLIC_SKIP = new Set(['_headers', 'robots.txt', 'og-image.jpg']);

const TEMPLATE = new URL('./sw.js', import.meta.url);

/** Source de sw.js pour une version et sa liste d'adresses. */
export function serviceWorkerSource(version: string, precache: readonly string[]): string {
  return `const VERSION = ${JSON.stringify(version)};\nconst PRECACHE = ${JSON.stringify(precache, null, 1)};\n${readFileSync(TEMPLATE, 'utf8')}`;
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, root) : [relative(root, path).split('\\').join('/')];
  });
}

/**
 * Adresses à précacher et empreinte de la version. `bundle` : fichiers produits par Vite (noms à empreinte, plus
 * index.html) ; `publicDir` : copiés tels quels, donc leur contenu entre dans l'empreinte.
 */
export function precacheManifest(bundle: Record<string, string | Uint8Array>, publicDir: string): { version: string; urls: string[] } {
  const hash = createHash('sha256');
  const urls = ['/'];
  for (const name of Object.keys(bundle).sort()) {
    if (name.endsWith('.map')) continue;
    // Polices .woff : seulement pour les navigateurs sans woff2 (aucun de ceux que l'application accepte).
    if (name.endsWith('.woff')) continue;
    hash.update(name);
    if (name === 'index.html') hash.update(bundle[name]!);
    else urls.push(`/${name}`);
  }
  for (const name of listFiles(publicDir).sort()) {
    if (PUBLIC_SKIP.has(name)) continue;
    hash.update(name).update(readFileSync(join(publicDir, name)));
    urls.push(`/${name}`);
  }
  return { version: hash.digest('hex').slice(0, 12), urls };
}

export function serviceWorker(): Plugin {
  let publicDir = 'public';
  return {
    name: 'service-worker',
    apply: 'build',
    enforce: 'post', // après le plugin HTML de Vite, qui ajoute index.html au paquet
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_, bundle) {
      const files: Record<string, string | Uint8Array> = {};
      for (const [name, out] of Object.entries(bundle)) files[name] = out.type === 'chunk' ? out.code : out.source;
      const { version, urls } = precacheManifest(files, publicDir);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, urls) });
    },
  };
}
