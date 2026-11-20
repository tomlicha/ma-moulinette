# Nouveautés : le récap depuis la dernière visite

Spécification de l'écran **Nouveautés**, retenue et **implémentée le 20 novembre 2026** (branche `nouveautes`, voir « Implémentation »). Toute évolution part de ce fichier et le met à jour.

- Maquettes (claude.ai, canevas privé) : [Nouveautés – écran de récap](https://claude.ai/artifact/BomTq8KKgbhFrit3ctdXCd). Trois propositions, chacune sur ordinateur (1280 × 800) et iPhone paysage (844 × 390) : N1 Carte, N2 Défilé, N3 Journal.
- Retenu : **N1 + N3**. N1 est la carte qui s'ouvre une fois après une mise à jour ; son « Tout voir » ouvre N3, le journal, qui reste accessible ensuite depuis l'accueil.
- Thème « Doux » inchangé (crème, cartes blanches, accent `#C2410C`, Barlow / Barlow Condensed). iPhone : plein écran, 844 × 390, voir [CLAUDE.md](../../CLAUDE.md).
- Voir aussi : [compte.md](compte.md) (synchronisation des données du coureur), [accueil-refonte.md](accueil-refonte.md), [recap.md](recap.md) (même famille de boîte de dialogue).

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-20 | **N1 + N3** : une carte automatique courte, un journal permanent. Face à N2 (défilé en diapositives). | N1 se lit en cinq secondes. N3 absorbe le reste et l'historique. N2 s'allonge dès qu'il y a plus de trois nouveautés. |
| 2026-11-20 | **Pas de numéro de version.** L'application se déploie en continu et `package.json` n'en a pas. On compare avec un **catalogue d'entrées datées**. | L'id de la dernière entrée vue dit quelle nouveauté a été vue en dernier, ce qu'un numéro ne dit pas. |
| 2026-11-20 | Le catalogue est **écrit à la main**, au moment où l'on fusionne une fonctionnalité. | Une nouveauté se rédige pour l'utilisateur, pas pour un commit. |
| 2026-11-20 | **Seules les nouveautés utiles à l'utilisateur** y entrent ; les refontes internes, tests, CI et docs, jamais (voir « Ce qui entre au catalogue »). | Un récap qui annonce « main.ts allégé » fait ignorer les suivants. Mieux vaut une carte rare, et qui compte. |
| 2026-11-20 | Les repères de lecture **suivent le compte** (synchronisés), avec le `localStorage` en repli. | Le `localStorage` ne suit pas l'utilisateur d'un appareil à l'autre, et Safari peut l'effacer après environ 7 jours sans visite. Lire les nouveautés sur l'ordinateur évite de les revoir sur l'iPhone. |

## Ce qui entre au catalogue

**Seulement ce qui est utile à l'utilisateur** : une chose qu'il voit, qu'il peut faire de nouveau, ou qu'il ressent à l'usage. Le catalogue n'est pas un journal des changements.

| Entre | N'entre pas |
|---|---|
| Une fonction ou un écran nouveau (route arc-en-ciel, carte du carrefour, Vélodrome). | Une refonte interne : découpage du code, architecture en couches, `main.ts` allégé, classes extraites. |
| Un comportement qui change à l'usage (la sortie se met en pause quand le trainer se perd). | Les tests, la CI, le déploiement, l'outillage, les docs, les mises à jour de dépendances. |
| Une amélioration visible (thème clair en sortie, accueil refait). | Une correction qui rend le comportement attendu sans que l'utilisateur l'ait remarqué (ligne mal lissée, arrondi). |
| Un réglage ou une donnée qui suit désormais le compte. | Les mesures de performance, sauf si elles se sentent (une sortie nettement plus fluide, dite comme telle). |

- Une entrée **dit ce que l'utilisateur y gagne**, avec ses mots à lui (« elle s'affiche 250 m avant chaque intersection »), jamais ce que le code a fait (« carte extraite dans son module »).
- **Une entrée par fonction**, pas une par commit : dix commits sur l'accueil donnent une seule entrée « Un accueil refait ».
- En cas de doute, on demande : « un cycliste qui n'a jamais vu le code s'en apercevrait-il ? » Sinon, l'entrée n'existe pas.
- Une sélection à la main évite aussi qu'un lot ne contienne que de l'interne : **pas de nouveauté utile, pas d'entrée**, et la carte ne s'ouvre pas.

