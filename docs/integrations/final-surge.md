# Intégration Final Surge

L'application permet de connecter un compte Final Surge depuis le menu du compte Ma Moulinette. Dès que la connexion réussit, les séances planifiées d'aujourd'hui à J+13 (14 jours calendaires) sont importées. La même fenêtre glissante est resynchronisée au démarrage de chaque session de l'application, au retour au premier plan et au retour du réseau.

## Architecture et sécurité

- Le navigateur envoie les identifiants uniquement à `POST /api/integrations/final-surge/connect` sur le Worker Ma Moulinette.
- Le Worker vérifie les identifiants auprès de Final Surge avant de les conserver.
- Les identifiants sont chiffrés en AES-GCM avant écriture dans D1. La clé maître n'est jamais stockée dans D1 ni envoyée au navigateur.
- Aucun mot de passe ni jeton Final Surge n'est conservé dans le stockage local du navigateur ou journalisé.
- À chaque import, le Worker déchiffre les identifiants, ouvre une session Final Surge et lit les séances. Cela permet de retrouver une session sans intervention de l'utilisateur après expiration d'un jeton.
- La déconnexion supprime les identifiants chiffrés.

Configurer une clé secrète d'au moins 32 caractères sur le Worker de l'application :

```sh
npx wrangler secret put FINAL_SURGE_ENCRYPTION_KEY -c wrangler.app.toml
```

Pour un environnement de prévisualisation, configurer également le secret sur le Worker de preview si Cloudflare ne le rend pas disponible automatiquement.

## API Final Surge utilisée

Les routes observées dans le projet public `pavelzaitsau/finalsurge-mcp` sont celles de l'application Web Final Surge, et non une API publique/partenaire documentée :

- `POST /login`
- `GET /WorkoutList`
- `GET /WorkoutBuilderGet`

Ces endpoints peuvent changer sans préavis. Cette intégration est expérimentale et non officielle ; vérifier les conditions d'utilisation de Final Surge avant tout usage en production.

## Conversion des séances

- Les répétitions sont dépliées en étapes individuelles.
- Les durées de type TIME sont converties en secondes.
- Les cibles de puissance en %FTP ou en watts sont ramenées au point milieu lorsqu'elles sont exprimées en plage, puis transformées en consigne ERG fixe.
- Les cibles en watts sont converties en fraction de FTP au moment de l'import, à partir de la FTP configurée dans Ma Moulinette.
- Les cibles de cadence sont conservées.
- Les étapes non temporelles ou les cibles illisibles sont signalées ; aucune durée ou puissance n'est inventée.
- L'éditeur actuel ne représente pas séparément tous les types d'intensité Final Surge : certains types (par exemple effort/récupération) sont importés comme paliers, avec un avertissement conservé dans la description.

## Routes Ma Moulinette

- `GET /api/integrations/final-surge/status`
- `POST /api/integrations/final-surge/connect`
- `POST /api/integrations/final-surge/workouts` (fenêtre de 14 jours glissante, aujourd'hui inclus)
- `POST /api/integrations/final-surge/disconnect`

Toutes les mutations exigent la session Ma Moulinette et l'en-tête anti-CSRF existant.


### Filtrage des séances importées

La liste calendrier Final Surge peut contenir plusieurs sports et des sorties sans structure d'intervalles. Le serveur ne transmet à l'import que les séances dont l'option Workout Builder sélectionnée identifie explicitement le vélo et qui contiennent au moins un bloc chronométré avec une cible de puissance explicite (en watts ou en % FTP), même si la séance est continue et sans répétitions. Les séances de course, de natation, les sorties vélo libres sans cible de puissance et les structures non reconnues sont ignorées.
