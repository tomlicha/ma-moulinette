# Audits

Un dossier par audit, daté, jamais réécrit : on compare d'un audit à l'autre.

| Date | Commit | Performance (ordi / mobile) | Accessibilité | SEO | Rapport |
|---|---|---|---|---|---|
| 16 novembre 2026 | `6b48683` | 33 / 28 | 100 (accueil) | 75 | [2026-11-16/rapport.md](2026-11-16/rapport.md) ; suivi : [réactivité du démarrage](2026-11-16/mesure-demarrage.md), [état du plan d'action](2026-11-16/suivi.md) |
| 17 novembre 2026 (iPad) | `7e9c992` | — | 0 violation axe (paysage) | — | [2026-11-17/ipad.md](2026-11-17/ipad.md) ; suivi : [corrections](2026-11-17/ipad-suivi.md) |

Chaque dossier contient `rapport.md` (constats et plan d'action), `captures/` (écrans par format) et `lighthouse/` (rapports HTML complets).

Pour refaire un audit : [tools/audit/README.md](../../tools/audit/README.md). Créer un nouveau dossier daté et ajouter une ligne à ce tableau.

Convention : sur iPhone, l'app est toujours lancée en plein écran (depuis l'écran d'accueil, sans barres Safari). Les mesures iPhone se font à la taille plein écran (iPhone 13 : 844 × 390 en paysage).