## Le catalogue

`src/domain/whatsnew/entries.ts` : une liste triée par date, ancienne en premier.

| Champ | Contenu |
|---|---|
| `id` | Commence par la date : `2026-11-18-route-arc-en-ciel`. **Ne change jamais** (corriger un texte ne ré-annonce rien). Se compare comme du texte. 64 caractères au plus, `[A-Za-z0-9_-]` : c'est la règle des identifiants de la synchronisation. |
| `kind` | `new` (« Nouveau ») ou `improved` (« Amélioré »). |
| `title`, `text` | Titre court ; une phrase pour N1, jusqu'à deux pour N3. |
| `featured` | Au plus une par lot de dates voisines. Elle devient le héros de N1 ; à défaut, l'entrée la plus récente. |
| `target` | Facultatif : où mène « Essayer » (écran et libellé du bouton). |
| `icon` | La petite icône de la ligne « Et aussi ». |
| `art` | Facultatif : l'illustration du héros et la vignette de N3. |

Un test garantit : ids uniques, triés, bien datés, champs complets, une seule vedette par lot.

## Ce qui est mémorisé

Trois valeurs.

| Valeur | Rôle | Où |
|---|---|---|
| `announced` | Id de la plus récente entrée **présentée dans N1**. Décide si la carte s'ouvre. | Compte (`setting/whatsnew-announced`), repli local `mamoulinette.whatsnew.announced` |
| `read` | Id de la plus récente entrée **acquittée**. Pilote le point orange de l'accueil et les puces « non lu » de N3. | Compte (`setting/whatsnew-read`), repli local `mamoulinette.whatsnew.read` |
| `visitedAt` | Date de la dernière visite, pour « il y a 9 jours ». | Appareil seulement (`mamoulinette.whatsnew.visited`) : elle dépend de l'appareil. |

Les ids se comparent comme du texte, donc **`announced` et `read` ne font qu'augmenter**.

## Quelles entrées présenter

Entrées dont l'id est **plus grand que `announced`**. Le nombre de versions manquées n'a pas d'importance : un utilisateur absent trois semaines récupère tout ce qui a été publié depuis.

