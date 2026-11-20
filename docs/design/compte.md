# Compte du coureur

Référence permanente du compte : connexion avec Strava, nom montré aux autres, données synchronisées entre appareils, mode sans compte. Toute évolution part de ce fichier et le met à jour.

- Code : [`src/ui/account/account-chip.ts`](../../src/ui/account/account-chip.ts) (pastille, menu, boîte du nom), [`src/ui/account/account.css`](../../src/ui/account/account.css) (style), [`src/infra/net/account.ts`](../../src/infra/net/account.ts) (appels au serveur) ; côté serveur [`src/server/accounts.ts`](../../src/server/accounts.ts) et [`src/server/user-strava.ts`](../../src/server/user-strava.ts).
- Branchement : fin de [`src/main.ts`](../../src/main.ts) : la pastille s'ajoute à chaque `.home-top` (Accueil, Appareils, Séances), et la connexion à la salle temps réel suit l'état du compte.
- Bouton Strava : fichiers officiels de Strava, **non retouchés** ([`public/strava/`](../../public/strava/)), tirés de l'archive des [règles de marque de l'API Strava](https://developers.strava.com/guidelines/) (révision du 29 septembre 2025).

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-16 | Le compte est **facultatif**. Sans compte, on roule seul et l'export FIT reste là ; l'envoi à Strava et les autres coureurs demandent un compte. | L'application doit marcher sans serveur et sans compte. Le multijoueur et l'envoi à Strava ont besoin de savoir qui roule. |
| 2026-11-16 | Le compte vit **en haut à droite** des écrans plein écran, en face de la marque, à sa hauteur. Pas dans les cartes, pas d'écran de connexion au lancement. | La place était libre sur les trois écrans. Rien ne bloque le chemin Appareils → Accueil → Rouler, et le compte reste visible partout. |
| 2026-11-16 | Sans compte, le **bouton officiel « Connect with Strava » orange**, dans une pastille de verre avec « Rouler avec les autres / Sans compte : seul, export FIT ». | Strava impose ses fichiers, sans retouche, et un lien vers `strava.com/oauth/authorize` (notre `/api/auth/login` y redirige). La ligne dit ce qu'on gagne, et ce qu'on garde sans compte. |
| 2026-11-16 | Connecté : une **pastille** (initiale sur l'accent, nom, « En ligne · 3 autres coureurs ») qui ouvre un menu : « Changer de nom », « Se déconnecter », et la mention « Compatible with Strava ». | Même forme que la marque. L'état en ligne dit tout de suite si les autres nous voient. La mention est l'une des deux formules permises par Strava. |
| 2026-11-16 | À la première connexion, une **boîte « Comment les autres te voient »** propose « Prénom I. » d'après Strava. Le coureur valide ou change ; « Plus tard » le laisse invisible des autres. | Les conditions de l'API Strava interdisent de montrer à un autre utilisateur les données d'un athlète. Le nom affiché devient une donnée de Ma Moulinette, choisie par le coureur. Ni photo ni activité Strava n'est montrée. |
| 2026-11-16 | **Android : connexion par l'app Strava.** Le bouton mène à `strava.com/oauth/mobile/authorize`, que l'app Strava (75.0 ou plus) intercepte : déjà connecté, on n'a qu'à toucher « Autoriser ». Si l'essai reste sans session (l'app a rendu la main à un autre navigateur que celui de Ma Moulinette), le toucher suivant, dans les 15 minutes, passe par la page web de Strava. iPhone et ordinateur : page web. | Demande de Tom : profiter de la session de l'app Strava. Sur iPhone, l'app Strava ne s'ouvre que depuis une app native (`strava://`, fenêtre de connexion système) : ce sera pour la coquille iOS. |
| 2026-11-16 | Le **menu du compte passe au-dessus des cartes** : l'en-tête des écrans a son propre niveau (`z-index: 20`). Dans le **rail de Séances** (téléphone couché), seule l'initiale tient ; le menu s'ouvre à sa droite, vers le haut ; sans compte, rien dans le rail. | Sur iPhone couché en plein écran (390 px de haut), le menu passait derrière la carte Séance. Le rail fait 54 px : la pastille débordait, et le bouton officiel Strava (198 px) n'y tient pas. |
| 2026-11-16 | **Téléphone couché** : seulement le bouton Strava (40 px de haut, comme la marque), ou la pastille réduite à l'initiale et au nom, avec un point vert sur l'initiale quand on est en ligne. | La hauteur est rare ; la phrase d'explication reste sur grand écran. |
| 2026-11-17 | **Les données du coureur suivent son compte** : FTP, masse, séances de l'éditeur et « Mes blocs ». Les réglages propres à l'appareil (trainer, protocole, braquets, parcours, affichage, appareils connus) restent sur l'appareil. | Demande de Tom : retrouver ses réglages et ses séances en se connectant sur un autre appareil. Un trainer ou un affichage dépend de l'appareil, pas du coureur. |
| 2026-11-17 | Fusion **élément par élément, la modification la plus récente gagne** ; les suppressions sont transmises. Pas de fusion à l'intérieur d'une séance. | Simple et prévisible : deux appareils qui changent deux séances différentes gardent les deux ; la même séance changée des deux côtés garde la dernière version. |
| 2026-11-17 | **Première connexion** sur un appareil : ses données (celles d'avant le compte comprises) rejoignent le compte. **Autre compte** que le précédent sur l'appareil : les données de l'appareil sont remplacées par celles de ce compte. La déconnexion n'efface rien. | Personne ne perd ce qu'il avait avant le compte ; un appareil partagé ne mélange pas les séances de deux coureurs. |

## États

| État | Ce qu'on voit | Envoi à Strava | Autres coureurs |
|---|---|---|---|
| Pas de serveur de comptes (build statique, Vite seul) | Rien | Non : export FIT | Non |
| Sans compte | Bouton « Connect with Strava » et la phrase | Non : export FIT (le bouton « Envoyer à Strava » est caché, le récapitulatif ne propose que le FIT) | Non |
| Connecté, nom à valider | Pastille « Nom à valider » ; la toucher rouvre la boîte du nom | Oui | Non : la salle le refuse tant que le nom n'est pas validé |
| Connecté | Pastille, état en ligne | Oui, sur son propre compte Strava | Oui |

États de la ligne en ligne (`worldLine`) : « En ligne · seul pour l'instant », « En ligne · N autres coureurs », « Connexion… », « Connexion perdue, nouvel essai… », « Connecté sur un autre appareil », « Mise à jour : recharger la page », « Session expirée », « Hors ligne ».

## Autres coureurs sur la Sortie

- Code : [`src/render/riders/others.ts`](../../src/render/riders/others.ts) (coureurs dans la scène), [`others-model.ts`](../../src/render/riders/others-model.ts) (voie, noms sans chevauchement), [`src/ui/ride/rider-tags.ts`](../../src/ui/ride/rider-tags.ts) (étiquettes et pastille).
- Les 16 plus proches, à moins de 220 m, sont dessinés ; leur nom et leur distance s'affichent jusqu'à 140 m, six étiquettes au plus, le plus proche gardant la sienne quand deux se recouvrent. Teinte du maillot et du vélo selon la place dans la salle.
- Encart des coureurs proches, au bord droit sous le bouton du menu (sur téléphone couché, à gauche de la colonne de boutons) : jusqu'à **7 coureurs devant**, « Toi », puis **3 derrière**, de l'avant vers l'arrière, avec un point de la couleur de leur maillot et l'écart à vol d'oiseau (+45 m, −140 m ; par 5 m, puis en km). « Devant » se décide par le cap du joueur ; portée 1,5 km. Les pistes des coureurs n'ont pas de repère commun : un écart de trajet n'existe pas. Dans le même cadre que la carte de la position, avec une bascule Liste / Carte ([sortie.md](sortie.md#encart--coureurs-et-carte)). Code : [`near-riders.ts`](../../src/ui/ride/near-riders.ts), [`ride-panel.ts`](../../src/ui/ride/ride-panel.ts), calcul dans `others-model.ts` (`nearby`).
- **Aspiration** : la ligne « Toi » affiche « Aspiration N % » en vert quand un coureur juste devant (même file, moins de 25 m) épargne de l'air ; détails et modèle dans [salle.md](salle.md). Au-delà de 33 coureurs, la salle n'envoie à chacun que ses 32 voisins les plus proches (1,5 km), de quoi remplir l'encart.
- Étiquettes de nom : fond à 34 % d'opacité et ombre portée du texte, pour rester discrètes (72 % avant le 17 novembre).
- Pastille à gauche du bouton du menu : « En ligne · N autres coureurs », cachée sans compte. Texte de 13 px (le minimum du projet est 12 px).

## Données synchronisées

- Code : [`src/infra/sync/protocol.ts`](../../src/infra/sync/protocol.ts) (éléments échangés, règles de validité, limites), [`journal.ts`](../../src/infra/sync/journal.ts) (ce qui reste à envoyer, version de chaque élément), [`client.ts`](../../src/infra/sync/client.ts) (envois et réception), [`sources.ts`](../../src/infra/sync/sources.ts) (séances, blocs) ; réglages dans [`src/main.ts`](../../src/main.ts) (`settingsSource`). Serveur : [`src/server/sync.ts`](../../src/server/sync.ts), table `user_items` (migration `0004`, [`worker/sync-store.ts`](../../worker/sync-store.ts)).
- **Une adresse**, `POST /api/sync` : la page envoie ses modifications (100 au plus) et la dernière révision reçue ; le serveur garde chaque modification plus récente que la sienne et rend ce qui a changé depuis (200 éléments par page), plus l'état final de chaque élément envoyé. Même contrôle d'origine et même en-tête anti-CSRF que les comptes.
- **Éléments** : `setting/ftp`, `setting/mass`, `setting/whatsnew-announced` et `setting/whatsnew-read` (repères de lecture des nouveautés, des textes : le client garde le plus grand, voir [nouveautes.md](nouveautes.md)), `workout/<id>`, `block/<id>`. Une suppression est gardée sans contenu, pour prévenir les autres appareils. Limites : 32 000 caractères par élément, 1000 éléments par compte.
- **Quand** : à la connexion, 1,5 s après une modification, au retour sur la page, au retour du réseau, et toutes les deux minutes tant que la page est visible. Sans compte, rien ne part : le journal (`mamoulinette.sync`) garde les modifications pour la prochaine connexion du même compte.
- **Ce qui arrive d'ailleurs** : la FTP et la masse se mettent à jour (une sortie en cours garde la masse de son départ) ; la liste des séances et l'étagère se refont ; une séance ouverte sans modification dans l'éditeur suit la nouvelle version, un brouillon modifié reste tel quel.
- **Anciennes clés** : le 17 novembre 2026, les clés du navigateur passent de `zwift2.*` à `mamoulinette.*` ; au lancement, les anciennes sont reprises sous le nouveau nom puis effacées ([`src/infra/storage/legacy-storage.ts`](../../src/infra/storage/legacy-storage.ts)). L'en-tête anti-CSRF devient `x-mamoulinette` ; l'ancien `x-zwift2` reste accepté le temps que la nouvelle version soit installée partout (le service worker sert l'ancienne au premier lancement après la mise à jour) : à retirer de [`src/shared/protocol/csrf.ts`](../../src/shared/protocol/csrf.ts) ensuite.
- Vérifié le 17 novembre 2026 : tests (serveur, SQL de D1 sur SQLite, deux appareils simulés) et application réelle avec `wrangler dev` (migration `0004` appliquée sur D1 local) : un ordinateur avec des données sous les anciennes clés, puis un iPhone 13 couché en plein écran (844 × 390), même compte ; l'iPhone a reçu la FTP, la masse et la séance, puis la FTP changée sur l'iPhone est arrivée sur l'ordinateur.

## Captures

Développement local, 16 novembre 2026 (connexion de développement et trois robots, `npm run bots`).

| | |
|---|---|
| Sans compte, ordinateur | ![](captures/compte-sans-compte-ordinateur.png) |
| Sans compte, téléphone couché | ![](captures/compte-sans-compte-telephone.png) |
| Connecté, ordinateur | ![](captures/compte-connecte-ordinateur.png) |
| Connecté, téléphone couché (écran Appareils) | ![](captures/compte-connecte-telephone.png) |
| Menu du compte | ![](captures/compte-menu.png) |
| Autres coureurs sur la Sortie, ordinateur (12 robots immobiles : 8 devant, 4 derrière) | ![](captures/compte-autres-coureurs-ordinateur.png) |
| Autres coureurs sur la Sortie, téléphone couché 844 × 390 (mêmes robots), encart collé au bord | ![](captures/compte-autres-coureurs-telephone.png) |
| Idem avec les commandes de séance affichées : l'encart passe à leur gauche | ![](captures/compte-autres-coureurs-telephone-seance.png) |
| Boîte du nom | ![](captures/compte-nom.png) |

## Développement

Sans identifiants Strava, `DEV_LOGIN=1` dans `.dev.vars` remplace le bouton Strava par « Connexion de développement » (un nom suffit). Jamais en ligne.
