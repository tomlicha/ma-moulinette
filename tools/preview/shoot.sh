#!/bin/sh
# Capture de la page d'aperçu en Chrome sans fenêtre : shoot.sh <sortie.png> <requête> [largeur] [hauteur]
# Le serveur de dev doit tourner (npx vite --port 5199). Voir shoot.mjs : la photo attend que la scène soit prête.
exec node "$(dirname "$0")/shoot.mjs" "$@"
