# Architecture du code

Le client (`src/`) est rangé en **couches**. Une couche n'importe que des couches inférieures ; la règle est vérifiée par ESLint (`eslint.config.js`, `no-restricted-imports`) et fait échouer la CI.

```
┌──────────────────────────────────────────────────────────────────┐
│ composition/             COMPOSITION (main.ts : 4 lignes)         │
│   construit les objets et les branche, module par module           │
├──────────────────────────────────────────────────────────────────┤
│ ui/<écran>/   render/        PRÉSENTATION                        │
│   Views (DOM) et rendu 3D. Aucune règle métier.                  │
├──────────────────────────────────────────────────────────────────┤
│ app/                         APPLICATION                         │
│   Classes qui orchestrent le domaine : une responsabilité chacune │
├──────────────────────────────────────────────────────────────────┤
│ infra/                       INFRASTRUCTURE                      │
│   Adaptateurs : Bluetooth, réseau, export FIT/Strava, stockage…  │
├──────────────────────────────────────────────────────────────────┤
│ domain/                      DOMAINE, pur, sans DOM              │
│   Physique, parcours, séances : testable sans navigateur         │
├──────────────────────────────────────────────────────────────────┤
│ shared/                      transverse (journal, erreurs…)      │
└──────────────────────────────────────────────────────────────────┘
 server/ (Worker) : à part ; ne dépend ni de ui, ni de render, ni de app.
```

| Couche | N'importe pas |
|---|---|
| `shared` | domain, infra, app, ui, render, server |
| `domain` | infra, app, ui, render, server |
| `infra` | app, ui, render, server |
| `app` | ui, server |
| `render` | app, ui, server |
| `ui` | server |
| `server` | app, ui, render |

## Arborescence

```
src/
├─ main.ts            quatre lignes : appelle composeApp()
├─ composition/       la racine de composition, un module par ensemble : platform, rider, trainer, devices, ride, workout, hud, recap, screens, account, group, online, whatsnew, launch ; wiring.ts (ce qu'ils se passent), index.ts (l'ordre)
├─ app/               SensorReadings, SettingsStore, GradeController, TrainerController, RideSession, WorkoutSession, DeviceManager, RideViewLoader, RideExport, EditorSession, ManualControl, WorkoutCatalog, RiderSettingsSync, AutoStart, VirtualGearbox, RecapSender, AccountSession, FollowSession, GroupSession, WhatsNew, WhatsNewMarks
├─ domain/
│  ├─ sim/            physique, Ride, Journey, aspiration, vitesses virtuelles, lissage de la pente
│  ├─ group/          règles du suivi (écart, aide, décrochage) et point de groupe (allure commune d'une séance de groupe)
│  ├─ whatsnew/       catalogue des nouveautés et sélection de ce qu'on présente
│  ├─ course/         réseau routier, parcours, vélodrome, données des parcours (courses/)
│  └─ workout/        modèle de séance, lecture .zwo/.erg/.mrc, runner, zones, blocs, bibliothèques
├─ infra/
│  ├─ sensors/        hub, simulateur, registre d'appareils ; ble/ (Web Bluetooth, natif) ; protocols/ (FTMS, Wahoo, FE-C, Zwift)
│  ├─ net/            client de la salle temps réel, protocole binaire, compte
│  ├─ export/         enregistrement, fichier FIT, Strava
│  ├─ sync/           synchronisation avec le compte
│  ├─ telemetry/      rapports d'erreurs
│  ├─ storage/        KeyValueStore, reprise des anciennes clés
│  └─ native/         coquille iOS (Capacitor)
├─ render/            three.js : core/ (moteur, ambiance, matériaux), world/ (décor, terrain, route), riders/ (coureurs, avatar)
├─ ui/                un dossier par écran : home/, ride/, devices/, editor/ (orchestrateur + inspector, chart, summary, shelf, mover, phone-controls, library, cadence, dom) ; chaque écran a ses vues : home/{home-view, home-workouts-view, home-devices-chips, course-picker}, ride/{ride-controls, workout-controls, hud-presenter, ride-loading, crowd, rider-inputs}, devices/{devices-view, log-view}, recap/, account/ ; shared/ (routeur, aide au blocage…)
├─ shared/
│  ├─ protocol/       ce que le serveur et la page se disent : codes de fermeture, utilisateur, en-tête anti-CSRF
│  └─ util/           journal, erreurs, travail en tâche de fond, émetteur d'événements, type du stockage de clés
├─ integration/       tests qui traversent les couches (client de synchronisation contre le vrai serveur)
├─ server/            logique du Worker Cloudflare (salle, comptes, synchronisation)
└─ assets/            modèles 3D et images
```

