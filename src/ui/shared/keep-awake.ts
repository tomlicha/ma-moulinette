/**
 * Écran allumé tant qu'on est sur l'application (tous les écrans, sur ordinateur comme sur tablette ou téléphone) : on ne
 * touche pas l'écran pendant une séance ERG, et la mise en veille de l'appareil suspendrait la page (enregistrement,
 * sortie virtuelle, reconnexion).
 *
 * - Coquille native : le plugin de l'application (`isIdleTimerDisabled`), qui tient tant qu'on ne le relâche pas.
 * - Navigateur : l'API Screen Wake Lock (Chrome et Edge, Safari 16.4 et plus sur Mac, iPhone et iPad, Firefox 126 et plus).
 *   Le verrou tombe dès que la page passe en arrière-plan (autre onglet, fenêtre réduite) ou que le système le retire
 *   (économie d'énergie) ; il est repris au retour au premier plan et au prochain toucher, tant qu'on le veut encore.
 */
export interface WakeEnv {
  native?: { keepAwake(o: { on: boolean }): Promise<void> };
  wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', f: () => void): void }> };
  document: Pick<Document, 'visibilityState' | 'addEventListener'>;
  log?: (msg: string) => void;
}

export function createKeepAwake(env: WakeEnv) {
  let wanted = false;
  let sentinel: { release(): Promise<void> } | undefined;
  let pending: Promise<void> | undefined;
  /** Reprises automatiques d'affilée après un retrait par le système ; remises à zéro au retour ou au toucher. */
  let autoRetries = 0;

  const acquire = async () => {
    if (!env.wakeLock || sentinel || pending || env.document.visibilityState !== 'visible') return;
    pending = env.wakeLock
      .request('screen')
      .then((s) => {
        if (!wanted) return void s.release().catch(() => {});
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel !== s) return;
          sentinel = undefined;
          // Retiré par le système page visible (économie d'énergie) : on le redemande aussitôt, sans boucler.
          if (wanted && !env.native && autoRetries++ < 3) void acquire();
        });
      })
      .catch((e: unknown) => env.log?.(`écran allumé : refusé (${e instanceof Error ? e.message : e})`))
      .finally(() => (pending = undefined));
    await pending;
  };

  const retry = () => {
    autoRetries = 0;
    if (wanted && !env.native && env.document.visibilityState === 'visible') void acquire();
  };
  env.document.addEventListener('visibilitychange', () => {
    if (env.document.visibilityState === 'hidden') {
      // Le navigateur retire le verrou d'une page en arrière-plan (c'est dans la norme, on ne peut pas le garder).
      // On l'oublie tout de suite : le retour au premier plan en redemande un neuf sans attendre l'événement de retrait.
      const s = sentinel;
      sentinel = undefined;
      void s?.release().catch(() => {});
      return;
    }
    retry();
  });
  // Verrou refusé ou retiré à répétition : un geste de l'utilisateur le redemande.
  env.document.addEventListener('pointerdown', retry);

  return {
    /** Garder l'écran allumé (`true`) ou rendre la main au réglage de l'appareil (`false`). */
    async set(on: boolean) {
      if (on === wanted) return;
      wanted = on;
      if (env.native) {
        await env.native.keepAwake({ on }).catch((e: unknown) => env.log?.(`écran allumé : ${e instanceof Error ? e.message : e}`));
        return;
      }
      if (on) return acquire();
      const s = sentinel;
      sentinel = undefined;
      await s?.release().catch(() => {});
    },
    get wanted() {
      return wanted;
    },
  };
}
