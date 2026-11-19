# Consignes pour Claude

## Architecture : couches et classes à responsabilité unique

Le code de `src/` est rangé en couches (`shared < domain < infra < app < ui, render`) : une couche n'importe que des couches inférieures, vérifié par ESLint. Voir [docs/architecture.md](docs/architecture.md). Pour tout nouveau code :

- **Ne rien ajouter à `src/main.ts`** (la racine de composition) : la logique va dans une classe de `src/app/` (orchestration), `src/domain/` (règles pures, sans DOM) ou `src/infra/` (Bluetooth, réseau, stockage).
- Une classe, une responsabilité ; horloge, stockage et réseau injectés par le constructeur ; un test à côté.
- Une Vue (`src/ui/<écran>/`) affiche et signale des intentions, sans règle métier.

## iPhone : toujours sans bordures

Sur iPhone, l'application s'affiche **sans bordures, en plein écran**, y compris dans le navigateur : pas de barres Safari autour de la page. Pour tout test, audit, capture ou calcul de mise en page sur iPhone, utiliser la **taille plein écran** de l'appareil, jamais la fenêtre réduite de Safari :

| Appareil | Paysage | Portrait |
|---|---|---|
| iPhone 13 | 844 × 390 | 390 × 844 |

Avec Playwright : `{ ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } }` (voir `tools/audit/screens.cjs`). Pas de 750 × 342 (fenêtre Safari) : ce format est hors périmètre.
