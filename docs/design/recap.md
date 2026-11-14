# Récapitulatif de fin de sortie

Référence permanente de l'écran **Récapitulatif**, ouvert à la fin d'une séance ou d'une sortie, avec l'envoi à Strava. Toute évolution part de ce fichier et le met à jour. L'écran est une boîte de dialogue posée sur l'écran Sortie ([sortie.md](sortie.md)).

- Code : [`src/ui/recap.ts`](../../src/ui/recap.ts) (affichage, compte à rebours, états de l'envoi), [`src/ui/recap.css`](../../src/ui/recap.css) (style), [`src/ui/recap-model.ts`](../../src/ui/recap-model.ts) (calculs purs, testés), [`src/ui/recap-demo.ts`](../../src/ui/recap-demo.ts) (aperçu sans rouler).
- Branchement : `offerRecap()` dans [`src/main.ts`](../../src/main.ts) ; envoi et FIT par [`src/export/wiring.ts`](../../src/export/wiring.ts).
- Maquettes (claude.ai) : canevas [Direction graphique](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), rangées « Récapitulatif de fin de sortie » (propositions R1 à R3) et « Récap retenu » (sombre, clair, envoyée).
- Aperçu en développement : `?recap` (séance, Strava connecté), `?recap=libre`, `?recap=connexion`, `?recap=echec`, `?recap=aucun`. L'envoi y est simulé.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-14 | **Grand écran : R1 · Ligne d'arrivée**, une carte en verre centrée sur la scène floutée. Face à R2 « Bilan » (tableau de bord plein écran) et R3 « Envoi automatique » (feuille latérale). | La sortie reste en arrière-plan : on voit où on était. Une carte, quatre chiffres, une courbe, deux boutons. |
| 2026-11-14 | **Téléphone couché : R2 · Bilan**, quelle que soit la taille du téléphone. | Sur 390 px de haut, la carte de R1 n'aurait laissé qu'une courbe minuscule ; R2 range courbe, zones et 9 mesures sur un écran, sans défilement. |
| 2026-11-14 | **Envoi automatique** repris de R3 : si Strava est connecté, le bouton orange porte un compte à rebours de 8 s, puis l'envoi part seul. | L'utilisateur voulait automatiser l'export : sans aucun geste, la sortie arrive sur Strava. |
| 2026-11-14 | « **Continuer** » (ou Échap, ou quitter l'écran) ferme le récapitulatif **sans annuler** un envoi programmé : il part tout de suite. « **Ne pas envoyer** » annule. Modifier le nom suspend le compte à rebours. | Continuer à pédaler est le geste le plus fréquent ; il ne doit pas coûter l'envoi. Annuler doit être un choix explicite. Un nom en cours de frappe ne doit pas partir à moitié écrit. |
| 2026-11-14 | **Reprise du pédalage** (arrêt, puis 5 s pédalées) : le récapitulatif s'efface et la sortie figée est libérée. Remplace la règle des 60 s de pédalage après la fin de séance. | 60 s était trop long. L'arrêt préalable évite de fermer l'écran pendant qu'on mouline encore à la fin de la séance. |
| 2026-11-14 | **Thème clair** « crème chaud » (jetons de [`src/style.css`](../../src/style.css), cartes de l'accueil) par défaut, **sombre** (verre du HUD) si le système le demande. | Mêmes thèmes que le reste de l'application. |
| 2026-11-14 | **Zones de la séance du HUD** (`--hz1` à `--hz6`), en **blocs pleins**, dans les deux thèmes. | Les teintes de `--z1` à `--z6` (écran Séances) paraissaient fades ; la courbe doit ressembler au profil vu pendant la séance. |
| 2026-11-14 | Le vert (`--ok`) pour « Séance terminée » et « blocs tenus », pas l'orange de l'application. | En thème clair, l'accent de l'application (orange brûlé) se confondrait avec l'orange Strava : le bouton Strava reste le seul orange de l'écran. |

## Quand il s'ouvre

- **Séance menée au bout du dernier palier** : la sortie est figée à cet instant (l'export s'y arrête), la sortie virtuelle continue derrière.
- **Sortie arrêtée à la main** (« Arrêter la sortie » du menu), hors séance : la sortie est figée à l'arrêt.
- Jamais sous **60 s** d'enregistrement, ni après un arrêt subi (trainer perdu), ni hors de l'écran Sortie. Une séance arrêtée avant la fin n'en ouvre pas : la sortie continue, son arrêt ouvrira le récapitulatif.
- **Reprise** : un arrêt (une seconde sans puissance ni cadence) puis **5 s de pédalage d'affilée** ferment le récapitulatif comme « Continuer » (un envoi programmé part tout de suite). Le pédalage qui continue sans arrêt après la fin, en moulinant, ne compte pas : sans cela l'écran disparaîtrait avant d'être lu. Règle : `RideRecorder.resumedAfter`, `RESUME_S` dans `wiring.ts`.
- La sortie figée reste celle de l'export jusqu'à ce que le cycliste continue (« Continuer » ou reprise). Si elle n'est pas déjà partie, l'export suivant couvre alors toute la sortie, séance comprise.

## Grand écran (R1)

Carte de 780 px au plus, centrée, sur la scène floutée (`::backdrop`, flou de 7 px et voile). De haut en bas :

1. « ✓ Séance terminée » (ou « Sortie terminée »), le nom de la séance (52 px), le lieu, le jour et l'heure de départ ; à droite la pastille « 3 blocs tenus sur 3 » (séance seulement).
2. Quatre chiffres (44 px) : durée, distance, puissance moyenne, TSS.
3. Une ligne : NP, IF, FC moyenne, cadence, travail, D+ (une mesure absente n'est pas affichée).
4. La courbe : consignes en blocs de zone, puissance réelle en trait, FTP en pointillé ; en sortie libre, la puissance elle-même en blocs de zone. Légende dessous.
5. Les actions, selon l'état de l'envoi (plus bas).

Fenêtre de moins de 700 px de haut : la carte se resserre (titre 42, chiffres 36, courbe 76 px, boutons 56).

## Téléphone couché (R2)

Même condition que les autres écrans : `(pointer: coarse) and (orientation: landscape) and (max-height: 600px)`. Plein écran, sans défilement, zones sûres respectées.

- En-tête : « BILAN » et le nom de la séance (28 px) ; à droite durée, distance, D+.
- À gauche (environ 59 %) : la courbe, puis la barre de temps par zone et sa légende (la zone la plus longue en gras).
- À droite : 9 tuiles (P moy., NP, TSS, IF, travail, cadence, FC moy., FC max, puis « 3/3 blocs tenus » en séance ou la vitesse moyenne en sortie libre).
- En bas, sur toute la largeur : le nom de l'activité, « Ne pas envoyer », Continuer, le bouton Strava avec « 8 s ». « Terminer » perd sa suite (« , retour à l'accueil ») et le FIT n'apparaît qu'une fois l'envoi réglé.

## Envoi à Strava

| État | Quand | Actions |
|---|---|---|
| `countdown` | Strava connecté | Bouton orange « Envoyer à Strava » + « envoi seul dans 8 s » et une barre qui se vide ; nom ; « Ne pas envoyer » ; FIT ; Continuer. |
| `manual` | Strava à connecter ou clé du propriétaire à saisir (il faut un geste pour ouvrir la fenêtre), ou compte à rebours suspendu | Le même bouton sans compte à rebours (« Connecter Strava et envoyer » si besoin). |
| `sending` | Envoi parti | Bouton « Envoi… » inactif. |
| `sent` | Strava a reçu le fichier | « Envoyée sur Strava à 18:43 » et le nom ; « Voir sur Strava » si Strava donne le lien ; Continuer ; Terminer ; FIT. |
| `error` | Échec, sortie gardée en mémoire | Message, bouton « Réessayer ». |
| `none` | Pas de relais Strava (build statique), ou Strava a refusé le fichier | Continuer, Terminer, FIT ; le message d'échec s'il y en a un. |

- Nom proposé : « Ma Moulinette - » puis la séance, ou le parcours. Il est modifiable avant l'envoi.
- « Continuer à rouler » devient « **Reprendre la sortie** » quand la sortie a été arrêtée ; « **Terminer, retour à l'accueil** » est alors proposé dans tous les états (sinon, fermer obligerait à relancer la sortie).
- L'identifiant externe (`zwift2-<début>`) évite un doublon chez Strava si l'envoi est refait depuis le menu.

## Données

| Affiché | Calcul (`recap-model.ts`) |
|---|---|
| Durée | temps hors pauses de l'enregistrement |
| Distance, D+ | écart des distances, somme des montées des altitudes enregistrées |
| P moy., travail | moyenne et somme des puissances à 1 Hz (une seconde sans mesure compte 0 W) |
| NP, IF, TSS | moyenne glissante sur 30 s à la puissance 4 ; IF = NP / FTP ; TSS = durée × NP × IF / (FTP × 3600) × 100 |
| FC, cadence | moyennes (cadence en pédalant seulement), FC max |
| Temps par zone | puissance mesurée, bornes de `zoneOf` |
| Blocs tenus | paliers d'effort (au moins le tempo, ni échauffement, ni récupération, ni retour au calme) roulés sur au moins 90 % de leur durée, à au moins 95 % de la consigne en moyenne, les 5 premières secondes écartées (montée du trainer) |
| Courbe | 240 points au plus ; la consigne et le palier sont notés dans chaque échantillon de l'enregistrement (`targetW`, `stepIndex`, absents du FIT) |

## Style

| Jeton | Clair | Sombre |
|---|---|---|
| `--rc-fg` | `#14171A` | `#FFFFFF` |
| `--rc-muted` | `#4F5865` | `#D3DCE8` |
| `--rc-ok` | `#23733A` | `#5BE3C9` |
| `--rc-card` | `rgb(255 255 255 / .94)` | `rgb(24 30 40 / .78)` |
| `--rc-page` (téléphone) | `#F4EDE3` | dégradé `#15263F` → `#0B1422` |
| `--rc-line` (puissance) | `#14171A`, liseré blanc | `#FFFFFF`, liseré `#0B1422` |
| `--rc-strava` | `#FC5200` | `#FC5200` |
| `--hz1` … `--hz6` | `#C4CDD8` `#2E9BFF` `#1FE07F` `#FFD60A` `#FF7A1A` `#FF2D55` | les mêmes |

Typographie : Barlow Condensed 700 pour les chiffres et le titre, Barlow 500 à 700 pour le reste ; rien sous 12 px sur téléphone.

## À faire

- Vérifier sur de vrais téléphones (iPhone 13, Pixel 9) : mesuré en émulation seulement.
- Prévenir si l'envoi échoue après la fermeture du récapitulatif (aujourd'hui : journal et bouton « Réessayer l'envoi à Strava » du menu).
- Choisir le comportement d'envoi automatique par destination quand d'autres plateformes seront branchées ([integrations.md](../integrations.md), question 4).
