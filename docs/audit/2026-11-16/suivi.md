# Suivi du plan d'action

État des actions du [rapport](rapport.md) au 16 novembre 2026 au soir. Le rapport reste tel quel ; ce fichier dit ce qui a été fait depuis, et ce qui reste.

## Où en est chaque action

| # | Action | État | Où |
|---|---|---|---|
| 1 | Vue 3D chargée à la demande, construite au repos | **Fait** | Monde en tâche de fond (`90db462`), première ouverture accélérée ([mesure-demarrage.md](mesure-demarrage.md)) ; `import()` de la vue au premier temps mort après l'affichage, ou à l'ouverture de la Sortie si elle vient avant (`src/main.ts`, `startViewBuild`) ; three.js dans son propre fichier (`vite.config.ts`) |
| 2 | Portrait du coureur en cache | **Fait** | Cache API ([mesure-demarrage.md](mesure-demarrage.md)). Reste : le produire au build pour le premier lancement d'une version |
| 3 | CI (build, tests, budget de taille) | **Fait** | `.github/workflows/ci.yml` ; budget du lancement `npm run budget` (`tools/ci/bundle-budget.mjs`) : 110 Kio de JS (100 jusqu'au 20 novembre 2026) et 30 Kio de CSS compressés |
| 4 | Qualité automatique sur mobile | **Premier palier** | Écran tactile → qualité réduite : décor allégé, ombres 1024 px, HUD sans flou, densité de pixels ≤ 1,5 (`src/render/quality.ts`). `?quality=high` force la complète (lien dans le menu de la Sortie). Reste : résolution dynamique pilotée par le p95 |
| 5 | Reprise après perte du GPU | **Fait** | `RideView.onLost` : la vue est jetée et reconstruite sur un canevas neuf, en WebGL2 à partir de la 2ᵉ perte, abandon après 3 ; perte pendant la construction comprise (`GpuLostError`). Chaque perte est journalisée |
| 6 | Description, `robots.txt`, Open Graph, icônes PNG | **Fait** | `index.html`, `public/robots.txt`, `public/og-image.jpg` (1200 × 630), icônes 192, 512 et `maskable` ; images refaites par `tools/assets/share-images.cjs`. **À faire au déploiement** : donner `SITE_URL` (adresse publique) au build, sinon l'image de partage reste en chemin relatif, que WhatsApp ou Slack n'affichent pas |
| 7 | `_headers` immuable, GLB versionnés, service worker | **Fait** | Modèles et portrait de repli dans `src/assets/`, publiés avec une empreinte ; `public/_headers` : `/assets/*` gardé un an ; service worker généré au build (`tools/offline/`), précache de toute la version. Vérifié : relancement hors ligne en 138 ms, Sortie et vue 3D hors ligne, mise à jour pendant qu'une page est ouverte (elle garde sa version). **À vérifier au déploiement** : que Cloudflare applique `_headers` (`curl -I …/assets/<fichier>.js` doit montrer `max-age=31536000, immutable`) |
| 8 | Textes ≥ 12 px, cibles ≥ 44 px, radar sans interactif imbriqué | **Fait** (cibles : 38 à 44 px) | Voir « Lisibilité » ci-dessous |
| 9 | Découper `main.ts` et `workout-editor.ts`, tests de l'UI | À faire | `main.ts` : 1 248 lignes (la reprise après perte du GPU y a ajouté une soixantaine) |
| 10 | `tsconfig` par cible, cartes de sources cachées | À faire | — |

Relecture de `90db462` : réglée. `Background.calm()` remet la construction en arrière-plan quand on quitte la Sortie, la ligne `router.current() === 'sortie'` (jamais vraie au lancement) a disparu, l'écran de chargement existe (`5832f00`), `Background` a ses tests (`background.test.ts`, dont l'arrêt d'une construction avec `stop()`).

Petits points réglés en passant : lien « Voir sur Strava » toujours muni d'une adresse (masqué tant que l'activité n'en a pas) ; titre de la page ; README (l'app s'ouvre sur l'accueil) ; date de la feuille de route.

## Lisibilité (action 8)

