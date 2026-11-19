import { byId } from '../shared/dom';

/** Le journal de l'écran Appareils : une ligne par événement, datée, et le bouton qui le copie (pour un rapport de panne). */
export class LogView {
  private readonly pre = byId('log');

  constructor() {
    byId('copy-log').addEventListener('click', () => void navigator.clipboard.writeText(this.pre.textContent ?? ''));
  }

  append(message: string): void {
    const ts = new Date().toLocaleTimeString('fr-FR');
    this.pre.textContent += `${ts}  ${message}\n`;
    this.pre.scrollTop = this.pre.scrollHeight;
  }
}
