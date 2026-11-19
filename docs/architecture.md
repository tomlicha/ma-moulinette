# Architecture du code

Le client (`src/`) est rangé en **couches**. Une couche n'importe que des couches inférieures ; la règle est vérifiée par ESLint (`eslint.config.js`, `no-restricted-imports`) et fait échouer la CI.

```
┌──────────────────────────────────────────────────────────────────┐
│ main.ts                  racine de composition                   │
│   construit les objets et les branche ; la logique en sort peu à peu │
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
├─ main.ts            racine de composition (encore volumineuse : voir « Reste à faire »)
├─ app/               SensorReadings, SettingsStore, GradeController, TrainerController, RideSession, WorkoutSession, DeviceManager, RideViewLoader, RideExport, EditorSession
├─ domain/
│  ├─ sim/            physique, Ride, Journey, aspiration, vitesses virtuelles, lissage de la pente
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
├─ ui/                un dossier par écran : home/, ride/, devices/, editor/, recap/, account/ ; shared/ (routeur, aide au blocage…)
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
| `WorkoutSession` | la séance choisie et son déroulement ; la consigne ERG qu'elle impose | la sortie (l'appelant démarre l'une avec l'autre), l'export, le récapitulatif |

Ces classes se parlent par **événements typés** (`shared/util/typed-emitter.ts`) : `RideSession` publie `started`, `tick`, `paused`, `resumed`, `stopped` ; `TrainerController` publie `state` et `erg` ; `WorkoutSession` publie `state`, `changed`, `started`, `stepped`, `completing`, `ended` ; `DeviceManager` publie `changed`, `heartRateState`, `recall`, `launchSettled` ; `RideViewLoader` publie `progress`, `ready`, `lost`, `retrying`, `unavailable` ; `RideExport` publie `changed`, `resumed` ; `EditorSession` publie `opened`, `changed`, `focused`. Les écouteurs sont appelés dans l'ordre d'abonnement, de façon synchrone : l'ordre des effets reste lisible. `main.ts` y branche la vue 3D, la salle, l'export, le récapitulatif et les boutons.

## Règles

1. **Une classe = une responsabilité.** Si on ne peut pas la décrire sans « et », on la coupe.
2. **Dépendances par le constructeur.** Horloge, stockage et réseau s'injectent (voir `SensorReadings` et `SettingsStore`) : les tests n'ont besoin ni du navigateur ni du temps réel.
3. **Les Views sont passives** : elles affichent et signalent des intentions. La logique va dans `app/` ou `domain/`.
4. **Pas de `document` ni de `window` dans `domain/`, `app/` et `shared/`.**
5. **Un nouveau fichier va dans la couche la plus basse qui lui suffit.**

## Dette connue

Aucune : `npm run lint` ne remonte plus d'import qui monte d'une couche (13 au 19 novembre 2026, tous corrigés le jour même).

Quelques liens restent à surveiller, permis par la règle mais discutables : `server/accounts.ts` importe les types de Strava de `infra/export/strava/api.ts`, et `render` est importé par `app/ride-view-loader.ts` (types seulement).

## Reste à faire

`main.ts` fait encore ~1100 lignes : il ne garde plus de logique de sortie, de séance, d'appareils ni de vue 3D, mais encore tout le DOM (boutons, champs, écrans) et le câblage. Découpage prévu :

1. Les `setupX()` de `ui/` et les morceaux de DOM de `main.ts` (écran Appareils, boutons de la séance, bouton de sortie, écran de chargement) transformés en classes `View` qui possèdent leur DOM (plus de `$('…')` dans `main.ts`).
2. `ui/editor/workout-editor.ts` (~1450 lignes, dont l'état est maintenant dans `EditorSession`) : encore une seule fermeture pour tout le rendu. À découper par région (étagère de blocs, bibliothèque, inspecteur, profil et info-bulle, commandes du téléphone, glisser-déposer), chacune avec ses dépendances explicites.
