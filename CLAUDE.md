# Consignes pour Claude

## iPhone : toujours sans bordures

Sur iPhone, l'application s'affiche **sans bordures, en plein écran**, y compris dans le navigateur : pas de barres Safari autour de la page. Pour tout test, audit, capture ou calcul de mise en page sur iPhone, utiliser la **taille plein écran** de l'appareil, jamais la fenêtre réduite de Safari :

| Appareil | Paysage | Portrait |
|---|---|---|
| iPhone 13 | 844 × 390 | 390 × 844 |

Avec Playwright : `{ ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } }` (voir `tools/audit/screens.cjs`). Pas de 750 × 342 (fenêtre Safari) : ce format est hors périmètre.
