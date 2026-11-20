-- Amis : les coureurs qu'un compte a ajoutés depuis la liste « En ligne » (src/server/friends.ts, docs/design/groupe.md).
-- Pas de réciprocité : `user_id` a ajouté `friend_id`, sans que l'autre le sache ni le doive. Une ligne par ami.
-- Ils servent à les passer en tête de la liste et au réglage « Qui peut me rejoindre : mes amis » (les amis du coureur suivi).
CREATE TABLE IF NOT EXISTS friends (
  user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id  TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
