# Intégrations avec les plateformes d'entraînement

Brouillon du 12 novembre 2026. Document de conception : import et export des **activités** (sorties enregistrées) et des **séances** (entraînements structurés, planifiés ou non) avec Garmin Connect, TrainingPeaks, Final Surge, Strava et Wahoo. Il prolonge l'exigence EF-07 de l'[analyse technique](analyse-technique.md) et l'étape 6 de la [feuille de route](roadmap.md).

Les règles d'accès de ces plateformes ont beaucoup changé en 2026 (Strava payant, Garmin fermé puis rouvert avec de nouveaux paliers). Chaque affirmation sur une API externe porte sa source ; « à vérifier » veut dire lu dans une source secondaire ou pas lu du tout dans la documentation officielle.

intervals.icu a été abandonné (décision du 12 novembre 2026) et son relais retiré du code.

## Résumé

- **Ce qui marche déjà** : export FIT local et envoi à Strava (codé, jamais lancé avec de vrais identifiants). L'envoi passe par un relais du serveur Vite : rien ne fonctionne dans un build publié.
- **Ce qui bloque tout le reste** : il faut un serveur public pour garder les secrets OAuth, stocker les jetons de chaque utilisateur et recevoir les webhooks. Proposition : une **passerelle d'intégrations** sur Cloudflare Workers, à côté du récepteur de journaux déjà écrit, en réutilisant le gestionnaire `Request` vers `Response` du relais Strava.
- **Ce qui ne se fera pas par API** : envoyer une sortie terminée dans Garmin Connect. Garmin réserve ce droit à quelques partenaires historiques (Zwift, TrainerRoad, Peloton). Pour Garmin, la sortie passe par le fichier FIT, à importer à la main. Les **séances** peuvent, elles, être poussées vers Garmin (Training API).
- **Final Surge** n'a pas d'API publique documentée : à contacter. En attendant, échange par fichiers (.fit).
- **Sans payer ni attendre d'approbation**, on peut déjà : importer les séances de TrainingPeaks (.zwo, .erg, .mrc, .fit) et de Final Surge (.fit) par fichier, avec nos parseurs ; envoyer les sorties à Strava par l'import manuel de Strava ; et, pour Tom seul, se servir d'une application Strava personnelle s'il a déjà l'abonnement (voir « Chemins gratuits »).
- **Ordre proposé** : (1) formats de fichiers et file d'envoi locale, sans serveur ; (2) passerelle et comptes connectés (Strava, Wahoo) ; (3) import des séances planifiées (TrainingPeaks) ; (4) envoi des séances vers Garmin, TrainingPeaks et Wahoo ; (5) import de l'historique d'activités.
- **À lancer tout de suite**, parce que les délais ne dépendent pas de nous : demande Garmin « Starter » (gratuite depuis la réouverture d'octobre 2026), demande partenaire TrainingPeaks, application Wahoo, prise de contact Final Surge. Sans l'accès TrainingPeaks, l'étape 3 n'a aucune plateforme sur laquelle s'essayer.

## Ce qui existe

| Élément | Fichier | État |
|---|---|---|
| Enregistrement 1 Hz (puissance, cadence, FC, vitesse, distance, altitude), pauses | [`src/export/recorder.ts`](../src/export/recorder.ts) | Fait, testé |
| Encodage FIT Activity (SDK Garmin), un seul tour, sport `cycling`, sous-sport `virtualActivity` | [`src/export/fit-activity.ts`](../src/export/fit-activity.ts) | Fait ; fichier relu avec le décodeur Garmin ; jamais ouvert dans Strava ni Garmin Connect |
| Relais Strava : OAuth, jetons de chaque coureur dans D1 (Worker), dépôt et attente du traitement | [`src/export/strava/`](../src/export/strava/) | Codé, testé avec un faux `fetch` ; jamais lancé contre Strava |
| Branchement des boutons, sortie gardée en mémoire pour réessayer | [`src/export/wiring.ts`](../src/export/wiring.ts) | Fait ; **la sortie est perdue si l'onglet se ferme** |
| Lecture .zwo, .erg, .mrc ; écriture .zwo | [`src/workout/`](../src/workout/) | Fait, testé |
| Bibliothèque de séances | [`src/workout/library.ts`](../src/workout/library.ts) | `localStorage`, un seul appareil |
| Worker Cloudflare + D1 | [`worker/`](../worker/) | Récepteur de journaux seulement ; jamais déployé |

Point d'appui pour la suite : le relais Strava est un gestionnaire `Request` vers `Response` indépendant de Vite, avec `fetch` injecté et magasin de jetons abstrait (`TokenStore`). Il passe dans un Worker sans réécriture de la logique.

## Ce que permet chaque plateforme

### Matrice

« API » = faisable automatiquement une fois l'accès obtenu. « Fichier » = l'utilisateur télécharge ou dépose lui-même un fichier.

| Plateforme | Envoyer une sortie | Importer des sorties | Envoyer une séance | Importer les séances planifiées | Accès |
|---|---|---|---|---|---|
| **Strava** | API (codé) | API (ses propres sorties) | Non (Strava n'a pas de séances structurées) | Non | OAuth ; application payante depuis juin 2026 |
| **TrainingPeaks** | API (dépôt asynchrone) | API | API (séance structurée au calendrier) | API (fenêtre limitée) | Partenaire approuvé, bac à sable |
| **Garmin Connect** | **Fichier seulement** (API réservée à quelques partenaires) | API (Activity API, par webhook) | API (Training API, au calendrier) | Non : Garmin pousse vers ses appareils, pas vers nous | Palier Starter gratuit (≤ 1 000 utilisateurs selon DC Rainmaker) |
| **Wahoo** | API (dépôt FIT asynchrone) | API (webhook `workout_summary`) | API (plans), comportement à vérifier | API (plans), à vérifier | OAuth, application approuvée |
| **Final Surge** | Fichier (dépôt manuel) | Fichier | Fichier (.zwo, à vérifier) | Fichier, ou API partenaire si accordée | Pas d'API publique ; contact direct |
| Apple Santé, Health Connect | API native (coquille Capacitor) | — | — | — | Étape 4 de la feuille de route |
| TrainerRoad, Zwift | — | — | — | — | Pas d'API ouverte ; concurrents directs |

### Chemins gratuits

Ce qui marche sans abonnement payant ni accès partenaire, du plus sûr au plus incertain.

| Besoin | Chemin | Automatique ? | État |
|---|---|---|---|
| Séance TrainingPeaks → nous | « Export » dans la vue rapide de la séance : .zwo (vélo en puissance), .erg et .mrc (puissance et durée), .fit (fréquence cardiaque) ; puis import dans notre écran Séances | Non, une séance à la fois | Nos parseurs .zwo, .erg et .mrc existent : **marche aujourd'hui**, à essayer sur une vraie séance. Restriction premium : non documentée |
| Séance Final Surge → nous | Téléchargement de la séance structurée en .fit depuis le calendrier (version bêta) ; puis import | Non | Il manque le parseur FIT Workout (étape 1) |
| Sortie → Strava | « Exporter FIT » puis page d'import de Strava (`strava.com/upload/select`), ouverte par un bouton à côté | Non, deux clics | Rien à payer ; marche pour tous les utilisateurs |
| Sortie → Strava, pour Tom seul | Application Strava en mode « un seul athlète » (le mode par défaut de toute nouvelle application), avec le relais existant | Oui | Exige l'abonnement Strava du propriétaire de l'application (11,99 $ par mois ou 79,99 $ par an aux États-Unis selon un blog) ; sans frais d'API en plus. Passage à 10 athlètes sans revue |
| Rappel des séances prévues | Flux de calendrier .ics : TrainingPeaks (compte payant seulement, 14 jours à venir, jusqu'à 24 h de retard), Final Surge (iCal, Google, Outlook) | Oui | Titre et description seulement, pas la structure : utile pour « Séance du jour : … — importer le fichier », pas pour rouler |

#### Automatiser l'import des séances TrainingPeaks et Final Surge

| Moyen | Automatique | Structure de la séance | Accord de la plateforme | Verdict |
|---|---|---|---|---|
| API partenaire (TrainingPeaks ; Final Surge sur demande) | Oui | Oui | Oui, gratuit mais sur approbation | Le chemin propre ; demandes à déposer maintenant |
| Flux de calendrier .ics | Oui | Non : titre, durée, description | Oui (fonction publique) | Complément : rappel sur l'accueil, puis import du fichier à la main |
| Extension de navigateur sur leurs pages | Un clic (« Envoyer à Ma Moulinette » à côté de leur bouton Export) | Oui (le fichier d'export officiel) | Non : s'appuie sur leurs pages web internes, casse à chaque refonte | Plan de secours si l'API partenaire n'aboutit pas |
| Robot qui se connecte avec l'identifiant de l'utilisateur | Oui | Oui | Non, et mot de passe à stocker | Écarté (voir ci-dessous) |

Ordre : déposer les demandes partenaires ; pendant l'attente, le flux .ics et l'import de fichier couvrent l'intervalle.

Passer par un tiers qui reçoit déjà ces séances (Wahoo, Garmin) est écarté le 12 novembre 2026.

Écartées, même gratuites :

- **Bibliothèques non officielles** (`garth`, `python-garminconnect`, client Final Surge, cookie de session TrainingPeaks) : il faudrait stocker le mot de passe de l'utilisateur, c'est contraire aux conditions des plateformes, et ça casse sans préavis (`garth` abandonné le 28 mars 2026 après un changement de la connexion Garmin ; comptes bloqués plus de 48 h signalés). Tolérable au mieux dans un script personnel de Tom, jamais dans l'application.
- **Open Wearables** (MIT, hébergé chez soi) : une API unifiée en lecture seule (Garmin, Strava, Polar, Suunto…), sans TrainingPeaks, Final Surge ni Wahoo, et qui demande quand même nos propres accès à chaque plateforme. Économise du code d'import, pas les accès.
- **Synchronisation par Dropbox** : aucune trace actuelle chez TrainingPeaks ni Final Surge.

Sources : [export de séances TrainingPeaks (FAQ)](https://help.trainingpeaks.com/hc/en-us/articles/115001844087-Structured-Workout-Export-FAQs) · [téléchargement manuel des séances Final Surge](https://site.finalsurge.com/help/WorkoutFileDownload) · [calendrier Final Surge vers iCal, Google, Outlook](https://blog.finalsurge.com/?p=9) · [Strava, premiers pas](https://developers.strava.com/docs/getting-started/) · [Strava, prix de l'accès API (appsforstrava)](https://appsforstrava.com/blog/strava-developer-program-changes-2026) · [garth](https://awesome.ecosyste.ms/projects/github.com%2Fmatin%2Fgarth) · [compte Garmin bloqué 48 h](https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours/2029273) · [Open Wearables](https://openwearables.io/docs) · [calendrier TrainingPeaks en .ics](https://help.trainingpeaks.com/hc/en-us/articles/204072184)

### Strava

- **Accès** : OAuth 2.0 avec `client_secret`, sans PKCE : le secret vit forcément sur un serveur. Depuis le 1er juin 2026, un abonnement Strava du propriétaire est exigé pour créer une application. Paliers : 1 athlète par défaut, 10 sans revue, jusqu'à 9 999 après revue, accès étendu au-delà. Démarche détaillée : « Devenir partenaire ».
- **Sorties** : dépôt FIT (`POST /uploads`) puis interrogation du statut ; `external_id` pour l'idempotence. Le changelog officiel ajoute en mai 2026 la prise en charge du message de traitement (`setmessage`) pour les fichiers FIT.
- **Import** : lecture des sorties de l'utilisateur (`activity:read`). Les données ne peuvent être montrées qu'à leur propriétaire, et leur usage pour entraîner un modèle d'IA est interdit (conditions de novembre 2024).
- **Changements à intégrer** : nouvelle adresse de l'API `api-v3.strava.com` disponible à partir du 4 janvier 2027 (changelog et FAQ ; l'annonce du 1er juin la place au 1er juin 2027) ; au 1er juin 2027, jetons dans l'en-tête `Authorization` uniquement (plus en paramètre de formulaire) et `/oauth/deauthorize` remplacé par `/oauth/revoke`. Garder l'adresse de base dans la configuration, pas en dur. Le relais actuel envoie déjà le jeton en en-tête (`strava/api.ts`) ; sa déconnexion efface les jetons locaux sans les révoquer chez Strava : appeler `/oauth/revoke` dans le connecteur.
- **Désautorisation** : Strava envoie un évènement webhook quand l'utilisateur révoque l'accès ; la passerelle doit alors effacer ses jetons.
- **Rôle** : première plateforme branchée sur la passerelle, parce que le connecteur existe déjà. C'est elle qui valide OAuth, la file d'envoi et les nouveaux essais.
- **Quotas** (page officielle) : 200 requêtes par 15 min et 2 000 par jour (lecture : 100 et 1 000) ; 400 et 4 000 après le passage à 10 athlètes (lecture : 200 et 2 000). Dépassement : 429 ; remise à zéro aux quarts d'heure et à minuit UTC ; en-têtes `X-RateLimit-*` à lire pour espacer les appels.

Sources : [changelog de l'API v3](https://developers.strava.com/docs/changelog/) · [mise à jour du programme développeurs](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428) · [changements 2026 (Terra)](https://tryterra.co/blog/strava-api-changes-2026)

### TrainingPeaks

- **Accès** : API partenaire OAuth 2.0, sur demande (`api.trainingpeaks.com/request-access`), avec un environnement de bac à sable avant la production. **Au 12 novembre 2026, TrainingPeaks n'accepte plus de nouveaux partenaires** pendant une maintenance de son API ; le formulaire reste ouvert et ils recontacteront les demandeurs à la reprise. Les demandes pour un usage personnel sont refusées. Démarche détaillée : « Devenir partenaire ».
- **Droits** (non cumulatifs : `workouts:details` n'inclut pas `workouts:read`) : `workouts:read` (lire séances planifiées et réalisées), `workouts:plan` (créer, modifier, supprimer des séances planifiées), `file:write` (déposer un fichier d'activité), `athlete:profile`.
- **Sorties** : dépôt de fichier **asynchrone** (le dépôt synchrone est retiré depuis juin 2023), avec interrogation du statut.
- **Séances** : création au calendrier avec un objet `structure` (étapes, répétitions, plages d'intensité). Ne pas envoyer `structure` et `structured_workout` dans le même appel.
- **Séances planifiées** : lecture possible sur une fenêtre limitée à venir (7 jours selon une source tierce).
- **Compte premium** : l'analyse signalait que plusieurs fonctions exigent un compte athlète premium ; non confirmé par cette recherche. Conséquence possible : un athlète gratuit ne verrait que les séances du jour.
- **Rôle** : seule plateforme de la liste qui fournit des séances planifiées par un coach. C'est le cas d'usage central de l'import de séances.
- **Sans accès partenaire** : export de chaque séance en fichier depuis la vue rapide (.zwo pour le vélo en puissance, .erg et .mrc pour les séances en puissance et durée, .fit pour la fréquence cardiaque). Un fil de TrainerRoad rapporte que seuls .fit et .zwo restent proposés : vérifier dans la fenêtre d'export. Ce chemin marche dès aujourd'hui avec nos parseurs.
- À vérifier dans le wiki partenaire (accessible après approbation) : fenêtre de lecture, règles premium, schéma exact de `structure` (pourcentage de FTP ou watts), durée de vie des jetons.

Sources : [demande d'accès](https://api.trainingpeaks.com/request-access) · [wiki PartnersAPI, points d'entrée](https://github-wiki-see.page/m/TrainingPeaks/PartnersAPI/wiki/API-Endpoints) · [wiki PartnersAPI, OAuth](https://github-wiki-see.page/m/TrainingPeaks/PartnersAPI/wiki/OAuth) · [serveur MCP communautaire (format `structure`)](https://github.com/JamsusMaximus/trainingpeaks-mcp/blob/main/README.md)

### Garmin Connect

- **Historique** : programme fermé aux nouvelles demandes en mars 2026, rouvert et refondu le 21 octobre 2026.
- **Paliers** (page officielle du programme) :

  | Palier | Pour qui | API | Livraison des données | Historique | Prix |
  |---|---|---|---|---|---|
  | Personal | Un individu, ses propres données | Activity (JSON, FIT), Health, Women's Health | Lecture à la demande | — | Gratuit |
  | Starter | Organisations qui démarrent | Activity, Courses, Health, **Training**, Women's Health | Push (webhooks) | Non inclus | Gratuit jusqu'à 1 000 utilisateurs (DC Rainmaker) |
  | Enterprise | Grande échelle | Tout, plus Golf | Push ou ping puis lecture | 1 mois et plus | 1 000 $ d'entrée, puis par utilisateur actif mensuel, négocié |

- **Envoyer une sortie terminée : non.** Garmin ne laisse pas une application tierce créer une activité chez lui, sauf une poignée de partenaires stratégiques historiques (Zwift, TrainerRoad, Peloton cités). Réponse de DC Rainmaker à la question : « No, that still remains no-go territory for Garmin ». Chemin retenu : bouton « Exporter FIT » et import manuel dans Garmin Connect (web : « Importer des données »). À essayer : que Garmin Connect accepte un FIT dont le fabricant est `development`.
- **Envoyer une séance : oui**, par la Training API : création de la séance structurée puis planification à une date ; Garmin Connect la synchronise vers la montre ou le compteur. C'est ce que font TrainingPeaks et Final Surge. Pour nous, l'intérêt est réel mais secondaire : la séance s'exécute dans notre application, pas sur le compteur. Cas d'usage : une séance créée dans l'éditeur et faite dehors, ou sur un compteur qui pilote le trainer.
- **Importer des sorties** : Activity API (JSON et FIT), livrées par webhook sur le palier Starter. Garmin retire de ces FIT des données qu'il juge propriétaires (DC Rainmaker). Usage : historique de puissance, courbe de puissance, sorties extérieures pour la charge.
- **Conditions à relire** : interdiction rapportée d'entraîner ou d'alimenter un modèle d'IA avec les données des appareils Garmin ; interdiction de les retransmettre ou sous-licencier sans accord écrit. Une structure légale (société) serait peut-être exigée pour le palier Starter (témoignage non vérifié).
- À vérifier dans la documentation de la Training API : cibles de puissance en watts et en pourcentage de FTP, cible de cadence, absence de rampes (approximation en paliers), mode d'authentification (OAuth 2.0 avec PKCE annoncé, OAuth 1.0a retiré fin 2026 selon l'analyse).

Sources : [aperçu du programme (Garmin)](https://developer.garmin.com/gc-developer-program/overview/) · [refonte du programme, 21 octobre 2026 (DC Rainmaker)](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html) · [Training API](https://developer.garmin.com/gc-developer-program/training-api) · [Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)

### Wahoo

- **Accès** : Cloud API OAuth 2.0, application soumise à approbation. Au plus 10 jetons non révoqués par utilisateur depuis le 1er janvier 2026 : réutiliser le jeton existant au lieu d'en demander un à chaque connexion.
- **Sorties** : `POST /v1/workout_file_uploads` (droit `workouts_write`) : FIT accepté avec une réponse 202 et un jeton pour suivre le traitement.
- **Import** : webhook `workout_summary` (droit `offline_data`), lecture du résumé et de l'URL du fichier FIT par séance.
- **Séances** : API Plans (`/v1/plans`, droits `plans_read`, `plans_write`). Des développeurs tiers doutaient que l'envoi crée une séance structurée exécutable sur le compteur ELEMNT. À essayer avant de s'engager.
- Intérêt particulier : le matériel de test est un KICKR, l'utilisateur type a souvent un compte Wahoo.
Sources : [Wahoo Cloud API (miroir OpenAPI, apis.io)](https://apis.io/providers/wahoo/) · documentation officielle : `cloud-api.wahooligan.com` (non relue)

### Final Surge

- **Pas d'API publique documentée.** Final Surge contrôle l'accès partenaire : il est partenaire de la Training API de Zwift (séances poussées vers Zwift le jour prévu, sorties renvoyées ensuite) et pousse ses séances vers Garmin par la Training API. Une API privée destinée aux développeurs tiers est mentionnée par RunGap (page ancienne). Il existe un client non officiel (`api.finalsurge.com`, jeton porteur) : **à ne pas utiliser**, il peut casser sans préavis et contourner leurs conditions.
- **Démarche** : écrire à Final Surge pour demander un accès partenaire, en présentant le même échange que Zwift (séances du jour vers nous, sorties vers eux).
- **En attendant** : import de séances par fichier .fit, téléchargé depuis le calendrier de Final Surge (version bêta du calendrier, d'après leur aide) ; aucune trace d'un export .zwo, .erg ou .mrc. Flux de calendrier (iCal, Google, Outlook) pour les rappels. Sorties : dépôt manuel du FIT.

Sources : [Final Surge et Wahoo SYSTM ajoutés à la Training API de Zwift (Zwift Insider)](https://zwiftinsider.com/final-surge-wahoo-systm/) · [Final Surge avec RunGap](https://rungap.zendesk.com/hc/en-us/articles/115003667993-Using-Final-Surge-with-RunGap) · [client non officiel](https://github.com/dtbray/finalsurge-api)

## Architecture proposée

### Vue d'ensemble

```
Navigateur (PWA, coquille Capacitor)                Passerelle d'intégrations (Worker)             Plateformes
────────────────────────────────────                ───────────────────────────────────             ───────────
Enregistreur ─► FIT ─► File d'envoi (IndexedDB) ──► POST /api/sync/activities ─► R2 (FIT) ──┐
                                                                                             ├─► file d'attente ─► connecteurs ─► Strava, TrainingPeaks,
Bibliothèque de séances ◄── modèle Workout ◄─────── GET /api/sync/planned ◄── connecteurs ◄──┘                                     Wahoo
Éditeur ──► « Envoyer vers… » ───────────────────► POST /api/sync/workouts ──────────────────────────────────────────────────────► Garmin, TrainingPeaks,
                                                                                                                                   Wahoo (séances)
Écran « Comptes connectés » ─────────────────────► /api/connect/{plateforme}/login, callback, logout
                                                    /api/webhooks/{plateforme}  ◄────────────────────────────────────────────────── webhooks
                                                    D1 : connexions, jetons chiffrés, travaux, correspondances d'identifiants
```

Principes :

1. **Le navigateur ne voit jamais un secret ni un jeton tiers.** C'est déjà la règle du relais Strava ; elle reste.
2. **Le FIT est le format pivot des sorties.** Un seul encodeur, enrichi (tours, séance suivie), envoyé tel quel partout.
3. **Le modèle `Workout` interne est le pivot des séances.** Chaque plateforme a un convertisseur aller et retour ; les pertes de conversion sont signalées dans `warnings`, comme le fait déjà la lecture des .zwo.
4. **Envoi en tâche de fond, idempotent et rejouable.** La fin d'une sortie ne dépend jamais du réseau ni d'une plateforme tierce.
5. **Tout appel externe passe par un `fetch` injecté** et se teste sans réseau, avec des réponses enregistrées (règle déjà suivie dans `src/export/`).

### Pourquoi un Worker Cloudflare, et pas le futur backend Node

| Critère | Worker + D1 + R2 + Queues | API Node/PostgreSQL de l'analyse |
|---|---|---|
| Disponible quand | Maintenant : le récepteur de journaux en a déjà posé les bases | Après les comptes OIDC (étape 6) |
| Secrets, HTTPS public, webhooks, tâches planifiées | Inclus (`wrangler secret`, crons, Queues) | À monter |
| Réutilisation du code | Le relais Strava est déjà `Request` vers `Response` | Idem |
| Coût au démarrage | Offre gratuite suffisante pour quelques utilisateurs | Un serveur à payer et maintenir |
| Portabilité (ENF-15) | La logique ne dépend que de `fetch`, `crypto` et d'interfaces de stockage | Native |

Recommandation : la passerelle sur Worker maintenant, avec des interfaces de stockage (`ConnectionStore`, `JobStore`, `BlobStore`) comme `LogStore` l'a fait pour les journaux. Si le backend Node arrive, il fournit d'autres implémentations, sans toucher aux connecteurs.

### Identité avant les comptes

Les jetons doivent être rangés sous l'identité de quelqu'un, et les comptes OIDC ne sont pas encore faits. Deux options :

| Option | Principe | Limites |
|---|---|---|
| **A. Identité implicite** (recommandée pour démarrer) | Au premier « Connecter », la passerelle crée un identifiant aléatoire et le pose en cookie `HttpOnly`, `Secure`, `SameSite=Lax`. Les connexions y sont rattachées. | Un seul navigateur ; cookie effacé = reconnecter ses comptes. Rattachée plus tard à un vrai compte par un lien de migration. |
| B. Comptes OIDC d'abord | E-mail, Google, Apple, comme prévu à l'étape 6 | Retarde toute intégration de plusieurs semaines |

L'option A suffit tant que l'application sert une poignée d'utilisateurs, ce qui est aussi le plafond de Strava Standard et du palier Garmin Starter.

### Connecteurs

Un connecteur par plateforme, sans dépendance au Worker :

```ts
type Provider = 'strava' | 'trainingpeaks' | 'garmin' | 'wahoo' | 'finalsurge';

interface Capabilities {
  uploadActivity: boolean;
  importActivities: boolean;
  pushWorkout: boolean;
  importPlanned: boolean;
}

interface Connector {
  provider: Provider;
  capabilities: Capabilities;
  auth: OAuthSpec;                       // URLs, droits demandés, PKCE ou secret
  uploadActivity?(ctx: Ctx, fit: Uint8Array, meta: ActivityMeta): Promise<UploadOutcome>;
  pollUpload?(ctx: Ctx, ref: string): Promise<UploadOutcome>;                // dépôts asynchrones (Strava, TrainingPeaks, Wahoo)
  listPlanned?(ctx: Ctx, from: string, to: string): Promise<PlannedWorkout[]>;
  pushWorkout?(ctx: Ctx, w: Workout, date?: string): Promise<{ externalId: string }>;
  handleWebhook?(req: Request, deps: WebhookDeps): Promise<Response>;        // désautorisation, nouvelles sorties, calendrier
}

/** `ctx` donne un jeton frais (rafraîchi si besoin, sous verrou) et le `fetch` injecté. */
interface Ctx {
  token(): Promise<string>;
  fetch: typeof fetch;
}

type UploadOutcome =
  | { status: 'done'; externalId: string; url?: string; duplicate?: boolean }
  | { status: 'processing'; ref: string; retryAfterS: number }
  | { status: 'rejected'; message: string }                  // définitif : ne pas réessayer
  | { status: 'retry'; message: string; retryAfterS?: number } // réseau, 5xx, 429
  | { status: 'reauth' };                                     // jeton refusé : l'utilisateur doit se reconnecter
```

Le fichier `api.ts` de Strava devient le cœur du premier connecteur. Le rafraîchissement des jetons, aujourd'hui dans le relais Strava (`freshTokens`), remonte dans `Ctx`, commun à tous.

### Envoi des sorties : la file d'envoi

Aujourd'hui une sortie non envoyée vit en mémoire et disparaît à la fermeture de l'onglet. Exigence EF-13 : ne rien perdre.

1. **Fin de sortie** : le FIT est encodé et rangé dans **IndexedDB** avec son identifiant (`zwift2-<startMs>`, déjà utilisé comme `external_id`) et la liste des destinations choisies.
2. **Côté navigateur** : dès que le réseau est là, chaque sortie en attente est déposée **une fois** à la passerelle (`POST /api/sync/activities`, corps FIT, en-tête CSRF existant). La passerelle répond dès que le fichier est en R2 et les travaux créés ; la sortie locale est alors marquée « remise ». Elle reste téléchargeable en FIT pendant 30 jours.
3. **Côté passerelle** : un travail par destination (`jobs` en D1, exécuté par Cloudflare Queues). États : `pending → running → done | processing | rejected | reauth | failed`. Nouvel essai avec attente exponentielle (1 min, 5 min, 30 min, 2 h, 12 h), puis `failed`. `Retry-After` et 429 respectés.
4. **Idempotence** : l'`external_id` est envoyé à chaque plateforme qui l'accepte ; une sortie déjà présente (Strava : « duplicate ») est un succès, pas une erreur. La table `links` garde la correspondance sortie ↔ identifiant distant.
5. **Retour à l'utilisateur** : l'écran de fin de sortie et la bibliothèque des sorties montrent l'état par destination (« Envoyée à Strava », « En attente : Strava se reconnecte », « Refusée : … ») avec le lien de l'activité.
6. **Garmin et Final Surge** : pas de travail automatique ; la destination affiche « Télécharger le FIT » et le lien d'import manuel de la plateforme.

### Import des séances planifiées

1. **Quand** : à l'ouverture de l'accueil et de l'écran Séances, la page demande `GET /api/sync/planned?from=aujourd'hui&to=+7 j`. La passerelle interroge chaque plateforme connectée (en parallèle, résultat mis en cache 10 min) ; les webhooks de calendrier, là où ils existent, invalident le cache.
2. **Conversion** : chaque plateforme répond dans son format ; le connecteur produit un `Workout` interne :
   - TrainingPeaks : convertisseur `structure` vers `Workout`.
   - Wahoo : convertisseur de plan (si l'API le permet).
   - Final Surge : selon le format de l'API partenaire, si elle est accordée.
3. **Affichage** : sur l'accueil, « Séance du jour : Seuil 3 × 12 min (TrainingPeaks) » avec Rouler ; dans la bibliothèque, une rubrique « Planifiées » en lecture seule, copiable dans « Mes séances » pour la modifier.
4. **Rapprochement** : la sortie faite sur une séance planifiée porte l'identifiant de l'évènement d'origine (`PlannedWorkout.externalId`). Les plateformes rapprochent d'elles-mêmes par date et sport ; à vérifier pour chacune si un identifiant explicite améliore le rapprochement (TrainingPeaks : « planned vs completed »).
5. **FTP** : une séance en pourcentage de FTP utilise la FTP réglée dans l'application. Afficher un écart si la plateforme d'origine en connaît une autre (TrainingPeaks l'expose), sans l'écraser en silence.

### Envoi des séances

Depuis l'éditeur ou la bibliothèque : « Envoyer vers… » ouvre la liste des plateformes connectées qui savent recevoir une séance, avec une date facultative (planification au calendrier). Chaque connecteur convertit le `Workout`, et les pertes sont montrées avant l'envoi (« Garmin : les 2 rampes deviendront des paliers d'une minute »).

### Modèle de données de la passerelle (D1)

| Table | Colonnes principales | Note |
|---|---|---|
| `users` | `id`, `created_at`, `account_id` (nul tant que pas de vrai compte) | Identité implicite |
| `connections` | `user_id`, `provider`, `remote_athlete_id`, `scopes`, `access_token_enc`, `refresh_token_enc`, `expires_at`, `status` (`ok`, `reauth`, `revoked`), `options` (envoi auto…) | Jetons chiffrés en AES-GCM avec une clé `wrangler secret` ; une ligne par plateforme |
| `activities` | `id` (`zwift2-<startMs>`), `user_id`, `start_ms`, `r2_key`, `summary` (JSON), `workout_ref` | FIT dans R2, purgé après 30 jours s'il est livré partout |
| `jobs` | `id`, `activity_id` ou `workout_id`, `provider`, `kind`, `status`, `attempts`, `next_at`, `remote_ref`, `last_error` | Un travail par destination |
| `links` | `local_id`, `provider`, `remote_id`, `remote_url` | Idempotence et liens affichés |
| `oauth_states` | `state`, `user_id`, `provider`, `pkce_verifier`, `expires_at` | Remplace la `Map` en mémoire du relais Strava, qui ne survit pas à un Worker |

### Routes de la passerelle

| Route | Rôle |
|---|---|
| `GET /api/connect` | Plateformes configurées et état des connexions de l'utilisateur |
| `GET /api/connect/{p}/login`, `GET /api/connect/{p}/callback`, `POST /api/connect/{p}/logout` | OAuth (état et PKCE en D1), révocation chez la plateforme à la déconnexion |
| `POST /api/sync/activities` | Dépôt d'une sortie FIT, crée les travaux |
| `GET /api/sync/activities/{id}` | État par destination |
| `GET /api/sync/planned?from&to` | Séances planifiées, converties en `Workout` |
| `POST /api/sync/workouts` | Envoi d'une séance vers une plateforme, date facultative |
| `POST /api/webhooks/{p}` | Désautorisation (Strava), nouvelles sorties (Garmin, Wahoo) ; signature ou jeton vérifié selon la plateforme |

La passerelle Strava est montée par le Worker (`worker/app.ts`, `src/server/user-strava.ts`), en local par `wrangler dev` comme en ligne : le relais du serveur Vite et son fichier `.strava-tokens.json` ont disparu le 16 novembre 2026.

## Formats et conversions

### Sorties : enrichir le FIT

| Ajout | Pourquoi | Où |
|---|---|---|
| Un **tour par étape de séance** (`LAP` avec `wktStepIndex`, puissance moyenne, cible) | TrainingPeaks et Garmin découpent l'analyse par tour ; aujourd'hui un seul tour couvre toute la sortie | L'enregistreur reçoit `markLap(nowMs, stepIndex)` du déroulement de séance |
| Messages **`WORKOUT` et `WORKOUT_STEP`** de la séance suivie | Rapprochement « prévu / réalisé » | Encodeur FIT |
| **Nom de la séance** et du parcours dans le nom d'activité | Lisibilité chez la plateforme | `rideName()` de `wiring.ts` |
| **Identifiant fabricant FIT** propre à la place de `development` | Affichage du nom de l'application chez Garmin et Strava ; acceptation par Garmin Connect à vérifier | Demande d'identifiant à Garmin (programme FIT) |
| `DEVICE_INFO` du trainer et du capteur de puissance | Étiquetage de la source de puissance (exigence d'intégrité de l'analyse) | Encodeur FIT, à partir de `trainer-profiles.ts` |

### Séances : couverture par format

| Fonction de la séance | `Workout` interne | .zwo | .erg / .mrc | FIT Workout | TrainingPeaks `structure` | Garmin Training API |
|---|---|---|---|---|---|---|
| Palier en % FTP | oui | oui | .mrc | oui | oui | à vérifier (sinon watts) |
| Palier en watts | oui | non (converti en %) | .erg | oui | oui | oui |
| Rampe | oui | oui | oui | non : paliers | à vérifier | non : paliers |
| Répétitions | dépliées | oui | dépliées | oui | oui | oui |
| Cadence cible | oui | oui | non | oui | à vérifier | à vérifier |
| Libre, effort maximal | oui | oui | non | « ouvert » | à vérifier | sans cible |
| Messages texte horodatés | oui | oui | non | non | non | non |

Règle : une rampe que le format cible ne connaît pas devient une suite de paliers d'au plus 60 s, au milieu de chaque tranche ; l'avertissement l'indique. Le `Workout` interne garde les intervalles dépliés ; `EditorBlock` garde les répétitions. Pour les formats qui savent répéter (FIT, TrainingPeaks, Garmin), la conversion part de `EditorBlock` quand la séance vient de l'éditeur, et d'un regroupement des étapes identiques successives sinon.

### Fichiers sans plateforme

Utile tout de suite, sans serveur, et seule voie pour Garmin (sorties) et Final Surge :

- **Import** : ajouter **FIT Workout** (`@garmin/fitsdk` décode déjà ; nouveau `parse-fit-workout.ts`) aux .zwo, .erg et .mrc.
- **Export** : .erg, .mrc et FIT Workout en plus du .zwo, depuis le menu « ⋯ » de l'éditeur.
- **Dépôt par glisser-déposer** de fichiers sur l'écran Séances.
- **Ouvrir avec Ma Moulinette** : déclarer la PWA comme gestionnaire des fichiers .zwo, .erg, .mrc et .fit (`file_handlers` du manifeste, Chrome et Edge sur ordinateur) et comme cible de partage (`share_target`, Android) : la séance téléchargée depuis TrainingPeaks ou Final Surge s'ouvre directement dans l'éditeur, sans passer par un sélecteur de fichier.
- **Bouton « Strava : importer le FIT »** qui télécharge le fichier et ouvre `strava.com/upload/select`, sur le modèle du bouton Garmin.

## Sécurité et données personnelles

- **Jetons** : chiffrés au repos (AES-GCM, clé en secret Worker, numéro de version de clé pour la rotation), jamais renvoyés au navigateur, jamais journalisés. Les rapports de télémétrie excluent les en-têtes et corps des appels tiers.
- **OAuth** : `state` à usage unique et durée de 10 min (comme aujourd'hui), PKCE quand la plateforme le permet, droits minimaux par fonction activée : on ne demande `activity:read` à Strava que si l'import est activé.
- **Requêtes de la page** : vérification d'origine et en-tête CSRF existants (`x-zwift2`), cookie `SameSite=Lax`.
- **Webhooks** : vérification propre à chaque plateforme (jeton de vérification Strava, signature quand elle existe) ; réponse rapide puis traitement en file.
- **Déconnexion et désautorisation** : effacer les jetons, révoquer côté plateforme quand l'API le permet, annuler les travaux en attente.
- **Données de santé** (FC, poids) : consentement explicite par destination (« Envoyer ma fréquence cardiaque à Strava »), finalités affichées, suppression en libre-service de tout ce que la passerelle garde. FIT conservés 30 jours au plus après livraison. Hébergement : D1 et R2 permettent de restreindre les données à l'Union européenne (juridiction), à activer à la création.
- **Conditions des plateformes** : données Strava et Garmin montrées à leur seul propriétaire, jamais utilisées pour un modèle d'IA, jamais retransmises à une autre plateforme. Conséquence concrète : une sortie importée de Garmin ne doit pas être renvoyée à Strava par nous.

## Tests

| Niveau | Ce qui est vérifié | Comment |
|---|---|---|
| Unitaire | Convertisseurs de séances aller et retour, pertes signalées ; enrichissements du FIT | Vitest, relecture par le décodeur Garmin, jeu de fichiers dans `samples/` |
| Connecteurs | Chaque cas de `UploadOutcome`, rafraîchissement, 401, 429, doublons | `fetch` injecté avec des réponses enregistrées sur de vrais comptes (anonymisées) |
| Passerelle | Routes, états OAuth, travaux, nouvel essai, webhooks | `wrangler dev` avec D1 local, comme le récepteur de journaux |
| Bout en bout | Une vraie sortie sur le KICKR jusqu'à chaque plateforme | Comptes de test ; bac à sable TrainingPeaks |
| Manuel | Import du FIT dans Garmin Connect et Final Surge | Une fois par changement de l'encodeur |

Le tableau « Où on en est » de la feuille de route reçoit une ligne par plateforme, avec la même règle : « validé » veut dire essayé sur un vrai compte.

## Devenir partenaire

### Ce qu'il faut avoir avant de déposer une demande

Toutes les plateformes demandent à peu près la même chose ; mieux vaut l'avoir prêt une fois pour toutes.

| Élément | Pourquoi | État |
|---|---|---|
| Nom de l'application et site public | TrainingPeaks demande le site de la société et l'adresse du projet ; un projet sans adresse publique passe pour un usage personnel, refusé | À faire : la PWA déployée sur un domaine, avec une page de présentation |
| Politique de confidentialité | Exigée par les conditions de TrainingPeaks (3.d), par Garmin et Strava | À écrire (données de santé : FC, poids) |
| Adresse e-mail du projet | Contact des plateformes ; éviter l'adresse personnelle | À créer |
| Société ou particulier | Le formulaire TrainingPeaks a un champ « Company » (obligatoire ou non : inconnu) ; Garmin Starter exigerait une société selon un témoignage | Décision de Tom |
| Adresses de retour OAuth | Demandées à la création des applications | Fournies par la passerelle déployée |
| Schéma du parcours utilisateur | TrainingPeaks le demande avant la mise en production | À tirer de ce document |

### TrainingPeaks

1. **Lire le wiki partenaire** (`github.com/TrainingPeaks/PartnersAPI/wiki`), exigé avant le formulaire.
2. **Remplir le formulaire** `api.trainingpeaks.com/request-access`, même fermé : la demande est gardée pour la reprise. Réponses proposées :

   | Champ | Réponse |
   |---|---|
   | Industry / Category | Cycling / Software |
   | Primary API objective | Pull planned workouts from TrainingPeaks |
   | Role of TrainingPeaks | Athletes use TrainingPeaks and our product for different aspects |
   | Role of coaches | Coaches are optional |
   | AI use | Not using AI |
   | Application for | Athletes |
   | Integrations | Get basic profile and zones ; Get planned workouts (up to 7 days ahead) ; Upload completed workout files ; plus tard Push planned workouts |
   | Project | Application d'entraînement sur home trainer (navigateur, iOS, Android) : exécute en ERG les séances prévues par le coach, renvoie la sortie en FIT avec un tour par étape |

3. **Revue manuelle**, sans délai publié (« as soon as we are able to »).
4. **Bac à sable** : identifiants pour `api.sandbox.trainingpeaks.com`, comptes de test, données rafraîchies depuis la production chaque week-end (il faut parfois refaire les essais).
5. **Validation avant production**, demandée par leur portail de support. Ils vérifient : les droits demandés et réellement utilisés (aucun droit inutile), un en-tête `User-Agent`, des essais avec un coach, un athlète premium, un athlète gratuit et un athlète en essai premium. Un athlète gratuit ne doit pas pouvoir créer ou modifier une séance future (`workouts:plan`) ni appeler les routes de détail (`workouts:details`). Les fichiers déposés doivent apparaître dans leur interface ; la marque TrainingPeaks doit suivre leur kit média (règles sur demande à marketing@trainingpeaks.com).
6. **Production** : identifiants promus après validation.

Conditions qui nous concernent (conditions d'utilisation de l'API) :
- **Gratuit aujourd'hui**, avec le droit de facturer plus tard, après préavis.
- **Pas de produit concurrent** de TrainingPeaks (4.a.1). Zwift, TrainerRoad et ROUVY sont partenaires : une application qui *exécute* les séances passe. Ne pas présenter l'application comme un outil de planification ou d'analyse pour coachs.
- Pas de revente des données, même avec l'accord de l'utilisateur ; cache de 7 jours au plus ; export des données possible pour l'utilisateur ; aucune annonce publique citant TrainingPeaks sans leur accord écrit ; identifiants jamais dans un dépôt public.

Sources : [formulaire de demande et conditions](https://api.trainingpeaks.com/request-access) · [wiki PartnersAPI](https://github.com/TrainingPeaks/PartnersAPI/wiki) · [FAQ partenaires](https://github.com/TrainingPeaks/PartnersAPI/wiki/Frequently-Asked-Questions) · [validation avant production](https://github.com/TrainingPeaks/PartnersAPI/wiki/Pre-Production-Validation) · [annuaire des partenaires](https://www.trainingpeaks.com/partners/)

### Strava

Strava ne parle pas de « partenaire » : toute application commence au palier Standard, et grandit par revue.

| Palier | Athlètes | Comment l'obtenir | Quotas (par 15 min / par jour) |
|---|---|---|---|
| Un seul athlète | 1 (le propriétaire) | Par défaut, à la création de l'application sur `strava.com/settings/api` ; abonnement Strava du propriétaire exigé | 200 / 2 000 |
| Standard 10 | 10 | Soi-même, dans le tableau de bord de l'API, sans revue | 400 / 4 000 |
| Standard 9 999 | jusqu'à 9 999 | Formulaire de revue (lien depuis la page « Rate Limits » de la documentation) | Relevés après revue (chiffres non publiés) |
| Accès étendu | 10 000 et plus | Admis au cas par cas | Plus élevés ; abonnement non exigé |

Démarche pour dépasser 10 athlètes :
1. Relire l'API Agreement et l'API Policy (en vigueur depuis le 1er juin 2026) et appliquer les règles de marque.
2. Envoyer le formulaire de revue avec **des captures de chaque endroit où l'application montre des données Strava, et du bouton « Connect with Strava »**.
3. Attendre : pas de délai garanti (« Strava does not commit to a fixed review-time »), et l'accès n'est pas acquis. Critères annoncés : applications qui « complètent l'expérience Strava », d'une qualité suffisante, et qui respectent l'accord et la politique.

À préparer pour la revue :
- **Bouton officiel « Connect with Strava »** (orange ou blanc, 48 px de haut), qui mène à `strava.com/oauth/authorize`.
- **Lien « View on Strava »** à côté de chaque sortie envoyée (gras, souligné ou couleur #FC5200).
- Mentions permises : « Powered by Strava » ou « Compatible with Strava » seulement ; logo Strava jamais plus visible que le nôtre ; pas de « Strava » dans le nom de l'application.
- **Webhook de désautorisation** : exigé par les conditions ; effacer les données dans les 48 h pour une suppression, 30 jours au plus après une révocation.

Conditions qui nous concernent :
- Coût : l'abonnement du propriétaire, sans frais d'API en plus ; Strava se réserve de facturer plus tard. Interdit de faire payer l'utilisateur pour une fonction qui dépend de l'API.
- Envoyer des activités est explicitement permis (accord, 7.1) ; aucune règle propre aux applications d'entraînement en salle.
- Pas d'usage concurrent de Strava ni d'imitation de son interface ; pas de statistiques agrégées sur les données Strava (5.4) ; pas d'IA, d'index de recherche ni de serveur MCP sur ces données ; cache de 7 jours au plus ; aucune transmission à un tiers, même avec l'accord de l'utilisateur.
- Données montrées à leur seul propriétaire (2.3) ; la clause 6.1 semble dire autre chose pour les petites applications : à faire préciser par developers@strava.com si l'application montre un jour des sorties d'autres coureurs.

Pour nous, le palier Standard 10 suffit longtemps : il couvre Tom et les premiers testeurs, sans revue.

Sources : [premiers pas](https://developers.strava.com/docs/getting-started/) · [quotas et revue](https://developers.strava.com/docs/rate-limits/) · [règles de marque](https://developers.strava.com/guidelines/) · [API Agreement](https://www.strava.com/legal/api) · [API Policy](https://www.strava.com/legal/api_policy) · [annonce du 1er juin 2026](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428) · [FAQ de l'API](https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906)

### Final Surge

- **Aucun programme partenaire ni page développeurs.** La page de contact (`finalsurge.com/contact-us`) dit d'écrire directement pour les partenariats, mais le lien pointe vers une adresse factice (`random@random.com`). Société : Final Surge LLC.
- **Démarche** : passer par le formulaire de support (`support.finalsurge.com/hc/en-us/requests/new`) en demandant que le message soit transmis à l'équipe partenariats, et demander une adresse directe.
- **Ce qu'on leur propose**, calqué sur leur intégration Zwift (mars 2025) : Final Surge pousse chaque nuit les séances vélo structurées des 4 jours suivants, en % de FTP (format exigé pour Zwift, que notre modèle gère) ; nous renvoyons la sortie terminée sur leur calendrier. TrainerRoad et ROUVY ont des accords proches.
- Aucun délai ni condition connus.

Sources : [contact](https://www.finalsurge.com/contact-us) · [applications reliées](https://www.finalsurge.com/connected-apps) · [intégration Zwift](https://blog.finalsurge.com/final-surge-zwift-integration/) · [synchronisation TrainerRoad](https://support.trainerroad.com/hc/en-us/articles/360044135651)

## Étapes

### 0. Demandes d'accès (maintenant, dépend de Tom)

| Plateforme | Démarche | Délai connu |
|---|---|---|
| Garmin | Formulaire du palier Starter ; vérifier si une société est exigée | « Presque immédiat » annoncé, des demandes sans réponse après deux semaines selon des témoignages |
| TrainingPeaks | `api.trainingpeaks.com/request-access` (voir « Devenir partenaire ») | Nouveaux partenaires suspendus au 12 novembre 2026 ; demande gardée pour la reprise |
| Wahoo | Création d'application sur la Cloud API | Inconnu |
| Strava | Application sur `strava.com/settings/api` (abonnement requis), passage à 10 athlètes soi-même ; revue seulement au-delà (voir « Devenir partenaire ») | Immédiat une fois abonné ; revue sans délai garanti |
| Final Surge | Formulaire de support, à transmettre aux partenariats (voir « Devenir partenaire ») | Inconnu |

Les prérequis communs (site public, politique de confidentialité, adresse e-mail du projet, adresses de retour OAuth) sont listés dans « Devenir partenaire ». La passerelle déployée, même vide, fournit les adresses de retour.

### 1. Fichiers et file d'envoi locale (sans serveur)

- Tours par étape de séance et messages de séance dans le FIT.
- File d'envoi en IndexedDB : plus aucune sortie perdue à la fermeture de l'onglet.
- Import FIT Workout ; export .erg, .mrc, FIT Workout.
- Boutons « Garmin Connect : importer le FIT » et « Strava : importer le FIT » qui téléchargent le fichier et ouvrent la page d'import.
- PWA gestionnaire des fichiers de séance et cible de partage.
- Critère de fin : un FIT importé à la main dans Garmin Connect, Strava et Final Surge, tours visibles ; une séance exportée de TrainingPeaks et une de Final Surge importées et roulées sur le KICKR.

### 2. Passerelle et comptes connectés

- Worker `integrations` (séparé de `ma-moulinette-logs`), D1, R2, Queues ; identité implicite.
- Connecteur Strava repris du relais, puis Wahoo dès l'application approuvée ; écran « Comptes connectés » ; envoi automatique en fin de sortie, par destination.
- Critère de fin : une sortie sur le KICKR arrive seule sur Strava depuis le build publié, avec un réseau coupé puis rétabli pendant la sortie.

### 3. Séances planifiées

- TrainingPeaks dès l'accès obtenu (bac à sable d'abord), puis Wahoo si ses plans sont lisibles.
- « Séance du jour » sur l'accueil.
- Critère de fin : une séance planifiée dans TrainingPeaks se lance depuis l'accueil, et la sortie revient rapprochée de la séance prévue.

### 4. Envoi des séances

- Garmin (Training API), TrainingPeaks (`workouts:plan`), Wahoo si l'API le permet.
- Critère de fin : une séance créée dans l'éditeur apparaît au calendrier Garmin et sur un compteur.

### 5. Import de l'historique

- Sorties extérieures depuis Garmin (Activity API), Strava, Wahoo : courbe de puissance, estimation de la FTP, charge.
- Dépend des comptes OIDC et du stockage des activités côté serveur (étape 6 de la feuille de route).

## Questions ouvertes

1. **Identité** : partir sur l'identité implicite (option A) ou attendre les comptes OIDC ?
2. **Hébergement** : passerelle sur Cloudflare (recommandé) ou attendre le backend Node et PostgreSQL ?
3. **Structure légale** : les demandes Garmin, TrainingPeaks et Wahoo seront-elles faites au nom d'une société ou d'un particulier ?
4. **Envoi automatique** : par défaut, chaque sortie part vers toutes les plateformes connectées, ou l'utilisateur choisit à chaque fin de sortie ?
5. **Priorités** : l'ordre Strava, TrainingPeaks, Garmin, Wahoo, Final Surge convient-il ? Il suit la facilité d'accès, pas le nombre d'utilisateurs.
6. **Strava** : Tom a-t-il déjà un abonnement Strava ? Si oui, l'application personnelle ne coûte rien de plus et valide le connecteur existant ; sinon, l'import manuel suffit en attendant.
