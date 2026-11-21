// Strecke: geglättete Straßenpunkte alle `step` Meter in lokalen Koordinaten (x=Ost, y=Nord, h=Höhe)
export interface RouteData {
  name: string;
  step: number;
  origin: { lat: number; lon: number };
  length: number;
  ascent: number;
  maxGrade: number;
  minGrade: number;
  x: number[];
  y: number[];
  h: number[];
  terrain: { x0: number; y0: number; cell: number; nx: number; ny: number; scale: number };
  attribution: string;
  world?: {
    buildings: { vertices: number; triangles: number; count: number; qxy: number; qz: number; palette: string[]; rgb?: boolean };
    trees: { count: number; qxy: number };
    canopy: boolean;
  };
  landuse?: { px: number; w: number; h: number; classes: Record<string, string> };
  chimneys?: number[][];
  loop?: boolean;   // Rundkurs: Start = Ziel, mehrere Runden möglich
  places?: { d: number; road: string | null; area: string | null }[];
  surface?: { from: number; to: number; type: 'radweg' }[];
  width?: number[];   // echte Fahrbahnbreite je Streckenpunkt (m)
  overlap?: number[][];   // doppelt befahrene Abschnitte (Streckenmeter der späteren Durchfahrt): nur einmal zeichnen
}

/** Echte Weltdaten (Geobasis NRW), falls für die Strecke vorhanden */
export interface WorldData {
  buildings?: { pos: Uint16Array; col: Uint8Array; ext?: { u: Uint16Array; base: Uint16Array; meta: Uint8Array } };
  trees?: Uint8Array;
  canopy?: Uint8Array;
  landuse?: Uint8Array;
  houses?: import('./world/houses').HouseData;
  rawHeights?: Int16Array; // Gelände ohne eingeschnittene Straße (für glatte Beleuchtung)
  sideRoads?: { w: number[]; p: number[][] }[]; // abzweigende Straßen [x, y, h]
  furniture?: import('./world/furniture').FurnitureData;
  landmarks?: import('./world/landmarks').LandmarkData;  // Talsperre, Aqua Magis, Türme, Hochspannung // Ortstafeln, Leitpfosten, Schutzplanken, Laternen
  ortho?: Map<string, ImageData>;                // Luftbild je Geländekachel ("ci_cj"), Zeile 0 = Süden
}

export interface RoutePose {
  x: number; y: number; h: number;
  heading: number;   // Fahrtrichtung, Radiant (0 = Nord, im Uhrzeigersinn)
  grade: number;     // Steigung in Prozent
  curvature: number; // 1/m, positiv = Linkskurve
}

const R = 6378137;

export class Route {
  readonly n: number;
  constructor(readonly data: RouteData) { this.n = data.x.length; }

  get length() { return this.data.length; }
  get loop() { return !!this.data.loop; }
  /** Rundkurs: Streckenmeter auf eine Runde abbilden */
  wrap(d: number) { if (!this.loop) return d; const L = this.length; return ((d % L) + L) % L; }

  private lerp(arr: number[], d: number) {
    d = this.wrap(d);
    const f = Math.min(Math.max(d / this.data.step, 0), this.n - 1);
    const i = Math.min(Math.floor(f), this.n - 2), t = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }
  xAt(d: number) { return this.lerp(this.data.x, d); }
  yAt(d: number) { return this.lerp(this.data.y, d); }
  hAt(d: number) { return this.lerp(this.data.h, d); }

  headingAt(d: number, span = 8) {
    const dx = this.xAt(d + span) - this.xAt(d - span), dy = this.yAt(d + span) - this.yAt(d - span);
    return Math.atan2(dx, dy);
  }

  gradeAt(d: number, span = 15) {
    const a = this.loop ? d - span : Math.max(0, d - span), b = this.loop ? d + span : Math.min(this.length, d + span);
    return b > a ? (this.hAt(b) - this.hAt(a)) / (b - a) * 100 : 0;
  }

  pose(d: number): RoutePose {
    const h1 = this.headingAt(d - 10), h2 = this.headingAt(d + 10);
    let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    return { x: this.xAt(d), y: this.yAt(d), h: this.hAt(d), heading: this.headingAt(d), grade: this.gradeAt(d), curvature: -dh / 20 };
  }

  toLatLon(x: number, y: number): [number, number] {
    const { lat, lon } = this.data.origin, rad = Math.PI / 180;
    return [lat + y / (R * rad), lon + x / (R * Math.cos(lat * rad) * rad)];
  }
}

