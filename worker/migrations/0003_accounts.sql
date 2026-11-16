-- Comptes : un par athlète Strava (src/server/accounts.ts). `name_confirmed` : le coureur a validé le nom montré aux autres.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT    PRIMARY KEY,
  display_name   TEXT    NOT NULL,
  name_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- Moyens de connexion d'un compte : Strava aujourd'hui ; un autre fournisseur pourra s'ajouter sans migrer les comptes.
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  subject  TEXT NOT NULL,
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (provider, subject)
);

-- Sessions : seule l'empreinte SHA-256 du jeton est gardée ; le jeton lui-même ne vit que dans le cookie.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions (expires_at);

-- Jetons Strava de chaque coureur (la table strava_tokens reste celle de la passerelle du propriétaire).
CREATE TABLE IF NOT EXISTS user_strava_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  body    TEXT NOT NULL
);
