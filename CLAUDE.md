# Consignes pour Claude

## Architecture : couches et classes à responsabilité unique

Le code de `src/` est rangé en couches (`shared < domain < infra < app < ui, render`) : une couche n'importe que des couches inférieures, vérifié par ESLint. Voir [docs/architecture.md](docs/architecture.md). Pour tout nouveau code :

- **Ne rien ajouter à `src/main.ts`** (4 lignes : il appelle `composeApp()`). La logique va dans une classe de `src/app/` (orchestration), `src/domain/` (règles pures, sans DOM) ou `src/infra/` (Bluetooth, réseau, stockage). Un nouvel objet à créer et à brancher va dans le module de `src/composition/` de son ensemble, jamais dans `main.ts` ; l'ordre des modules (`composition/index.ts`) compte, voir [docs/architecture.md](docs/architecture.md).
- Une classe, une responsabilité ; horloge, stockage et réseau injectés par le constructeur ; un test à côté.
- Une Vue (`src/ui/<écran>/`) affiche et signale des intentions, sans règle métier.

## Nouveautés : une entrée pour chaque fonctionnalité utile à l'utilisateur

L'écran « Nouveautés » (carte après une mise à jour, journal sur l'accueil) lit un catalogue écrit à la main : [`src/domain/whatsnew/entries.ts`](src/domain/whatsnew/entries.ts). Spec : [docs/design/nouveautes.md](docs/design/nouveautes.md). **Quand un changement apporte à l'utilisateur quelque chose qu'il voit, peut faire de nouveau ou ressent à l'usage** (nouvelle fonction, écran ou parcours, comportement qui change, amélioration visible, réglage qui suit le compte), **ajoute son entrée dans ce fichier, dans le même changement**, avant de commiter ou d'ouvrir la PR.

- `id` : `AAAA-MM-JJ-nom-court` (la date du jour), ajouté **en fin de liste** (la liste est triée, ancienne en premier) ; il ne change jamais ensuite.
- `kind` : `new` ou `improved`. `title` court ; `text` : une phrase qui dit **ce que le cycliste y gagne**, avec ses mots à lui (« elle s'affiche 250 m avant chaque intersection »), jamais ce que le code a fait. `icon` obligatoire ; `art` et `target` (où mène « Essayer ») si utiles ; `featured` seulement pour la plus marquante d'un lot.
- **Une entrée par fonction, pas par commit.** Si la fonction évolue avant d'être livrée, on modifie son entrée.
- **Pas d'entrée** pour : refonte interne (découpage du code, `main.ts`, classes extraites), tests, CI, déploiement, outillage, docs, dépendances, correction que personne n'aurait remarquée, performance qui ne se sent pas. Test : *un cycliste qui n'a jamais vu le code s'en apercevrait-il ?* Sinon, aucune entrée.
- Dis-le dans ton compte rendu : « entrée de nouveauté ajoutée : … », ou « pas d'entrée : changement interne ». `npx vitest run src/domain/whatsnew` (depuis PowerShell) vérifie l'ordre, les ids, les champs, et refuse le jargon de développeur.

## iPhone : toujours sans bordures

Sur iPhone, l'application s'affiche **sans bordures, en plein écran**, y compris dans le navigateur : pas de barres Safari autour de la page. Pour tout test, audit, capture ou calcul de mise en page sur iPhone, utiliser la **taille plein écran** de l'appareil, jamais la fenêtre réduite de Safari :

| Appareil | Paysage | Portrait |
|---|---|---|
| iPhone 13 | 844 × 390 | 390 × 844 |

Avec Playwright : `{ ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } }` (voir `tools/audit/screens.cjs`). Pas de 750 × 342 (fenêtre Safari) : ce format est hors périmètre.
