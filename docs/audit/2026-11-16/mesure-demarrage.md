# Suivi : réactivité du démarrage

Suite des actions 1 et 2 du [rapport](rapport.md) : le monde 3D construit en tâche de fond (`90db462`), puis le portrait du coureur gardé dans le navigateur et les shaders compilés d'avance (commit suivant).

## Ce qui a changé

- **Portrait du coureur en cache** (`src/render/rider-portrait.ts`). L'image est rangée dans le Cache API du navigateur sous une empreinte calculée au build : modèles GLB, tout le code de `src/render/` et la version de three.js (`vite.config.ts`, `riderPortraitKey`). Elle n'est rendue qu'au premier lancement d'une version ; ensuite le second moteur de rendu n'est même plus chargé (`rider-portrait-render.ts`, importé seulement si l'image manque). Pas de cache en développement : l'empreinte n'y suivrait pas les modifications. Sans Cache API, ou si elle refuse, le rendu se fait comme avant.
- **Shaders compilés d'avance** (`src/render/ride-view.ts`). À la fin de la construction, la caméra est posée comme à la première image et `renderer.compileAsync(scene, camera)` prépare les matériaux visibles. three.js (r186) les traite un par un en rendant la main entre deux (`scheduler.yield()`), et crée les pipelines de façon asynchrone quand le moteur le permet (WebGPU, ou WebGL2 avec `KHR_parallel_shader_compile`).

## Mesures

`tools/audit/startup.cjs`, processeur ralenti 4×, ordinateur 1280 × 800. Valeur : la **plus longue tâche** du thread principal, pendant laquelle un clic attend. « Froid » : premier lancement, profil vierge ; « chaud » : second lancement du même profil.

**La machine d'audit n'a pas de GPU** (rendu logiciel SwiftShader). Les compilations de shaders et les envois de textures y sont des dizaines de fois plus lents que sur un vrai GPU. Les secondes ci-dessous ne valent donc que **pour comparer les versions entre elles**, pas comme temps réels.

### WebGL2

| Version | Chargement, froid | Chargement, chaud | Ouverture de la Sortie (froid / chaud) | Vue prête (chaud) |
|---|---|---|---|---|
| `6b48683` (avant) | 9,7 s | 8,5 s | 10,3 s / 13,0 s | — |
| `90db462` (monde en tâche de fond) | 5,4 s | 4,7 s | 19,1 s / 16,1 s | — |
| + portrait en cache | 5,0 s | **0,8 s** | 18,4 s / 20,1 s | 11,8 s |
| + shaders compilés d'avance | 4,7 s | **0,75 s** | **2,6 s / 3,2 s** | 25,5 s |

- Le **portrait en cache** fait disparaître la dernière grosse tâche du chargement dès le deuxième lancement (4,7 s → 0,8 s). Au premier lancement d'une version, elle reste (c'est le rendu du portrait lui-même). Le portrait s'affiche en 65 ms au lieu de 4,7 s.
- La **précompilation** retire presque tout le coût de la première image de la Sortie (16 à 20 s → 2,6 à 3,2 s), sans créer de longue tâche au chargement : three.js découpe le travail. Ce qui reste à l'ouverture vient des passes d'ombre, que `compileAsync` ne prépare pas.
- Contrepartie : la vue est prête plus tard (11,8 s → 25,5 s ici), puisque la compilation se fait avant. Sur l'accueil, cela ne se voit pas.

### WebGPU

| Version | Chargement, chaud | Ouverture de la Sortie, chaud | Vue prête (chaud) |
|---|---|---|---|
| + portrait en cache | 0,6 s | 15,3 s | 10,9 s |
| + shaders compilés d'avance | 9,7 s | **3,9 s** | 28,9 s |

- Le coût de la première image passe aussi de l'ouverture de la Sortie (15,3 s → 3,9 s) au chargement. Mais ici il reste **une tâche de 9,7 s au chargement**. Le profil montre qu'il s'agit de l'envoi d'une texture au GPU (`copyExternalImageToTexture`, textures des banderoles et panneaux dessinées sur canevas). Cet envoi est pathologique en rendu logiciel ; sur un vrai GPU il prend quelques millisecondes. Il aurait eu lieu de toute façon à la première image. **À vérifier sur un vrai appareil** (ligne de statistiques de la vue, ou profil de performance de Chrome).
- Les lancements à froid en WebGPU ne sont pas comparables : dans cet environnement, détruire le moteur du portrait fait perdre son GPU à la vue principale (« A valid external Instance reference no longer exists »), qui ne dessine plus rien. Avec le portrait en cache, ce cas ne se produit plus qu'au premier lancement d'une version. **À vérifier sur un vrai appareil** ; si cela s'y produit aussi, il faudra faire le portrait avec le moteur de la vue, et reprendre après une perte du GPU (point 1.5 du rapport).

