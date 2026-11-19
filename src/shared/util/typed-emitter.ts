type Listener<A extends unknown[]> = (...args: A) => void;

/**
 * Émetteur d'événements typé : `Events` associe chaque nom d'événement aux arguments de ses écouteurs.
 *
 *     class Door extends TypedEmitter<{ opened: [by: string]; closed: [] }> {}
 *
 * Les écouteurs sont appelés dans l'ordre d'abonnement, de façon synchrone : l'ordre des effets reste lisible et testable.
 */
export class TypedEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  private readonly handlers = new Map<keyof Events, Listener<never>[]>();

  /** Abonne `fn` ; renvoie de quoi se désabonner. */
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(fn as Listener<never>);
    this.handlers.set(event, list);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const list = this.handlers.get(event);
    const i = list?.indexOf(fn as Listener<never>) ?? -1;
    if (i >= 0) list!.splice(i, 1);
  }

  protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    // Copie : un écouteur peut se désabonner pendant l'émission.
    for (const fn of [...(this.handlers.get(event) ?? [])]) (fn as Listener<Events[K]>)(...args);
  }
}
