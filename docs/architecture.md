# Architecture du code

Le client (`src/`) est rangé en **couches**. Une couche n'importe que des couches inférieures ; la règle est vérifiée par ESLint (`eslint.config.js`, `no-restricted-imports`), en avertissement tant que la migration n'est pas finie.

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
├─ app/               SensorReadings, SettingsStore, GradeController, TrainerController, RideSession, WorkoutSession
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
├─ shared/util/       journal, erreurs, travail en tâche de fond
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
| `WorkoutSession` | la séance choisie et son déroulement ; la consigne ERG qu'elle impose | la sortie (l'appelant démarre l'une avec l'autre), l'export, le récapitulatif |

Ces classes se parlent par **événements typés** (`shared/util/typed-emitter.ts`) : `RideSession` publie `started`, `tick`, `paused`, `resumed`, `stopped` ; `TrainerController` publie `state` et `erg` ; `WorkoutSession` publie `state`, `changed`, `started`, `stepped`, `completing`, `ended`. Les écouteurs sont appelés dans l'ordre d'abonnement, de façon synchrone : l'ordre des effets reste lisible. `main.ts` y branche la vue 3D, la salle, l'export, le récapitulatif et les boutons.

## Règles

1. **Une classe = une responsabilité.** Si on ne peut pas la décrire sans « et », on la coupe.
2. **Dépendances par le constructeur.** Horloge, stockage et réseau s'injectent (voir `SensorReadings` et `SettingsStore`) : les tests n'ont besoin ni du navigateur ni du temps réel.
3. **Les Views sont passives** : elles affichent et signalent des intentions. La logique va dans `app/` ou `domain/`.
4. **Pas de `document` ni de `window` dans `domain/`, `app/` et `shared/`.**
5. **Un nouveau fichier va dans la couche la plus basse qui lui suffit.**

## Dette connue

`npm run lint` liste les imports qui remontent (13 au 19 novembre 2026) :

| Violation | Où | Correction prévue |
|---|---|---|
| `domain → infra` | `domain/workout/library.ts` et `block-library.ts` écrivent dans le journal de synchronisation et ont `browserStore()` pour défaut | déplacer les bibliothèques dans `app/` (ou passer journal et stockage par le constructeur) |
| `infra → server` | `infra/net` et les tests de `infra/sync` importent des types de `server/` | types du protocole dans un module partagé, importé par les deux côtés |
| `infra → ui` | `infra/export/wiring.ts` | ce câblage est de l'orchestration : à passer dans `app/` |

## Reste à faire

`main.ts` fait encore ~1200 lignes : il garde surtout le DOM (boutons, champs, écrans), les appareils (cardio, reconnexion au lancement) et le chargement de la vue 3D. Découpage prévu :

1. `DeviceManager`, `RideViewLoader`, et les `setupX()` de `ui/` transformés en classes `View` qui possèdent leur DOM (plus de `$('…')` dans `main.ts`).
2. `ui/editor/workout-editor.ts` (1600 lignes) en `EditorState`, `TimelineView`, `BlockPalette`, `Inspector`, `DragController`.
3. Règle d'imports en `error` une fois la dette à zéro.
