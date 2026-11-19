import { CHAINRING_LIMITS, VIRTUAL_GEARS, clampGear, nearestGear, realRatio } from '../../domain/sim/virtual-gears';

const COG_KEY = 'mamoulinette.cog';
const RING_KEY = 'mamoulinette.chainring';

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface GearState {
  /** Vélo monté avec un Zwift Cog : les vitesses virtuelles sont actives. */
  enabled: boolean;
  /** Vitesse choisie, de 1 à 24. */
  gear: number;
  virtualRatio: number;
  realRatio: number;
}

/**
 * Vitesses virtuelles du Zwift Cog, côté interface : l'interrupteur et le plateau dans le menu de la sortie, le sélecteur
 * posé sur la vue, et le clavier (flèches haut et bas, + et −). Le calcul est dans domain/sim/virtual-gears.ts.
 */
export function setupGears(o: {
  prefs: Store;
  toggle: HTMLInputElement;
  ringRow: HTMLElement;
  ring: HTMLInputElement;
  shifter: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  out: HTMLElement;
  /** Le clavier ne change de vitesse que sur l'écran Sortie, hors boîte de dialogue. */
  keysActive: () => boolean;
  onChange: (s: GearState, why: 'shift' | 'setup') => void;
}) {
  const read = (k: string) => {
    try {
      return o.prefs.getItem(k);
    } catch {
      return null; // préférence illisible : valeur par défaut
    }
  };
  const save = (k: string, v: string) => {
    try {
      o.prefs.setItem(k, v);
    } catch {
      // préférence non mémorisée, sans conséquence
    }
  };
  const validRing = (n: number) => Number.isInteger(n) && n >= CHAINRING_LIMITS.min && n <= CHAINRING_LIMITS.max;

  let enabled = read(COG_KEY) === '1';
  let ring = validRing(Number(read(RING_KEY))) ? Number(read(RING_KEY)) : CHAINRING_LIMITS.default;
  let index = nearestGear(realRatio(ring));

  const state = (): GearState => ({ enabled, gear: index + 1, virtualRatio: VIRTUAL_GEARS[index]!, realRatio: realRatio(ring) });

  const render = () => {
    o.toggle.checked = enabled;
    o.ringRow.hidden = !enabled;
    o.ring.value = String(ring);
    o.shifter.hidden = !enabled;
    o.out.textContent = String(index + 1);
    o.out.title = `Vitesse ${index + 1} sur ${VIRTUAL_GEARS.length}, braquet ${VIRTUAL_GEARS[index]!.toFixed(2).replace('.', ',')}`;
    o.down.disabled = index === 0;
    o.up.disabled = index === VIRTUAL_GEARS.length - 1;
  };

  const shift = (by: number) => {
    if (!enabled) return;
    const next = clampGear(index + by);
    if (next === index) return;
    index = next;
    render();
    o.onChange(state(), 'shift');
  };

  o.toggle.addEventListener('change', () => {
    enabled = o.toggle.checked;
    save(COG_KEY, enabled ? '1' : '0');
    render();
    o.onChange(state(), 'setup');
  });
  o.ring.addEventListener('change', () => {
    const n = Math.round(Number(o.ring.value));
    if (validRing(n)) {
      ring = n;
      save(RING_KEY, String(ring));
      index = nearestGear(realRatio(ring)); // nouveau braquet réel : on repart de la vitesse qui lui ressemble
    }
    render();
    o.onChange(state(), 'setup');
  });
  o.up.addEventListener('click', () => shift(1));
  o.down.addEventListener('click', () => shift(-1));

  document.addEventListener('keydown', (e) => {
    if (!enabled || e.ctrlKey || e.metaKey || e.altKey || !o.keysActive()) return;
    const t = e.target;
    if (t instanceof HTMLElement && t.closest('input, select, textarea, [contenteditable]')) return;
    const by = e.key === 'ArrowUp' || e.key === '+' ? 1 : e.key === 'ArrowDown' || e.key === '-' ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    shift(by);
  });

  render();
  return { state };
}