Les classes de `app/` ont chacune une seule raison de changer :

| Classe | Responsabilité | Ne sait pas |
|---|---|---|
| `SensorReadings` | retenir les dernières mesures des capteurs et leur fraîcheur | d'où elles viennent, à quoi elles servent |
| `SettingsStore` | lire et écrire FTP, masse, protocole de pilotage, avec clés et bornes | le DOM, la synchronisation |
| `GradeController` | décider quelle pente envoyer au trainer et quand (lissage, braquet virtuel, cadence d'envoi, état ERG) | envoyer quoi que ce soit : il rend la consigne |
| `TrainerController` | le trainer branché : connexion, état, commandes (ERG, pente), reprise après un envoi raté | la sortie, la séance, l'écran |
| `RideSession` | une sortie virtuelle : départ, pause faute de trainer, reprise, arrêt, pas de 100 ms, aspiration | l'écran, la vue 3D, le réseau, l'export : ils s'abonnent à `tick` |
| `DeviceManager` | les appareils (trainer, ceinture cardio) : état par rôle, appareils connus, reconnexion au lancement | l'écran, le Bluetooth réel (injecté) |
| `RideViewLoader` | le cycle de vie de la vue 3D : une construction à la fois, reprise après perte du GPU, renoncement après trop de pertes | le DOM, l'écran de chargement, le canevas |
| `RideExport` | l'export de la sortie : enregistrement, sortie figée, fichier FIT, envoi à Strava | les boutons, les fenêtres du navigateur (ports `ExportPlatform` et `StravaPort`) |
| `EditorSession` | l'état de l'éditeur de séance : séance ouverte, sélection, historique, enregistrement, bibliothèque | le DOM, les questions au coureur (`confirmDiscard` injecté) |
| `ManualControl` | les gestes à la main sur le trainer : engager ou relâcher l'ERG, changer sa cible, imposer une pente, selon ce qui tourne | l'écran : les boutons sont dans `RideControlsView` |
| `WorkoutCatalog` | les séances que l'on peut choisir (les nôtres, les modèles) et celle que désigne un choix | la liste affichée, le choix retenu |
| `RiderSettingsSync` | la FTP et la masse vues par la synchronisation du compte : ce que l'appareil en sait, ce qu'il fait de ce qui vient d'ailleurs | les champs eux-mêmes (port `RiderInputsPort`) |
| `VirtualGearbox` | les vitesses virtuelles du Zwift Cog : Cog monté ou non, plateau, vitesse, butées, mémorisation | les boutons et le clavier (`GearsView`), le calcul des braquets (`domain/sim/virtual-gears.ts`) |
| `RecapSender` | l'envoi du récapitulatif à Strava : compte à rebours, envoi automatique, suspension par un geste, essais après refus | l'écran du récapitulatif (`ui/recap/recap.ts`), l'envoi lui-même (`RideExport`) |
| `AccountSession` | le compte du joueur : qui est connecté, connexion Strava (page web, app Android, session système), connexion de développement, nom affiché, déconnexion | la pastille et ses boîtes (`ui/account/account-chip.ts`), les appels au serveur (`infra/net/account.ts`) |
| `FollowSession` | le suivi en cours (qui on suit, écart, aide de rappel), qui nous suit, les demandes à la salle | l'écran (`ui/ride/follow-view.ts`), la physique (la sortie lit `assist`), le serveur |
| `GroupSession` | le groupe où l'on est (séance, parcours, départ, membres), l'horloge commune, quand c'est l'heure de partir, la liste des coureurs en ligne | la sortie et la séance (la composition les lance sur `go`), la salle (port `GroupWorld`) |
| `WhatsNew` | les nouveautés depuis la dernière visite : ce que la carte présente, le non-lu, les gestes qui acquittent, les repères d'un appareil neuf | l'écran (`ui/whatsnew/`), le stockage et la synchronisation des repères (`WhatsNewMarks`), quand ouvrir la carte (composition) |
| `WhatsNewMarks` | les repères de lecture des nouveautés : stockage local, synchronisation avec le compte (le plus grand gagne, renvoi s'il dépasse celui du compte) | le catalogue, les écrans |
| `AutoStart` | le démarrage au premier coup de pédale (sortie libre ou séance choisie), armé à l'arrivée sur l'écran Sortie | l'écran, le démarrage lui-même (il le demande) |
| `WorkoutSession` | la séance choisie et son déroulement ; la consigne ERG qu'elle impose | la sortie (l'appelant démarre l'une avec l'autre), l'export, le récapitulatif |

Ces classes se parlent par **événements typés** (`shared/util/typed-emitter.ts`) : `RideSession` publie `started`, `tick`, `paused`, `resumed`, `stopped` ; `TrainerController` publie `state` et `erg` ; `WorkoutSession` publie `state`, `changed`, `started`, `stepped`, `completing`, `ended` ; `DeviceManager` publie `changed`, `heartRateState`, `recall`, `launchSettled` ; `RideViewLoader` publie `progress`, `ready`, `lost`, `retrying`, `unavailable` ; `RideExport` publie `changed`, `resumed` ; `EditorSession` publie `opened`, `changed`, `focused`. Les écouteurs sont appelés dans l'ordre d'abonnement, de façon synchrone : l'ordre des effets reste lisible. `composition/` y branche la vue 3D, la salle, l'export, le récapitulatif et les boutons.

## Règles

1. **Une classe = une responsabilité.** Si on ne peut pas la décrire sans « et », on la coupe.
2. **Dépendances par le constructeur.** Horloge, stockage et réseau s'injectent (voir `SensorReadings` et `SettingsStore`) : les tests n'ont besoin ni du navigateur ni du temps réel.
3. **Les Views sont passives** : elles affichent et signalent des intentions. La logique va dans `app/` ou `domain/`.
4. **Pas de `document` ni de `window` dans `domain/`, `app/` et `shared/`.**
5. **Un nouveau fichier va dans la couche la plus basse qui lui suffit.**

## Dette connue

Aucune : `npm run lint` ne remonte plus d'import qui monte d'une couche (13 au 19 novembre 2026, tous corrigés le jour même).

Quelques liens restent à surveiller, permis par la règle mais discutables : `server/accounts.ts` importe les types de Strava de `infra/export/strava/api.ts`, et `render` est importé par `app/ride-view-loader.ts` (types seulement).

## Valider une refonte

Les scénarios de `tools/e2e/` (voir son README) pilotent l'application dans Chromium, avec le trainer simulé, et comparent deux séries de traces : états des boutons, journal, DOM complet des écrans Séances, Appareils et Accueil. C'est ainsi qu'ont été validés tous les découpages ci-dessus : `npm run e2e -- --out .e2e/avant` sur le code d'avant, `.e2e/apres` sur le code d'après, puis `npm run e2e:compare -- .e2e/avant .e2e/apres` ; « identique » veut dire que le comportement n'a pas changé.

## La composition

`src/composition/` est le seul endroit qui connaît toutes les couches : il crée les objets et les branche. Elle est au-dessus de `ui` et `render`, et personne ne l'importe (règle ESLint) ; `main.ts` ne fait qu'appeler `composeApp()`.

- Chaque module (`platform`, `rider`, `trainer`, `devices`, `ride`, `workout`, `hud`, `recap`, `screens`, `account`, `group`, `online`, `whatsnew`, `launch`) est une fonction `composeX(w)` qui crée ses objets, les range dans `w` (le `Wiring`, typé dans `wiring.ts`) quand un autre module en a besoin, et lit ceux des autres.
- **L'ordre d'`index.ts` compte** : un module ne lit *tout de suite* (à la création d'un objet, hors fonction ou écouteur) que ce que les modules précédents ont rangé. Le reste se lit à l'usage, dans une fonction ou un écouteur : `w.router.go(…)`, `w.world.riders()`. Le routeur (`screens`) vient presque en dernier : il applique l'écran courant dès sa création, donc tout ce que son écouteur touche doit exister.
- Un objet qu'un seul module utilise reste une variable locale de ce module ; un objet partagé va dans `Wiring`.
- Les règles qui touchent plusieurs morceaux (`setState` : l'état du trainer se répercute sur les vues, la sortie, l'export ; `startRide`, `toggleRide`, `chooseWorkout`, `startWorkout`, `offerRecap`, `ftpChanged`) sont des fonctions de leur module de composition. Elles passent dans une classe de `app/` quand l'une gagne un test propre, comme `AutoStart`.

## Reste à faire

1. Les `setupX()` de `ui/` qui restent (menu de la sortie, routeur, fiche du coureur, compte, coque de l'application, roulette) sont des fonctions de DOM sans règle métier à isoler : les passer en classes `View` serait cosmétique. Le compte est scindé : `AccountSession` porte l'état et les gestes, la pastille n'affiche que.
2. Le scénario `app` du `tools/e2e` ne couvre pas le Bluetooth réel, ni la connexion à un compte, ni un envoi réel à Strava : à compléter avec des essais sur le matériel.
