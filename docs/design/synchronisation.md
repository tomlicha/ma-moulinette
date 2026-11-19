# Synchronisation entre appareils

Référence permanente de la **synchronisation des séances et du profil** d'un même utilisateur entre ses appareils (ordinateur, téléphone, tablette). Statut : **spécification, rien n'est codé**. Toute évolution part de ce fichier et le met à jour.

- Situation de départ (16 novembre 2026) : tout vit dans le `localStorage` de chaque navigateur (voir « Inventaire des données »). Aucun compte ; le Worker Cloudflare et sa base D1 ne servent qu'à la passerelle Strava, avec un seul propriétaire (`OWNER_KEY`, table `strava_tokens` à une ligne).
- Code à toucher : [`src/domain/workout/library.ts`](../../src/domain/workout/library.ts), [`src/domain/workout/block-library.ts`](../../src/domain/workout/block-library.ts), [`src/main.ts`](../../src/main.ts) (FTP, masse), [`src/ui/ride/gears.ts`](../../src/ui/ride/gears.ts), [`worker/app.ts`](../../worker/app.ts), une migration D1 (`worker/migrations/0003_sync.sql`).
- Voir aussi : [analyse-technique.md](../analyse-technique.md) (cible : comptes OIDC, PostgreSQL), [seances.md](seances.md), [recap.md](recap.md).

## Ce que « garantir » veut dire

La synchronisation ne peut pas promettre « tout est identique à chaque instant » (un appareil peut être hors ligne). Elle promet ceci :

| # | Garantie | Comment on la vérifie |
|---|---|---|
| G1 | **Aucune perte silencieuse.** Une séance ou un réglage enregistré sur un appareil finit sur le serveur, même après une coupure, une fermeture de l'onglet ou plusieurs jours hors ligne. | Test : enregistrer hors ligne, fermer, rouvrir en ligne : l'élément est envoyé. |
| G2 | **Convergence.** Deux appareils qui se synchronisent jusqu'au silence (deux passes sans changement) ont exactement les mêmes données synchronisées, quel que soit l'ordre des modifications. | Test de propriété : séquences aléatoires d'opérations sur deux appareils simulés. |
| G3 | **Pas d'écrasement muet entre deux séances modifiées en parallèle.** Les deux versions survivent : l'une garde la séance, l'autre devient une copie nommée. | Test de conflit. |
| G4 | **Une suppression se propage** et ne ressuscite pas, sauf si l'autre appareil a modifié la séance depuis (la modification l'emporte, voir « Conflits »). | Test de suppression. |
| G5 | **Le serveur ne bloque jamais l'utilisateur.** Panne, réseau lent, quota atteint : l'application marche en local, dit l'état en une ligne, réessaie. Aucune requête réseau pendant une sortie. | Test avec serveur en panne ; contrôle qu'aucun appel de synchronisation ne part tant qu'une sortie est en cours. |

Non-garanties, à dire telles quelles dans l'interface : un appareil jamais synchronisé ne voit rien ; un appareil hors ligne voit l'état de sa dernière synchronisation ; si tous les appareils et la clé de récupération sont perdus, le compte est perdu.

## Inventaire des données

| Clé actuelle | Contenu | Synchronisée | Pourquoi |
|---|---|---|---|
| `zwift2.workouts` | Séances de l'éditeur (`SavedWorkout`) | **Oui**, une ligne par séance (`workout`) | Le besoin principal. |
| `zwift2.blocks` | Blocs préfaits de l'utilisateur | **Oui**, une ligne par bloc (`block`) | Fait partie de l'atelier de séances. |
| `zwift2.ftp`, `zwift2.mass` | FTP et masse | **Oui**, une ligne par réglage (`pref`) | Profil du cycliste : alimente zones, puissance cible et physique du coureur. |
| `zwift2.cog`, `zwift2.chainring` | Pignon et plateau simulés | **Oui** (`pref`) | Réglage du cycliste, pas de la machine. |
| `zwift2.viewStats` | Affichage des statistiques | Non | Préférence d'affichage propre à l'écran. |
| `zwift2.trainerProtocol` | Protocole imposé au trainer | Non | Dépend du matériel de cet appareil. |
| `zwift2.devices` | Appareils Bluetooth mémorisés | Non | Les identifiants Bluetooth n'ont de sens que dans le navigateur qui a appairé. |
| Clé Strava (`client.ts`) | Clé du propriétaire pour la passerelle | **Jamais** | Secret : ne doit pas transiter ni être stocké avec les données de profil. |
| Parcours choisi, séance choisie | Sélection courante | Non (v1) | Choix de l'instant ; une séance synchronisée sur l'autre appareil n'est pas « choisie » pour autant. |
| `sessionStorage` (`installSkipped`) | Invitation à installer | Non | Durée de vie d'un onglet. |

