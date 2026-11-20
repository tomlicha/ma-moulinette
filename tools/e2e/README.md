# Scénarios de bout en bout

Trois parcours pilotés dans un vrai navigateur (Chromium, via Playwright) contre le serveur de dev. Ils servent à deux choses :

1. **Vérifier** que l'application fait ce qu'elle doit : chaque étape contrôle ce que le geste doit avoir produit (boutons, textes, journal, erreurs de la page).
2. **Comparer avant et après** une refonte : chaque scénario écrit une trace (états, journal, DOM) que `compare.mjs` met en regard d'une autre. C'est ainsi qu'ont été validés les découpages de `main.ts` et de l'éditeur (docs/architecture.md).

| Scénario | Ce qu'il couvre | Durée |
|---|---|---|
| `boot` | Démarrage de la composition sur ordinateur et iPhone 13 paysage : aucune erreur de la page, accueil affiché, chaque écran s'ouvre. Détecte un module de composition mal ordonné | ~25 s |
| `app` | Trainer simulé : connexion, sortie libre, ERG manuel, séance (intensité, pause, palier suivant, ERG relâché puis repris), arrêt, récapitulatif, perte du trainer en pleine sortie et reprise | ~2 min |
| `autostart` | Démarrage au premier coup de pédale : sortie libre, arrêt volontaire non défait, séance choisie sur l'accueil, séance arrêtée non relancée | ~25 s |
| `account` | Compte contre un serveur de comptes simulé : visiteur, connexion Strava par la page web ou par l'app (Android), connexion de développement, nom à valider (refusé, erreur, accepté), menu, déconnexion ; sur iPhone couché (844 × 390), bouton Strava, pastille et menu Final Surge visibles sur Accueil, Appareils et Séances | ~15 s |
| `gears` | Vitesses virtuelles du Zwift Cog : interrupteur, plateau (bornes, arrondi), boutons, clavier (seulement sur la Sortie), butées, mémoire au rechargement | ~10 s |
| `recap` | Récapitulatif et envoi à Strava (aperçu `?recap=…`, envoi simulé) : compte à rebours, envoi automatique, suspension par un geste, Continuer et Échap, Strava à connecter, refus puis nouvel essai, pas de relais | ~2,5 min (la page, chargée de rendu 3D, tient mal les délais) |
| `gpu` | Perte du contexte WebGL de la vue 3D : trois reprises sur un canevas neuf, puis renoncement | ~15 s |
| `group` | Suivre un coureur (iPhone 13 paysage 844 × 390 plein écran), salle simulée : icône sur la ligne d'un coureur proche, panneau du suivi avec l'écart, être suivi et refuser, arrêter, fin du suivi, réglage « me rejoindre ». Captures dans `.e2e/group-*.png` | ~90 s |
| `online` | Rouler avec d'autres depuis l'accueil (iPhone 13 paysage 844 × 390), salle simulée : pastille « En ligne », panneau (coureurs, recherche sans accents, groupes), blocage sans trainer, rejoindre un coureur en sortie, créer une séance de groupe, salle d'attente, départ commun, séance verrouillée (ni pause ni palier), quitter. Captures dans `.e2e/online-*.png` | ~60 s |
| `route` | Carrefour en séance de groupe (iPhone 13 paysage) : le groupe est créé « en retard » pour arriver à 300 m du premier carrefour ; en créateur, les touches sont ouvertes, le choix part à la salle et revient ; en suiveur, les touches sont grisées et la route du créateur est retenue. Captures `.e2e/route-*.png` | ~70 s |
| `editor` | Écran Séances, sur ordinateur et sur iPhone en paysage (844 × 390, plein écran) : étagère, glisser-déposer, clavier, annuler/rétablir, enregistrement, bibliothèque, saisie exacte | ~60 s |

Aucune connexion Bluetooth ni compte n'est nécessaire : le trainer est le simulateur de l'application, et le serveur de comptes est simulé (visiteur déconnecté).

## En CI

`.github/workflows/e2e.yml` lance `boot`, `account`, `gears`, `autostart` et `editor` à chaque pull request ; `app` et `recap` s'y ajoutent sur `main`, chaque nuit et à la demande. `gpu` n'y est pas : il dépend du pilote graphique de la machine. Les traces sont jointes à l'exécution en cas d'échec.

## Installation

Playwright n'est pas une dépendance du projet (comme pour [tools/audit](../audit/README.md)) :

```
npm i --no-save playwright
npx playwright install chromium     # si aucun Chromium n'est déjà installé
```

## Lancer

```
npm run e2e                          # les trois scénarios
npm run e2e -- editor                # un seul (boot, app, autostart, account, gears, recap, gpu, editor)
npm run e2e -- --out .e2e/avant      # choisir le dossier des traces (défaut : .e2e/last)
npm run e2e -- --url http://localhost:5173/   # contre un serveur déjà lancé
```

Sans `--url`, le serveur de dev est lancé sur le port 5199 puis arrêté. Le code de sortie est non nul s'il y a un échec ; les échecs sont listés avec l'étape et la valeur trouvée. Les traces vont dans `.e2e/` (ignoré par git).

## Comparer avant et après une refonte

```
git stash                            # ou : git checkout <commit-d-avant>
npm run e2e -- --out .e2e/avant
git stash pop                        # ou : git checkout -
npm run e2e -- --out .e2e/apres
npm run e2e:compare -- .e2e/avant .e2e/apres
```

La comparaison ignore ce qui varie d'une exécution à l'autre : les chiffres du journal, l'ordre des lignes (la ligne « rendu 3D » surtout), le HUD en direct, les UUID, et le fond animé de l'écran Séances. Pour `editor`, le **DOM complet** de l'écran est comparé à chaque étape : une refonte qui ne doit rien changer à l'affichage doit sortir « identique ».

Sous Windows, `git stash pop` remet les fichiers en fins de ligne CRLF ; sans conséquence pour les scénarios.

## Écrire ou modifier un scénario

- Un scénario est un module `scenarios/<nom>.cjs` qui rend `{ trace, failures }` (voir `lib.cjs` : `openPage`, `Steps`). `Steps.mark(étiquette, attente)` prend un instantané et vérifie l'attente : un objet `{ champ: valeur | RegExp | fonction }`, ou une fonction `(instantané, précédent, relevé) => message d'erreur`.
- Rendre les attentes sur ce que le geste **fait**, pas sur des chiffres qui dépendent de la FTP ou des modèles livrés (sauf si c'est le but).
- Pour une attente qui dépend d'un délai (reconnexion du trainer simulé), attendre la condition (`waitText`) plutôt qu'une durée fixe.
- Les récapitulatifs ne s'ouvrent qu'au-delà de 60 s de sortie enregistrée : le scénario `app` attend (`waitRecording`) que le bouton d'export affiche 62 s.
- Le HUD ne se met à jour que sur l'écran Sortie (`#sortie`).
- iPhone : toujours en plein écran (844 × 390 en paysage), jamais dans la fenêtre Safari (voir CLAUDE.md).

Ces scénarios ne tournent pas dans la CI : ils demandent un Chromium et durent plus de deux minutes.
