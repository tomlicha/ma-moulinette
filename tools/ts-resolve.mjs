/**
 * Lance du TypeScript de `src/` directement dans Node (`node --import ./tools/ts-resolve.mjs …`) : les modules de
 * `src/` s'importent sans extension, comme le veut Vite ; ce crochet essaie `.ts` quand Node ne trouve pas le fichier.
 */
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\\.{1,2}\\//.test(specifier) || /\\.[cm]?[jt]s$/.test(specifier)) throw e;
    return next(specifier + '.ts', context);
  }
}`),
  import.meta.url,
);
