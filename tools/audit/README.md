# Outils d'audit

Scripts utilisés pour [docs/audit/](../../docs/audit/). Ils ne font pas partie des dépendances du projet : on les installe à part, sans toucher à `package.json`.

```
npm i --no-save playwright axe-core lighthouse@12
npx playwright install chromium     # si aucun Chromium n'est déjà installé
```

1. **Servir le build** comme Cloudflare (brotli, en-têtes de cache par défaut, repli SPA) :

   ```
   npm run build
   node tools/audit/serve.mjs "$PWD/dist" 4173
   ```

2. **Lighthouse**, ordinateur et mobile :

   ```
   npx lighthouse http://localhost:4173/ --preset=desktop --output=json --output=html --output-path=./lh-desktop
   npx lighthouse http://localhost:4173/ --output=json --output=html --output-path=./lh-mobile
   node tools/audit/lighthouse-summary.mjs lh-desktop.report.json lh-mobile.report.json
   ```

3. **Parcours des écrans** (captures, axe-core, débordements, textes < 12 px, cibles tactiles, erreurs console) sur tous les formats, ou ceux dont le nom commence par le 3ᵉ argument :

   ```
   node tools/audit/screens.cjs <dossier-captures> <resultats.json> [iphone]
   ```

   Les iPhone sont mesurés en plein écran (844 × 390), jamais dans la fenêtre Safari.

   Le serveur de comptes est simulé (`/api/auth/me`) pour que la pastille « Connect with Strava » apparaisse comme en ligne : `AUDIT_ACCOUNT=deconnecte` (défaut), `connecte`, ou `aucun` pour le mode sans compte.

4. **Profil CPU du démarrage**, par fichier et par fonction (serveur de dev, pour garder les noms de modules) :

   ```
   npx vite --port 5199 &
   node tools/audit/profile.cjs http://localhost:5199/
   ```

5. **Réactivité du démarrage** : plus longue tâche pendant le chargement et à la première ouverture de la Sortie, au premier lancement (profil vierge) puis au second (caches remplis). Premier argument : ralentissement du processeur. `AUDIT_WEBGPU=1` pour essayer WebGPU (sinon WebGL2 sans GPU).

   ```
   node tools/audit/startup.cjs 4 http://localhost:4173/ http://localhost:4174/
   ```

Sans GPU (machine d'intégration, conteneur), Chromium rend en logiciel : les images par seconde ne sont pas significatives, les triangles et appels de dessin le sont. Pour la Sortie, utiliser `?renderer=webgl2`.

6. **Budget du lancement** (aussi lancé par la CI) : poids compressé du JS et du CSS que `index.html` charge avant tout affichage.

   ```
   npm run build && npm run budget
   ```
