# Ma Moulinette

App d'entraînement home trainer (cyclisme, puis course à pied), avec rendu 3D, capteurs Bluetooth et multijoueur.

Point de départ : [docs/analyse-technique.md](docs/analyse-technique.md), l'évaluation technologique des 26 et 27 octobre 2026.
État d'avancement et prochaines étapes : [docs/roadmap.md](docs/roadmap.md).
Audits de performance, maintenabilité et visibilité (ordinateur et mobile) : [docs/audit/](docs/audit/README.md).
Source : https://claude.ai/artifact/DNwZzib59Z5B9rMruVJT1S

Orientation retenue : un cœur web unique en TypeScript (Three.js, WebGPU avec repli WebGL2), livré en PWA sur ordinateur et Android, et dans une coquille Capacitor sur iOS et Android. Pas d'app TV.

## PoC : connexion au home trainer

Premier PoC de l'analyse (PoC 1, capteurs), réduit à la connexion : appairage Web Bluetooth, lecture puissance, cadence, vitesse et cardio, pilotage ERG et SIM via FTMS.

```
npm install
npm run dev      # http://localhost:5173 dans Chrome ou Edge
npm test         # décodeurs et encodeurs de trames
```

- `src/sensors/decoders.ts`, `control-point.ts` : décodage et encodage des trames FTMS, Cycling Power et Heart Rate, en TypeScript pur.
- `src/sensors/web-bluetooth.ts` : adaptateur Web Bluetooth ; repli en lecture seule sur Cycling Power si FTMS est absent.
- `src/sensors/simulator.ts` : trainer simulé, pour développer sans matériel.
- Le journal de la page affiche les trames du Control Point et du Machine Status : à copier dans la matrice de compatibilité par modèle de trainer.

Web Bluetooth exige Chrome ou Edge et un contexte sécurisé (localhost ou HTTPS). Pour tester depuis un téléphone Android, exposer le serveur en HTTPS (tunnel ou certificat local).

### Résultat du PoC

| Trainer | Transport | Lecture | ERG | SIM | Notes |
|---|---|---|---|---|---|
| Wahoo KICKR (81B5) | Web Bluetooth, Chrome (Windows) | Cycling Power (1818) | oui | oui | Pas de FTMS exposé : contrôle par le service propriétaire Wahoo (`a026ee01…`, opcodes 0x42, 0x43, 0x46). Cache Bluetooth Windows à vider si les services paraissent obsolètes. |