// In der Artefakt-Vorschau liegen Binärdaten als Base64-JSON vor (dort sind nur Standard-Dateitypen erlaubt)
async function fetchBin(base: string, name: string): Promise<ArrayBuffer> {
  const file = name.includes('.') ? name : `${name}.bin`;
  if (import.meta.env.MODE === 'artifact') {
    const r = await fetch(`${base}/${file.replace(/\.bin$/, '')}.json`); if (!r.ok) throw new Error(`${name}: ${r.status}`);
    const { b64 } = await r.json() as { b64: string };
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(`${base}/${file}`); if (!r.ok) throw new Error(`${file}: ${r.status}`);
  const buf = await r.arrayBuffer(), u = new Uint8Array(buf, 0, 2);
  // gzip-gepackt veröffentlicht (spart ~60 % Ladezeit) → im Browser entpacken
  if (u[0] === 0x1f && u[1] === 0x8b) return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}

export interface RouteInfo { id: string; name: string; length: number; ascent: number; maxGrade: number }
/** Verfügbare Strecken (routes/index.json) */
export async function listRoutes(): Promise<RouteInfo[]> {
  try { const r = await fetch('routes/index.json'); if (r.ok) return await r.json(); } catch { /* egal */ }
  return [{ id: 'hausrunde', name: 'Hausrunde', length: 0, ascent: 0, maxGrade: 0 }];
}

export async function loadRoute(base: string, onProgress?: (msg: string) => void, opts: { fine?: boolean; photo?: boolean } = {}) {
  const data = await fetch(`${base}/route.json`).then(r => { if (!r.ok) throw new Error(`route.json: ${r.status}`); return r.json() as Promise<RouteData>; });
  onProgress?.('Gelände wird geladen …');
  const heights = new Int16Array(await fetchBin(base, 'terrain'));
  const world: WorldData = {};
  // Neuer Stil: Häuser aus houses.json (klein) statt LoD2-Dreiecken, keine Luftbilder → deutlich schneller
  if (!opts.photo) {
    try {
      const r = await fetch(`${base}/houses.json`);
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) world.houses = await r.json();
    } catch { /* optional */ }
  }
  if (data.world) {
    onProgress?.(`${(world.houses?.houses.length ?? data.world.buildings.count).toLocaleString('de-DE')} Häuser und ${data.world.trees.count.toLocaleString('de-DE')} Bäume werden geladen …`);
    // Kronendach nur nötig, wenn keine Nutzungskarte vorliegt; LoD2-Gebäude nur ohne houses.json
    const [b, t, c] = await Promise.all([world.houses ? Promise.resolve(null) : fetchBin(base, 'buildings'), fetchBin(base, 'trees'), data.landuse ? Promise.resolve(null) : fetchBin(base, 'canopy')]);
    const nV = data.world.buildings.vertices;
    if (b) world.buildings = { pos: new Uint16Array(b, 0, nV * 3), col: new Uint8Array(b, nV * 6, data.world.buildings.rgb ? nV : nV / 3) };
    world.trees = new Uint8Array(t);
    if (c) world.canopy = new Uint8Array(c);
    try { world.rawHeights = new Int16Array(await fetchBin(base, 'terrain_raw')); } catch { /* optional */ }
  }
  try {
    const r = await fetch(`${base}/landmarks.json`);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) world.landmarks = await r.json();
  } catch { /* optional */ }
  try {
    const r = await fetch(`${base}/furniture.json`);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) world.furniture = await r.json();
  } catch { /* optional */ }
  try {
    const r = await fetch(`${base}/roads.json`);
    if (r.ok) world.sideRoads = (await r.json() as { roads: WorldData['sideRoads'] }).roads;
  } catch { /* optional */ }
  if (opts.photo) try {
    const r = await fetch(`${base}/ortho.json`);
    if (r.ok) {
      const man = await r.json() as { tiles: Record<string, number>; fine?: string[] };
      const fine = new Set(opts.fine ? man.fine ?? [] : []);
      const keys = Object.keys(man.tiles), out = new Map<string, ImageData>();
      let done = 0;
      const worker = async () => {
        for (let k = keys.shift(); k; k = keys.shift()) {
          const res = await fetch(`${base}/${fine.has(k) ? 'ortho1' : 'ortho'}/${k}.jpg`);
          if (res.ok) {
            const url = URL.createObjectURL(await res.blob()), img = new Image(); img.src = url;
            await img.decode();
            // Pixel auslesen, Zeilen umdrehen (Süden unten = v 0) → als Rohdaten-Textur hochladen
            const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
            const g = cv.getContext('2d', { willReadFrequently: true })!;
            g.translate(0, img.height); g.scale(1, -1); g.drawImage(img, 0, 0);
            out.set(k, g.getImageData(0, 0, img.width, img.height));
            URL.revokeObjectURL(url);
          }
          onProgress?.(`Luftbilder ${++done} / ${Object.keys(man.tiles).length} …`);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      world.ortho = out;
    }
  } catch (e) { console.warn('Luftbilder nicht geladen', e); }
  if (data.landuse) {
    onProgress?.('Felder, Wiesen und Wege werden geladen …');
    try {
      const buf = new Uint8Array(await fetchBin(base, 'landuse'));
      // gzip-komprimiert gespeichert; manche Server entpacken schon beim Ausliefern → Kennung prüfen
      world.landuse = buf[0] === 0x1f && buf[1] === 0x8b
        ? new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
        : buf;
    } catch (e) { console.warn('Nutzungskarte nicht geladen', e); }
  }
  return { route: new Route(data), heights, world };
}
