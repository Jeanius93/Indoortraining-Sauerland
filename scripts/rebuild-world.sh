#!/usr/bin/env bash
# Welt einer vorhandenen Strecke neu aufbauen: Straßennetz + Kreisverkehre (ATKIS Basis-DLM), Gelände/Bäume (DGM1, nDOM),
# Häuser (LoD2), Kirchen. Voraussetzung: scripts/.cache/dlm/axes.json (scripts/extract-dlm.py), Kacheln im Cache.
# Aufruf: scripts/rebuild-world.sh <id> [quelle]   (quelle = Ordner mit unbearbeitetem Stand, Standard: public/routes/<id>)
set -euo pipefail
ID="$1"; OUT="public/routes/$ID"; SRC="${2:-}"
export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
if [ -n "$SRC" ]; then rm -rf "$OUT"; cp -r "$SRC" "$OUT"; fi
python3 scripts/prepare-network.py "$OUT" | grep -E "Kreisverkehr|Straßenstücke|Kreuzungen|ausgeschlossen"
rm -rf "scripts/.cache/base/$ID"
node scripts/prepare-world.mjs "$OUT" > "scripts/.cache/world-$ID.log" 2>&1
tail -c 600 "scripts/.cache/world-$ID.log" | tr '\r' '\n' | grep -E "Straße:|Gebäude:" || true
python3 scripts/prepare-houses.py "$OUT" | tail -3
python3 scripts/prepare-churches.py "$OUT" | tail -1
echo "fertig: $ID"
