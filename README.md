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
- **FIT-Export** als „Virtuelle Radfahrt“ inkl. GPS-Spur → bei Strava hochladen
- **Simulator:** ohne Trainer ausprobieren (z. B. am Handy)

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

Die Straßenhöhe kommt aus der Aufzeichnung (Barometer, geglättet), das Gelände aus den
Mapzen Terrain Tiles (AWS Open Data; SRTM, EU-DEM u. a.).

## Veröffentlichen (GitHub Pages)

Unter *Settings → Pages → Source* „GitHub Actions“ wählen. Jeder Push auf `main` baut und veröffentlicht die App.
Web Bluetooth braucht HTTPS – GitHub Pages liefert das mit.

## Geplant

- Direkter Strava-Upload (OAuth)
- Hochauflösendes NRW-Geländemodell (DGM1), Luftbilder (DOP20) und 3D-Gebäude (LoD2)
- Ghost-Rider (eigene Bestzeit), Segmente, Streckenauswahl, `.zwo`-Workout-Import
