import type { GearState } from '../../app/virtual-gearbox';
import { VIRTUAL_GEARS } from '../../domain/sim/virtual-gears';

/** Les éléments de l'écran que la vue pilote : l'interrupteur et le plateau (menu de la sortie), le sélecteur posé sur la vue. */
export interface GearsViewElements {
  toggle: HTMLInputElement;
  ringRow: HTMLElement;
  ring: HTMLInputElement;
  shifter: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  out: HTMLElement;
}

/** Ce que la vue demande : ni règle ni mémorisation ici (app/virtual-gearbox.ts). */
export interface GearsViewActions {
  setEnabled(enabled: boolean): void;
  setChainring(teeth: number): void;
  shift(by: number): void;
  /** Le clavier ne change de vitesse que sur l'écran Sortie, hors boîte de dialogue, et si le Cog est monté. */
  keysActive(): boolean;
}

/**
 * Vitesses virtuelles du Zwift Cog, côté interface : l'interrupteur et le plateau dans le menu de la sortie, le
 * sélecteur de vitesse posé sur la vue, et le clavier (flèches haut et bas, + et −). Elle affiche l'état qu'on lui donne.
 */
export class GearsView {
  constructor(
    private readonly el: GearsViewElements,
    actions: GearsViewActions,
  ) {
    el.toggle.addEventListener('change', () => actions.setEnabled(el.toggle.checked));
    el.ring.addEventListener('change', () => actions.setChainring(Number(el.ring.value)));
    el.up.addEventListener('click', () => actions.shift(1));
    el.down.addEventListener('click', () => actions.shift(-1));

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !actions.keysActive()) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, select, textarea, [contenteditable]')) return;
      const by = e.key === 'ArrowUp' || e.key === '+' ? 1 : e.key === 'ArrowDown' || e.key === '-' ? -1 : 0;
      if (!by) return;
      e.preventDefault();
      actions.shift(by);
    });
  }

  render(state: GearState, chainring: number): void {
    const { el } = this;
    const index = state.gear - 1;
    el.toggle.checked = state.enabled;
    el.ringRow.hidden = !state.enabled;
    el.ring.value = String(chainring);
    el.shifter.hidden = !state.enabled;
    el.out.textContent = String(state.gear);
    el.out.title = `Vitesse ${state.gear} sur ${VIRTUAL_GEARS.length}, braquet ${state.virtualRatio.toFixed(2).replace('.', ',')}`;
    el.down.disabled = index === 0;
    el.up.disabled = index === VIRTUAL_GEARS.length - 1;
  }
}