Règle de classement pour toute donnée future : **profil du cycliste ou contenu créé → synchronisée ; matériel, affichage, secret → locale.**

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-16 | **Étape 1 : compte anonyme et appairage par code** (pas de mot de passe, pas d'e-mail). Les comptes OIDC (e-mail, Google, Apple) viendront ensuite et se rattacheront au même compte, sans toucher au format des données. | Débloque la synchronisation sans attendre le chantier comptes de l'analyse technique ; l'identité est isolée derrière un jeton d'appareil, donc remplaçable. À confirmer avec le porteur du projet (voir « Questions ouvertes »). |
| 2026-11-16 | Le **serveur est la source de vérité** ; le `localStorage` reste le cache de travail et fonctionne seul. | Garde le hors ligne et la vitesse actuels (G5). |
| 2026-11-16 | **Numéro de révision attribué par le serveur** (`rev`, croissant par compte), pas l'heure de l'appareil. | Une horloge de téléphone fausse ne doit pas faire gagner une vieille version. `updatedAt` ne sert plus qu'à trier l'affichage. |
| 2026-11-16 | **Suppressions marquées** (pierre tombale) conservées 180 jours. | Sans trace, une séance supprimée sur A reviendrait depuis B. |
| 2026-11-16 | Une **modification postérieure à une suppression l'emporte** sur la suppression. | Perdre du travail est pire que garder une séance supprimée par erreur. |
| 2026-11-16 | **Pas de réseau pendant une sortie** ; envoi à la fin ou au retour au menu. | Le HUD et le Bluetooth passent avant tout (G5). |
| 2026-11-16 | Données stockées en **région européenne** (D1 avec juridiction UE), strict minimum collecté. | La masse et la puissance sont des données de santé au sens large (RGPD). |

## Identité (étape 1)

Un **compte** est un identifiant aléatoire (UUID) créé par le serveur. Chaque **appareil** y est rattaché par un **jeton d'appareil** de 256 bits, gardé dans le `localStorage` ; le serveur ne garde que son empreinte SHA-256. Un appareil se révoque seul, sans toucher aux autres.

Parcours :

1. **Activer la synchronisation** (premier appareil) : le serveur crée le compte et le premier jeton, et affiche une **clé de récupération** (24 caractères par groupes de 4, 128 bits), à noter. Elle redonne un accès si tous les appareils sont perdus ; seule son empreinte est stockée.
2. **Ajouter un appareil** : sur l'appareil A, « Ajouter un appareil » affiche un **code à 8 caractères** (alphabet de 32 signes sans `0 O 1 I`, soit 40 bits) valable **5 minutes**, à usage unique. Sur l'appareil B, « J'ai un code » le reçoit et B obtient son propre jeton. Un lien `?pair=CODE` et un QR code pourront remplir le champ (hors v1).
3. **Récupérer** : « J'ai une clé de récupération » sur un appareil neuf, avec la clé.
4. **Gérer** : liste des appareils (nom, dernière synchronisation), « Retirer cet appareil » ; « Supprimer le compte et les données » et « Exporter mes données » (JSON), pour le RGPD.

Protections : code et clé comparés par empreinte ; 5 essais par code puis le code est brûlé ; limite de débit par adresse IP sur les routes de création, d'appairage et de récupération ; taille d'une ligne limitée à 256 Ko, 5 Mo de données par compte ; routes `/api/sync/*` en même origine uniquement.

Le jeton d'appareil est un secret du même ordre que la clé Strava : il n'apparaît jamais dans les journaux de télémétrie ni dans une URL (en-tête `Authorization` seulement).

## Modèle de données (D1, migration 0003)

```sql
CREATE TABLE sync_accounts (
  id          TEXT PRIMARY KEY,      -- UUID
  rev         INTEGER NOT NULL DEFAULT 0,   -- dernier numéro de révision attribué
  min_rev     INTEGER NOT NULL DEFAULT 0,   -- révision en deçà de laquelle les pierres tombales ont été purgées
  recovery_hash TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE sync_devices (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE TABLE sync_pairing (
  code_hash   TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sync_records (
  account_id  TEXT NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,         -- 'workout' | 'block' | 'pref'
  id          TEXT NOT NULL,         -- UUID de la séance, du bloc ; nom du réglage pour 'pref'
  body        TEXT,                  -- JSON ; NULL pour une pierre tombale
  rev         INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, kind, id)
);
CREATE INDEX sync_records_rev ON sync_records (account_id, rev);
```

Chaque écriture accepte : `rev = ++sync_accounts.rev`, dans une seule transaction (`db.batch`). La lecture incrémentale est « tout ce dont `rev > curseur` », triée par `rev`.

## Interface réseau

Toutes les routes sauf la création, l'appairage et la récupération exigent `Authorization: Bearer <jeton>`. Elles s'ajoutent à `/api/*` de [`worker/app.ts`](../../worker/app.ts), à côté de la passerelle Strava.

| Route | Rôle |
|---|---|
| `POST /api/sync/account` | Crée un compte et un premier appareil ; renvoie `{ deviceToken, recoveryKey }`. |
| `POST /api/sync/pair/start` | Appareil connecté : renvoie `{ code, expiresAt }`. |
| `POST /api/sync/pair/finish` `{ code, deviceName }` | Appareil neuf : renvoie `{ deviceToken }`. |
| `POST /api/sync/recover` `{ recoveryKey, deviceName }` | Idem, par clé de récupération. |
| `GET /api/sync/changes?since=N` | `{ records: [{kind,id,body,deleted,rev}], rev, minRev }`. Si `N < minRev`, l'appareil doit repartir de zéro (voir « Appareil absent trop longtemps »). |
| `PUT /api/sync/records` `[{kind,id,body,deleted,baseRev}]` | Écrit un lot (50 lignes au plus). Par ligne : `{ rev }` si acceptée, ou `{ conflict: <version courante> }` si la ligne a changé depuis `baseRev` et que le contenu diffère. |
| `GET /api/sync/devices`, `DELETE /api/sync/devices/:id` | Liste, retrait. |
| `GET /api/sync/export`, `DELETE /api/sync/account` | Export JSON, effacement complet. |

## Conflits

Un conflit apparaît quand une ligne est écrite avec un `baseRev` plus ancien que la `rev` du serveur et un contenu différent.

| Cas | Règle |
|---|---|
| **Séance ou bloc modifié des deux côtés** | La version du serveur reste sous l'identifiant. La version locale devient une **nouvelle séance** « *Nom* (autre appareil) » : rien ne se perd (G3). L'interface le dit une fois (« Une séance a été modifiée sur deux appareils : les deux versions sont gardées »). |
| **Réglage (`pref`) modifié des deux côtés** | **Dernier arrivé au serveur gagne**, par réglage : le FTP modifié sur A et la masse modifiée sur B se combinent ; deux FTP différents, le dernier envoi l'emporte. Pas de copie : une valeur unique n'en a pas besoin. |
| **Supprimé d'un côté, modifié de l'autre** | La modification l'emporte : la séance revient chez celui qui l'avait supprimée. |
| **Supprimé des deux côtés** | Rien à faire. |
| **Contenu identique** | Pas de conflit, seule la `rev` locale est mise à jour. |

## Moteur de synchronisation (client)

Module neuf `src/infra/sync/`, en **logique pure** testable (comme `src/domain/workout/`), avec une fine couche réseau et DOM.

- **État local**, clé `zwift2.sync` : `{ deviceToken, accountId, cursor, rows: { "kind/id": { rev, dirty } } }`. Le format des données existantes ne change pas : la `rev` d'une séance vit dans cet état, pas dans `SavedWorkout`.
- **Marquage** : `WorkoutLibrary.save/remove`, `BlockLibrary.save/remove` et l'enregistrement du FTP, de la masse et des vitesses appellent `sync.markDirty(kind, id)`. Pas de synchronisation lancée depuis les bibliothèques elles-mêmes (elles restent pures).
- **Passe de synchronisation** (une seule à la fois) : 1) envoyer les lignes `dirty` par lots, 2) appliquer les conflits, 3) tirer `changes?since=cursor` et fusionner dans le `localStorage`, 4) avancer le curseur. Une écriture n'est retirée de `dirty` qu'après accusé du serveur (G1).
- **Déclencheurs** : au lancement, au retour de l'onglet au premier plan (`visibilitychange`), à `online`, 2 s après un enregistrement (regroupement), toutes les 5 minutes onglet visible, et à la demande. **Jamais pendant une sortie** ; la passe est reportée à la fin.
- **Échec** : réessai à 5 s, 30 s, 2 min, puis toutes les 5 min, sans bruit. 401 : l'appareil a été retiré, l'interface le dit et revient en local.
- **Sans compte** : le moteur ne fait rien ; l'application est identique à aujourd'hui.

