# Feuille de route

Mise à jour du 17 novembre 2026. Référence : [analyse technique](analyse-technique.md) (preuves de concept, exigences EF et ENF).

« Validé » veut dire essayé sur du vrai matériel. Le reste n'est vérifié que par des tests automatiques, ce qui ne prouve pas que le matériel se comporte pareil.

## Où on en est

| Domaine | État | Validé sur matériel ? |
|---|---|---|
| Connexion trainer (Web Bluetooth) | Fait : appairage, lecture de la puissance, reconnexion automatique | Oui sur un Wahoo KICKR |
| Pilotage ERG et SIM | Fait par le protocole propriétaire Wahoo ; ERG engageable et désengageable à tout moment | Oui sur le KICKR |
| Pilotage FTMS | Codé et testé sur un faux appareil | **Non** : le KICKR n'expose pas FTMS |
| Identification et choix du protocole | Fait : nom et Device Information (fabricant, modèle, firmware), profil par famille (Wahoo, Tacx, Elite), protocole préféré puis repli FTMS → Wahoo → FE-C → Zwift → lecture seule, pente plafonnée au modèle, protocole imposable depuis l'écran Appareils | Testé sur faux appareils ; à confirmer sur le KICKR (lecture de Device Information, déverrouillage Wahoo) |
| Pilotage FE-C over BLE (Tacx) | Codé : ERG, SIM, poids, traînée ; encodage recoupé avec GoldenCheetah, FortiusANT et qdomyos-zwift ; mesures par Cycling Power (pages FE-C en repli) ; reprise selon la norme : état de commande (pages 70 → 71) avec un renvoi, configuration renvoyée quand la page 25 la réclame, consigne renvoyée toutes les 5 s | **Non** : aucun Tacx essayé |
| Reprise du contrôle Wahoo | Codé : accusé `01 <opcode> <statut>` attendu (1 s, abandonné si le trainer n'accuse jamais) ; commande refusée → déverrouillage puis un nouvel essai ; écriture BLE refusée → 3 essais | **Non** : à vérifier sur le KICKR (lignes « Wahoo Control Point » du journal) |
| Robustesse FTMS | Fait : contrôle repris après perte (Machine Status ou refus), Control Point facultatif, prise de contrôle tolérante | **Non** : faux appareil seulement |
| Zwift Cog, vitesses virtuelles | Codé (14 novembre 2026) : 24 braquets virtuels, changement par les boutons sur la vue ou les flèches haut et bas. Deux modes. **Protocole Zwift** ([`zwift.ts`](../src/sensors/zwift.ts)), à choisir comme protocole de pilotage prioritaire sur l'écran Appareils : poignée de main « RideOn », puis pente réelle et braquet envoyés au trainer, qui fait le calcul ; écarté sans réponse à la poignée de main. **Repli** pour les autres protocoles : le trainer reste en SIM et reçoit une pente corrigée ([`virtual-gears.ts`](../src/sim/virtual-gears.ts)). Protocole non publié par Zwift, repris de rétro-ingénieries ouvertes (Makinolo, swift-gears, TrainerHUD, orbeat, qdomyos-zwift). Manette Zwift Click non lue | **Non** : encodage et calcul testés, page vérifiée avec le trainer simulé, aucun trainer avec Cog essayé. À vérifier sur le KICKR : forme de la poignée de main acceptée, effet du braquet, ERG par ce protocole |
| Capteur de puissance seul | Fait : lecture, cadence déduite de la manivelle, cadence à 0 à l'arrêt | Oui sur un Stages (connexion) ; correction de cadence à confirmer |
| Ceinture cardio autonome | Codée, avec reconnexion | Oui sur un Garmin HRM-Pro+ : connexion, valeurs affichées, reconnexion (18,6 s, mais la ceinture était coupée pendant l'essai : le seuil de 5 s reste non mesuré) |
| Simulation physique | Fait : puissance, pente, air, roulement, inertie, freinage sans pédalage, trajet sur un réseau routier de 28,8 km avec deux parcours, montagne et plat ([parcours](design/parcours.md)) | Ressenti du SIM confirmé ; réglages à affiner |
| Rendu 3D | Décor remis à niveau d'après la maquette (14 et 15 novembre 2026) : rendu neutre, forêts et prés, relief propre, chaîne de montagnes, deux lacs, lieux bâtis à chaque carrefour, érables roux du Col, mobilier de bord de route, vent et nuages ([parcours](design/parcours.md)). Monde construit sur le réseau routier (relief par morceaux autour du cycliste, décor semé par morceau), relief exagéré ×1,6, caméra qui suit la pente, champ de vision et balancement selon l'effort, ombres en cascades, cycliste animé, WebGPU et repli WebGL2 ; carrefours et choix de route (14 novembre 2026) ; vue chargée à la demande et reconstruite après une perte du GPU (16 novembre 2026) | WebGPU confirmé sur l'ordinateur de Tom ; **aucune mesure de performance** |
| Export FIT | Fait ; bouton essayé dans la vraie page avec le trainer simulé, fichier relu avec le décodeur de Garmin | Fichier ouvert dans Strava (validé par Tom, 17 novembre 2026) ; pas encore essayé dans Garmin Connect |
| Envoi à Strava | Fait ; envoi sur le compte de chaque coureur (voir la ligne Multijoueur, étape 3a) | Oui : export vers Strava validé par Tom (17 novembre 2026) |
| Tapis, capteur de foulée (seconde vague) | Non commencé | — |
| Multijoueur, backend, comptes | Commencé (16 novembre 2026). **Étape 1, positions partagées** : chaque coureur annonce sa route, son sens, son abscisse et la route suivante dès qu'elle est verrouillée ([`Journey.locate`](../src/sim/journey.ts)) ; les autres recollent ses routes en une piste continue avec les mêmes virages arrondis ([`remote-track.ts`](../src/sim/remote-track.ts)) et lissent sa course avec 200 ms de retard ([`interpolation.ts`](../src/net/interpolation.ts)) ; protocole binaire de 19 octets par coureur, sans fréquence cardiaque ([`protocol.ts`](../src/net/protocol.ts)). **Étape 2, comptes et salle** : connexion par Strava seule, un compte par athlète, nom affiché validé par le coureur ([`accounts.ts`](../src/server/accounts.ts), migration 0003) ; salle en Durable Object Cloudflare qui relaie sans simuler ([`room.ts`](../src/server/room.ts), [`world-room.ts`](../worker/world-room.ts)) ; client avec reconnexion ([`world-client.ts`](../src/net/world-client.ts)) ; robots de test (`npm run bots`). Application Strava passée à 10 athlètes. **Étape 3a, compte dans l'application** : bouton officiel « Connect with Strava » en haut à droite des écrans, pastille du coureur en ligne, choix du nom, mode sans compte (seul, export FIT) ; l'envoi à Strava part sur le compte de chaque coureur, le relais du serveur Vite disparaît ([compte](design/compte.md)). **Étape 3b, autres coureurs dans la vue** (17 novembre 2026) : les 16 plus proches (moins de 220 m) sont dessinés comme le joueur, sur le relief dessiné, avec cap, pente, cadence et maillot de leur teinte ([`others.ts`](../src/render/others.ts)) ; nom et distance au-dessus d'eux, sans chevauchement, six au plus ([`others-model.ts`](../src/render/others-model.ts), [`rider-tags.ts`](../src/ui/rider-tags.ts)) ; pastille « En ligne · N autres coureurs » et encart des coureurs proches (7 devant, 3 derrière) sur la Sortie. **Étape 4, charge** (17 novembre 2026) : gestion d'intérêt dans la salle, 32 voisins dans 1,5 km au-delà de 33 coureurs ; trafic constant de 2,5 Ko/s par client, 2,45 Mo/s pour le serveur à 1000 coureurs au lieu de 76 ; `npm run load` ([salle](design/salle.md)). **Aspiration** : économie de traînée de l'air derrière le coureur de devant, jusqu'à 35 %, affichée dans l'encart des proches. **Données synchronisées** (17 novembre 2026) : FTP, masse, séances et « Mes blocs » suivent le compte d'un appareil à l'autre, la modification la plus récente gagne ([`src/sync/`](../src/sync/), migration `0004`, [compte](design/compte.md#données-synchronisées)). Reste : capacité réelle d'un Durable Object (clients réels sur un aperçu de branche), classement | Tests, et `wrangler dev` avec un vrai Durable Object (robots). Vérifié dans la page (Chromium sans GPU, WebGL2, iPhone 13 paysage 844 × 390 et ordinateur 1280 × 800) avec des robots immobiles et en mouvement. Connexion Strava validée en ligne ; déployé le 17 novembre 2026 (migration `0003` appliquée, version `57ed6213`). **Non** : deux vrais coureurs en ligne en même temps, rendu sur un vrai GPU et un vrai téléphone |
| Coquille iOS (Capacitor) | Commencée (17 novembre 2026) : coquille chargée depuis le serveur, pont Bluetooth natif avec balayage partagé et sélecteur de l'application, plugin propre (écran allumé, connexion Strava par session système et ticket), hors-ligne par domaines app-bound, iPad en paysage plein écran ([audit iPad](audit/2026-11-17/ipad.md), [suivi](audit/2026-11-17/ipad-suivi.md)). Reste : HealthKit, TestFlight | Tests et rendu simulé dans Chromium. **Non** : compilation Xcode, vrai iPad, vrai trainer |
| Séances structurées (.zwo, .erg, .mrc) | Fait : lecture des trois formats, déroulement minuté, ERG piloté par la séance, profil coloré par zone, intensité réglable | Vérifié dans la page avec le trainer simulé ; **pas encore sur le KICKR** |
| Éditeur de séances | Fait (étape 1 de la maquette « A·2 + A·3 ») : profil sur fond de zones avec info-bulle, barre du bloc sélectionné, réglages du bloc sur une ligne avec ±5 %, cadence en option, temps par zone, écarts avant/après, annuler/rétablir, raccourcis clavier. Glisser-déposer des blocs fait par la poignée de la barre du bloc, sur le profil (12 novembre 2026). Étagère de blocs préfaits et « Mes blocs » ([docs/design/seances.md](design/seances.md)), 12 novembre 2026. Reste : régler puissance et durée en tirant sur le profil. Le 12 novembre 2026, l'écran est refondu : bibliothèque et éditeur sur un seul écran plein écran, comme l'accueil ([docs/design/seances.md](design/seances.md)) | Vérifié dans la vraie page (Chrome) |
| Thème visuel « Doux » | Fait (12 nov. 2026) : jetons chauds, cartes claires, accent orange, navigation flottante, accueil en trois cartes avec radar carré, Séances et écrans suivants alignés, invite plein écran refaite, poubelle de bloc sur téléphone | Vérifié en émulation (Pixel 7 paysage, ordinateur 1280 × 800, clair et nuit) ; **pas sur un vrai téléphone** |
| Reconnexion au lancement | Fait : appareils mémorisés, écran Appareils en premier, reconnexion sans clic si `getDevices()` existe, sinon un clic par appareil | `getDevices()` absent du Chrome de test : **reconnexion sans clic non vérifiée sur matériel** |

## Prochaines étapes

L'ordre suit le risque : on lève d'abord ce qui peut invalider l'architecture, pas ce qui est le plus facile.

### Étape 1. Fermer les inconnues de ce qui existe (court)

1. **Mesurer le rendu.** Relever la ligne de statistiques de la vue 3D (i/s, p50, p95, triangles) sur l'ordinateur de Tom, en WebGPU puis en WebGL2, pendant une sortie de plusieurs minutes. Cible : p95 ≤ 16,7 ms (ENF-02). C'est la première donnée réelle pour le PoC 2.
2. ~~Essayer l'export avec ton matériel~~ Fait : export Strava validé par Tom le 17 novembre 2026.
3. **Couvrir plus de matériel.** Un trainer qui expose FTMS (une autre marque que Wahoo). Sans cela, le chemin FTMS, le socle de l'analyse, n'est jamais passé sur un vrai appareil (EF-01, EF-02, PoC 1).
4. **Affiner le ressenti** : freinage à l'arrêt, pente au départ du trajet, vitesse virtuelle comparée à celle du trainer.

### Étape 2. Séances structurées (fait le 10 novembre 2026, reste l'essai sur le KICKR)

Importer et exécuter des fichiers `.zwo`, `.erg` et `.mrc` (EF-05) : paliers, rampes, échauffements, avec la consigne envoyée en ERG. Le pilotage ERG existe déjà, il manque l'analyse des fichiers, l'exécution minutée et un HUD de séance. Les parseurs sont du TypeScript pur, testables sans matériel, avec un jeu de fichiers de référence.

### Étape 3. Rendu haute densité, PoC 2 complet (long)

C'est la plus grosse inconnue de l'analyse.
- Passer de la scène actuelle aux budgets de l'analyse : 50 coureurs d'environ 45 000 triangles, niveaux de détail générés, instanciation, décor en géométrie virtuelle (bibliothèque tierce ou réimplémentation).
- Ajouter la chaîne d'image : occlusion ambiante (GTAO), anticrénelage temporel, mise à l'échelle, lumière indirecte. Aujourd'hui il n'y a que des ombres en cascades.
- Départager Three.js et Babylon.js sur la même scène (critère de l'analyse).
- Mesurer sur les appareils planchers (iPhone 11, Android 2021, portable à GPU intégré) : 30 i/s stables pendant 60 min sur mobile, température et mémoire stables (ENF-01, ENF-07).
- Profils de qualité automatiques et baisse de profil en cas de dérive thermique. Premier palier fait le 16 novembre 2026 : qualité réduite par défaut sur écran tactile (`src/render/quality.ts`) ; reste la résolution dynamique pilotée par le temps d'image.

### Étape 4. Coquille iOS, PoC 4 (à lancer tôt, en parallèle)

Le Bluetooth ne marche pas dans Safari : sans coquille native, il n'y a pas d'iOS. Le risque est le rejet de l'App Store (règle 4.2) et ses délais ne dépendent pas de nous.
- Coquille Capacitor, plugin BLE natif derrière la même interface SensorHub, HealthKit, build TestFlight soumis en revue.
- Vérifier au passage que WebGPU tourne dans la WebView iOS et Android (inconnue de l'analyse).
- Nécessite un compte développeur Apple et un iPhone.

### Étape 5. Multijoueur, PoC 3

Salle en Durable Object Cloudflare (et non Colyseus : décision du 16 novembre 2026), gestion d'intérêt et mesure de la bande passante faites le 17 novembre ([salle](design/salle.md)) ; reste la mesure de capacité réelle avec de vrais clients (ENF-08). La simulation déterministe de `src/sim/` est déjà conçue pour tourner côté serveur. Ensuite : bots meneurs d'allure et fantômes (EF-12), courses arbitrées (EF-09).

### Étape 6. Produit

Comptes (OIDC), base PostgreSQL, hébergement avec région européenne, anglais et français, RGPD et données de santé, PWA installable, télémétrie (ENF-16), intégration continue avec budgets de taille et de performance, téléphone compagnon (EF-10), synchronisations Garmin et TrainingPeaks (EF-07). La course à pied reste en seconde vague.

## Ce qui dépend de Tom

- **Mesures de performance** : la ligne de statistiques de la vue 3D sur chaque appareil disponible.
- **Matériel** : un trainer FTMS d'une autre marque, un iPhone (idéalement un iPhone 11), un Android milieu de gamme de 2021.
- **Comptes** : compte développeur Apple pour l'étape 4 ; application Strava (créée, envoi validé). Un abonnement Strava payant est exigé pour créer une application depuis le 1er juin 2026 (rapporté par plusieurs médias, non relu dans la documentation officielle) : à confirmer sur la page du programme avant de payer.
- **Demandes d'accès API** (action 5 de l'analyse) : Garmin Connect, TrainingPeaks, Wahoo. Les délais sont longs et indépendants de nous, donc à déposer maintenant même si l'intégration vient tard.

## Points ouverts

- **Strava en production** : le relais actuel n'existe que dans le serveur de dev. Un déploiement public demandera un vrai serveur pour garder le secret client.
- **Modèle physique** : pas d'inertie des roues ni de limite d'adhérence. L'aspiration (17 novembre 2026) reprend des ordres de grandeur de la littérature, pas des mesures : à régler à l'usage ([salle](design/salle.md)).
- **Géométrie virtuelle** : bibliothèque très jeune (une seule étoile GitHub). La décision adopter ou réimplémenter se prend dans l'étape 3.
