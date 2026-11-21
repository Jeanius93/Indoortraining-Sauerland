# Sauerland Indoor – Übergabe

## 1. Projektziel
Browser-Indoortraining wie Zwift auf den eigenen Rennradstrecken im Sauerland (Herscheid/Plettenberg).
Elite Suito (FTMS, ERG- und Simulationsmodus) und Pulsgurt per Web Bluetooth, 3D-Welt aus amtlichen
Geodaten NRW mit Avatar, FIT-Export nach der Fahrt. Nutzer fährt auf MSI Claw 8 AI+ (Windows, **Edge/Chrome** –
Firefox hat kein Web Bluetooth) und testet auch am Handy. Oberfläche und Code-Kommentare auf Deutsch.

## 2. Tech-Stack, Starten, Bauen, Testen
- Vite + TypeScript + Three.js r187, Garmin FIT SDK. Vite-Root ist `app/` (`app/index.html`), Quellcode in `src/`.
- `npm run dev` – Entwicklung · `npm run build` – tsc + Build nach `dist/` · `npx vite preview --port 4173` – lokal ansehen.
- `npm test` – FIT-Test (`tests/fit.test.mjs`).
- `npm run deploy` – Streckenliste (`scripts/make-index.mjs`), Build, Kopie nach `docs/` (gzip-komprimierte .bin, ohne Luftbilder).
- **Live:** GitHub Pages vom Branch `claude/sleepy-turing-e9avo2`, Root-`index.html` leitet auf `docs/` um:
  https://jeanius93.github.io/Indoortraining-Sauerland/ – vor jedem Deploy `data-v` in `app/index.html` hochzählen
  (Cache-Bruch, Format `JJJJ-MM-TTx`), danach live prüfen (curl auf `docs/?t=…`).
- URL-Parameter: `?km=5.3` (Startpunkt), `?q=low|high` (Grafikstufe), `?leben=0` (ohne Tiere/Autos/Gärten), `?style=luftbild` (alter Look).
- Testen ohne GPU: Playwright/Chromium mit SwiftShader (`--use-angle=swiftshader`), Bildrate dort nicht aussagekräftig,
  nur Optik/Fehler/Dreiecks- und Draw-Call-Zahlen. `window.__sauerland.world` gibt Zugriff auf die Welt (`debugView` = feste Kamera).
- Python-Skripte brauchen numpy, scipy, PIL; Node-Skripte mit Netz: `NODE_USE_ENV_PROXY=1`.

## 3. Ordnerstruktur
- `src/main.ts` – App: Einstellungen (localStorage `sauerland.settings`), Streckenauswahl, Fahrt-Schleife, HUD, Runden, Speichern/Fortsetzen, FIT.
- `src/route.ts` – Streckendaten laden (`loadRoute`, `listRoutes`), `Route` mit `pose(d)`, `wrap(d)` für Rundkurse.
- `src/physics.ts`, `src/workouts.ts`, `src/recorder.ts`, `src/fit.ts`, `src/storage.ts` (IndexedDB, alle 5 s gesichert).
- `src/devices/ftms.ts` (FTMS + Puls, Auto-Reconnect), `simulator.ts` (Simulationsmodus ohne Trainer).
- `src/ui/` – Höhenprofil/Karte (`charts.ts`), Gamepad, Orte-Sprung.
- `src/world/scene.ts` – Renderer, Licht, Kameras, LOD-Takt (0,4 s), adaptive Auflösung, rechts fahren (`riderOffset`).
- `src/world/style.ts` – Look „ens“ (Standard): Dunst, Bloom, Farbkorrektur, MSAA-Zwischenbild. `lookflag.ts` schaltet.
- `src/world/terrain.ts` – Gelände (Kacheln mit 3 Detailstufen + Schürze), Straße/Nebenstraßen (Ribbons, je km zusammengefasst),
  Bäume (`TreeField`, 500-m-Kacheln, 3 LOD), Hausmaterial-Shader.