- **axe-core : plus aucun défaut**, sur les quatre écrans et les sept formats. Le radar n'est plus une image contenant un bouton : ses dessins sont masqués aux lecteurs d'écran et une phrase cachée à l'œil les résume (`radar.ts`). Sur téléphone, le titre « Capteurs » est masqué à l'œil seulement, et reste le `h2` des cartes.
- **Plus aucun texte sous 12 px**, sauf la Sortie en portrait, recouverte par l'invite à tourner. Séances : étiquettes, axes, onglets, cartes de l'étagère (élargies à 158 px pour ne pas tronquer « 10:00 · 75 % »), valeurs posées sur le profil, rail de navigation. HUD de la Sortie sur un portable 1024 × 640 : les widgets grossissent jusqu'à 100 % de la scène pour garder des libellés de 12 px (`hud.ts`, `--hud-k`).
- **Cibles tactiles** : toutes au-dessus de 24 px (WCAG 2.5.8). Sur téléphone, de 38 à 44 px de zone tactile par une marge invisible, comme les boutons déjà conçus ainsi : onglets de l'étagère (38 px), flèches de bloc (44 px), « Rouler », titre de la séance (32 px), recherche, « Continuer sans trainer » et « Créer ou modifier » (44 px). `tools/audit/screens.cjs` compte désormais ces marges (`::before` / `::after`) : sans elles, il annonçait des cibles de 20 px qui en faisaient 40.
- Bulles du radar entières sur le portable (requête de conteneur sous 230 px) ; invite à tourner et guide d'installation à l'accent orange du thème.
- Reste sous 44 px : les boutons de l'écran Appareils sur téléphone (38-40 px) et le tiroir de la bibliothèque (36 px), au-dessus du minimum de 24 px. Les passer à 44 px demande de revoir la mise en page en hauteur (390 px).

## Mesures

Build de production servi par `tools/audit/serve.mjs`. Lighthouse 12.8, deux passages par version, contre le commit `f11c8ad` (avant ces changements, mais après les gains de [mesure-demarrage.md](mesure-demarrage.md)) :

| | `f11c8ad` | Après |
|---|---|---|
| Performance mobile | 32 / 42 | **57 / 54** |
| Performance ordinateur | 87 / 83 | 89 / 90 |
| SEO | 75 | **100** |
| First Contentful Paint, mobile | 3,2 s | 2,0 / 2,9 s |
| Largest Contentful Paint, mobile | 6,5 s | **3,8 / 3,9 s** |
| JS du lancement (gzip) | 358 Kio | **76 Kio** |

Le Total Blocking Time mobile varie trop d'un passage à l'autre (2,7 à 7,7 s des deux côtés) pour conclure : Lighthouse part d'un profil vierge, donc paie le rendu du portrait, et la construction de la vue tombe dans sa fenêtre de mesure. Sans GPU, la compilation des ombres (rendu fait d'avance) y pèse plusieurs secondes ; sur un vrai téléphone, bien moins. **À mesurer sur un vrai téléphone.**

Reprise après perte du GPU, vérifiée en WebGL2 (perte provoquée par `WEBGL_lose_context`, Sortie ouverte) : l'écran de chargement revient, la vue se reconstruit sur un canevas neuf et redessine. La perte du device WebGPU n'a pas pu être provoquée ici (pas de GPU) : même chemin dans three.js (`renderer.onDeviceLost`), **à vérifier sur appareil** (mise en arrière-plan prolongée sur iPhone).

Pixel 7 couché (émulé) : HUD sans flou, 874 k triangles, canevas à 1,5 pixel par point (2,6 en natif). L'ordinateur garde la qualité complète.

## Ce qui reste, par ordre d'intérêt

1. **Mesurer sur un vrai téléphone** (Pixel, iPhone 13 en plein écran) : temps de blocage au lancement, ouverture de la Sortie, i/s en qualité réduite, et une perte du GPU après une mise en arrière-plan.
2. **`SITE_URL` au déploiement** (action 6), sinon les aperçus de liens restent sans image.
3. **Maintenabilité** (actions 9 et 10) : `tsconfig` pour `worker/` et `tools/`, cartes de sources cachées, `$` qui lève si l'id manque, découpage de `main.ts` et `workout-editor.ts`, polices importées une seule fois (`hud.ts`, `radar.ts`), linter.
4. **Rendu** : résolution dynamique ; portrait produit au build ; passes d'ombre compilées à la première image ; `setInterval(renderHud, 250)` qui tourne hors de la Sortie ; envoi des textures en WebGPU (tâche de 9,7 s sans GPU, à vérifier sur appareil).
