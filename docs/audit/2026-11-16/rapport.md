# Audit du 16 novembre 2026 : performance, maintenabilité, visibilité

Commit audité : `6b48683` (« Aperçu : option gate=z1..z6|free pour voir une porte de palier »).
Formats : ordinateur (1280 × 800, 1920 × 1080, 1024 × 640), tablette (iPad paysage), téléphones (Pixel 7 paysage, iPhone 13 paysage et portrait **en plein écran**, sans barres Safari).

## En bref

| Axe | Ordinateur | Mobile | Verdict |
|---|---|---|---|
| Performance (Lighthouse) | **33** / 100 | **28** / 100 | Démarrage trop lourd : le monde 3D est construit avant même d'afficher l'accueil |
| Accessibilité (Lighthouse, écran d'accueil) | 100 | 100 | Bon socle ; axe-core trouve 2 défauts sur les autres écrans |
| Bonnes pratiques (Lighthouse) | 100 | 100 | — |
| SEO (Lighthouse) | 75 | 75 | Pas de description, `robots.txt` renvoie la page HTML, pas d'aperçu de partage |
| Maintenabilité | — | — | Cœur métier propre et bien testé ; couche UI et `main.ts` sans tests ni garde-fous (pas de CI ni de linter) |

Les trois actions qui rapportent le plus :

1. **Ne plus construire la vue 3D au démarrage** (`src/main.ts:1112`) : la charger quand on va sur Sortie (ou pendant un temps mort après le premier affichage), en `import()` dynamique. Cela supprime la tâche bloquante de 10 s sur mobile et sort three.js (964 Kio, 76 % du JS) du chargement initial.
2. **Mettre en cache le portrait du coureur** (`src/render/rider-portrait.ts`) au lieu de le recalculer à chaque lancement avec un second moteur de rendu et les deux modèles GLB. C'est l'élément LCP de l'accueil.
3. **Donner un budget de rendu propre au mobile** : aujourd'hui le téléphone reçoit la même scène que l'ordinateur (1,45 M triangles, 347 appels de dessin, flous `backdrop-filter` sur le HUD).

## Méthode et limites

- Build de production (`npm run build`), servi en local avec compression brotli et les en-têtes de cache par défaut de Cloudflare (`max-age=0, must-revalidate`) : `tools/audit/serve.mjs`.
- **Lighthouse 12.8** en profil ordinateur et mobile (Moto G Power simulé, 4G lente, CPU ralenti 4×). Rapports complets : [lighthouse/desktop.html](lighthouse/desktop.html), [lighthouse/mobile.html](lighthouse/mobile.html).
- **Parcours des 4 écrans** avec Playwright (Chromium) sur chaque format : captures, axe-core (WCAG 2.2 AA + bonnes pratiques), débordements, textes de moins de 12 px, cibles tactiles, erreurs console (`tools/audit/screens.cjs`).
- **Profil CPU du démarrage** sur le serveur de dev (`tools/audit/profile.cjs`), pour attribuer le temps aux modules.
- Couverture des tests (`vitest --coverage`), composition du bundle (cartes de sources), `npm audit`, `npm outdated`.

**Limite importante** : la machine d'audit n'a pas de GPU (rendu logiciel SwiftShader). Les images par seconde mesurées (1 i/s) ne veulent rien dire ; seuls les **triangles et appels de dessin** sont fiables. Le WebGPU logiciel perd aussi son device pendant les tests : les captures de la Sortie ont donc été faites en WebGL2 (`?renderer=webgl2`). Les temps absolus dépendent du CPU de la machine ; ce sont les **proportions** qui comptent. Les marges de sécurité de l'encoche iPhone (`env(safe-area-inset-*)`) ne sont pas émulées par Playwright : `tools/mobile/check.mjs` reste l'outil pour ça.

---

## 1. Performance

### 1.1 Chargement (Lighthouse)

| Mesure | Ordinateur | Mobile | Seuil « bon » |
|---|---|---|---|
| First Contentful Paint | 2,3 s | 4,8 s | ≤ 1,8 s |
| Largest Contentful Paint | 3,6 s | 8,7 s | ≤ 2,5 s |
| Total Blocking Time | 3 720 ms | 10 100 ms | ≤ 200 ms |
| Time to Interactive | 6,3 s | 15,2 s | ≤ 3,8 s |
| Cumulative Layout Shift | 0 | 0 | ≤ 0,1 ✅ |
| Poids transféré | 931 Kio | 931 Kio | — |
| Temps d'exécution JS | 5,5 s | 16,9 s | — |

Le poids (931 Kio compressés, dont ~500 Kio de modèles GLB) est raisonnable pour une app 3D. **Le problème est le travail du thread principal**, presque entièrement dans `index-*.js` (16,1 s sur 16,9 s en mobile), dont **une seule tâche de 10 s**. Pendant ce temps, l'écran d'accueil est affiché mais ne répond pas.

### 1.2 D'où vient le temps de démarrage

Profil CPU du démarrage (temps inclusif, machine d'audit, sans ralentissement) :

| Fonction | Temps | Rôle |
|---|---|---|
| `RideView.create` (`render/ride-view.ts:75`) | 1 455 ms | Construction de toute la vue 3D, alors que l'écran affiché est l'accueil |
| ↳ `World.prime` (`render/world.ts:559`) | 807 ms | Décor et terrain autour du départ |
| ↳ `WorldLayout.nearestRoad` / `groundAlt` (`render/world-layout.ts:213`, `:350`) | ~600 ms | Requêtes de hauteur du sol, appelées pour chaque sommet et chaque objet |
| ↳ `Terrain.gridMesh` (`render/terrain.ts:67`) | 497 ms | Maillage du relief |
| ↳ `Decor.generate` (`render/decor.ts:375`) | 358 ms | Semis d'arbres et mobilier |
| `riderPortrait.render` (`render/rider-portrait.ts:24`) | 720 ms | Second moteur WebGPU + chargement des deux GLB pour produire **une image PNG de 512 px** |
| Initialisation three/WebGPU | ~470 ms | — |

Constats :

- **P1 — La vue 3D est construite au lancement** (`src/main.ts:1112`), alors que l'app démarre sur l'accueil (`ui/router.ts` force `#accueil`). `setActive(false)` arrête bien la boucle de rendu hors Sortie, mais la construction elle-même (≈ 1,5 s ici, 10 s sur un mobile milieu de gamme simulé) bloque l'interface.
  *Recommandation* : `import('./render/ride-view')` au premier passage sur Sortie, ou dans un `requestIdleCallback` après le premier affichage ; découper `prime()` en morceaux rendus sur plusieurs images (le monde est déjà « par morceaux ») ; à plus long terme, calculer `WorldLayout`, terrain et semis dans un Web Worker (ce sont des fonctions pures).
- **P1 — Le portrait du coureur est recalculé à chaque lancement.** Il crée un second `WebGPURenderer`, charge `avatar.glb` (418 Kio) et `bike.glb` (337 Kio), rend une image puis jette tout. C'est l'élément LCP de l'accueil (médaillon du radar), découvert tard.
  *Recommandation* : garder le PNG dans le Cache API / IndexedDB avec pour clé l'empreinte des GLB ; ou le produire au build dans `npm run assets` et le précharger (`<link rel="preload" as="image">`).
- **P2 — `nearestRoad` / `groundAlt` sont les fonctions les plus chaudes.** Elles parcourent une grille de cases à chaque appel, et les paramètres par défaut (`scratch = { dist: Infinity, … }`) allouent un objet à chaque appel sans tampon. Un cache de hauteurs par case de terrain, ou un passage systématique du tampon, réduirait le coût de `prime()` et des mises à jour en roulant.

### 1.3 Bundle

| Fichier | Brut | Compressé (gzip) |
|---|---|---|
| `index-*.js` | 1 271 Kio | 370 Kio |
| ↳ dont `three` | **964 Kio (76 %)** | — |
| ↳ dont `src/ui` / `src/render` / `src/main.ts` | 72 / 61 / 22 Kio | — |
| `fit-activity-*.js` (SDK Garmin, chargé à l'export) | 425 Kio | 61 Kio ✅ déjà différé |
| `index-*.css` (bloquant) | 102 Kio | 21 Kio |
| `index.html` | 41 Kio | 9 Kio |

- **P1 — three.js est dans le chunk initial.** Avec la vue 3D et le portrait en `import()` dynamique, l'accueil, les Appareils et les Séances s'affichent avec ~300 Kio de JS au lieu de 1,27 Mio. Vite avertit déjà (« chunks larger than 500 kB »).
- P3 — Le CSS (102 Kio) est entièrement bloquant ; 49 règles `backdrop-filter`. Acceptable, mais à surveiller.
- ✅ Polices : seuls les sous-ensembles latins sont téléchargés (4 × ~22 Kio, woff2) ; `font-display` correct.

### 1.4 Cache et hors ligne

- **P2 — Aucun cache long pour les fichiers versionnés.** Les Workers Static Assets de Cloudflare servent par défaut `max-age=0, must-revalidate` (à confirmer sur le domaine déployé) : chaque lancement revalide le JS, le CSS et les GLB. Ajouter un fichier `public/_headers` avec `Cache-Control: public, max-age=31536000, immutable` pour `/assets/*`. Attention : `bike.glb`, `avatar.glb` et `rider-portrait.jpg` viennent de `public/` et ne sont **pas** versionnés par un hash : les importer depuis le code (`?url`) pour qu'ils le soient, sinon ils resteraient figés dans les caches.
- **P2 — Pas de service worker.** L'app est une PWA installée (iPhone en plein écran), utilisée dans un garage où le réseau est souvent faible : un service worker qui précache le shell, le JS et les GLB rendrait le lancement instantané et possible hors ligne.

### 1.5 Rendu 3D (écran Sortie)

Mesures de l'app elle-même (ligne de statistiques de la vue) :

| Format | Qualité | Triangles par image | Appels de dessin |
|---|---|---|---|
| Ordinateur 1280 × 800 | `high` (défaut) | 1 436 k | 312 |
| Pixel 7 paysage | `high` (défaut) | 1 449 k | 347 |
| Ordinateur 1280 × 800 | `?quality=low` | 935 k | 272 |

- **P1 — Le mobile reçoit la scène de l'ordinateur.** Aucun choix automatique de qualité : un téléphone a 1,45 M triangles, un `pixelRatio` jusqu'à 2, l'anticrénelage, des ombres en cascades 2048 px (qui redessinent la géométrie par cascade) et des panneaux HUD en verre dépoli (`backdrop-filter`, recalculé à chaque image au-dessus d'un canevas animé). L'objectif ENF-01 (30 i/s stables pendant 60 min sur mobile) est à risque.
  *Recommandation* : qualité `low` par défaut si `pointer: coarse` ; résolution dynamique pilotée par le p95 déjà mesuré (`frameP95Ms`) ; HUD sans flou sur mobile (ce que fait déjà `?quality=low`). C'est l'étape 3 de la feuille de route, mais un premier palier automatique est peu coûteux.
- **P2 — Aucune reprise après perte du GPU.** Rien n'écoute la perte du device WebGPU ni `webglcontextlost` (aucune occurrence dans `src/`). Pendant l'audit, la perte du device laisse la vue figée sur « rendu : initialisation… » sans repli. Sur iPhone et Android, une perte de contexte arrive après une mise en arrière-plan ou une pression mémoire. *Recommandation* : `renderer.onDeviceLost` → recréer la vue, ou basculer en WebGL2, et journaliser l'événement (la télémétrie existe déjà).
- ✅ La boucle de rendu s'arrête hors de l'écran Sortie (`RideView.setActive`).
- P3 — `setInterval(renderHud, 250)` (`main.ts:1097`) tourne sur tous les écrans ; il pourrait suivre `setActive`.

### 1.6 Mémoire et DOM

- Tas JS : 38 à 48 Mio sur l'accueil, 65 Mio en Sortie. Correct.
- DOM : **2 004 éléments** dès le chargement (Lighthouse : « excessive »), car `index.html` contient tous les écrans. Peu grave aujourd'hui (les écrans masqués ne coûtent pas de mise en page), mais ce chiffre ne fera que grandir.

---

## 2. Maintenabilité

### Points forts

- TypeScript **strict** avec `noUncheckedIndexedAccess` ; **0** `any`, **0** `@ts-ignore`, **0** TODO/FIXME.
- **434 tests, tous verts, en 3,4 s**. Le cœur métier est pur, sans DOM, et très bien couvert : `sim` 100 %, `workout` 97 %, `sensors` 92 %, `telemetry` 83 %.
- Découpage par domaine lisible (`sensors`, `sim`, `workout`, `render`, `export`, `telemetry`, `ui`) ; le récepteur de journaux et le relais Strava sont des gestionnaires `Request → Response` indépendants de l'hébergeur.
- `npm audit` : **0 vulnérabilité**. Dépendances à jour (seuls des correctifs mineurs : three 0.187, vite 8.3.8, vitest 5.1).
- Documentation de conception abondante (`docs/design/`), feuille de route qui distingue « testé » et « validé sur matériel ».

### Points faibles

| Prio | Constat | Où | Recommandation |
|---|---|---|---|
| P1 | **Pas d'intégration continue** ni de linter/formateur : rien n'empêche de pousser un build cassé ou des tests rouges | pas de `.github/`, pas d'ESLint/Biome/Prettier | GitHub Actions : `npm ci && npm run build && npm test`, plus un budget de taille du bundle |
| P1 | **`main.ts` : 1 145 lignes**, 50 imports, 26 `let` au niveau du module, 52 recherches DOM par id. Composition, état et logique sont mêlés ; 0 % de couverture | `src/main.ts` | Extraire des contrôleurs par écran (Appareils, Sortie, Séances) qui reçoivent leurs dépendances ; garder `main.ts` comme simple assemblage |
| P2 | **Couverture globale 38 %** des lignes : `ui` 10 %, `render` 13 %, `main.ts` 0 % | — | Viser d'abord les modèles UI purs (`*-model.ts` existent déjà) et la logique de `workout-editor.ts` |
| P2 | `workout-editor.ts` : **1 576 lignes** | `src/ui/workout-editor.ts` | Séparer rendu SVG, gestes (glisser-déposer) et commandes |
| P2 | `index.html` : **41 Kio, 557 lignes** de balisage pour tous les écrans ; la navigation est **copiée trois fois** ; le lien HTML ↔ TS passe par des id avec des conversions non vérifiées (`$<T>(id)` = `getElementById(id) as T`, 96 `as` dans `src/`) | `index.html`, `main.ts` | Un module par écran qui possède son balisage (template), ou au minimum une fonction `$` qui lève une erreur si l'id manque |
| P2 | **`worker/` et `tools/` ne sont pas typés au build** : `tsconfig.json` n'inclut que `src`. Le code du Worker compile aujourd'hui, mais rien ne le garantit | `tsconfig.json` | Un `tsconfig` par cible (navigateur, Worker, Node) + `tsc -b` ; ajouter `@types/node` pour `tools/` |
| P2 | **Pas de cartes de sources en production** : les piles d'erreurs remontées par la télémétrie sont illisibles | `vite.config.ts` | `build.sourcemap: 'hidden'` et garder les `.map` hors du déploiement pour décoder les rapports |
| P3 | Imports de polices dupliqués | `ui/hud.ts:1-5`, `ui/radar.ts:1-5` | Les importer une fois (dans `style.css` ou `main.ts`) |
| P3 | Documentation en retard sur le code : le README dit que l'écran Appareils est « toujours le premier au lancement », le routeur force `#accueil` ; la feuille de route est « mise à jour du 27 octobre » mais contient des entrées du 15 novembre | `README.md`, `docs/roadmap.md` | Corriger au fil de l'eau |

---

## 3. Visibilité

### 3.1 Référencement et partage (SEO 75/100)

| Prio | Constat | Correction |
|---|---|---|
| P2 | **Pas de `<meta name="description">`** | Une phrase qui décrit l'app (home trainer, 3D, séances, Strava) |
| P2 | **`/robots.txt` renvoie `index.html`** (le repli « single-page-application » de `wrangler.app.toml` répond à toute adresse inconnue) : Lighthouse y lit 557 erreurs | Ajouter `public/robots.txt` (et un `sitemap.xml` si un site vitrine existe) |
| P2 | **Aucune balise Open Graph / Twitter** : un lien partagé (WhatsApp, Strava, Slack) n'affiche ni image ni texte | `og:title`, `og:description`, `og:image` (1200 × 630, une capture de la Sortie), `og:locale=fr_FR` |
| P3 | Lien sans `href` dans le récapitulatif (« Voir sur Strava »), non suivi par les robots | `src/ui/recap.ts:114` : le rendre `hidden` tant que l'URL Strava n'est pas connue |
| P3 | Manifeste : une seule icône SVG `any`, pas de PNG 192/512 ni d'icône `maskable` | Android affiche une icône de moindre qualité à l'installation |
| P3 | `<title>` réduit à « Ma Moulinette » | « Ma Moulinette — home trainer 3D et séances structurées » |

### 3.2 Lisibilité et accessibilité, par format

Lighthouse ne note que l'écran affiché au chargement (100/100). axe-core sur les quatre écrans trouve :

| Prio | Constat | Formats | Où |
|---|---|---|---|
| P2 | **Élément interactif imbriqué** (sérieux) : le radar cliquable contient d'autres commandes, ce que les lecteurs d'écran annoncent mal | tous | `.radar--large`, écran Appareils |
| P3 | **Ordre des titres** : un `h3` sans `h2` parent | téléphones en paysage | `#card-trainer h3` |
| P2 | **Textes de moins de 12 px** : étiquettes des statistiques (Durée, Moyenne, Intensité, Charge : 11,2 px), axes du profil (11,5 px), puces de filtre ; libellés de la barre latérale sur téléphone (11 px) | Séances, tous formats | `src/ui/seances.css` |
| P2 | **HUD de la Sortie à 11,5 px** sur un portable 1024 × 640 (le HUD suit la taille de la fenêtre) | 1024 × 640 | `src/ui/hud.css` |
| P2 | **Cibles tactiles de moins de 44 px** sur Séances : 20 à 22 commandes sur iPhone et Pixel en paysage ; champs « nom de séance » et « recherche » de 20 px de haut | téléphones | `src/ui/seances.css` |
| P3 | « Continuer sans trainer » : lien isolé de 19-20 px de haut (sous les 24 px de WCAG 2.5.8) | tous | écran Appareils |
| P3 | Bulles du radar tronquées (« Aucun appareil c… ») | 1024 × 640 | écran Appareils |
| P3 | La pastille de navigation flottante masque le bas de la carte Capteurs tant qu'on n'a pas fait défiler (le contenu reste atteignable) | 1024 × 640 | écran Appareils |
| P3 | L'invite « Mets ton téléphone à l'horizontale » utilise un bouton turquoise, hors des jetons du thème « Doux » (accent orange) | iPhone portrait | `#rotate-hint` |

Ce qui va bien :

- **iPhone en plein écran (844 × 390)** : aucun débordement, aucun chevauchement sur les quatre écrans. (En fenêtre Safari 750 × 342, la navigation recouvrait « Rechercher un trainer » ; ce cas est hors périmètre puisque l'app est toujours lancée en plein écran.)
- **Pixel 7 paysage** : la navigation passe en barre latérale, l'éditeur de séances tient sur un écran.
- **Portrait** : l'invite à tourner l'appareil s'affiche comme prévu (le HUD y serait illisible, à 4-5 px).
- Aucun défilement horizontal sur aucun format ; contrastes conformes (aucune alerte axe).

---

## 4. Plan d'action proposé

| # | Action | Axe | Effort | Gain attendu |
|---|---|---|---|---|
| 1 | Vue 3D en `import()` dynamique, construite au premier passage sur Sortie ou au repos | Perf | M | TBT mobile de 10 s → < 1 s ; JS initial 1,27 Mio → ~0,3 Mio |
| 2 | Portrait du coureur mis en cache (ou produit au build) | Perf | S | LCP accueil, −720 ms de calcul et −500 Kio de GLB au lancement |
| 3 | CI GitHub Actions (build + tests + budget de taille) | Maint. | S | Plus de régression silencieuse |
| 4 | Qualité automatique sur mobile (`low`, HUD sans flou, résolution dynamique) | Perf mobile | M | Marge pour 30 i/s (ENF-01) |
| 5 | Reprise après perte du device GPU | Robustesse | S | Plus d'écran 3D figé après une mise en arrière-plan |
| 6 | `meta description`, `robots.txt`, Open Graph, icônes PNG | Visibilité | S | SEO 75 → ~100, liens partagés lisibles |
| 7 | `_headers` immuable + GLB versionnés + service worker | Perf | M | Relancement instantané, hors ligne |
| 8 | Textes ≥ 12 px et cibles ≥ 44 px sur Séances (mobile) ; radar sans interactif imbriqué | Lisibilité | S | Confort au téléphone, accessibilité |
| 9 | Découper `main.ts` et `workout-editor.ts` ; tests de l'UI | Maint. | L | Coût de chaque évolution |
| 10 | `tsconfig` par cible (Worker, Node) ; cartes de sources cachées | Maint. | S | Erreurs de type et piles lisibles |

Effort : S = moins d'une demi-journée, M = 1 à 2 jours, L = plusieurs jours.

## Annexes

- Captures : [captures/](captures/) (ordinateur 1280 × 800, portable 1024 × 640, Pixel 7 paysage, iPhone 13 plein écran paysage et portrait ; Sortie en WebGL2).
- Rapports Lighthouse complets : [lighthouse/desktop.html](lighthouse/desktop.html), [lighthouse/mobile.html](lighthouse/mobile.html).
- Refaire l'audit : [tools/audit/README.md](../../../tools/audit/README.md).
