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
    buildings: { vertices: number; triangles: number; count: number; qxy: number; qz: number; palette: string[] };
    trees: { count: number; qxy: number };
    canopy: boolean;
  };
}

/** Echte Weltdaten (Geobasis NRW), falls für die Strecke vorhanden */
export interface WorldData {
  buildings?: { pos: Uint16Array; col: Uint8Array };
  trees?: Uint8Array;
  canopy?: Uint8Array;
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

  private lerp(arr: number[], d: number) {
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
    const a = Math.max(0, d - span), b = Math.min(this.length, d + span);
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
  if (import.meta.env.MODE === 'artifact') {
    const r = await fetch(`${base}/${name}.json`); if (!r.ok) throw new Error(`${name}: ${r.status}`);
    const { b64 } = await r.json() as { b64: string };
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(`${base}/${name}.bin`); if (!r.ok) throw new Error(`${name}.bin: ${r.status}`);
  return r.arrayBuffer();
}

export async function loadRoute(base: string, onProgress?: (msg: string) => void) {
  const data = await fetch(`${base}/route.json`).then(r => { if (!r.ok) throw new Error(`route.json: ${r.status}`); return r.json() as Promise<RouteData>; });
  onProgress?.('Gelände wird geladen …');
  const heights = new Int16Array(await fetchBin(base, 'terrain'));
  const world: WorldData = {};
  if (data.world) {
    onProgress?.(`${data.world.buildings.count.toLocaleString('de-DE')} Häuser und ${data.world.trees.count.toLocaleString('de-DE')} Bäume werden geladen …`);
    const [b, t, c] = await Promise.all([fetchBin(base, 'buildings'), fetchBin(base, 'trees'), fetchBin(base, 'canopy')]);
    const nV = data.world.buildings.vertices;
    world.buildings = { pos: new Uint16Array(b, 0, nV * 3), col: new Uint8Array(b, nV * 6, nV / 3) };
    world.trees = new Uint8Array(t);
    world.canopy = new Uint8Array(c);
  }
  return { route: new Route(data), heights, world };
}