- `src/world/houses.ts` – Häuser aus `houses.json` (Rechteck, Dachformen, Schornsteine). `grass.ts`, `sky.ts`, `furniture.ts`
  (Ortstafeln, Leitpfosten, Laternen, Planken, Bordsteine), `landmarks.ts` (Talsperre, Aqua Magis, Türme, Hochspannung).
- `src/world/avatar.ts` – Fahrer + Rennrad, Bein/Arm-IK, Wiegetritt, Trikot-Textur (Canvas), Helm.
- `src/world/life/` – belebte Welt: `common.ts` (Nutzungskarte, Straßen-/Häuser-Abfragen, `StaticSet` = Instanzen in 1-km-Kacheln),
  `animals.ts` (Kühe/Schafe, Vögel, Schmetterlinge, Pollen), `traffic.ts` (Autos, Überholen, Parken), `village.ts`
  (Gärten, Kirchtürme, Bushaltestellen, Wegweiser, Rauch), `roadside.ts` (Weidezäune, Hochsitze, Holzstapel, SGV-Schilder).
- `public/routes/<id>/` – Streckendaten: `route.json` (Punkte alle 5 m, Breite, Orte, `loop`, `overlap`), `terrain.bin`,
  `terrain_raw.bin`, `landuse.bin` (2 m), `trees.bin`, `houses.json` (+ `churches`), `roads.json`, `furniture.json`, `landmarks.json`.
  `index.json` = Streckenliste. `routes/<id>.gpx` = bereinigte Rundkurs-GPX.
- `scripts/` – Datenpipeline (siehe 4.), Cache in `scripts/.cache/` (gitignored: DGM1, LoD2, ALKIS-GeoPackages, DOP, Uploads).

## 4. Architektur- und Designentscheidungen
- **Datenschutz (Repo ist öffentlich):** Strecken starten nie an der Haustür (`scripts/make-loop.py`: gemeinsamen Hin/Rückweg
  abschneiden, Start ≥ 1,5 km Luftlinie vom Zuhause), Zeit/Puls/Temperatur aus GPX entfernt. Keine Adresse/Namen ins Repo.
- **Alle Strecken sind Rundkurse** (Start = Ziel, `close-loop.py`), Runden = Überfahrten der Ziellinie.
- **Neue Strecke:** `scripts/build-route.sh <aufzeichnung.gpx> <id> "<Name>"` (ganze Pipeline, ~3–8 min);
  `-` statt GPX verarbeitet vorhandenes `routes/<id>.gpx` neu. Danach `scripts/rename-route.py <id> "<Name>"`,
  Namen aus Ortschaften entlang der Strecke: `scripts/route-villages.py public/routes/<id> scripts/.cache/alkis/*.gpkg`.
- **Straßenhöhe** (`prepare-world.mjs`): DGM1 in der Straßenmitte; Höhenmesser nur zur Brückenerkennung (driftet bis 15 m),
  kurze Abweichungen ≤ 200 m werden geradlinig überbrückt. **Doppelt befahrene Abschnitte** (`merge-overlap.py`): spätere
  Durchfahrt auf die frühere gelegt, `route.overlap` → App zeichnet Straße/Ausstattung dort nur einmal.
- **Geodaten:** Geobasis NRW (dl-de/zero-2-0) – DGM1, LoD2, nDOM, ALKIS vereinfacht (Märkischer Kreis, Olpe). Häuser werden
  sauber neu aufgebaut statt LoD2-Dreiecke (Nutzerwunsch: „darf von den Daten abweichen“), Böden prozedural, keine Luftbilder.
- **Grafikstil:** „realistischer Gaming-Look à la Enshrouded“ – vom Nutzer gewählt und bestätigt. Neon/Toon/Cinema abgelehnt.
- **Performance:** alles Instanzen in Kacheln mit Sichtweite, Kleinteile ohne Schatten, Gelände-LOD, adaptive Auflösung
  nur nach unten und nie unter 1 (sonst unscharf; Auflösungswechsel vor dem Zeichnen, sonst schwarzes Aufblitzen).