### Premier raccordement d'un appareil qui a déjà des données

Sans jamais écraser un côté par l'autre : les **séances et blocs** des deux côtés sont réunis (identifiants différents, donc aucun conflit), les **réglages** prennent la valeur du compte s'il en a une, sinon celle de l'appareil. Résumé affiché : « 12 séances ajoutées au compte, 3 reçues, profil du compte repris ».

### Appareil absent trop longtemps

Les pierres tombales sont purgées après 180 jours (`min_rev` avance). Un appareil dont le curseur est plus ancien que `min_rev` repart de zéro : il garde ses lignes `dirty`, remplace le reste par l'état du serveur (ce qui retire ce qui a été supprimé entre-temps), sans rien perdre de non envoyé.

## Interface

Un panneau **Synchronisation** dans les réglages de l'accueil (le placement exact se décide avec une maquette, comme pour les autres écrans). Il reste simple et tient dans 844 × 390 px, sans défilement de page (le téléphone s'utilise en paysage uniquement, cibles 844 × 390 et 915 × 412) :

| État | Ce que l'utilisateur voit |
|---|---|
| Pas de compte | « Retrouvez vos séances et réglages sur tous vos appareils » : **Activer**, **J'ai un code**, **J'ai une clé de récupération**. |
| Connecté | État en une ligne (« À jour il y a 2 min » / « 2 modifications en attente » / « Hors ligne ») ; **Ajouter un appareil** (code en grand, compte à rebours de 5 min) ; liste des appareils ; **Synchroniser maintenant**. |
| Après activation | Écran unique de la clé de récupération, avec « Je l'ai notée » ; la clé n'est plus jamais affichée. |
| Conflit | Bandeau unique, voir « Conflits ». |
| Compte supprimé | Retour à l'état « pas de compte », données locales conservées. |

