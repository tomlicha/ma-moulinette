-- Identifiants Final Surge chiffrés avec une clé maître Worker (jamais stockée dans D1).
CREATE TABLE IF NOT EXISTS user_final_surge (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  encrypted_credentials TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
