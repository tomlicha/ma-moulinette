import { byId } from '../shared/dom';

/** Ce que la vue 3D mesure d'elle-même (images par seconde, charge). */
export interface ViewStats {
  backend: string;
  fps: number;
  frameP50Ms: number;
  frameP95Ms: number;
  triangles: number;
  drawCalls: number;
}

/**
 * Écran de chargement de la sortie (index.html, sortie.css) : visible tant que la vue 3D n'a pas dessiné sa première
 * image, avec sa barre de progression ; l'écran d'erreur quand la vue est indisponible ; et la ligne de mesures du menu.
 */
export class RideLoadingView {
  private readonly root = byId('ride-loading');
  private readonly bar = this.root.querySelector<HTMLElement>('.rl-bar')!;
  private readonly step = byId('ride-loading-step');
  private readonly stats = byId('view-stats');

  /** Avancement de la construction (de 0 à 1) et l'étape en cours. */
  progress(done: number, step: string): void {
    this.step.textContent = step;
    this.bar.style.setProperty('--p', String(done));
    this.bar.setAttribute('aria-valuenow', String(Math.round(done * 100)));
  }

  /** La première image est dessinée : l'écran s'efface. */
  hide(): void {
    this.root.hidden = true;
  }

  /** Après une perte du GPU : un canevas neuf (le perdu garde son contexte mort), et l'écran revient à zéro. */
  retry(): void {
    const old = byId<HTMLCanvasElement>('view');
    old.replaceWith(old.cloneNode(false) as HTMLCanvasElement);
    this.root.hidden = false;
    this.progress(0, 'Reprise de la vue 3D');
  }

  /** La vue 3D ne reviendra pas : la sortie continue sans elle. */
  unavailable(): void {
    this.stats.textContent = 'rendu 3D indisponible';
    this.root.hidden = false;
    this.root.dataset.state = 'error';
    byId('ride-loading-title').textContent = 'Vue 3D indisponible';
    this.step.textContent = 'La sortie fonctionne sans elle : mesures, profil et séance restent affichés.';
  }

  showStats(s: ViewStats): void {
    this.stats.textContent =
      `${s.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · ${s.fps.toFixed(0)} i/s · ` +
      `p50 ${s.frameP50Ms.toFixed(1)} ms · p95 ${s.frameP95Ms.toFixed(1)} ms · ` +
      `${(s.triangles / 1000).toFixed(0)} k triangles · ${s.drawCalls} appels`;
  }
}
