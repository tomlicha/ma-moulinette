import type { ExportPlatform, RideExport } from '../../app/ride-export';
import { setBlocked } from '../shared/blocked';

/** Ce que l'export demande au navigateur : fenêtre de connexion, saisie de la clé, téléchargement. */
export const browserExportPlatform: ExportPlatform = {
  askOwnerKey: (current) => window.prompt('Clé d’accès Ma Moulinette (nécessaire pour envoyer à Strava)', current),
  openLoginWindow: () => window.open('', 'strava-login', 'width=520,height=720'),
  saveFile(name, bytes) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000); // libérer tout de suite peut interrompre le téléchargement sur certains navigateurs
  },
};

const NOTHING = 'Rien à exporter pour l’instant : l’enregistrement démarre dès qu’un trainer connecté envoie des mesures.';

/** Les deux boutons de l'export (fichier FIT, envoi à Strava) : ils se redessinent quand l'export change, et lui passent les clics. */
export class ExportButtons {
  constructor(
    private readonly exporter: RideExport,
    private readonly fit: HTMLButtonElement,
    private readonly strava: HTMLButtonElement,
  ) {
    exporter.on('changed', () => this.render());
    fit.addEventListener('click', () => void exporter.downloadFit());
    strava.addEventListener('click', () => void exporter.sendToStrava());
  }

  private render(): void {
    const s = this.exporter.status();
    setBlocked(this.fit, s.busy ? 'Export en cours…' : s.samples === 0 && s.frozenSamples === undefined ? NOTHING : undefined);
    this.fit.textContent =
      s.frozenSamples !== undefined
        ? `Exporter FIT (${s.frozenSamples} s)`
        : s.samples
          ? `Exporter FIT (${s.samples} s${s.paused ? ', en pause' : ''})`
          : 'Exporter FIT';
    this.strava.hidden = !s.stravaConfigured;
    setBlocked(this.strava, s.busy ? 'Envoi en cours…' : s.samples === 0 && !s.kept && s.frozenSamples === undefined ? NOTHING : undefined);
    this.strava.textContent = s.samples === 0 && s.kept ? 'Réessayer l’envoi à Strava' : 'Envoyer à Strava';
  }
}
