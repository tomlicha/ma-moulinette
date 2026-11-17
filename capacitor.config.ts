import type { CapacitorConfig } from '@capacitor/cli';

/**
 * La coquille charge l'application depuis son serveur plutôt que depuis des fichiers embarqués : la page garde ainsi
 * l'origine du Worker, et tout ce qui s'appuie dessus marche tel quel : adresses relatives `/api/...`, cookie de
 * session (SameSite=Lax), contrôle d'origine du WebSocket, relais Strava. Avec des fichiers embarqués, l'origine serait
 * `capacitor://localhost` et chacun de ces appels échouerait.
 *
 * Le Bluetooth reste natif : le pont (`src/sensors/native-bluetooth.ts`) est injecté dans la page par le plugin.
 * Autre serveur (préproduction, Mac en développement) : `CAP_SERVER_URL=https://… npm run ios:sync`, qui accorde aussi
 * `WKAppBoundDomains` d'Info.plist et la page hors ligne à ce serveur (`tools/ios/sync.mjs`).
 *
 * Domaines app-bound (serveur HTTPS) : sans eux, la WKWebView n'a pas de service worker, donc pas de hors-ligne. Ils
 * bornent aussi la navigation au serveur ; les autres liens (Strava…) s'ouvrent dans Safari. La connexion Strava passe
 * par une session d'authentification système (`ios/App/App/MoulinettePlugin.swift`), pas par la WebView.
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? 'https://ma-moulinette-ride.moulinette-ride.workers.dev';
const host = new URL(SERVER_URL).host;
const cleartext = SERVER_URL.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'app.moulinette.ride',
  appName: 'Ma Moulinette',
  // Embarqué dans la coquille ; seule la page hors ligne (`errorPath`) y est servie, l'application vient du serveur.
  webDir: 'dist',
  server: {
    url: SERVER_URL,
    // Un serveur de développement en clair (http://192.168…) exige ce réglage ; la production est en HTTPS.
    cleartext,
    allowNavigation: [host],
    // Premier lancement sans réseau (rien encore en cache) : page embarquée, qui rouvre l'application au retour du réseau.
    errorPath: 'offline.html',
  },
  ios: { contentInset: 'never', preferredContentMode: 'mobile', limitsNavigationsToAppBoundDomains: !cleartext },
  plugins: {
    BluetoothLe: { displayStrings: { scanning: 'Recherche…', cancel: 'Annuler', availableDevices: 'Appareils disponibles', noDeviceFound: 'Aucun appareil trouvé' } },
  },
};
export default config;