Reconnexion automatique (coupure du KICKR en cours d'ERG) : 3,4 s et 3,7 s, du premier coup, avec rejeu de la consigne ERG (réponse du trainer : succès). Exigence ENF-06 : moins de 5 s. Deux mesures seulement ; presque tout le temps est pris par la connexion GATT et la découverte des services.

Le protocole Wahoo est repris du code de GoldenCheetah, sans documentation officielle. Il faut tester les autres marques en FTMS (voir la matrice de compatibilité de l'analyse).

### Sortie virtuelle et physique

`src/sim/` : modèle physique vélo (puissance, pente, air, roulement, inertie), parcours bouclé et sortie à pas fixe de 50 ms, déterministe et sans dépendance au DOM, donc réutilisable côté serveur. Sur la page, « Démarrer la sortie » fait avancer ce modèle avec la puissance mesurée et renvoie la pente du parcours au trainer en mode SIM. L'aspiration derrière les autres coureurs est modélisée ([docs/design/salle.md](docs/design/salle.md)) ; l'inertie des roues et la limite d'adhérence ne le sont pas encore.

`src/sensors/hub.ts` fusionne le trainer et la ceinture cardio ; les deux se reconnectent seuls après une coupure (60 s maximum).

### Export FIT et Strava

`src/export/` : la sortie est enregistrée à 1 Hz (puissance, cadence, cardio, et vitesse, distance, altitude quand la sortie virtuelle tourne), en pause quand le trainer est déconnecté. « Exporter FIT » télécharge un fichier FIT Activity encodé avec le SDK officiel de Garmin (`@garmin/fitsdk`), chargé seulement à l'export.

Envoi à Strava, pour un coureur connecté avec Strava (voir « Multijoueur ») : sa sortie part sur son propre compte, avec les jetons obtenus à la connexion. **Sans compte**, l'application marche entièrement, seule et sans serveur : on roule seul, et « Exporter FIT » télécharge le fichier, à déposer soi-même où l'on veut.

1. Créer une application sur https://www.strava.com/settings/api avec « Authorization Callback Domain » = `localhost` (le domaine de l'application en ligne).
2. Copier `.dev.vars.example` en `.dev.vars` et renseigner `STRAVA_CLIENT_ID` et `STRAVA_CLIENT_SECRET`.
3. `npm run dev:api` et `npm run dev`, « Connect with Strava » en haut à droite, puis « Envoyer à Strava » à la fin de la sortie.

Strava exige le `client_secret` pour l'échange et le rafraîchissement des jetons, et sa documentation ne prévoit pas PKCE : le secret ne peut pas vivre dans le navigateur. Le Worker (`worker/app.ts`, en local par `wrangler dev`) garde donc le secret, et les jetons de chaque coureur dans D1 ; la passerelle (`src/export/strava/relay.ts`) travaille sur ceux du coureur connecté (`src/server/user-strava.ts`). Le relais du serveur Vite, avec sa clé du propriétaire et son fichier `.strava-tokens.json`, a disparu le 16 novembre 2026 : en local comme en ligne, c'est le même Worker.

Depuis le 1er juin 2026, un compte Strava avec abonnement payant est exigé pour créer une nouvelle application (niveau Standard ; les anciennes applications dès le 30 juin). Plusieurs médias le rapportent, avec un prix de 11,99 $ par mois aux États-Unis ; nous ne l'avons pas relu dans la documentation officielle. Une application Standard sert un athlète par défaut, et jusqu'à dix selon les sources : le palier réel de l'application s'affiche sur https://www.strava.com/settings/api.

Validé : l'export FIT dans la vraie page (fichier relu avec le décodeur de Garmin : intégrité, 0 erreur, puissance, cadence, cardio, vitesse, distance, altitude, sport `cycling` et sous-sport `virtualActivity`). Non validé : l'envoi lui-même, jamais lancé avec de vrais identifiants.

### Séances structurées

`src/workout/` : lecture des fichiers `.zwo` (Zwift), `.erg` (watts) et `.mrc` (% de FTP), en TypeScript pur et sans DOM ; déroulement minuté de la séance ; consigne envoyée au trainer en ERG (immédiatement à chaque palier, au plus une fois par seconde pendant une rampe). Fichiers de référence dans `samples/workouts/`, également proposés dans la page (« Séance d'exemple »).

Sur la page : charger un fichier ou l'exemple, régler la FTP (mémorisée dans le navigateur), puis « Démarrer la séance ». Pause, palier suivant, arrêt et intensité ±5 % sont disponibles en cours de route. Un palier libre (`FreeRide`, `MaxEffort`) relâche l'ERG, qui est repris au palier suivant. Désengager l'ERG à la main laisse la séance continuer sans consigne ; le réengager lui rend la main. Le temps de séance s'arrête quand le trainer est déconnecté.

Vérifié dans la vraie page avec le trainer simulé ; pas encore sur le KICKR.

### Écrans et connexion au lancement

L'application s'ouvre toujours sur l'**accueil**, d'où l'on va aux écrans **Appareils**, **Sortie** et **Séances**.

- Chaque appareil connecté (trainer, capteur cardiaque) est mémorisé dans le navigateur. Au lancement, l'application tente de les retrouver et de s'y reconnecter seule, puis passe à la sortie quand le trainer et les autres appareils connus ont répondu.
- Cette reconnexion sans clic repose sur `navigator.bluetooth.getDevices()`, détecté à l'exécution. Le Chrome de test (novembre 2026) ne l'expose pas par défaut : l'écran propose alors « Reconnecter KICKR 81B5 », un clic par appareil, avec un sélecteur limité à cet appareil. La coquille Capacitor (BLE natif) permettra la reconnexion vraiment automatique.
- **Séances** : un seul écran plein écran, dans la continuité de l'accueil ([docs/design/seances.md](docs/design/seances.md)). Bibliothèque (mes séances, modèles en lecture seule, recherche, import `.zwo`/`.erg`/`.mrc`) à droite, éditeur par blocs toujours actif à gauche (échauffement, palier, intervalles, rampe, libre, retour au calme) avec aperçu du profil, durée, puissance moyenne, intensité et charge estimées, validation, export `.zwo`. Les séances sont gardées dans le navigateur (`localStorage`), pas encore synchronisées entre appareils.
- **Thème « Doux »** (12 novembre 2026) : fond crème, cartes blanches arrondies, accent orange, navigation en pastille flottante en bas, scènes d'accueil conservées derrière un voile crème ; thème nuit suivant le système sur la Sortie. Sur téléphone en portrait, une invite translucide propose le plein écran et le paysage. L'écran Appareils est plein écran : carte titre, radar (toucher le médaillon règle masse, FTP et zones) et une carte « Capteurs » unique. Détails : [docs/design/accueil-appareils.md](docs/design/accueil-appareils.md).


### HUD de la sortie

L'écran Sortie est plein écran : le rendu 3D occupe toute la fenêtre, un bouton en haut à droite ouvre un menu (navigation, sortie, séance, pilotage manuel, export, rendu, journal), et le premier coup de pédale démarre la séance chargée, ou la sortie libre ([docs/design/sortie.md](docs/design/sortie.md)). Les mesures sont posées sur la vue 3D : parcours ou palier en haut à gauche, puissance (moyenne 3 s), FC, cadence et vitesse en haut au centre, profil du parcours ou de la séance en bas. Panneaux en verre dépoli, police Barlow servie par l'application. `?quality=low` les passe sans flou. Spécification, décisions et jetons : [docs/design/hud.md](docs/design/hud.md).

### Multijoueur : comptes Strava et salle temps réel

Chaque coureur se connecte avec Strava ; il voit les autres rouler dans le monde. Le serveur ne simule rien : chaque client calcule sa position et l'annonce sur le réseau routier (route, sens, abscisse, route suivante), 4 fois par seconde ; la salle relaie un instantané à tous, et chaque client redessine les autres avec 200 ms de retard.

- `src/server/accounts.ts` : connexion Strava (un compte par athlète), cookie de session, nom affiché proposé (« Tom L. ») et validé par le coureur avant d'être montré aux autres. Les conditions de l'API Strava interdisent de montrer à un autre utilisateur les données d'un athlète : ni photo ni activité Strava n'est affichée.
- `src/server/room.ts` : la salle (arrivées, départs, états vérifiés, instantanés à 4 Hz) ; `worker/world-room.ts` la branche sur un Durable Object Cloudflare, avec mise en veille quand personne ne roule.
- `src/net/` : protocole binaire (19 octets par état, pas de fréquence cardiaque), lissage des autres coureurs, client avec reconnexion. `src/sim/remote-track.ts` reconstruit la trajectoire d'un autre coureur.

Le compte est **facultatif** : sans lui, on roule seul et l'export FIT reste là. Il se montre en haut à droite des écrans Accueil, Appareils et Séances, en face de la marque : le bouton officiel « Connect with Strava », puis, une fois connecté, une pastille (initiale, nom, « En ligne · 3 autres coureurs ») qui ouvre « Changer de nom » et « Se déconnecter ». Spécification : [docs/design/compte.md](docs/design/compte.md).

En local :

```
cp .dev.vars.example .dev.vars                                         # connexion de développement, sans Strava
npx wrangler d1 migrations apply ma-moulinette-logs --local -c wrangler.app.toml
npm run dev:api    # Worker : comptes et salle, sur http://localhost:8787
npm run dev        # page sur http://localhost:5173, qui relaie /api/auth et /api/world vers le Worker
npm run bots -- --count 5 --watch --url ws://localhost:5173/api/world/ws   # 5 robots qui roulent
```

En ligne : `npx wrangler d1 migrations apply ma-moulinette-logs --remote -c wrangler.app.toml`, les secrets `STRAVA_CLIENT_ID` et `STRAVA_CLIENT_SECRET` (`npx wrangler secret put … -c wrangler.app.toml`), puis `npm run deploy:app`. Dans les réglages de l'application Strava, « Authorization Callback Domain » doit être le domaine de l'application. L'application Strava est limitée à 10 athlètes ; au-delà, il faut une revue de Strava.

Gestion d'intérêt : au-delà de 33 coureurs, chacun ne reçoit que ses 32 voisins les plus proches (20 kbit/s par client quelle que soit la salle) ; mesures avec `npm run load`, décisions et limites dans [docs/design/salle.md](docs/design/salle.md).

Vérifié : tests unitaires (dont deux clients reliés par une salle, sans réseau), et `wrangler dev` avec un vrai Durable Object : robots connectés directement et à travers Vite, refus lisibles sans session et pour une mauvaise version. Validé en ligne : la vraie connexion Strava. Déployé le 17 novembre 2026 sur https://ma-moulinette-ride.moulinette-ride.workers.dev (migration `0003` appliquée à la base de production). Les autres coureurs sont dessinés dans la vue 3D, avec un encart des 7 coureurs devant et 3 derrière ; pas encore essayé avec deux vrais comptes en ligne en même temps, ni sur un vrai GPU.

### Hors ligne et cache

Au garage, le réseau est souvent faible : l'application se lance depuis le navigateur sans attendre le réseau, et roule hors ligne (sans compte ni envoi à Strava, qui passent par `/api/`).

- **Service worker** (build de production seulement) : `dist/sw.js` est généré au build avec la liste des fichiers de la version (page, JS, CSS, polices woff2, modèles 3D, icônes : ~1 Mio compressé). Tout est téléchargé à la première visite ; ensuite la page et les fichiers viennent du cache. Gabarit et règles : [`tools/offline/sw.js`](tools/offline/sw.js) ; génération : [`tools/offline/service-worker.ts`](tools/offline/service-worker.ts).
- **Mise à jour** : le navigateur revérifie `sw.js` à chaque lancement. Une nouvelle version s'installe en arrière-plan et prend le relais au lancement suivant, une fois l'application fermée : une page ouverte garde tous les fichiers de sa version, même ceux qu'elle charge plus tard. Sur iPhone, l'application installée peut rester en mémoire : la nouvelle version arrive alors après l'avoir fermée depuis le sélecteur d'apps.
- **Cache HTTP** : tout ce qui est sous `/assets/` porte une empreinte dans son nom (y compris `avatar.glb`, `bike.glb` et le portrait de repli, importés depuis `src/assets/`), et [`public/_headers`](public/_headers) le garde un an (`immutable`).

### Journaux d'erreurs à distance

`src/telemetry/` : tout ce que la page écrit dans son journal (connexion au trainer, reconnexions, échecs de commande, erreurs non gérées du navigateur) est gardé en mémoire (300 dernières lignes). Dès qu'une ligne ressemble à une erreur, la page envoie le tampon au récepteur, 5 s plus tard pour y embarquer les essais de reconnexion qui suivent, avec le contexte (navigateur, trainer, état de connexion, capacités). Chaque ligne n'est envoyée qu'une fois ; au plus un envoi toutes les 30 s et vingt par session. Hors ligne, l'envoi repart au retour du réseau ou à la fermeture de la page. Les envois ne font jamais d'erreur visible et ne sont jamais journalisés eux-mêmes.

- **En développement** : rien à configurer. `npm run dev` reçoit les rapports dans `.logs/reports.jsonl` (ignoré par git).
- **À distance** : héberger `tools/log-server.ts` sur une machine joignable (VPS, Raspberry Pi derrière un tunnel…) :

  ```
  LOG_READ_TOKEN=<long et aléatoire> LOG_INGEST_TOKEN=<autre> npm run logs:serve
  ```

  puis construire l'application avec `VITE_LOG_ENDPOINT=https://hôte/api/logs/ingest` et `VITE_LOG_TOKEN=<LOG_INGEST_TOKEN>`. Sans `VITE_LOG_ENDPOINT`, un build de production n'envoie rien. Le jeton d'envoi est visible dans le code de la page : il écarte le bruit, il ne protège pas un secret. Seul `LOG_READ_TOKEN` donne accès aux rapports, il ne va jamais dans l'application. Restreindre `LOG_ALLOWED_ORIGIN` au domaine de l'application.
- **Relire** : `curl -H "Authorization: Bearer $LOG_READ_TOKEN" "https://hôte/api/logs/reports?limit=20&since=<ms>"` (JSON, du plus ancien au plus récent).

#### Récepteur gratuit sur Cloudflare (Workers + D1)

`worker/` rejoue le même récepteur (`src/telemetry/receiver.ts`) dans un Worker, avec D1 pour stockage : pas de serveur à maintenir, HTTPS inclus, offre gratuite largement suffisante pour quelques rapports par session. D1 plutôt que KV : KV ne liste pas du plus récent au plus ancien, et un Worker gratuit ne fait qu'environ 50 appels par requête, ce qui limiterait la relecture. Les rapports de plus de 30 jours sont purgés chaque nuit.

```
npx wrangler login
npx wrangler d1 create ma-moulinette-logs          # copier database_id dans wrangler.toml
npx wrangler d1 migrations apply ma-moulinette-logs --remote
npx wrangler secret put INGEST_TOKEN        # jeton d'envoi, le même que VITE_LOG_TOKEN
npx wrangler secret put READ_TOKEN          # jeton de lecture, jamais dans l'application
npx wrangler deploy                         # affiche https://ma-moulinette-logs.<compte>.workers.dev
```

Puis `VITE_LOG_ENDPOINT=https://ma-moulinette-logs.<compte>.workers.dev/api/logs/ingest` au build de l'application, et `ALLOWED_ORIGIN` de `wrangler.toml` au domaine de l'application. La relecture par `curl` est la même que ci-dessus. Le jeton d'envoi étant public, une règle de limitation de débit (Cloudflare, tableau de bord > Sécurité > WAF) protège le quota gratuit d'un envoi massif. Vérifié en local avec `wrangler dev` (D1 simulé) et par tests ; pas encore déployé sur un vrai compte.

Le récepteur (`receiver.ts`) reste un gestionnaire `Request` vers `Response` indépendant de Node et de Cloudflare : un autre `LogStore` suffit pour l'héberger ailleurs. Les rapports contiennent le nom de l'appareil Bluetooth et le navigateur, pas de position ni de compte ; le rapport est lisible par quiconque détient le jeton de lecture. Vérifié : tests unitaires, serveur autonome et serveur de dev avec `curl`. Non vérifié : un envoi réel depuis la page avec un vrai trainer.

## Coquille iOS (iPad, iPhone)

Safari n'a pas Web Bluetooth : `ios/` est une coquille Capacitor dont le Bluetooth passe par le plugin natif (`src/sensors/native-bluetooth.ts`). La coquille charge l'application depuis le serveur (`server.url` de `capacitor.config.ts`), pour que `/api/...`, le cookie de session et le WebSocket gardent l'origine du Worker. Autre serveur : `CAP_SERVER_URL=https://… npx cap sync ios`.

```
npm run ios:sync   # puis, sur un Mac : npm run ios:open, signer, lancer sur l'appareil
```
