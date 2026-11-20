#!/usr/bin/env bash
# Komplette Datenverarbeitung für eine Strecke (Rundkurs aus einer eigenen Fahrt).
# Aufruf: scripts/build-route.sh <aufzeichnung.gpx> <id> "<Name>"
set -euo pipefail
SRC="$1"; ID="$2"; NAME="$3"; OUT="public/routes/$ID"; GPKG=(scripts/.cache/alkis/*.gpkg)
export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
rm -rf "scripts/.cache/base/$ID"; mkdir -p "$OUT"
python3 scripts/make-loop.py "$SRC" "routes/$ID.gpx" "$NAME"
node scripts/prepare-route.mjs "routes/$ID.gpx" "$OUT"
python3 scripts/prepare-landuse.py "$OUT" "${GPKG[@]}" | tail -1 | cut -c1-120
node scripts/prepare-world.mjs "$OUT" > "scripts/.cache/world-$ID.log" 2>&1
python3 scripts/snap-route.py "$OUT"
python3 scripts/prepare-landuse.py "$OUT" "${GPKG[@]}" | tail -1 | cut -c1-120
python3 scripts/prepare-roads.py "$OUT" | tail -1
node scripts/prepare-world.mjs "$OUT" > "scripts/.cache/world-$ID.log" 2>&1
tail -c 400 "scripts/.cache/world-$ID.log" | tr '\r' '\n' | tail -3
python3 scripts/close-loop.py "$OUT"
python3 scripts/prepare-furniture.py "$OUT" "${GPKG[@]}" | head -1 | cut -c1-200
python3 scripts/fetch-dop.py "$OUT" | tail -1
python3 scripts/prepare-houses.py "$OUT"
python3 scripts/prepare-landmarks.py "$OUT"
echo "fertig: $ID"
