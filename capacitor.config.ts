import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.moulinette.ride',
  appName: 'Ma Moulinette',
  webDir: 'dist',
  ios: { contentInset: 'never', preferredContentMode: 'mobile' },
  plugins: {
    // Les appareils choisis sont retrouvés au lancement : pas de balayage plus long que nécessaire.
    BluetoothLe: { displayStrings: { scanning: 'Recherche…', cancel: 'Annuler', availableDevices: 'Appareils disponibles', noDeviceFound: 'Aucun appareil trouvé' } },
  },
};
export default config;