L'indicateur d'état est le seul élément de synchronisation visible hors de ce panneau : un point discret dans l'écran Séances (à jour / en attente / hors ligne).

## Tests

- **Fusion pure** (`merge`, `applyChanges`) : tests en tableau, un par ligne de « Conflits ».
- **Serveur** : D1 simulé avec le SQLite de Node, comme dans [`d1-store.test.ts`](../../worker/d1-store.test.ts), avec la vraie migration et le vrai SQL. Cas : révisions croissantes, lot, conflit, jeton invalide, code expiré, code réutilisé, 5 essais, quota, purge des pierres tombales, `min_rev`.
- **Deux appareils simulés** contre ce serveur : scénario d'acceptation de chaque garantie G1 à G5, plus un **test de propriété** de convergence (G2) sur des séquences aléatoires de création, modification, suppression et coupure.
- **Pendant une sortie** : un test vérifie qu'aucun appel réseau de synchronisation ne part.
- **Sur matériel** : deux navigateurs réels (ordinateur et téléphone), appairage par code, modification croisée, mode avion. À faire par le porteur du projet avant de déclarer la fonction livrée.

## Étapes de réalisation

| Étape | Contenu | Vérifiable par |
|---|---|---|
| S1 | Migration 0003, routes compte, appairage, jetons, limites de débit. | Tests serveur. |
| S2 | Routes `changes` et `records`, révisions, pierres tombales, conflits. | Tests serveur, test de propriété. |
| S3 | Moteur client (`src/infra/sync/`), branchement des bibliothèques et du profil, règle « pas de réseau en sortie ». | Tests des deux appareils simulés. |
| S4 | Panneau Synchronisation, clé de récupération, liste des appareils, états et messages. | Aperçu navigateur et captures, comme pour le HUD. |
| S5 | Export, effacement, purge programmée (déclencheur `scheduled` du Worker, comme la purge des journaux). | Tests serveur. |
| S6 | Essai sur matériel réel. | Porteur du projet. |

Puis, plus tard : comptes OIDC rattachés au même compte, QR code d'appairage, synchronisation des sorties enregistrées et de l'historique (hors de cette spec).

## Questions ouvertes

1. **Identité de l'étape 1** : l'appairage par code est proposé par défaut. Un vrai compte (OIDC) d'emblée serait plus long et ajouterait un fournisseur d'identité à choisir.
2. **Parcours et séance choisis** : locaux en v1. À synchroniser si on veut « reprendre où j'en étais » d'un appareil à l'autre.
3. **Durée de conservation des pierres tombales** : 180 jours proposés ; plus court allège la base, plus long protège les appareils rarement ouverts.
4. **Passerelle Strava** : reste liée à `OWNER_KEY` (un seul propriétaire). Une version multi-utilisateur rattacherait les jetons Strava au compte ; hors de cette spec.
5. **Quotas** : 256 Ko par ligne et 5 Mo par compte sont des valeurs de départ, à ajuster après mesure de la taille réelle d'une séance chargée.
