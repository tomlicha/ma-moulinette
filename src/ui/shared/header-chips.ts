import type { View } from './router';

/** Un repère dans l'en-tête d'un écran : les pastilles se posent juste après. */
export interface ChipsSlot {
  after(node: unknown): void;
}

/**
 * Les pastilles d'en-tête (Nouveautés, état des appareils, coureur) : un seul jeu, donc un seul câblage, que l'on pose dans
 * l'en-tête de l'écran qui les montre. Un écran se déclare en portant un repère `data-chips-slot` dans son en-tête ;
 * les autres écrans laissent les pastilles dans celui de l'accueil, où elles restent cachées avec lui.
 */
export class HeaderChips {
  private current: ChipsSlot | null = null;

  constructor(
    private readonly chips: unknown,
    private readonly slotOf: (view: View) => ChipsSlot | null,
    private readonly fallback: View,
  ) {}

  show(view: View): void {
    const slot = this.slotOf(view) ?? this.slotOf(this.fallback);
    if (!slot || slot === this.current) return;
    slot.after(this.chips);
    this.current = slot;
  }
}

/** Les pastilles de la page : repères `[data-chips-slot]` des sections `[data-view]`. */
export function setupHeaderChips(chips: HTMLElement, fallback: View, root: ParentNode = document): HeaderChips {
  return new HeaderChips(chips, (view) => root.querySelector<HTMLElement>(`[data-view="${view}"] [data-chips-slot]`), fallback);
}
