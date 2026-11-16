/**
 * Portrait du coureur pour les écrans Appareils et Accueil, rendu d'après les modèles 3D réels : il reflète toujours la
 * dernière version de l'avatar, sans image à régénérer à la main.
 *
 * Le rendu coûte cher (un second moteur de rendu, les deux modèles, un encodage PNG : plusieurs centaines de
 * millisecondes de page figée sur un téléphone). L'image est donc gardée dans le navigateur (Cache API), sous une
 * empreinte des modèles et du code de rendu calculée au build : elle n'est refaite qu'au premier lancement d'une
 * nouvelle version. Ce module ne charge pas le moteur 3D : il n'est importé que si l'image manque.
 *
 * Résout l'URL d'une image (objet blob) ; rejette si le rendu est impossible, l'appelant garde alors son image de repli.
 */
const CACHE_NAME = 'ma-moulinette-portrait';

let pending: Promise<string> | undefined;

export function riderPortrait(size = 512): Promise<string> {
  // En développement, le code de rendu change sans que l'empreinte (calculée au démarrage du serveur) ne suive.
  pending ??= loadPortrait(size, import.meta.env.DEV ? undefined : __RIDER_PORTRAIT_KEY__).catch((e) => {
    pending = undefined; // une nouvelle tentative reste possible
    throw e;
  });
  return pending;
}

/** L'image gardée sous l'empreinte `version`, sinon un nouveau rendu, rangé à sa place. Sans `version`, pas de cache. */
export async function loadPortrait(size: number, version: string | undefined): Promise<string> {
  const key = version === undefined ? undefined : portraitRequest(version, size);
  const kept = key && (await readCache(key));
  if (kept) return URL.createObjectURL(kept);
  const { renderRiderPortrait } = await import('./rider-portrait-render');
  const blob = await renderRiderPortrait(size);
  if (key) await writeCache(key, blob);
  return URL.createObjectURL(blob);
}

/** Adresse fictive sous laquelle l'image est rangée : jamais demandée au serveur, elle ne sert que de clé. */
function portraitRequest(key: string, size: number): string {
  return new URL(`/__cache/rider-portrait-${key}-${size}.png`, location.href).href;
}

/** Cache API absente (contexte non sécurisé, navigation privée stricte) ou refusée : on fait comme si l'image manquait. */
async function readCache(url: string): Promise<Blob | undefined> {
  try {
    if (typeof caches === 'undefined') return undefined;
    const hit = await (await caches.open(CACHE_NAME)).match(url);
    return hit ? await hit.blob() : undefined;
  } catch {
    return undefined;
  }
}

/** Range la nouvelle image et retire celles des versions précédentes. */
async function writeCache(url: string, blob: Blob): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE_NAME);
    for (const old of await cache.keys()) if (old.url !== url) await cache.delete(old);
    await cache.put(url, new Response(blob, { headers: { 'content-type': 'image/png' } }));
  } catch {
    // quota dépassé, stockage refusé : l'image sera refaite au prochain lancement
  }
}
