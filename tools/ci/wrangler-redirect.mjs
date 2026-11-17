/**
 * Redirection de configuration wrangler pour les builds Cloudflare (Workers Builds).
 *
 * Le dépôt a deux Workers : l'application (`wrangler.app.toml`) et le récepteur de journaux (`wrangler.toml`, le fichier
 * que wrangler lit par défaut). Cloudflare lance `npx wrangler preview` pour les branches hors production, sans `-c` :
 * wrangler lisait donc le récepteur, n'y trouvait pas de bloc `[previews]` et le build échouait (constaté le
 * 17 novembre 2026, sur toutes les branches depuis le 16).
 *
 * Fin de `npm run build`, et seulement dans l'environnement de Workers Builds (`WORKERS_CI=1`) : écrit
 * `.wrangler/deploy/config.json`, que wrangler suit pour toute commande lancée sans `-c`. Un `-c` explicite l'emporte
 * toujours (le déploiement de production, le récepteur). Ailleurs (poste local, GitHub Actions) rien n'est écrit : les
 * commandes wrangler gardent leur comportement habituel.
 *
 * Réglage équivalent côté Cloudflare : la commande de déploiement `npx wrangler preview -c wrangler.app.toml`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_CONFIG = 'wrangler.app.toml';

/** Vrai dans l'environnement de build de Cloudflare Workers Builds. */
export function inWorkersBuilds(env) {
  return env.WORKERS_CI === '1' || Boolean(env.WORKERS_CI_BUILD_UUID);
}

/** Contenu de `.wrangler/deploy/config.json` : le chemin est relatif à ce fichier. */
export function redirectFile(configName = APP_CONFIG) {
  return `${JSON.stringify({ configPath: `../../${configName}` })}\n`;
}

/** Écrit la redirection dans `root` si l'on est dans Workers Builds ; renvoie le chemin écrit, sinon `undefined`. */
export function writeRedirect(root, env) {
  if (!inWorkersBuilds(env)) return undefined;
  const file = path.join(root, '.wrangler', 'deploy', 'config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, redirectFile());
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = writeRedirect(process.cwd(), process.env);
  console.log(file ? `wrangler : configuration redirigée vers ${APP_CONFIG} (${path.relative(process.cwd(), file)})` : 'wrangler : pas de redirection (hors Workers Builds)');
}
