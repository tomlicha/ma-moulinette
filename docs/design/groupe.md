# Sortie de groupe : séance ensemble, rejoindre, suivre

Spec du 20 novembre 2026. **Codé le 20 novembre 2026** : le suivi en sortie libre, la liste « En ligne » avec recherche, la séance de groupe, les amis (dans l'application). Voir « État de l'implémentation ». Références : [salle](salle.md) (relais et aspiration), [compte](compte.md), [synchronisation](synchronisation.md), [sortie](sortie.md).

## Ce qu'on veut

1. **Séance de groupe** : plusieurs coureurs font la même séance, ensemble. Quelle que soit la puissance de chacun, **le groupe reste groupé** sur la route.
2. **Sortie libre de groupe** : on peut **rejoindre un coureur déjà en sortie** (un ami, ou un coureur en ligne qui l'accepte), et il y a un **mécanisme de suivi** pour rester collé à lui.

Décisions de Tom (20 novembre 2026) :

| Question | Décision |
|---|---|
| Comment le groupe reste-t-il ensemble en séance | **Allure commune par % de FTP** (voir plus bas) |
| Comment rejoint-on | **Amis Strava** et **coureurs en ligne** ; **pas de lien ni de code** |
| « Suivi » | **Rester collé à la personne rejointe** (écart, aide pour revenir, décrochage) |

## Ce qui existe et que la fonction réutilise

- **La salle** (`src/server/room.ts`, un Durable Object, un seul monde) : chaque client simule sa propre position et envoie son état 4 fois par seconde ; le serveur relaie sans rien simuler. Chaque coureur y a un `slot`, un `userId` (compte Strava) et un nom.
- **La physique est déterministe** : `Ride` avance par pas fixes de 50 ms et son résultat « ne dépend pas de la cadence d'appel » ; `WorkoutRunner.advance(dt)` est pur lui aussi. Deux clients qui lui donnent les mêmes entrées obtiennent la même position. C'est ce qui rend la séance de groupe possible **sans que le serveur simule quoi que ce soit**.
- **L'aspiration** (`draft.ts`) : calculée côté client, derrière le coureur de devant.
- **Le suivi de piste distant** (`RemoteTrack`, `Interpolator`) : un coureur lointain se rend sur le réseau commun.

Ce qui manque : la notion de **groupe** côté serveur, une **horloge commune**, un moyen de **se placer sur la position d'un autre** (`Journey` sait `setCourse` et `reset`, pas « se placer en `NetPosition` »), la **relation d'amitié**, et une **séance pilotée par une horloge extérieure**.

## 1. Séance de groupe : l'allure commune

### Principe

Chacun roule **en ERG sur son propre palier** : 80 % de la FTP de Lucie, c'est 200 W pour elle et 280 W pour Marc à 350 de FTP. Les deux fournissent le même **effort relatif**. Le groupe avance donc au même rythme **par construction** : sa vitesse est celle du **créateur du groupe** (sa FTP et sa masse, fixées à la création : décision de Tom du 20 novembre 2026, « allure du groupe, distance et vitesse calées sur le leader ») qui roulerait à ce même pourcentage, sur la pente du moment.

- La **puissance réelle** de chacun reste mesurée, affichée et exportée dans son FIT. Elle **n'influe pas** sur la position.
- Chacun voit les autres **dans le même peloton** : mêmes positions, avec un léger décalage latéral et longitudinal par rang d'arrivée, pour ne pas se superposer.
- Le **trainer** reçoit la pente comme d'habitude (ERG engagé : la pente est sans effet, voir `parcours-reseau`). Rien ne change pour le matériel.

### Comment chaque client connaît la position du groupe

Pas de simulation côté serveur : **chaque client rejoue la même simulation du « point de groupe »** :

```
position(t) = Ride(parcours imposé, cycliste du créateur : sa masse)
              avancé de (t − t0) avec la puissance virtuelle  pct(t) × FTP du créateur
```

où `t0` est l'instant de départ **en heure du serveur** et `pct(t)` vient de la séance (le `WorkoutRunner`, piloté par `t − t0`). Tous les clients ont donc la même position sans se parler en continu.

- **Horloge commune** : le serveur envoie son heure à la connexion et sur un `ping` toutes les 30 s ; le client garde le décalage (`serverOffsetMs`). Un écart de quelques centaines de ms n'est pas visible.
- **Arriver en retard ou se reconnecter** : le client rejoue la simulation de `t0` à maintenant en accéléré (une heure de séance, 72 000 pas de 50 ms : une fraction de seconde). Il est alors **déjà dans le groupe**, et sa séance reprend au bon palier.
- **Parcours imposé, carrefours choisis par le créateur** : le créateur choisit le parcours à la création ; aux intersections, c'est lui qui choisit la route, les autres suivent (voir « Carrefours en groupe » plus bas). Sans choix de sa part, le parcours (sinon le tout droit) l'emporte, comme en solo.
- **Pas de pause du groupe** : la séance suit l'horloge. Se reconnecter ramène au bon endroit.
- **Contrôle de cohérence** : les états envoyés à la salle (`STATE`) contiennent déjà la position. Un client dont la position s'écarte de plus de 30 m de la majorité des autres se **recale** (dérive, version différente). Les versions de protocole et la signature du réseau sont déjà vérifiées à la connexion.

### Qui décroche

« Peu importe l'intensité » ne veut pas dire « même sans pédaler » :

- Un coureur sous 5 W pendant **30 s** est marqué **« à l'arrêt »** : son avatar reste dans le groupe, grisé.
- Après **60 s** sans pédaler, il **quitte le groupe** : son avatar reste sur place, il ne compte plus dans les messages du groupe. Il peut **rejoindre à nouveau** d'un geste (il est replacé sur le groupe).
- Un coureur **hors séance** (pas d'ERG engagé, ou séance abandonnée) sort du groupe de séance.

### La séance de chacun

La séance est la même pour tous (même fichier, identifiant partagé ; le serveur garde la séance **complète**, une séance de groupe n'est donc pas limitée à la bibliothèque de chacun). Le **% de FTP** vient de la séance, la **puissance cible** de la FTP de chacun. L'intensité globale réglable (`intensity`) s'applique à la cible de chacun, **pas à l'allure du groupe**, pour ne pas désynchroniser.

## 2. Sortie libre : rejoindre quelqu'un

### Qui peut être rejoint

Un réglage par coureur, **« Qui peut me rejoindre »** : **Personne** / **Mes amis** (défaut) / **Tous les coureurs en ligne**. Il suit le compte (synchronisation des réglages). Il ne s'applique qu'à ceux qui sont **en sortie** à cet instant.

### Où on rejoint

- **Encart des coureurs proches** et **liste « En ligne »** sur l'accueil : un bouton **Rejoindre** sur chaque coureur en sortie qui l'accepte. Les amis sont en tête de liste, avec une pastille.
- Le coureur rejoint est **prévenu** (« Lucie vous rejoint ») et peut **refuser** dans les 5 s ; sans réponse, c'est accepté (on ne bloque pas un coureur concentré sur son effort).
- Le coureur qui rejoint est **placé 10 m derrière** lui, sur la même route et dans le même sens (il lui faut une fonction « se placer sur une `NetPosition` » dans `Journey` : voir « À construire »). Il roule ensuite normalement, avec **sa** puissance : c'est la sortie libre.

### Les amis

La relation est **réciproque et propre à l'application** : on **suit** un coureur depuis son nom (encart, liste, fiche du coureur) ; deux coureurs qui se suivent mutuellement sont **amis**. Elle est stockée dans D1 par identifiant de compte et suit le compte.

**Point à lever avant de coder : « amis Strava ».** L'API Strava a un point d'accès `athlete/friends`, mais **je n'ai pas pu confirmer qu'il soit ouvert aux applications ordinaires** (un fil du forum Strava de juin 2025 rapporte un 401 ; le journal officiel des changements ne le mentionne pas ; la page de l'accord d'API déconseille d'afficher les données d'un autre athlète). Et notre application est limitée à 10 athlètes : la plupart des amis Strava d'un coureur n'y ont **pas de compte**. D'où le choix de départ : **amis dans l'application, identifiés par leur compte Strava**, avec en option **l'import des amis Strava déjà inscrits** si l'essai (un appel réel avec le jeton de Tom) montre que le point d'accès répond. Sinon, la liste se construit à l'usage.

### Vie privée

- Le **nom affiché** (déjà validé par le coureur) est tout ce qu'un autre voit ; pas de fréquence cardiaque (elle ne quitte pas l'appareil, voir `protocol.ts`).
- Un coureur **peut se rendre invisible** pour la liste « En ligne » (réglage « Personne »).

## 3. Le suivi : rester collé

Quand on a rejoint quelqu'un, un mode **Suivre** est actif. Il est **volontairement une aide, pas un moteur** : il ne fait jamais avancer plus vite que le meneur, il aide à **revenir**.

| Élément | Règle |
|---|---|
| **Écart** | Affiché au HUD : mètres et secondes (« 14 m · 3 s »), avec une flèche si le suivi est devant ou derrière. |
| **Aide pour revenir** | Si l'écart dépasse 15 m, une **aspiration de rappel** s'ajoute : la part de traînée épargnée (celle de `draft.ts`, jusqu'à 35 %) est appliquée comme si le meneur était à 5 m, **à condition d'être à moins de 150 m derrière**. Au-delà de 150 m, aucune aide : le coureur roule seul pour recoller. L'aide ne dépasse jamais le meneur. |
| **Décrochage** | Écart de plus de 150 m pendant 60 s : « Vous avez décroché », le suivi **se met en pause** (bouton **Reprendre** qui replace derrière lui s'il roule encore). |
| **Le meneur s'arrête** | Plus de 10 s sans rouler : « Lucie a fait une pause » ; le suivi attend 2 min, puis se termine. |
| **Soi-même à l'arrêt** | 60 s sans pédaler : le suivi se termine. |
| **Quitter** | Un bouton **Arrêter de suivre**. Le meneur peut aussi demander à ne plus être suivi. |
| **Plusieurs suiveurs** | Autorisés. Chacun mesure son écart à **la même personne**, pas à un autre suiveur. Pas de chaîne. |
| **Séance** | Suivre quelqu'un **ne met pas** dans sa séance : c'est la sortie libre. Pour la séance, on rejoint le **groupe** (section 1). |

L'aide est **calculée côté client** avec l'état du meneur reçu (comme l'aspiration) ; le serveur n'a besoin que de savoir **qui suit qui**, pour prévenir le meneur et nourrir l'écran « Mon groupe ».

## 4. Écrans

- **Accueil** : carte **« Rouler avec d'autres »** : amis en ligne (en sortie, en séance, au repos), coureurs en ligne, groupes de séance ouverts. Un bouton **Créer une séance de groupe**.
- **Création d'une séance de groupe** : choix de la séance (bibliothèque), du parcours, de **l'heure de départ** (dans 2, 5 ou 10 minutes, ou « quand tout le monde est prêt »), de qui peut la voir (**mes amis** / **tous**). Les invités reçoivent une notification dans l'application.
- **Salle d'attente** : liste des coureurs prêts, compte à rebours commun, les coureurs sont sur la ligne de départ. Le départ est donné **à l'heure** (`t0`), pas au dernier arrivé.
- **HUD de sortie** : pastille **« Groupe · 6 »**, écart au meneur, liste des membres avec leur **% de FTP** (pas leurs watts : on compare des efforts, pas des moteurs). Pour le suivi : l'écart et le bouton **Arrêter de suivre**.
- **Récapitulatif** : le nom du groupe, les coureurs avec qui on a roulé, et le temps passé **dans** le groupe.
- **Tous les écrans** : iPhone en paysage plein écran, 844 × 390, sans bordures (voir CLAUDE.md et `mobile-paysage`).

## 5. Serveur et protocole

### Groupes dans la salle

La salle actuelle reste **un seul monde**. On y ajoute des **groupes**, sans nouvel objet Cloudflare :

```
Group { id, kind: 'workout' | 'follow', leaderUserId, members: userId[], t0?: serverEpochMs,
        workoutId?, courseId?, visibility: 'friends' | 'all' }
```

Messages JSON (rares) en plus de `welcome`/`join`/`leave` :

| Sens | Message | Rôle |
|---|---|---|
| client → serveur | `groupCreate { kind, workoutId, courseId, startAt, visibility }` | crée une séance de groupe |
| client → serveur | `groupJoin { groupId }` · `follow { slot }` · `unfollow` · `groupLeave` | rejoindre, suivre, quitter |
| serveur → client | `groupState { id, kind, leader, members: [{slot, name, status}], t0, workoutId, courseId }` | l'état du groupe, à chaque changement |
| serveur → client | `followRequest { slot }` · `followEnded { reason }` | prévient le meneur, annonce la fin |
| client ↔ serveur | `time { clientMs } → { clientMs, serverMs }` | horloge commune |

Les **états binaires** (`STATE`, `SNAPSHOT`) ne changent **pas**. La **gestion d'intérêt** doit toutefois **toujours inclure les membres du groupe** dans les voisins envoyés, même au-delà de 1,5 km.

### Vérifications du serveur

- Rejoindre : le serveur applique « Qui peut me rejoindre » **lui-même** (le client ne décide rien).
- Séance de groupe : maximum **30 membres** à la première version ; au-delà, nouvelle salle de départ.
- Les amis : table D1 `friendships (user_id, friend_id, created_at)`, migration `0005`.

### Cas limites

| Cas | Comportement |
|---|---|
| Le meneur d'une séance part | Le groupe continue (sa position vient de l'horloge, pas de lui) ; le **meneur change** pour le plus ancien membre. |
| Le meneur d'un suivi part | Le suivi se termine (`followEnded: 'left'`). |
| Même compte sur deux appareils | Déjà géré : l'ancienne connexion est remplacée. |
| Déconnexion pendant la séance | Reconnexion automatique, reprise par accéléré. Après 10 min absent, le coureur est retiré du groupe. |
| Coureur sans trainer en séance de groupe | Impossible de rejoindre (ERG exigé). Les coureurs sans trainer **suivent** seulement, sans effort. |
| Parcours différent selon le coureur | Rejoindre en suivi **change de parcours** pour celui du meneur ; en séance, le parcours est celui du groupe. |
| Version de l'application différente | Déjà refusée à la connexion (`CLOSE_OUTDATED`). |

## 6. À construire, dans l'ordre

Chaque étape est livrable et testable seule. Respecter [l'architecture](../architecture.md) : rien dans `main.ts`, un module de composition `group`, une classe par responsabilité, un test à côté.

1. **Domaine** (`src/domain/group/`) : `group-pace.ts` (le point de groupe : `Ride` + puissance virtuelle `pct × REF`), `follow.ts` (écart, aide, règles de décrochage), `group-model.ts` (statuts, rangs de placement). Tests : même position chez deux simulations décalées dans le temps ; reprise en accéléré.
2. **`Journey`** : se placer sur une `NetPosition` (dans le sens donné, sur la route donnée), `setCourse` sans réinitialiser.
3. **Serveur** : groupes dans `Room`, messages, horloge, `friendships` (D1), « Qui peut me rejoindre ». Intérêt qui garde les membres.
4. **Client réseau** : `WorldClient` (messages de groupe, horloge) ; `GroupSession` dans `app/` (le groupe courant) ; `FollowSession` dans `app/` (le suivi en cours) ; `ExternalClockWorkout` ou un mode horloge extérieure de `WorkoutSession`.
5. **Suivi** en sortie libre : bouton « Rejoindre », écart au HUD, aide. C'est la **plus petite tranche utile** et celle qui prépare l'amitié.
6. **Séance de groupe** : création, salle d'attente, départ commun, HUD.
7. **Amis** : suivre un coureur, liste, import Strava si l'essai le permet.

Étapes **1 → 5 d'abord** : la sortie libre avec suivi, sans séance de groupe. La séance de groupe demande l'horloge et la simulation partagée, qui sont le vrai risque technique.

## État de l'implémentation (20 novembre 2026)

Fait (étapes 1 à 5 de « À construire ») :

| Morceau | Où |
|---|---|
| Règles du suivi : écart signé, aide de rappel (≈ 15 %, entre 15 et 150 m derrière), décrochage à 60 s au-delà de 150 m, pause du meneur (message à 10 s, fin à 2 min), meneur perdu (10 s), arrêt de soi-même (60 s) | [`domain/group/follow.ts`](../../src/domain/group/follow.ts) |
| `Journey.placeAt` : repartir derrière la position d'un autre coureur, distance 0 = ce point (la première route a un `startM` négatif : tout le reste du trajet, du FIT au HUD, compte depuis là) | [`domain/sim/journey.ts`](../../src/domain/sim/journey.ts) |
| Messages JSON du suivi, partagés par le serveur et le client | [`infra/net/group-protocol.ts`](../../src/infra/net/group-protocol.ts) |
| Salle : « qui suit qui » (`FollowBook`), « Qui peut me rejoindre », refus, annonces, départ de l'un ou de l'autre ; le réglage est gardé dans la pièce jointe du WebSocket pour survivre à un réveil du Durable Object | [`server/room.ts`](../../src/server/room.ts), [`server/follow-book.ts`](../../src/server/follow-book.ts), [`worker/world-room.ts`](../../worker/world-room.ts) |
| Client de la salle : `follow`, `unfollow`, `refuseFollower`, `setJoinable`, `onGroup` | [`infra/net/world-client.ts`](../../src/infra/net/world-client.ts) |
| `FollowSession` : le suivi en cours et la liste de ceux qui nous suivent ; l'aide passe à `RideSession` (`assist`), qui garde la meilleure de l'aide et de la vraie aspiration | [`app/follow-session.ts`](../../src/app/follow-session.ts), [`app/ride-session.ts`](../../src/app/ride-session.ts) |
| Écran : icône « rattraper » sur chaque ligne de l'encart des proches ; panneau du HUD sous « Sortie libre » (qui on suit, écart, **Arrêter** ; qui nous suit, **Refuser** ; messages passagers) ; réglage « Les autres peuvent me rejoindre » dans le menu de la sortie | [`ui/ride/near-riders.ts`](../../src/ui/ride/near-riders.ts), [`ui/ride/follow-view.ts`](../../src/ui/ride/follow-view.ts), [`composition/group.ts`](../../src/composition/group.ts) |
| Entrée « Nouveautés » : `2026-11-20-suivre-un-coureur` | [`domain/whatsnew/entries.ts`](../../src/domain/whatsnew/entries.ts) |

Tests : règles et `Journey.placeAt` (unitaires), salle (`room-follow.test.ts`), `FollowSession`, textes du panneau, deux vrais `WorldClient` contre la vraie `Room` (`integration/follow.test.ts`), et le scénario `npm run e2e -- group` (iPhone 13 paysage 844 × 390 plein écran, salle simulée, trainer simulé : suivre, écart affiché, être suivi, refuser, arrêter, fin, réglage).

### Écarts avec la spec ci-dessus

- **Deux façons de rejoindre.** Sortie **déjà en cours** : on **rattrape** le coureur (mode `chase`), sans changer de place : la distance du fichier FIT reste continue, pas de saut de plusieurs centaines de mètres. Sortie **pas encore démarrée** : la sortie repart **10 m derrière lui** (mode `place`, `Journey.placeAt`). Il faut un trainer connecté dans les deux cas.
- **Pas de suivi en séance** : l'icône disparaît et un suivi en cours s'arrête quand une séance démarre. La séance fixe la puissance ; rattraper quelqu'un n'y a pas de sens.
- ~~**« Qui peut me rejoindre » : tous ou personne**~~ Remplacé le 20 novembre 2026 : un menu **Tout le monde / Mes amis / Personne** (voir « Les amis »). Le défaut reste **tout le monde**, non « mes amis » comme la spec le voulait : ce choix de confidentialité reste à Tom. Le réglage est **gardé sur l'appareil**, pas encore synchronisé avec le compte.
- **Refus : sans délai de 5 s.** Le coureur suivi voit « Marc te suit » avec **Refuser** tant que l'autre le suit ; le suiveur reçoit « préfère rouler seul ».
- **Décrochage : reprise automatique.** Pas de bouton **Reprendre** : si l'écart repasse sous 150 m, le suivi repart tout seul.
- **Gestion d'intérêt inchangée** : le coureur suivi reste dans les 1,5 km autour du suiveur tant que le suivi tient (le décrochage intervient bien avant). Rien à garder de plus côté serveur.

### Liste « En ligne » et séance de groupe (même jour)

| Morceau | Où |
|---|---|
| `who` : la salle répond aux coureurs en ligne (en sortie d'abord, nom sans accents ni majuscules, 30 au plus, sans soi ni ceux qui ont réglé « personne ») et aux groupes ouverts ; une réponse par seconde et par coureur au plus | [`server/room.ts`](../../src/server/room.ts) |
| Groupes : création (départ borné entre 30 s et 30 min), arrivée, départ, fermeture 10 min après la fin de la séance, 30 coureurs et 50 groupes au plus ; un coureur dans un seul groupe | [`server/groups.ts`](../../src/server/groups.ts) |
| Horloge commune : `time` renvoie l'heure du serveur ; le client garde la mesure d'aller-retour la plus courte et mesure de nouveau toutes les 30 s | [`app/group-session.ts`](../../src/app/group-session.ts) |
| Séance reçue du réseau relue strictement (bornes, genres, champs inconnus écartés) des deux côtés | [`domain/workout/wire.ts`](../../src/domain/workout/wire.ts) |
| **Point de groupe** : la sortie avance comme le **créateur** (sa FTP et sa masse, envoyées à la création et gardées même s'il part) qui roulerait la séance au même %, par pas fixes de 100 ms ; même position chez tous, quelle que soit la cadence des appels ou l'heure d'arrivée | [`domain/group/group-pace.ts`](../../src/domain/group/group-pace.ts), [`app/ride-session.ts`](../../src/app/ride-session.ts) (`pacing`) |
| `WorkoutSession` à horloge extérieure (`start(clockS)`) : on arrive au bon palier, même en retard ; ni pause ni palier suivant ; l'intensité ne change que sa propre consigne ERG | [`app/workout-session.ts`](../../src/app/workout-session.ts) |
| Trajet identique pour tous : `Journey.lockChoices` (pas de carrefour annoncé ni de sortie de piste) | [`domain/sim/journey.ts`](../../src/domain/sim/journey.ts) |
| Écran : pastille « En ligne » sur l'accueil, panneau « Rouler avec d'autres » (recherche, groupes, créer, salle d'attente avec décompte), pastille de la sortie « Séance de groupe · N coureurs », « Quitter la séance de groupe » à la place d'« Arrêter » | [`ui/online/`](../../src/ui/online/), [`composition/online.ts`](../../src/composition/online.ts) |

Tests : `wire`, `group-pace` (déterminisme), `Groups` et `Room` (`room-group.test.ts`), `GroupSession` (horloge simulée), `WorkoutSession` synchronisée, `RideSession` à rythme imposé, textes du panneau, et le scénario `npm run e2e -- online` (iPhone 13 paysage, salle simulée : pastille, panneau, recherche, rejoindre un coureur, créer un groupe, salle d'attente, départ, séance verrouillée, quitter).

### Les amis (20 novembre 2026)

Décision de Tom : **on ajoute un ami depuis la liste « En ligne », sans réciprocité, rangé dans D1 par compte Strava.** (Les amis Strava eux-mêmes sont inaccessibles, voir plus bas.)

- **Ajouter, retirer** : une **étoile** sur la ligne de chaque coureur de la liste « En ligne » (pleine : c'est un ami). Le geste se voit tout de suite ; si le serveur refuse (100 amis au plus, compte inconnu, connexion perdue), la liste revient en arrière avec un message.
- **À sens unique** : j'ajoute un coureur sans qu'il le sache et sans qu'il ait à accepter. Rien n'indique à l'autre qu'il est mon ami.
- **D1** : table `friends (user_id, friend_id, created_at)`, migration [`0006_friends.sql`](../../worker/migrations/0006_friends.sql), suppression en cascade avec le compte. **À appliquer en production** (`wrangler d1 migrations apply`) avant de déployer. Adresse `/api/friends` : `GET` la liste (avec les noms que les amis montrent aux autres), `POST { add }` ou `{ remove }` ([`server/friends.ts`](../../src/server/friends.ts), [`worker/friend-store.ts`](../../worker/friend-store.ts)). Seuls les comptes au **nom validé** peuvent être ajoutés ; on ne s'ajoute pas soi-même.
- **La salle** : à la connexion et à chaque changement, la page lui dit sa liste (`friends`, jusqu'à 100 identifiants de compte). Elle sert à **deux choses seulement**, pour ce coureur : (1) **mes amis en tête** de la liste « En ligne » ; (2) **« Qui peut me rejoindre : Mes amis »** : les **amis du coureur suivi**, ceux qu'**il** a ajoutés (pas l'inverse : ajouter quelqu'un ne donne aucun droit sur lui). Les listes sont rangées dans le stockage du Durable Object (`friends:<compte>`) et reprises après un redémarrage pour les comptes encore connectés ; celle d'un compte qui part est effacée.
- **« Qui peut me rejoindre »** devient un **menu à trois choix** dans le menu de la sortie : Tout le monde (défaut), Mes amis, Personne. La liste « En ligne » dit si on peut rejoindre quelqu'un (`open`) : un coureur « amis seulement » dont on n'est pas l'ami n'a pas de bouton « Rejoindre » (« en sortie · amis seulement »).
- **Les identifiants de compte** des coureurs en ligne (`uid`) sont donnés par la salle pour pouvoir les ajouter ; ils ne sont pas les identifiants Strava.
- Protocole **version 3**. Tests : `friends.test.ts` (serveur), `friend-store.test.ts` (D1 simulé avec le vrai SQL et les vraies migrations, et mémoire), `room-friends.test.ts`, `world-room.test.ts` (redémarrage), `friends-list.test.ts`, `group-protocol.test.ts`, et le scénario `online` (ajouter puis retirer un ami, serveur de comptes et salle simulés).
- **Pas fait** : les amis **hors ligne** ne sont pas listés (la liste ne montre que ceux qui sont en ligne), et le réglage « Qui peut me rejoindre » ne suit pas le compte.

### Amis Strava : impossible, liste globale à la place

Décision de Tom (20 novembre 2026) : « prendre les amis Strava si possible, sinon la liste globale des gens en ligne avec une recherche ». **Ce n'est pas possible** (revérifié le 20 novembre 2026 dans la spécification officielle `swagger.json` de l'API Strava : 29 chemins, aucun « friends », « followers » ou « following » ; l'application ne demande d'ailleurs que le droit `activity:write`) : l'endpoint `athlete/friends` de l'API Strava a été retiré en janvier 2018 (le support de Strava l'a confirmé à des développeurs, d'après le fil du groupe strava-api ; le journal officiel des changements ne le remet pas). Notre application, limitée à 10 athlètes, n'aurait de toute façon connu que peu d'amis. D'où la **liste globale avec recherche par nom**. La valeur « mes amis » de « Qui peut me rejoindre » reste côté serveur, inutilisée : une liste d'amis dans l'application serait un chantier à part.

### Carrefours en groupe : le créateur choisit (20 novembre 2026)

Décision de Tom : **le créateur du groupe choisit** (pas de vote). Tous les clients doivent faire exactement le même trajet, donc le choix du créateur doit être connu de chacun **avant que sa simulation ne valide la route** (40 m avant le nœud, `LOCK_M`).

- **Désigner un carrefour** : par le **rang de la route** dans le trajet (`PendingJunction.legIndex`, soit `committed.length`). Tous les clients suivent le même chemin, donc ce rang est le même chez tous.
- **Le créateur** touche une option (HUD ou flèches du clavier) : `Journey.choose` n'applique rien lui-même, il appelle `GroupRouting.decide(leg, index)` ; le message `groupRoute` part à la salle, qui le **renvoie à tous les membres, créateur compris**. Chacun l'applique à son retour (`GroupRouting.choiceFor`), au moment où son trajet valide la route : le créateur n'a donc pas d'avance sur les autres.
- **Fenêtre de choix** : ouverte de 250 m à **100 m** du carrefour (`DECIDE_CLOSE_M` = `LOCK_M` + 60 m). Au-delà, le choix est verrouillé (le message doit arriver chez tous avant le verrou, à 40 m). Le créateur peut changer d'avis tant que la fenêtre est ouverte (le dernier message compte).
- **Les autres** voient le panneau du carrefour, touches grisées, avec « Le créateur du groupe choisit » ; la route retenue est surlignée dès que le choix arrive, sur le panneau comme sur la carte de l'encart.
- **Sans choix à temps**, le parcours (sinon le tout droit) l'emporte, pour tous : la règle du mode solo.
- **Arrivée en retard ou reconnexion** : `groupState` porte tous les choix déjà faits (`routes`) ; la simulation rejouée d'un trait les relit, et retombe sur le même trajet (testé : présent depuis le départ ou arrivé en retard, même point).
- **Le créateur part** : le plus ancien membre qui reste devient créateur (`leader` dans `groupMembers`) ; il choisit aux carrefours suivants.
- **Serveur** : seul le créateur est écouté (`Groups.route`), rang et option bornés (rang ≤ 10 000, option ≤ 9), 2000 choix au plus par groupe. Il ne simule rien.
- **Limite connue** : si un message de choix arrivait *après* qu'un client ait validé la route (onglet endormi, réseau très lent), ce client prendrait la route par défaut et sortirait du groupe sans le savoir. La fenêtre de 60 m (plusieurs secondes aux vitesses de groupe) l'évite en pratique ; pas de recalage tant qu'aucun écart n'est observé.

Tests : `group-routing.test.ts` (choix, fenêtre, option absurde, déterminisme), `room-group.test.ts` (relais, créateur seul, historique, relève), `group-session.test.ts`, et le scénario `npm run e2e -- route` (iPhone 13 paysage : créateur qui choisit et voit son choix revenir, puis suiveur aux touches grisées).

### Allure du créateur (20 novembre 2026)

Décision de Tom : **l'allure du groupe, la distance et la vitesse sont calées sur le leader**, c'est-à-dire sur le **créateur** du groupe.

- À la création, le client envoie sa **FTP et sa masse** (`ftpW`, `massKg` dans `groupCreate`, bornées côté serveur : 50 à 700 W, 30 à 250 kg). Le serveur les garde et les donne à tous (`groupState`).
- Chacun simule le **cycliste du créateur** (`GroupPace` reçoit un `GroupRef`) : la puissance virtuelle est le % du palier × la FTP du créateur, sur la masse du créateur. Un créateur plus fort fait donc un groupe plus rapide. Les valeurs par défaut (250 W, 75 kg) ne servent plus que de repli.
- **Elles ne changent pas si le créateur part** : l'allure est celle de la création. Seul le choix des routes aux carrefours passe au plus ancien membre (voir plus bas). Changer l'allure en cours de route ferait diverger les simulations.
- La **distance et la vitesse du fichier FIT et de Strava** sont celles du groupe, donc celles du créateur ; la puissance enregistrée reste la puissance **réelle** de chacun.
- **Vie privée** : les membres connaissent la FTP et la masse du créateur, de quoi retrouver la vitesse du groupe. Elles ne sont envoyées qu'en créant un groupe, et seulement à ses membres.
- Le protocole passe à la **version 2** (`PROTOCOL_VERSION`) : un ancien client est invité à recharger la page.

### Recalage d'une dérive (20 novembre 2026)

Un client qui rate un choix de route (onglet endormi, réseau très lent) prend la route par défaut et sort du groupe **sans le savoir**. Il s'en aperçoit en se comparant aux autres ([`domain/group/drift.ts`](../../src/domain/group/drift.ts)) :

- **Dans le groupe** : à moins de 30 m d'au moins la moitié des autres membres qui roulent et qu'on reçoit. **Dérive** : hors du peloton pendant 6 s d'affilée, ou (sans voir personne alors qu'il y a du monde) pendant 20 s.
- **Recalage** : le client redemande l'état du groupe à la salle (`groupJoin` du même groupe), qui renvoie **tous les choix de route** ; la sortie repart du début du parcours (`Journey.reset`, `RideSession.repace`) et la simulation rejoue d'un trait jusqu'au temps du groupe. Il retombe sur le même point que les autres (testé : après un choix raté, écart de plus de 100 m ; après recalage, position identique). Un message « Recalé sur le groupe » s'affiche.
- **On n'insiste pas** : au plus un recalage toutes les 30 s et trois d'affilée (compteur remis à zéro après une minute dans le peloton). Si c'est l'autre qui a tort, ou si le rejeu ne change rien, le client s'arrête là.
- **Un saut dans le fichier FIT** : la distance enregistrée saute au moment du recalage (la distance repart du début du parcours avant de rattraper). Rare, et préférable à un coureur hors du groupe.

### Les groupes survivent à un redémarrage du Durable Object (20 novembre 2026)

Les coureurs gardent leurs connexions (API d'hibernation) mais l'objet perdait ses groupes. Maintenant :

- `Groups` range chaque changement (création, arrivée, départ, choix de route, fin) dans le **stockage du Durable Object**, une clé par groupe (`group:<id>`) plus le prochain numéro (`groups:next`) ([`server/groups.ts`](../../src/server/groups.ts), [`worker/world-room.ts`](../../worker/world-room.ts)). Les écritures ne sont pas attendues ; une écriture ratée n'arrête personne.
- Au réveil, l'objet **relit** ses groupes avant le premier message (`blockConcurrencyWhile`), après avoir repris ses coureurs. Un coureur dont la connexion n'a pas survécu est retiré de son groupe (le plus ancien qui reste devient créateur du choix des routes) ; un groupe vide disparaît. Une donnée illisible est ignorée.
- **Le prochain numéro de groupe est rangé aussi** : un numéro ne sert pas deux fois, même après plusieurs redémarrages.
- Tests : `groups.test.ts` (rangement, relève, numérotation, donnée abîmée) et `worker/world-room.test.ts` (redémarrage simulé avec un faux stockage et des connexions qui survivent ou non).
- **Pas rangés** (hors de la demande) : les suivis en cours (« qui suit qui ») et les mesures d'horloge ; ils se reconstruisent à la reconnexion.

### Écarts avec la spec ci-dessus (séance de groupe)

- **Pas de % de FTP des autres** : la salle d'attente et l'encart montrent des noms. Montrer le % demanderait que chacun envoie sa FTP, une donnée personnelle que la spec ne justifiait pas assez.
- **Décrochage** : 60 s sans pédaler et le coureur quitte le groupe (sa sortie redevient libre, sa séance s'arrête). Pas d'étape « grisé » à 30 s.
- **Trainer perdu en pleine séance** : la sortie se met en pause comme d'habitude ; à la reconnexion, le point de groupe est rejoué d'un trait et le coureur retrouve le groupe.
- **Départ dans 2, 5 ou 10 min** (le serveur accepte de 30 s à 30 min). La séance et le parcours sont ceux choisis sur l'accueil.
- **Tout le monde voit tous les groupes** (pas de visibilité « amis » pour un groupe, seulement pour « Qui peut me rejoindre » d'un coureur).
- **Départ manqué** : si le trainer n'est pas connecté ou si une sortie est en cours à l'heure du départ, on quitte le groupe avec un message.
- **Gestion d'intérêt** : au-delà de 33 coureurs actifs, la salle n'envoie rien à qui n'a pas encore donné de position ; la liste « En ligne » vient d'un message à part (`who`), mais « rejoindre » un coureur lointain marche, car la réponse du serveur donne sa position.

### Ce qui reste

2. % de FTP et état « à l'arrêt » des membres pendant la séance.
4. Mesure de charge **réelle** du Durable Object avec 30 coureurs d'un groupe (`npm run bots` contre un aperçu de branche). La logique de la salle est mesurée (`npm run load`, voir [salle](salle.md#rouler-avec-dautres--coût-des-messages-20-novembre-2026)) : quelques centièmes de milliseconde par message de groupe, `who` à 0,2 ms pour 1000 coureurs.

## Questions ouvertes

1. ~~**Strava, amis**~~ Réglé le 20 novembre 2026 : l'endpoint n'existe plus, voir plus haut.
2. ~~**Coureur de référence**~~ Réglé le 20 novembre 2026 : le groupe prend l'allure de son créateur, voir plus haut.
3. **Charge du Durable Object** : la logique est mesurée (voir [salle](salle.md)) ; reste la capacité réelle avec 30 coureurs d'un groupe en plus du monde, à mesurer avec `npm run bots` contre un aperçu de branche.
4. ~~**Carrefours en groupe**~~ Réglé le 20 novembre 2026 : le créateur choisit, voir plus haut.
5. ~~**Séance de groupe et FIT**~~ Réglé le 20 novembre 2026 : la distance et la vitesse du fichier sont celles du groupe, donc celles du créateur ; la puissance exportée reste la puissance réelle de chacun. À confirmer avec un vrai envoi à Strava, qui recalcule parfois l'allure.