- **Kein Strava** (Nutzer will nur FIT-Datei, automatisch nach der Fahrt). Fahrt geht bei Verbindungsabbruch nicht verloren.
- Kirchtürme aus LoD2-Funktion 31001_3040/3041 (`prepare-churches.py`).

## 5. Code-Konventionen
- TypeScript strict, `npx tsc --noEmit -p .` muss sauber sein. Kompakter Stil, deutsche Kommentare/Bezeichner in UI.
- Weltkoordinaten: x = Ost, y = Nord, z = Höhe; Three.js: `(x, z, -y)` (Helfer `V()` in `life/common.ts`).
  Heading 0 = Nord, im Uhrzeigersinn; Modelle entlang lokal +X, Drehung `yaw = atan2(dy, dx)`.
- Prozedurale Texturen per Canvas, Geometrien zusammenfügen (`merge`) + `InstancedMesh`; keine externen Assets.
- Deterministische Zufälle über `rng(seed)` (`src/world/noise.ts`).
- Commits auf Deutsch, nur auf Branch `claude/sleepy-turing-e9avo2`; Nutzer will **keine vielen Stände** – alten Stand ersetzen.

## 6. Aktueller Stand (funktioniert)
- Echte Fahrt mit Suito + Pulsgurt getestet („alles hat geklappt“). ERG/Sim, Workouts, FIT-Export, Auto-Reconnect, Fortsetzen.
- 7 Rundkurse: Hausrunde, Fürwigge-, Lüdenscheid-, Plettenberg-Runde, 2× Valbert-Runde, Große Runde (72 km).
- Welt: Gelände, Straßen inkl. Nebenstraßen/Radwege, Häuser, Bäume, Gras, Ortstafeln, Talsperre, Aqua Magis, Kirchtürme,
  Tiere, Autos (überholen, warten bei Gegenverkehr), Gärten, Bushaltestellen, Wegweiser, Weidezäune, Hochsitze, Rauch.
- Avatar überarbeitet (geformter Oberkörper, Trikot „SAUERLAND“, Helm, Schuhe). Performance optimiert (Dreiecke halbiert).

## 7. Bekannte Bugs / offene Baustellen
- Performance auf der Claw nach der letzten Optimierung **nicht bestätigt**; schwarze Blitzer am Handy vermutlich behoben (unbestätigt).
- Noch 40–130 Stellen je Strecke mit > 3 m Abstand Straße↔Rohgelände (Brücken, Einschnitte – meist korrekt, nicht einzeln geprüft).
- In Ortschaften stehen nah an Straßen gelegentlich Objekte unpassend (Bushaltestelle vor Hauswand, parkende Autos am Gehweg).
- Autos sind starr (keine Räderdrehung, kein Licht); Fahrer hat auf schmalen Straßen wenig Abstand beim Überholen.
- Wanderwegweiser/Hochsitze/Holzstapel nur grob über Nutzungskarte platziert.
- Electron-/Installer-Version nur besprochen, nicht gebaut.

## 8. Nächste Schritte
1. Rückmeldung zur Performance (Claw + Handy) einholen; ggf. `?leben=0` vergleichen und Sichtweiten/Anzahlen nachregeln.
2. Offene Ideen aus der Abhak-Liste (Artifact „Lebendige Sauerland-Welt“): Klangkulisse, andere Radfahrer (KI/Ghost),
   Tageszeit/Wetter – Nutzer wünscht vorher **Bilder als Vorschlag** (Tokens sparen), erst nach Zustimmung programmieren.
3. Avatar-Feinschliff nach Nutzerfeedback (Trikotdesign/Schriftzug in Einstellungen wählbar, Haar-/Hautfarbe).
4. Zukunftsidee „freies Fahren“: Region als Straßennetz, Route frei wählen (größerer Umbau der Datenpipeline).
5. Optional: Installer (Electron) für die Claw.
