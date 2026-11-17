import type { CapacitorConfig } from '@capacitor/cli';

/**
 * La coquille charge l'application depuis son serveur plutôt que depuis des fichiers embarqués : la page garde ainsi
 * l'origine du Worker, et tout ce qui s'appuie dessus marche tel quel : adresses relatives `/api/...`, cookie de
 * session (SameSite=Lax), contrôle d'origine du WebSocket, relais Strava. Avec des fichiers embarqués, l'origine serait
 * `capacitor://localhost` et chacun de ces appels échouerait.
 *
 * Le Bluetooth reste natif : le pont (`src/sensors/native-bluetooth.ts`) est injecté dans la page par le plugin.
 * Autre serveur (préproduction, Mac en développement) : `CAP_SERVER_URL=https://… npx cap sync ios`.
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? 'https://ma-moulinette-ride.moulinette-ride.workers.dev';
const host = new URL(SERVER_URL).host;

const config: CapacitorConfig = {
  appId: 'app.moulinette.ride',
  appName: 'Ma Moulinette',
  // Repli hors ligne : jamais servi tant que `server.url` est défini ; requis par la CLI.
  webDir: 'dist',
  server: {
    url: SERVER_URL,
    // Un serveur de développement en clair (http://192.168…) exige ce réglage ; la production est en HTTPS.
    cleartext: SERVER_URL.startsWith('http://'),
    // Restent dans la coquille : le serveur de l'application et la connexion Strava (retour sur /api/auth/callback).
    allowNavigation: [host, 'www.strava.com', 'strava.com'],
  },
  ios: { contentInset: 'never', preferredContentMode: 'mobile' },
  plugins: {
    BluetoothLe: { displayStrings: { scanning: 'Recherche…', cancel: 'Annuler', availableDevices: 'Appareils disponibles', noDeviceFound: 'Aucun appareil trouvé' } },
  },
};
export default config;
