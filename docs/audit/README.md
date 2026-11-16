# Audits

Un dossier par audit, daté, jamais réécrit : on compare d'un audit à l'autre.

| Date | Commit | Performance (ordi / mobile) | Accessibilité | SEO | Rapport |
|---|---|---|---|---|---|
| 16 novembre 2026 | `6b48683` | 33 / 28 | 100 (accueil) | 75 | [2026-11-16/rapport.md](2026-11-16/rapport.md) ; suivi : [réactivité du démarrage](2026-11-16/mesure-demarrage.md) |

Chaque dossier contient `rapport.md` (constats et plan d'action), `captures/` (écrans par format) et `lighthouse/` (rapports HTML complets).

Pour refaire un audit : [tools/audit/README.md](../../tools/audit/README.md). Créer un nouveau dossier daté et ajouter une ligne à ce tableau.

Convention : sur iPhone, l'app est toujours lancée en plein écran (depuis l'écran d'accueil, sans barres Safari). Les mesures iPhone se font à la taille plein écran (iPhone 13 : 844 × 390 en paysage).
