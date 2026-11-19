import type { GpuLoss, RideView } from '../render/ride-view';
import { Background } from '../shared/util/background';
import { TypedEmitter } from '../shared/util/typed-emitter';

export interface ViewBuildOptions {
  /** Passer en WebGL2 sans essayer WebGPU (après deux pertes du GPU). */
  forceWebGL: boolean;
  /** File de travail de la construction : l'appelant la transmet telle quelle à la vue. */
  background: Background;
  onProgress: (done: number, step: string) => void;
}

export interface RideViewLoaderDeps {
  /** Construit la vue 3D sur le canevas courant (l'appelant en change quand `retrying` est publié). */
  create: (options: ViewBuildOptions) => Promise<RideView>;
  /** L'écran Sortie est ouvert : le coureur attend la vue, la construction se presse. */
  rideScreenOpen: () => boolean;
  /** Pertes du GPU supportées : au-delà, on renonce à la vue. */
  maxLosses?: number;
  makeBackground?: () => Background;
}

/**
 * Construit la vue 3D en tâche de fond et la refait quand le GPU est perdu.
 *
 * Une seule responsabilité : le cycle de vie de la vue (une seule construction à la fois, reprise après perte du GPU,
 * renoncement après trop de pertes). Il ne touche ni au DOM, ni à l'écran de chargement : il publie `progress`, `ready`,
 * `lost`, `retrying` (le canevas doit être remplacé : un canevas garde le contexte qu'il a perdu) et `unavailable`.
 */
export class RideViewLoader extends TypedEmitter<{
  progress: [done: number, step: string];
  ready: [view: RideView];
  lost: [loss: GpuLoss, attempt: number, max: number];
  retrying: [];
  unavailable: [error: unknown];
}> {
  private current?: RideView;
  private background: Background;
  /** `none` : rien de lancé (ou vue perdue, à refaire) ; ensuite une seule construction, jusqu'à la vue ou l'échec. */
  private state: 'none' | 'building' | 'done' = 'none';
  private lossCount = 0;
  private readonly maxLosses: number;
  private readonly makeBackground: () => Background;

  constructor(private readonly deps: RideViewLoaderDeps) {
    super();
    this.maxLosses = deps.maxLosses ?? 3;
    this.makeBackground = deps.makeBackground ?? (() => new Background());
    this.background = this.makeBackground();
  }

  /** La vue en place ; `undefined` tant qu'elle se construit, ou si elle est perdue ou indisponible. */
  get view(): RideView | undefined {
    return this.current;
  }

  /** Pertes du GPU déjà subies. */
  get losses(): number {
    return this.lossCount;
  }

  /** Lance la construction (une seule à la fois). */
  start(): void {
    if (this.state !== 'none') return;
    this.state = 'building';
    this.build().then(
      () => (this.state = 'done'),
      (e: unknown) => {
        this.state = 'done';
        // GPU perdu pendant la construction : même reprise qu'après.
        if (e instanceof Error && e.name === 'GpuLostError') this.handleLost((e as Error & { loss: GpuLoss }).loss);
        else this.emit('unavailable', e);
      },
    );
  }

  /** L'écran Sortie vient de s'ouvrir : la construction se presse, et démarre si le temps mort n'est pas encore venu. */
  hurry(): void {
    this.background.hurry();
    this.start();
  }

  /** On a quitté la Sortie avant la fin : la construction repasse derrière l'interface. */
  calm(): void {
    this.background.calm();
  }

  private async build(): Promise<void> {
    const view = await this.deps.create({
      forceWebGL: this.lossCount >= 2,
      background: this.background,
      onProgress: (done, step) => this.emit('progress', done, step),
    });
    this.current = view;
    view.onLost = (loss) => this.handleLost(loss);
    this.emit('ready', view);
  }

  private handleLost(loss: GpuLoss): void {
    this.lossCount++;
    this.emit('lost', loss, this.lossCount, this.maxLosses);
    this.current?.dispose();
    this.current = undefined;
    if (this.lossCount > this.maxLosses) return this.emit('unavailable', new Error('GPU perdu trop souvent'));
    this.emit('retrying'); // le canevas est remplacé avant la nouvelle construction
    this.background = this.makeBackground();
    if (this.deps.rideScreenOpen()) this.background.hurry();
    this.state = 'none';
    this.start();
  }
}
