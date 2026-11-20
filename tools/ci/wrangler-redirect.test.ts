import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JavaScript sans types
import { inWorkersBuilds, redirectFile, stripMigrations, writeRedirect } from './wrangler-redirect.mjs';

const script = path.resolve('tools/ci/wrangler-redirect.mjs');

function run(env: Record<string, string>) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-'));
  // Environnement réduit : ni WORKERS_CI ni autre variable du poste ne doit s'y glisser.
  execFileSync(process.execPath, [script], { cwd, env: { PATH: process.env.PATH ?? '', ...env } });
  return path.join(cwd, '.wrangler', 'deploy', 'config.json');
}

describe('redirection de configuration wrangler', () => {
  it('ne s’active que dans Workers Builds', () => {
    expect(inWorkersBuilds({ WORKERS_CI: '1' })).toBe(true);
    expect(inWorkersBuilds({ WORKERS_CI_BUILD_UUID: 'abc' })).toBe(true);
    expect(inWorkersBuilds({})).toBe(false);
    expect(inWorkersBuilds({ WORKERS_CI: '0' })).toBe(false);
  });

  it('pointe vers la configuration de l’application, chemin relatif au fichier', () => {
    expect(JSON.parse(redirectFile())).toEqual({ configPath: '../../wrangler.app.toml' });
  });

  it('écrit .wrangler/deploy/config.json dans Workers Builds, rien ailleurs', () => {
    const file = run({ WORKERS_CI: '1' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ configPath: '../../wrangler.app.toml' });
    expect(fs.existsSync(run({}))).toBe(false);
  });
});

describe('aperçus de branche', () => {
  const toml = 'name = "x"\n\n[[migrations]]\ntag = "v1"\nnew_sqlite_classes = ["WorldRoom"]\n\n[triggers]\ncrons = ["30 3 * * *"]\n';

  it('retire les migrations Durable Object, rien d’autre', () => {
    expect(stripMigrations(toml)).toBe('name = "x"\n\n[triggers]\ncrons = ["30 3 * * *"]\n');
  });

  it('une branche autre que main passe par la configuration sans migrations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-'));
    fs.writeFileSync(path.join(root, 'wrangler.app.toml'), toml);
    writeRedirect(root, { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'ma-branche' });
    expect(JSON.parse(fs.readFileSync(path.join(root, '.wrangler/deploy/config.json'), 'utf8'))).toEqual({ configPath: '../../wrangler.app.preview.toml' });
    expect(fs.readFileSync(path.join(root, 'wrangler.app.preview.toml'), 'utf8')).not.toContain('migrations');
  });

  it('main garde la configuration complète', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-'));
    fs.writeFileSync(path.join(root, 'wrangler.app.toml'), toml);
    writeRedirect(root, { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' });
    expect(fs.existsSync(path.join(root, 'wrangler.app.preview.toml'))).toBe(false);
  });
});
