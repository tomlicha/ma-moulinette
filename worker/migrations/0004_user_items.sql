-- Données du coureur synchronisées entre ses appareils (src/server/sync.ts) : réglages, séances, « Mes blocs ».
-- Une ligne par élément ; `body` est son contenu en JSON, NULL une fois supprimé (gardé pour prévenir les autres appareils).
-- `updated_at` : instant de la modification (ms, horloge de l'appareil), la plus récente gagne.
-- `rev` : révision du compte, croissante à chaque écriture ; une page demande « ce qui a changé depuis la révision N ».
CREATE TABLE IF NOT EXISTS user_items (
  user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  body       TEXT,
  updated_at INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS user_items_rev ON user_items (user_id, rev);
