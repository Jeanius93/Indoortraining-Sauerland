# Sauerland Indoor

Indoortraining im Browser auf den eigenen Hausstrecken – mit 3D-Avatar, Frei- und ERG-Modus und FIT-Export für Strava.

## Funktionen

- **Smarttrainer per Bluetooth (FTMS)** – getestet für den Elite Suito, funktioniert mit allen FTMS-Trainern
  - **Frei-Modus:** Der Widerstand folgt der Steigung der Strecke (einstellbare Schwierigkeit, wie bei Zwift)
  - **ERG-Modus:** Der Trainer hält die Zielleistung – frei einstellbar oder als Workout (Grundlage, Sweet Spot, VO2max, Rampentest)
- **Pulsgurt** per Bluetooth
- **3D-Welt der echten Strecke:** Gelände aus Höhendaten, Straße, Wald, Radfahrer-Avatar, der im Takt der echten Trittfrequenz tritt
- Kameras: Verfolger, Seite, Ego, Drohne
- **Controller-Bedienung** (z. B. MSI Claw): Steuerkreuz ↑/↓ = Wert ±, LB/RB = Kamera, A/Start = Pause, Y = Modus wechseln
- **FIT-Datei** wird nach jeder Fahrt automatisch in „Downloads“ gespeichert (für Strava, Garmin Connect & Co., als „Virtuelle Radfahrt“)
- **Fahrt geht nicht verloren:** alle 5 s im Browser gesichert; Trainer und Pulsgurt verbinden sich bei Abbruch selbst neu (Fahrt pausiert solange); nach Absturz/Neuladen „Weiterfahren“ oder „Beenden & speichern“
- **Simulator:** ohne Trainer ausprobieren (z. B. am Handy)
- **Ortsauswahl:** Startpunkt per Karte, Höhenprofil oder Liste (Straßen- und Ortsnamen) wählen; im Simulator auch während der Fahrt springen

## Browser

Web Bluetooth gibt es nur in **Microsoft Edge** und **Google Chrome** (Windows, macOS, Android).
Firefox und Safari/iOS können sich nicht mit dem Trainer verbinden – dort läuft nur der Simulator.

## Entwicklung

```bash
npm install
npm run dev          # Entwicklungsserver (auch im LAN erreichbar)
npm test             # Prüft den FIT-Export
npm run build        # Produktions-Build nach dist/
```

## Neue Strecke hinzufügen

1. GPX bei Strava exportieren (Aktivität → ⋯ → „GPX exportieren“)
2. Zeit/Puls entfernen und Anfang/Ende abschneiden (Privatsphäre):
   `node scripts/trim-gpx.mjs eingabe.gpx routes/meinestrecke.gpx 500 "Meine Strecke"`
3. Strecken-Paket bauen (Höhenraster + geglättete Straße):
   `node scripts/prepare-route.mjs routes/meinestrecke.gpx public/routes/meinestrecke`

4. Nutzungskarte (Felder, Wiesen, Wald, Straßen, Wege, Gewässer) und Ortsnamen aus ALKIS
   (GeoPackage „Grundrissdaten vereinfacht“ der betroffenen Kreise von opengeodata.nrw.de):
   `python3 scripts/prepare-landuse.py public/routes/meinestrecke pfad/zu/*.gpkg`
4b. Strecke auf die echte Straßenmitte legen (danach Schritt 4 wiederholen):
   `python3 scripts/snap-route.py public/routes/meinestrecke`
5. Abzweigende Straßen und Radweg-Abschnitte (aus der Nutzungskarte):
   `python3 scripts/prepare-roads.py public/routes/meinestrecke`
6. Echte Welt aus amtlichen Geodaten NRW (Häuser, Bäume, genaues Gelände):
   `NODE_USE_ENV_PROXY=1 node scripts/prepare-world.mjs public/routes/meinestrecke`

7. Straßenausstattung (Ortstafeln, Leitpfosten, Schutzplanken, Laternen, Bordsteine):
   `python3 scripts/prepare-furniture.py public/routes/meinestrecke pfad/zu/*.gpkg`
8. Luftbilder als Bodentextur:
   `python3 scripts/fetch-dop.py public/routes/meinestrecke && python3 scripts/prepare-ortho.py public/routes/meinestrecke`

9. Dachfarben aus Luftbildern und Sehenswürdigkeiten (Talsperre, Aqua Magis, Türme, Hochspannung):
   `python3 scripts/prepare-roofs.py public/routes/meinestrecke && python3 scripts/prepare-landmarks.py public/routes/meinestrecke`

Benötigte Python-Pakete: `numpy pillow scipy scikit-image tifffile imagecodecs`

### Datenquellen

| Daten | Quelle | Verwendung |
|---|---|---|
| DGM1 – Geländemodell 1 m | Geobasis NRW | Gelände und Straßenhöhe |
| 3D-Gebäudemodell LoD2 | Geobasis NRW | Häuser mit echten Dachformen, Farbe nach Gebäudeart |
| nDOM 50 cm – Höhe über Grund | Geobasis NRW | einzelne Bäume (Position, Höhe, Krone, Laub/Nadel) und Waldflächen |
| ALKIS Grundrissdaten (vereinfacht) | Geobasis NRW | Nutzung: Acker, Grünland, Wald, Siedlung, Straßen, Wege, Gewässer; Straßen- und Gemarkungsnamen für die Ortsauswahl |
| DOP – Digitale Orthophotos | Geobasis NRW | Bodentextur (2 m nahe der Strecke, sonst 4 m) |
| Terrain Tiles | Mapzen / AWS Open Data | Gelände außerhalb von NRW (Rückfall) |

Geobasis-NRW-Daten stehen unter der Datenlizenz Deutschland – Zero – Version 2.0.
Bäume werden als lokale Höhenmaxima im nDOM erkannt: nahe der Straße jeder einzelne Baum,
weiter weg zu Gruppen zusammengefasst. Spitze Kronen gelten als Nadelbäume.

## Veröffentlichen (GitHub Pages)

`npm run deploy` baut die App in den Ordner `docs/` (große Daten gzip-gepackt). Auf GitHub unter
*Settings → Pages*: „Deploy from a branch“, Branch auswählen, Ordner **`/docs`**.
Alternativ baut der Workflow `.github/workflows/pages.yml` bei jedem Push auf `main` (Source „GitHub Actions“).
Web Bluetooth braucht HTTPS – GitHub Pages liefert das mit.

## Geplant

- Luftbilder (DOP20) als Bodentextur, Gewässer, Nebenstraßen
- Ghost-Rider (eigene Bestzeit), Segmente, Streckenauswahl, `.zwo`-Workout-Import
