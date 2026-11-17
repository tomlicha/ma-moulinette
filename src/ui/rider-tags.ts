import type { RiderTag } from '../render/others';

/** Au-delà, le nom est discret : les coureurs lointains ne doivent pas masquer la route. */
const FAR_M = 80;

/**
 * Noms des autres coureurs, posés au-dessus d'eux sur la vue 3D. Un élément par coureur, gardé d'une image à l'autre et
 * déplacé par `transform` : pas de reconstruction du DOM à chaque image. Le nom vient d'un autre joueur : il entre par
 * `textContent`, jamais comme HTML.
 */
export class RiderTags {
  private readonly items = new Map<number, { el: HTMLElement; name: HTMLElement; dist: HTMLElement }>();

  constructor(private readonly host: HTMLElement) {}

  set(tags: readonly RiderTag[]): void {
    const seen = new Set<number>();
    for (const t of tags) {
      seen.add(t.slot);
      let it = this.items.get(t.slot);
      if (!it) {
        const el = document.createElement('div');
        el.className = 'rider-tag';
        const name = document.createElement('span');
        name.className = 'rider-tag-name';
        const dist = document.createElement('span');
        dist.className = 'rider-tag-dist';
        el.append(name, dist);
        this.host.append(el);
        this.items.set(t.slot, (it = { el, name, dist }));
      }
      if (it.name.textContent !== t.name) it.name.textContent = t.name;
      const m = `${Math.round(t.distanceM / 5) * 5} m`;
      if (it.dist.textContent !== m) it.dist.textContent = m;
      it.el.classList.toggle('far', t.distanceM > FAR_M);
      it.el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [slot, it] of this.items) {
      if (seen.has(slot)) continue;
      it.el.remove();
      this.items.delete(slot);
    }
  }

  clear(): void {
    this.set([]);
  }
}

/** Pastille « En ligne · N autres coureurs » de l'écran Sortie ; cachée hors connexion. */
export function crowdLine(population: number): string {
  const others = Math.max(0, population - 1);
  if (others === 0) return 'En ligne · seul pour l’instant';
  return `En ligne · ${others} autre${others > 1 ? 's' : ''} coureur${others > 1 ? 's' : ''}`;
}
