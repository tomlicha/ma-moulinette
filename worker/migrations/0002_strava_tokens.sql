-- Jetons Strava du propriétaire : une seule ligne (id = 1), écrasée à chaque rafraîchissement.
CREATE TABLE IF NOT EXISTS strava_tokens (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL
);
