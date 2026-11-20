# Intégration Final Surge — première tranche technique

Cette tranche ajoute un client de lecture et un convertisseur isolés. Elle n'active pas la synchronisation dans le Worker ni dans l'interface.

## Statut et limites

Les endpoints observés dans le projet public `pavelzaitsau/finalsurge-mcp` sont des endpoints utilisés par l'application Web Final Surge, pas une API publique/partenaire documentée. Ils peuvent changer sans préavis et leur usage en production doit être autorisé par Final Surge.

- `GET /WorkoutList`
- `GET /WorkoutBuilderGet`

Le client reçoit un `accessToken` et un `userKey` déjà obtenus. Il ne prend jamais de mot de passe et ne fait pas de login automatique. Un HTTP 401 remonte sous forme `FinalSurgeAuthenticationError`.

## Modules

- `client.ts` : appels GET, padding de dates et filtrage local.
- `mapper.ts` : conversion des structures Builder vers le type `Workout`.
- `types.ts` : contrats d'entrée/sortie.
- `__tests__/` : tests Vitest.

## Règles de conversion

- La variante cycling/bike est priorisée si plusieurs sports sont retournés.
- Les répétitions sont dépliées en étapes individuelles.
- Les durées TIME sont converties en secondes.
- Les cibles de puissance explicitement identifiées en %FTP ou watts sont converties vers `Target`.
- Toute plage min/max de puissance est ramenée à son point milieu pour fournir une consigne ERG fixe : 80–90 % FTP devient 85 % FTP; 180–220 W devient 200 W. Un avertissement est ajouté.
- Les cibles de cadence en rpm sont converties en valeur moyenne si nécessaire.
- Les étapes DISTANCE, autres types de durée et unités de puissance inconnues sont signalées; aucune durée ou puissance n'est inventée.

## Validation à faire avant toute activation

Les fixtures sont illustratives et non des captures réseau vérifiées. Avec un JSON anonymisé de WorkoutBuilderGet, confirmer les champs de cible, leurs unités, le wrapper de réponse et la forme des répétitions. Ne pas demander ni stocker les mots de passe Final Surge. Ne pas présenter ces endpoints comme une API officielle.

## Tests

```bash
npm test -- src/infra/integrations/final-surge/__tests__
```

Les tests n'appellent pas Final Surge.