| Cas | Comportement |
|---|---|
| Rien de plus récent que `announced` | Aucune carte. Seul `visitedAt` est mis à jour. |
| **Installation neuve** (pas de valeur, ni sur le compte, ni sur l'appareil, aucune autre clé `mamoulinette.*`) | On enregistre l'entrée la plus récente comme vue. Aucune carte. |
| **Utilisateur existant le jour de la sortie** (pas de valeur, mais une FTP, une masse, des appareils, des séances ou un parcours sont gardés) | Départ depuis `LEGACY_BASELINE` (`2026-11-16`, dans `entries.ts` : un repère, pas une entrée) : il voit le premier récap. |
| **Absence très longue** | N1 plafonne à 60 jours et 8 entrées. N3 garde tout le catalogue. |
| **Purge du stockage** (Safari) | Sans compte : retombe sur « installation neuve » (rien d'affiché). Avec compte : la valeur revient de la synchronisation. |

## Quand la carte s'ouvre

- À la **première arrivée sur l'accueil**, pas sur Appareils, où l'application s'ouvre et où la reconnexion du trainer est en cours.
- **Jamais pendant une sortie.** Si la mise à jour tombe pendant un trajet, la carte attend le retour à l'accueil.
- **Après la première synchronisation** du lancement, pour ne pas s'ouvrir puis se corriger quand `announced` arrive du compte. Attente de 3 secondes au plus ; hors ligne ou sans compte, on décide avec la valeur locale.

## Marquer comme vu

- **C'est parti**, la croix ou Échap : `announced` et `read` passent à la plus récente entrée.
- **Tout voir** : `announced` passe tout de suite (la carte ne se rouvrira pas) ; `read` ne passe qu'à la fermeture de N3 ou sur « Tout marquer comme vu ».
- Le **point orange** de la pastille « Nouveautés » de l'accueil est affiché tant que la plus récente entrée dépasse `read`. C'est un filet : il ne reste que si la carte a été différée ou si N3 a été quitté sans rien acquitter.

## Écrans

### N1 · Carte (automatique)

- **Ordinateur** : carte de 760 px centrée sur l'accueil flouté. « NOUVEAUTÉS », « Depuis ta dernière visite » (48 px), « 11 novembre, il y a 9 jours · 8 nouveautés ». Le héros (illustration 300 × 200, puce « Nouveau », titre 36 px, deux phrases, bouton « Essayer »). Trois lignes « Et aussi » (icône, titre en gras, une demi-phrase). Pied : « Tout voir, 8 nouveautés » à gauche, **C'est parti** (accent, 52 px) à droite.
- **iPhone paysage** : **plein écran, bord à bord**, comme tout écran iPhone ([CLAUDE.md](../../CLAUDE.md)) : ni marge, ni coins arrondis, ni fond flouté autour. Les zones sûres (encoche à droite, barre d'accueil en bas) sont des marges intérieures (`max(44px, env(safe-area-inset-right))`, 20 px en bas). Illustration de 300 px à gauche, pleine hauteur, puce sur l'image. À droite : titre 36 px, deux lignes de texte, **Essayer** (44 px), trois « Et aussi » (titre seul), « Tout voir (8) » et **C'est parti** (48 px).

### N3 · Journal (permanent)

- Accès : pastille **« Nouveautés »** dans l'en-tête de l'accueil (point orange s'il y a du non-lu) et « Tout voir » de N1. Sur iPhone, elle rejoint les icônes du coin ; elle doit tenir dans la pastille existante (44 × 44) et garder un `aria-label`.
- **Ordinateur** : panneau de 600 px à droite, accueil assombri. « Nouveautés », « 8 nouveautés depuis ta dernière visite, le 11 novembre », filtres Tout / Nouveau / Amélioré. Liste par date : jour et mois, puce (accent si non lu), titre 24 px, texte, vignette 112 × 74 pour les entrées visuelles, « Essayer → ». Section « Déjà vu » grisée (opacité 75 %). « Tout marquer comme vu » en tête de la section non lue.
- **iPhone paysage** : le panneau de 540 px de M3.5 (séances). Marge droite de 48 px. Une colonne compacte : vignettes de 96 × 64, texte de 14 px.

## Synchronisation avec le compte

Elle réutilise la synchronisation de [compte.md](compte.md#données-synchronisées) : une adresse `/api/sync`, des éléments `kind` + `id`, un journal de modifications ([`src/infra/sync/`](../../src/infra/sync/)).

- Deux nouveaux réglages : `setting/whatsnew-announced` et `setting/whatsnew-read`. Le contenu est un **texte** (l'id de l'entrée) ; aujourd'hui les réglages sont des nombres bornés ([`protocol.ts`](../../src/infra/sync/protocol.ts), `SYNC_SETTINGS`) : la règle de validité s'étend aux réglages textuels (même motif que les ids, 64 caractères au plus).
- **Piège** : la fusion du serveur est « la modification la plus récente gagne », selon l'horloge de l'appareil. Un repère qui ne doit jamais reculer pourrait reculer : un appareil resté hors ligne renvoie sa vieille valeur après l'autre.
- **Parade, côté client** : à chaque valeur reçue, on garde le **plus grand** des deux (`max`). Si la valeur locale est plus grande que celle du serveur, on la rejette dans le journal : elle repart avec un horodatage neuf et gagne. Le résultat converge vers le maximum ; le pire cas est une carte rouverte avant la correction, pendant quelques secondes. Le serveur reste inchangé.
- **Première connexion sur un appareil** : les valeurs de l'appareil rejoignent le compte (règle existante), donc elles se fusionnent en `max`. **Autre compte** : les valeurs de l'appareil sont remplacées par celles du compte (règle existante).
- Sans compte, rien ne part ; le journal garde la modification pour la prochaine connexion du même compte.
- Éléments en plus par compte : deux, sur les 1000 permis.

## Découpage du code

| Couche | Fichier | Rôle |
|---|---|---|
| `domain/` | `whatsnew/entries.ts` | Le catalogue. |
| `domain/` | `whatsnew/unseen.ts` | Sélection pure : repère, date, plafonds, cas limites. Testée sans DOM. |
| `app/` | `whats-new-marks.ts` | `WhatsNewMarks` : les repères, leur stockage et leur synchronisation (fusion en `max`, renvoi du plus grand). |
| `app/` | `whats-new.ts` | `WhatsNew` : ce que la carte présente, le non-lu, les gestes qui acquittent ; pose les repères d'un appareil neuf. |
| `ui/` | `whatsnew/` | La carte N1 et le panneau N3 : ils affichent et signalent des intentions, sans règle. |
| `composition/` | un module de l'ensemble « accueil » | Branchement ; **rien dans `main.ts`**. L'ordre des modules compte, voir [architecture.md](../architecture.md). |

## Implémentation (20 novembre 2026)

- Code : [`src/domain/whatsnew/`](../../src/domain/whatsnew/) (`entries.ts` le catalogue, `unseen.ts` la sélection pure), [`src/app/whats-new.ts`](../../src/app/whats-new.ts) (`WhatsNew`) et [`whats-new-marks.ts`](../../src/app/whats-new-marks.ts) (`WhatsNewMarks`, source de synchronisation), [`src/ui/whatsnew/`](../../src/ui/whatsnew/) (`whats-new-card.ts` N1, `whats-new-journal.ts` N3, `whats-new-chip.ts`, `whats-new-model.ts`, `whats-new-art.ts`, `whatsnew.css`), branchement dans [`src/composition/whatsnew.ts`](../../src/composition/whatsnew.ts). Balisage : la pastille `#home-news-chip` et les dialogues `#whatsnew-card` et `#whatsnew-journal` dans la section Accueil d'`index.html`.
- **Deux classes** : `WhatsNewMarks` retient les repères et les relie à la synchronisation ; `WhatsNew` décide à partir des repères et du catalogue. Quand ouvrir la carte est dans la composition.
- **Ordre de composition** : `whatsnew` vient après `account`. Celui-ci range `syncSources` (le tableau des sources, resté ouvert) et `accountSettled` (compte connu et première synchronisation passée) dans le `Wiring` ; `whatsnew` y ajoute les repères avant que la première synchronisation commence, puisqu'elle attend le réseau.
- **Ouverture de la carte** : après `accountSettled` ou 3 secondes, à la première arrivée sur l'accueil, jamais pendant une sortie ni sur une autre boîte de dialogue ouverte. `hashchange` et l'arrêt de la sortie la retentent.
- **Synchronisation** : deux éléments `setting`, textuels (`SYNC_TEXT_SETTINGS` dans [`protocol.ts`](../../src/infra/sync/protocol.ts)) ; le serveur n'a pas changé. Un test d'intégration ([`src/integration/sync.test.ts`](../../src/integration/sync.test.ts)) couvre « lire sur l'ordinateur, l'iPhone le sait » et le cas d'un appareil resté hors ligne avec une vieille valeur.
- **Sur iPhone** : la carte est plein écran (voir N1), ce qui laisse la place du bouton « Essayer ». Le journal est un panneau de 540 px collé au bord droit, haut et bas : il ne montre qu'une entrée et demie à la fois, le reste défile.
- **Vérifié** dans la vraie page avec Chromium : ordinateur 1280 × 800 et iPhone 13 paysage 844 × 390 (carte plein écran 844 × 390, rien de rogné, journal de 540 px) et Pixel 9 915 × 412. Cibles de 44 px au moins, aucun texte sous 12 px, la carte ne se rouvre pas après rechargement, le point orange disparaît à la fermeture. **Non vérifié** : un vrai iPhone, la synchronisation entre deux vrais appareils, Safari (Chromium seulement).

## À décider ou à faire

- Illustrations : ce sont des dessins SVG provisoires. À remplacer par des captures ou des scènes du monde.
- **Ajouter une nouveauté** : chaque fonctionnalité utile ajoute son entrée au catalogue dans le même changement (voir « Ce qui entre au catalogue »). C'est systématique par trois moyens : la consigne de [CLAUDE.md](../../CLAUDE.md) (lue à chaque session, elle dit quoi écrire et quand s'abstenir), la case du [modèle de PR](../../.github/pull_request_template.md), et un test qui refuse le jargon de développeur dans les textes (`unseen.test.ts`). Aucune génération depuis les commits : une nouveauté se rédige pour le cycliste. Les huit entrées de départ vont du 17 au 20 novembre.
- Si la carte ne s'ouvre pas parce qu'une autre boîte de dialogue est ouverte, elle attend la prochaine arrivée sur l'accueil ; aucune relance par minuterie.
- iPad et portrait : non dessinés (comme l'accueil).
