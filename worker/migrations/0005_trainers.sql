-- Un trainer par installation (src/telemetry/device.ts), mis à jour quand il change. Hors de la purge des 30 jours des journaux.
CREATE TABLE IF NOT EXISTS trainers (
  install     TEXT    PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  changes     INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT    NOT NULL,
  profile     TEXT    NOT NULL,
  brand       TEXT,
  manufacturer TEXT,
  model       TEXT,
  firmware    TEXT,
  protocol    TEXT,
  body        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS trainers_profile ON trainers (profile);
