import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import type { Tokens } from './src/export/strava/api';
import { createStravaRelay, PREFIX, type TokenStore } from './src/export/strava/relay';
import { createFileStore } from './tools/logs/file-store.ts';
import { serveWith } from './tools/logs/node-http.ts';
import { createLogReceiver, PREFIX as LOGS_PREFIX } from './src/telemetry/receiver.ts';
import { LIMITS } from './src/telemetry/report.ts';

const TOKEN_FILE = '.strava-tokens.json';

/**
 * Empreinte de ce qui dessine le portrait du coureur : les modèles, tout le code de rendu et la version de three.js.
 * Elle sert de clé au portrait gardé dans le navigateur (`src/render/rider-portrait.ts`) : un nouveau modèle ou un
 * changement de rendu le refait une fois, sinon il est relu tel quel. Tout `src/render/` plutôt qu'une liste de
 * fichiers à tenir à jour : au pire, un portrait refait pour rien après une mise à jour du décor.
 */
function riderPortraitKey(): string {
  const hash = createHash('sha256');
  const render = readdirSync('src/render').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();
  for (const f of ['public/assets/avatar.glb', 'public/assets/bike.glb', ...render.map((f) => `src/render/${f}`), 'node_modules/three/package.json']) {
    hash.update(f).update(readFileSync(f));
  }
  return hash.digest('hex').slice(0, 16);
}

/** Jetons Strava dans un fichier local ignoré par git ; écriture atomique pour ne jamais perdre un jeton de rafraîchissement. */
const fileStore: TokenStore = {
  async load() {
    try {
      return JSON.parse(await readFile(TOKEN_FILE, 'utf8')) as Tokens;
    } catch {
      return undefined;
    }
  },
  async save(tokens) {
    if (!tokens) {
      await unlink(TOKEN_FILE).catch(() => {});
      return;
    }
    await writeFile(`${TOKEN_FILE}.tmp`, JSON.stringify(tokens), 'utf8');
    await rename(`${TOKEN_FILE}.tmp`, TOKEN_FILE);
  },
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Relais Strava dans le serveur de dev. Les variables STRAVA_* ne portent pas
 * le préfixe VITE_ : Vite ne les expose donc jamais au navigateur.
 */
function exportRelays(env: Record<string, string>): Plugin {
  return {
    name: 'zwift2-export-relays',
    configureServer(server) {
      const relay = createStravaRelay({
        clientId: env.STRAVA_CLIENT_ID,
        clientSecret: env.STRAVA_CLIENT_SECRET,
        store: fileStore,
      });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next();
        try {
          const method = req.method ?? 'GET';
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(req));
          const request = new Request(`http://${req.headers.host}${req.url}`, { method, headers, body });
          const response = await relay(request);
          if (!response) return next();
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.end(e instanceof Error ? e.message : 'erreur du relais');
        }
      });
    },
  };
}

/**
 * Récepteur de journaux du serveur de dev : les rapports de l'application arrivent dans `.logs/reports.jsonl`.
 * Pour les recevoir à distance, voir `tools/log-server.ts`.
 */
function logReceiver(env: Record<string, string>): Plugin {
  return {
    name: 'zwift2-log-receiver',
    async configureServer(server) {
      await mkdir('.logs', { recursive: true });
      const receiver = createLogReceiver({
        store: createFileStore('.logs/reports.jsonl'),
        // Dépôt ouvert : le serveur de dev n'écoute que sur localhost. Seule la lecture exige un jeton.
        readToken: env.LOG_READ_TOKEN,
      });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(LOGS_PREFIX)) return next();
        try {
          if (!(await serveWith(receiver, req, res, LIMITS.bodyBytes))) next();
        } catch (e) {
          res.statusCode = 500;
          res.end(e instanceof Error ? e.message : 'erreur du récepteur');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  define: { __RIDER_PORTRAIT_KEY__: JSON.stringify(riderPortraitKey()) },
  plugins: [
    exportRelays(loadEnv(mode, process.cwd(), ['STRAVA_'])),
    logReceiver(loadEnv(mode, process.cwd(), ['LOG_'])),
  ],
  server: {
    // Comptes et salle temps réel : servis par le Worker lancé à côté (`npm run dev:api`, wrangler dev sur le port 8787).
    proxy: {
      '/api/auth': 'http://localhost:8787',
      '/api/world': { target: 'ws://localhost:8787', ws: true },
    },
  },
  // Chargé à la demande par l'export : sans cela, Vite l'optimise au premier clic et recharge la page, ce qui efface la sortie en cours.
  optimizeDeps: { include: ['@garmin/fitsdk'] },
  test: {
    // Les worktrees d'agents vivent sous .claude/ : leurs copies du code ne sont pas à tester ici.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
}));