## Ce qui reste

- Le premier lancement d'une version paie toujours le rendu du portrait. Le produire au build (`npm run assets`) le supprimerait complètement.
- Les passes d'ombre se compilent encore à la première image de la Sortie.
- three.js est toujours dans le JS initial (1,27 Mio) : action 1 du rapport, second volet.
- Les points de la relecture de `90db462` non traités ici : `hurry()` sans retour au calme, la ligne `router.current() === 'sortie'` jamais vraie, pas de retour visuel pendant la préparation, pas de tests pour `Background`.

## Première ouverture de la Sortie (branche `perf/premiere-sortie`)

Constat : même avec la précompilation, la première ouverture restait longue sur téléphone (plus de 5 s sur un Pixel), et pas seulement sur Pixel. Découpage du temps avant la première image (repères `ride:*` posés par `RideView.create`) : relief de fond (`WorldLayout`), construction du monde, abords du départ, compilation, première image ; presque tout est du calcul sur le thread principal.

Changements :

1. **Vue dimensionnée à la fenêtre même masquée** (`ride-view.ts`, `resize`). Masqué, le canevas mesurait 1 × 1 px : les shaders étaient compilés pour un cadrage carré (une partie de la scène hors champ, donc non compilée) et les tampons d'image réalloués à l'ouverture.
2. **Seulement les abords avant la première image** : 400 m de relief et 300 m de décor au lieu de 1 200 et 800 m ; le reste se complète en tâche de fond (`World.fillSteps`), sans voler d'images même si la sortie est ouverte.
3. **`WorldLayout` plus rapide, au bit près** :
   - `nearestRoad` : une liste d'échantillons par case, construite une fois, au lieu de 49 recherches par appel ; données des segments pré-calculées en tableaux typés (mêmes opérations flottantes, même ordre des sommes).
   - grille du relief de fond : points de route rangés par paquets de 256 m, visités par anneaux, un paquet écarté seulement s'il ne peut rien changer (`SupportPoints`).
   - garde-fou : `world-layout-golden.test.ts` vérifie l'empreinte exacte du relief (355 000 valeurs : hauteurs, distances, route la plus proche).
4. **Premier rendu fait d'avance** pendant un temps mort de l'accueil (`requestIdleCallback`) : il compile les ombres et la passe de sortie, que `compileAsync` ne prépare pas.

Mesures (processeur de bureau, sous Node) :

| Étape | Avant | Après |
|---|---|---|
| `WorldLayout` | 225 ms | 115 ms |
| Abords du départ | 340 ms | 233 ms |
| Reste du relief et du décor (en tâche de fond) | 418 ms | 252 ms |

Mesures dans le navigateur (`tools/audit/startup.cjs`, processeur ralenti 4×, sans GPU, WebGL2), `main` (`b78e588`) contre la branche :

| | `main` | Branche |
|---|---|---|
| Sortie ouverte dès le lancement : vue 3D affichée | 13,8 s | 10,4 à 12,0 s |
| Vue prête en restant sur l'accueil (2ᵉ lancement) | 18,5 s | 12,9 à 13,5 s |
| Ouverture de la Sortie une fois la vue prête : plus longue tâche | 1,8 à 2,2 s | **0,11 à 0,13 s** |
| Chargement en restant sur l'accueil (2ᵉ lancement) : plus longue tâche | 1,1 s | 2,1 s |

La dernière ligne est le prix du rendu fait d'avance : la compilation des ombres et de la passe de sortie a lieu pendant un temps mort de l'accueil plutôt qu'au moment où l'on ouvre la Sortie. Sans GPU elle dure ~2 s (ralenti 4×) ; sur un vrai GPU, bien moins. À vérifier sur téléphone : si elle se sent sur l'accueil, la réserver au moment où l'on touche « Rouler » ou « Sortie ».

Note : `tools/audit/serve.mjs` recompressait chaque fichier en brotli maximal à chaque requête, ce qui ajoutait plusieurs secondes d'« attente réseau » aux mesures précédentes (identique pour toutes les versions comparées : les comparaisons tiennent, pas les durées absolues). Il garde désormais la version compressée.

Écran de chargement : si la Sortie est ouverte avant que la vue soit prête, une carte « Préparation de la route » affiche l'étape et l'avancement (`RideView.create`, option `onProgress`), jusqu'à la première image (`RideView.firstFrame`). Voir [docs/design/sortie.md](../../design/sortie.md#écran-de-chargement).
