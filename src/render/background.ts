/**
 * Travail lourd découpé en étapes, pour qu'il ne bloque jamais la page.
 *
 * Une étape est un générateur : chaque `yield` marque un endroit où l'on peut s'arrêter sans rien casser. `drain`
 * déroule tout d'un coup (tests, outils) ; `Background.run` déroule par tranches de quelques millisecondes et rend la
 * main au navigateur entre deux tranches, qui traite alors clics, défilement et affichage avant de reprendre.
 */
export type Steps<T = void> = Generator<void, T, void>;

/** Déroule toutes les étapes d'un coup et rend le résultat. */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

type Priority = 'background' | 'user-visible';

interface PostTaskScheduler {
  postTask(cb: () => void, opts: { priority: Priority }): Promise<void>;
}

const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : undefined;
const waiting: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();

/**
 * Rend la main au navigateur. `scheduler.postTask` (Chrome, Edge, Firefox) range la suite selon sa priorité : en
 * `background`, après les saisies et l'affichage. Ailleurs (Safari), un message à soi-même : pas le délai minimal de
 * 4 ms que `setTimeout` impose après quelques appels imbriqués.
 */
function pause(priority: Priority): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Partial<PostTaskScheduler> }).scheduler;
  if (typeof scheduler?.postTask === 'function') return scheduler.postTask(() => {}, { priority });
  if (channel) {
    return new Promise((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Tranche de travail entre deux pauses, en ms : bien sous une image à 60 Hz tant que rien ne presse. */
const CALM_SLICE_MS = 8;
/** Quand on attend le résultat (l'écran de sortie est ouvert), des tranches plus longues : on finit plus tôt. */
const HURRIED_SLICE_MS = 40;

/** `Background.run` interrompu par `stop()`. */
export class BackgroundStopped extends Error {
  constructor() {
    super('travail de fond arrêté');
    this.name = 'BackgroundStopped';
  }
}

/**
 * File de travail de fond. `hurry` la passe en priorité haute quand l'utilisateur attend le résultat, `calm` la remet
 * en arrière-plan quand il ne l'attend plus ; `stop` l'abandonne avant la prochaine étape.
 */
export class Background {
  private sliceMs = CALM_SLICE_MS;
  private priority: Priority = 'background';
  private stopped = false;

  hurry() {
    this.sliceMs = HURRIED_SLICE_MS;
    this.priority = 'user-visible';
  }

  calm() {
    this.sliceMs = CALM_SLICE_MS;
    this.priority = 'background';
  }

  /** Les `run` en cours (et à venir) rejettent avec `BackgroundStopped` avant leur prochaine étape. */
  stop() {
    this.stopped = true;
  }

  get hurried(): boolean {
    return this.priority === 'user-visible';
  }

  async run<T>(steps: Steps<T>): Promise<T> {
    let start = performance.now();
    for (;;) {
      if (this.stopped) {
        steps.return(undefined as T);
        throw new BackgroundStopped();
      }
      const r = steps.next();
      if (r.done) return r.value;
      if (performance.now() - start >= this.sliceMs) {
        await pause(this.priority);
        start = performance.now();
      }
    }
  }
}
