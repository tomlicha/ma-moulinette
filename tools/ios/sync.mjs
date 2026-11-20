/**
 * Après `cap sync ios` : accorde la coquille à l'adresse du serveur (`server.url` de capacitor.config.ts, copiée dans
 * ios/App/App/capacitor.config.json).
 *
 * - `WKAppBoundDomains` d'Info.plist : `localhost` (page hors ligne embarquée) et l'hôte du serveur. Sans eux, la
 *   WKWebView n'a pas de service worker, et `limitsNavigationsToAppBoundDomains` bloquerait le chargement.
 * - Page hors ligne embarquée (`server.errorPath`) : l'adresse à rouvrir quand le réseau revient.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Remplace la liste `WKAppBoundDomains` d'un Info.plist (texte XML), ou l'ajoute. Les fins de ligne du fichier sont
 * respectées : sous Windows, git le sort en CRLF.
 */
export function setAppBoundDomains(plist, domains) {
  const eol = plist.includes('\r\n') ? '\r\n' : '\n';
  const items = domains.map((d) => `\t\t<string>${d}</string>`).join(eol);
  const block = `\t<key>WKAppBoundDomains</key>${eol}\t<array>${eol}${items}${eol}\t</array>${eol}`;
  const re = /\t<key>WKAppBoundDomains<\/key>\s*<array>[\s\S]*?<\/array>\r?\n/;
  if (re.test(plist)) return plist.replace(re, block);
  return plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${block}</dict>${eol}</plist>${eol}`);
}

/** Écrit l'adresse de l'application dans la page hors ligne. */
export function setOfflineUrl(html, url) {
  return html.replace(/<meta name="app-url" content="[^"]*"/, `<meta name="app-url" content="${url.replace(/"/g, '&quot;')}"`);
}

/** Domaines app-bound pour un serveur : aucun pour un serveur de développement en clair (la restriction est levée). */
export function appBoundDomains(serverUrl) {
  const u = new URL(serverUrl);
  return u.protocol === 'https:' ? ['localhost', u.hostname] : [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ios/App/App');
  const config = JSON.parse(fs.readFileSync(path.join(app, 'capacitor.config.json'), 'utf8'));
  const url = config.server?.url;
  if (!url) throw new Error('server.url absent de capacitor.config.json : lancer `npx cap sync ios` d’abord');
  const domains = appBoundDomains(url);
  if (domains.length) {
    const plist = path.join(app, 'Info.plist');
    fs.writeFileSync(plist, setAppBoundDomains(fs.readFileSync(plist, 'utf8'), domains));
  }
  const offline = path.join(app, 'public/offline.html');
  if (fs.existsSync(offline)) fs.writeFileSync(offline, setOfflineUrl(fs.readFileSync(offline, 'utf8'), url));
  console.log(`coquille iOS accordée à ${url}${domains.length ? ` (domaines : ${domains.join(', ')})` : ' (serveur en clair : pas de domaines app-bound)'}`);
}
