/* Service worker de Ma Moulinette : lancement instantané et hors ligne (garage, réseau faible).
 *
 * Gabarit : le build (tools/offline/service-worker.ts) le publie en dist/sw.js, précédé de deux constantes :
 *   VERSION   empreinte de la version (noms des fichiers, contenu de index.html et des fichiers de public/)
 *   PRECACHE  adresses de tous les fichiers de la version : page, JS, CSS, polices, modèles 3D, icônes
 *
 * - Installation : tout est téléchargé d'un coup dans un cache propre à la version. Un seul échec et l'installation
 *   échoue : l'ancienne version reste en place, entière.
 * - Activation : seulement quand plus aucun onglet n'utilise l'ancienne version (pas de skipWaiting). Une page
 *   ouverte garde donc tous ses fichiers, même ceux qu'elle charge plus tard (vue 3D, export). Les caches des
 *   versions précédentes sont alors supprimés ; le portrait du coureur (autre cache) n'est pas touché.
 * - Requêtes : la page vient du cache (index.html de la version), les fichiers aussi ; /api/* (comptes, Strava, salle
 *   temps réel, journaux), les autres sites et tout ce qui n'est pas GET passent directement au réseau.
 * - Mise à jour : le navigateur revérifie sw.js à chaque lancement (servi sans cache) ; une nouvelle version
 *   s'installe en arrière-plan et prend le relais au lancement suivant.
 */
/* global VERSION, PRECACHE */
const PREFIX = 'ma-moulinette-app-';
const CACHE = PREFIX + VERSION;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    // Une seule page : quelle que soit l'adresse (ancre, ?renderer=…), c'est index.html de cette version.
    event.respondWith(caches.open(CACHE).then((c) => c.match(SHELL)).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.open(CACHE).then((c) => c.match(request)).then((hit) => hit || fetch(request)));
});
