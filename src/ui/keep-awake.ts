/**
 * Écran allumé pendant la sortie : on ne touche pas l'écran pendant une séance ERG, et la mise en veille de l'appareil
 * suspendrait la page (enregistrement, sortie virtuelle, reconnexion).
 *
 * - Coquille native : le plugin de l'application (`isIdleTimerDisabled`), qui tient tant qu'on ne le relâche pas.
 * - Navigateur : l'API Screen Wake Lock (Chrome, Safari 16.4 et plus). Le verrou tombe dès que la page passe en arrière-
 *   plan ; il est repris au retour, tant qu'on le veut encore.
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

  const acquire = async () => {
    if (!env.wakeLock || sentinel || pending || env.document.visibilityState !== 'visible') return;
    pending = env.wakeLock
      .request('screen')
      .then((s) => {
        if (!wanted) return void s.release().catch(() => {});
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = undefined;
        });
      })
      .catch((e: unknown) => env.log?.(`écran allumé : refusé (${e instanceof Error ? e.message : e})`))
      .finally(() => (pending = undefined));
    await pending;
  };

  env.document.addEventListener('visibilitychange', () => {
    if (wanted && env.document.visibilityState === 'visible') void acquire();
  });

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
