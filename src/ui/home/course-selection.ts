import type { CourseDef, RoadNetwork } from '../../domain/course/network';
import { fmt1 } from '../ride/hud-model';

/** « 16,0 km · +370 m » : la longueur de la boucle et ce qu'elle monte. Un parcours plat n'affiche pas de montée. */
export function courseSummary(stats: { lengthM: number; climbM: number }): string {
  const km = `${fmt1(stats.lengthM / 1000)} km`;
  return stats.climbM >= 40 ? `${km} · +${Math.round(stats.climbM / 10) * 10} m` : `${km} · plat`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Le parcours retenu, gardé d'une visite à l'autre. Sans DOM : le menu de choix ne fait que l'afficher. Il ne s'ouvre
 * qu'hors sortie (changer de parcours en route ferait repartir du village).
 */
export class CourseSelection {
  private current: CourseDef;

  constructor(
    private readonly network: RoadNetwork,
    private readonly store: Store,
    private readonly storeKey: string,
  ) {
    let saved: string | null = null;
    try {
      saved = store.getItem(storeKey);
    } catch {
      /* stockage bloqué : on prend le parcours par défaut */
    }
    this.current = network.course(saved ?? undefined)!;
  }

  get selected(): CourseDef {
    return this.current;
  }

  /** Retient le parcours `id`. Faux s'il est inconnu ou déjà retenu. */
  select(id: string): boolean {
    const next = this.network.courses.find((c) => c.id === id);
    if (!next || next === this.current) return false;
    this.current = next;
    try {
      this.store.setItem(this.storeKey, next.id);
    } catch {
      /* stockage plein ou bloqué : le choix vaut pour cette visite */
    }
    return true;
  }
}
