// Baut die 3D-Welt einer Strecke aus amtlichen Geodaten NRW (Geobasis NRW, Datenlizenz Deutschland – Zero 2.0):
//   DGM1  (Geländemodell 1 m)        → genaues Gelände + Straßenhöhe
//   LoD2  (3D-Gebäudemodell)          → Häuser mit echten Dachformen
//   nDOM  (Oberflächenhöhe über Grund) → einzelne Bäume (Position, Höhe, Kronengröße, Laub/Nadel)
// Voraussetzung: scripts/prepare-route.mjs wurde vorher ausgeführt.
// Aufruf: node scripts/prepare-world.mjs public/routes/hausrunde
import fs from 'node:fs';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import earcut from 'earcut';
import { toUtm, fromUtm } from './utm.mjs';

const dir = process.argv[2];
const BASE = 'https://www.opengeodata.nrw.de/produkte/geobasis';
const CACHE = path.join(path.dirname(new URL(import.meta.url).pathname), '.cache');
for (const d of ['lod2', 'dgm1', 'ndom', 'proc']) fs.mkdirSync(path.join(CACHE, d), { recursive: true });

// Ausgangsdaten von prepare-route.mjs beim ersten Lauf sichern, damit das Skript wiederholbar ist
const baseDir = path.join(CACHE, 'base', path.basename(dir));
if (!fs.existsSync(path.join(baseDir, 'route.json'))) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.copyFileSync(path.join(dir, 'route.json'), path.join(baseDir, 'route.json'));
  fs.copyFileSync(path.join(dir, 'terrain.bin'), path.join(baseDir, 'terrain.bin'));
}
const current = JSON.parse(fs.readFileSync(path.join(dir, 'route.json'), 'utf8'));
const route = JSON.parse(fs.readFileSync(path.join(baseDir, 'route.json'), 'utf8'));
for (const k of ['places', 'landuse', 'surface', 'width']) if (current[k]) route[k] = current[k]; // von prepare-landuse.py / prepare-roads.py
const T = route.terrain, { x0, y0, cell, nx, ny } = T;
const oldGrid = new Int16Array(fs.readFileSync(path.join(baseDir, 'terrain.bin')).buffer.slice(0));

// Nutzungskarte (optional, von prepare-landuse.py): keine Bäume auf Straßen, Wegen, Gewässern, Äckern
const LU = route.landuse && fs.existsSync(path.join(dir, 'landuse.bin'))
  ? new Uint8Array((await import('node:zlib')).gunzipSync(fs.readFileSync(path.join(dir, 'landuse.bin')))) : null;
const luAt = (x, y) => {
  if (!LU) return 0;
  const i = Math.round((x - x0) / route.landuse.px), j = Math.round((y - y0) / route.landuse.px);
  return i < 0 || j < 0 || i >= route.landuse.w || j >= route.landuse.h ? 0 : LU[j * route.landuse.w + i];
};
const NO_TRUNK = new Set([2, 8, 9, 10, 11]), NO_CROWN = new Set([9, 10, 11]);

// ---------- Koordinaten: lokal (m) ⇄ WGS84 ⇄ UTM32 ----------
const R = 6378137, rad = Math.PI / 180, { lat: lat0, lon: lon0 } = route.origin;
const kx = R * Math.cos(lat0 * rad) * rad, ky = R * rad;
const localToUtm = (x, y) => toUtm(lat0 + y / ky, lon0 + x / kx);
const utmToLocal = (E, N) => { const [la, lo] = fromUtm(E, N); return [(lo - lon0) * kx, (la - lat0) * ky]; };
// Affine Näherung je 1-km-Kachel (Fehler < 1 cm)
function tileAffine(E0, N0) {
  const [ax, ay] = utmToLocal(E0, N0), [bx, by] = utmToLocal(E0 + 1000, N0), [cx, cy] = utmToLocal(E0, N0 + 1000);
  const m = [(bx - ax) / 1000, (cx - ax) / 1000, (by - ay) / 1000, (cy - ay) / 1000];
  return (E, N) => { const e = E - E0, n = N - N0; return [ax + m[0] * e + m[1] * n, ay + m[2] * e + m[3] * n]; };
}

// ---------- Kachelliste ----------
const corners = [[x0, y0], [x0 + (nx - 1) * cell, y0], [x0, y0 + (ny - 1) * cell], [x0 + (nx - 1) * cell, y0 + (ny - 1) * cell]].map(([x, y]) => localToUtm(x, y));
const e0 = Math.floor(Math.min(...corners.map(c => c[0])) / 1000), e1 = Math.floor(Math.max(...corners.map(c => c[0])) / 1000);
const n0 = Math.floor(Math.min(...corners.map(c => c[1])) / 1000), n1 = Math.floor(Math.max(...corners.map(c => c[1])) / 1000);
const index = name => new Map([...fs.readFileSync(path.join(CACHE, name), 'utf8').matchAll(/"name":"([^"]+)"/g)].map(m => m[1]).map(n => [n.match(/_?32_?(\d{3})_(\d{4})_/)?.slice(1).join('_'), n]).filter(([k]) => k));
const idx = { dgm1: index('dgm1_index.json'), ndom: index('ndom_index.json'), lod2: index('lod2_index.json') };
const dirs = { dgm1: 'hm/dgm1_tiff/dgm1_tiff', ndom: 'hm/ndom50_tiff/ndom50_tiff', lod2: '3dg/lod2_gml/lod2_gml' };

async function download(kind, key) {
  const name = idx[kind].get(key); if (!name) return null;
  const file = path.join(CACHE, kind, name);
  if (!fs.existsSync(file)) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(`${BASE}/${dirs[kind]}/${name}`);
        if (!res.ok) throw new Error(`${res.status}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); break;
      } catch (e) { if (attempt >= 4) throw new Error(`${name}: ${e.message}`); await new Promise(r => setTimeout(r, 2000 * attempt)); }
    }
  }
  return file;
}
async function readTiff(file) {
  const b = fs.readFileSync(file), im = await (await fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))).getImage();
  const [data] = await im.readRasters();
  const [ox, oy] = im.getOrigin(), [rx] = im.getResolution();
  return { data, w: im.getWidth(), h: im.getHeight(), ox, oy, res: rx };
}

// ---------- Abstand zur Strecke (Chamfer, 10 m) ----------
const DC = 10, dw = Math.ceil((nx - 1) * cell / DC) + 1, dh = Math.ceil((ny - 1) * cell / DC) + 1;
const DF = new Float32Array(dw * dh).fill(1e9);
route.x.forEach((x, k) => { const i = Math.round((x - x0) / DC), j = Math.round((route.y[k] - y0) / DC); if (i >= 0 && j >= 0 && i < dw && j < dh) DF[j * dw + i] = 0; });
for (let pass = 0; pass < 2; pass++) {
  const s = pass ? -1 : 1, nb = [[-1, 0, DC], [0, -1, DC], [-1, -1, DC * Math.SQRT2], [1, -1, DC * Math.SQRT2]];
  for (let jj = 0; jj < dh; jj++) for (let ii = 0; ii < dw; ii++) {
    const j = pass ? dh - 1 - jj : jj, i = pass ? dw - 1 - ii : ii; let v = DF[j * dw + i];
    for (const [a, b, c] of nb) { const i2 = i + a * s, j2 = j + b * s; if (i2 >= 0 && j2 >= 0 && i2 < dw && j2 < dh) v = Math.min(v, DF[j2 * dw + i2] + c); }
    DF[j * dw + i] = v;
  }
}
const inBox = (x, y, m = 5) => x > x0 + m && y > y0 + m && x < x0 + (nx - 1) * cell - m && y < y0 + (ny - 1) * cell - m;
const routeDist = (x, y) => { const i = Math.round((x - x0) / DC), j = Math.round((y - y0) / DC); return i < 0 || j < 0 || i >= dw || j >= dh ? 1e9 : DF[j * dw + i]; };

// ---------- Rasterpunkte des Geländes in UTM ----------
const gridUtm = new Float64Array(nx * ny * 2);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const [E, N] = localToUtm(x0 + i * cell, y0 + j * cell); gridUtm[(j * nx + i) * 2] = E; gridUtm[(j * nx + i) * 2 + 1] = N; }
const routeUtm = route.x.map((x, k) => localToUtm(x, route.y[k]));

// Abzweigende Straßen (von prepare-roads.py), auf ≤ 5 m verdichtet
const roadsFile = path.join(dir, 'roads.json');
const sideRoads = fs.existsSync(roadsFile) ? JSON.parse(fs.readFileSync(roadsFile, 'utf8')).roads.map(r => {
  const pts = [], w = [];
  for (let i = 0; i < r.p.length - 1; i++) {
    const [ax, ay] = r.p[i], [bx, by] = r.p[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
    for (let s = 0; s < n; s++) { const t = s / n; pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]); w.push(r.w[i] + (r.w[i + 1] - r.w[i]) * t); }
  }
  pts.push(r.p.at(-1).slice(0, 2)); w.push(r.w.at(-1));
  return { pts, w, utm: pts.map(([x, y]) => localToUtm(x, y)), dgm: pts.map(() => NaN) };
}) : [];
const grid = new Float32Array(nx * ny).map((_, k) => oldGrid[k] * T.scale);
const gridFromDgm = new Uint8Array(nx * ny);
const canopy = new Uint8Array(nx * ny);
const dgmLat = route.x.map(() => []); // DGM1-Werte quer zur Straße (−6 … +6 m) je Streckenpunkt

// ---------- Gebäude (LoD2) ----------
const PALETTE = {
  wallWhite: '#ece8df', wallCream: '#e3d8c0', wallGrey: '#c8c8c2', wallSlate: '#5d646c', wallMetal: '#a6adb2', wallBrick: '#a56650', wallWood: '#7d6650',
  roofSlate: '#474d54', roofDark: '#5b6066', roofRed: '#87493a', roofTerra: '#a65a3e', roofFlat: '#8b8983', roofMetal: '#7d868b',
};
const palNames = Object.keys(PALETTE);
const hashStr = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const pick = (r, opts) => { let acc = 0; for (const [k, p] of opts) { acc += p; if (r < acc) return k; } return opts.at(-1)[0]; };
function styleFor(id, fn, roofType) {
  const r1 = hashStr(id), r2 = hashStr(id + 'r');
  const flat = roofType === '1000';
  if (fn.startsWith('31001_1') || fn.startsWith('31001_3')) // Wohnen / öffentlich
    return { wall: pick(r1, [['wallWhite', .55], ['wallCream', .22], ['wallSlate', .12], ['wallGrey', .08], ['wallBrick', .03]]), roof: flat ? 'roofFlat' : pick(r2, [['roofSlate', .6], ['roofDark', .17], ['roofRed', .15], ['roofTerra', .08]]) };
  if (fn.startsWith('31001_27')) // Land-/Forstwirtschaft
    return { wall: pick(r1, [['wallWood', .45], ['wallCream', .25], ['wallSlate', .15], ['wallGrey', .15]]), roof: flat ? 'roofFlat' : pick(r2, [['roofDark', .5], ['roofRed', .3], ['roofSlate', .2]]) };
  if (fn.startsWith('31001_2')) // Gewerbe / Industrie / Garagen
    return { wall: pick(r1, [['wallMetal', .45], ['wallGrey', .35], ['wallBrick', .1], ['wallWhite', .1]]), roof: flat ? pick(r2, [['roofFlat', .6], ['roofMetal', .4]]) : pick(r2, [['roofMetal', .4], ['roofDark', .4], ['roofRed', .2]]) };
  return { wall: 'wallGrey', roof: flat ? 'roofFlat' : 'roofDark' };
}
function simplifyRing(pts, tol = 0.15) { // nahezu kollineare Punkte entfernen (Gelände-Treppen an Wandunterkanten)
  let out = pts, changed = true;
  while (changed && out.length > 3) {
    changed = false; const res = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = res.at(-1), b = out[i], c = out[i + 1];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const L = Math.hypot(...ac) || 1, cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      if (Math.hypot(...cr) / L < tol) { changed = true; continue; }
      res.push(b);
    }
    res.push(out.at(-1)); out = res;
  }
  return out;
}
function triangulate(ring) {
  // Newell-Normale, auf dominante Ebene projizieren
  let nxv = 0, nyv = 0, nzv = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; nxv += (a[1] - b[1]) * (a[2] + b[2]); nyv += (a[2] - b[2]) * (a[0] + b[0]); nzv += (a[0] - b[0]) * (a[1] + b[1]); }
  const ax = Math.abs(nxv), ay = Math.abs(nyv), az = Math.abs(nzv);
  const [u, v] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [0, 2];
  const flat = []; for (const p of ring) flat.push(p[u], p[v]);
  return earcut(flat);
}
const buildings = { pos: [], col: [], count: 0, ranges: [] };
const towers = []; // ranges: [ersterVertex, letzterVertex+1] je Gebäude
function parseLod2(file, E0, N0, affine) {
  const xml = fs.readFileSync(file, 'utf8'), fps = [];
  for (const m of xml.matchAll(/<bldg:Building gml:id="([^"]+)">([\s\S]*?)<\/bldg:Building>/g)) {
    const [, id, body] = m;
    const fn = body.match(/<bldg:function>([^<]+)/)?.[1] ?? '', roofType = body.match(/<bldg:roofType>([^<]+)/)?.[1] ?? '';
    const style = styleFor(id, fn, roofType);
    const measured = Number(body.match(/<bldg:measuredHeight[^>]*>([^<]+)/)?.[1] ?? 0);
    // Hohe Türme/Masten bekommen eigene Modelle im Client → hier nur merken
    if ((fn.startsWith('51002_12') || fn.startsWith('51001_10')) && measured > 25) {
      const pl = body.match(/<gml:posList[^>]*>([^<]+)/); if (pl) {
        const v = pl[1].trim().split(/\s+/).map(Number); let sx = 0, sy = 0, sz = Infinity, c = 0, ex = -Infinity, nx_ = Infinity;
        for (let q = 0; q + 2 < v.length; q += 3) { sx += v[q]; sy += v[q + 1]; sz = Math.min(sz, v[q + 2]); c++; ex = Math.max(ex, v[q]); nx_ = Math.min(nx_, v[q]); }
        const [lx, ly] = affine(sx / c, sy / c);
        // Grundfläche für die Baum-Maske (sonst erkennt das nDOM den Turm als Baumkrone)
        const rr = Math.max(4, (ex - nx_) / 2 + 3), cxu = sx / c, cyu = sy / c;
        fps.push(Array.from({ length: 12 }, (_, q2) => [cxu + Math.cos(q2 / 12 * Math.PI * 2) * rr, cyu + Math.sin(q2 / 12 * Math.PI * 2) * rr]));
        if (!inBox(lx, ly, 30)) continue;
        towers.push({ x: Math.round(lx * 10) / 10, y: Math.round(ly * 10) / 10, z: Math.round(sz * 10) / 10, height: measured, size: Math.round((ex - nx_) * 10) / 10, fn });
      }
      continue;
    }
    // Brücken und Überdachungen: nur Dach/Fahrbahnplatte, keine Wände bis zum Boden
    const openStructure = fn.startsWith('53001') || fn.startsWith('51009_16');
    const surfaces = [];
    let groundMin = Infinity, cxs = 0, cys = 0, cn = 0;
    for (const s of body.matchAll(/<bldg:(RoofSurface|WallSurface|GroundSurface)[\s\S]*?<\/bldg:\1>/g)) {
      for (const pl of s[0].matchAll(/<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]+)<\/gml:posList>/g)) {
        const v = pl[1].trim().split(/\s+/).map(Number), ring = [];
        for (let i = 0; i + 2 < v.length; i += 3) ring.push([v[i], v[i + 1], v[i + 2]]);
        if (ring.length > 3 && ring[0].every((c, k) => c === ring.at(-1)[k])) ring.pop();
        if (s[1] === 'GroundSurface') { fps.push(ring.map(p => [p[0], p[1]])); for (const p of ring) { groundMin = Math.min(groundMin, p[2]); cxs += p[0]; cys += p[1]; cn++; } continue; }
        if (openStructure && s[1] === 'WallSurface') continue;
        surfaces.push({ kind: s[1], ring: s[1] === 'WallSurface' ? simplifyRing(ring) : ring });
      }
    }
    if (!surfaces.length) continue;
    if (!cn) { for (const s of surfaces) for (const p of s.ring) { groundMin = Math.min(groundMin, p[2]); cxs += p[0]; cys += p[1]; cn++; } }
    const [lx, ly] = affine(cxs / cn, cys / cn);
    if (routeDist(lx, ly) > 2500 || !inBox(lx, ly, 60)) continue;
    buildings.count++;
    const vStart = buildings.pos.length / 3;
    for (const s of surfaces) {
      const ring = s.ring.map(p => { const [x, y] = affine(p[0], p[1]); return [x, y, p[2]]; });
      if (ring.length < 3) continue;
      const tri = triangulate(ring), color = palNames.indexOf(s.kind === 'RoofSurface' ? style.roof : style.wall);
      // Wand-Unterkanten 3 m tiefer, damit nichts über dem (gröberen) Gelände schwebt
      const fixed = ring.map(p => [p[0], p[1], s.kind === 'WallSurface' && p[2] < groundMin + 0.3 ? p[2] - 3 : p[2]]);
      for (let t = 0; t < tri.length; t += 3) {
        for (let q = 0; q < 3; q++) { const p = fixed[tri[t + q]]; buildings.pos.push(p[0], p[1], p[2]); }
        buildings.col.push(color);
      }
    }
    buildings.ranges.push([vStart, buildings.pos.length / 3, openStructure]);
  }
  return fps;
}

// ---------- Bäume (nDOM) ----------
const trees = [];
let skipped = 0;
function rasterizeMask(fps, E0, N0, size) { // Gebäude-Grundrisse auf 1-m-Raster (Zeile 0 = Norden)
  const mask = new Uint8Array(size * size);
  for (const ring of fps) {
    const ys = ring.map(p => N0 + 1000 - p[1]);
    const jMin = Math.max(0, Math.floor(Math.min(...ys)) - 1), jMax = Math.min(size - 1, Math.ceil(Math.max(...ys)) + 1);
    for (let j = jMin; j <= jMax; j++) {
      const yy = j + 0.5, xs = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], ya = N0 + 1000 - a[1], yb = N0 + 1000 - b[1];
        if ((ya <= yy) !== (yb <= yy)) xs.push(a[0] - E0 + (yy - ya) / (yb - ya) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.floor(xs[k]) - 1); i <= Math.min(size - 1, Math.ceil(xs[k + 1]) + 1); i++) mask[j * size + i] = 1;
    }
  }
  return mask;
}
function processNdom(t, mask, E0, N0, affine) {
  const S = 1000, H = new Float32Array(S * S); // 1-m-Raster, Maximum aus 2×2
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const a = t.data[(2 * j) * 2000 + 2 * i], b = t.data[(2 * j) * 2000 + 2 * i + 1], c = t.data[(2 * j + 1) * 2000 + 2 * i], d = t.data[(2 * j + 1) * 2000 + 2 * i + 1];
    H[j * S + i] = mask[j * S + i] ? 0 : Math.max(0, a, b, c, d);
  }
  // Kronendach-Anteil je Geländepunkt (20×20 m Fenster)
  for (let k = 0; k < nx * ny; k++) {
    const E = gridUtm[k * 2], N = gridUtm[k * 2 + 1];
    if (E < E0 || E >= E0 + 1000 || N < N0 || N >= N0 + 1000) continue;
    const ci = Math.floor(E - E0), cj = Math.floor(N0 + 1000 - N); let c = 0, n = 0;
    const hw = Math.round(cell / 2);
    for (let j = cj - hw; j < cj + hw; j += 2) for (let i = ci - hw; i < ci + hw; i += 2) { if (i < 0 || j < 0 || i >= S || j >= S) continue; n++; if (H[j * S + i] > 2.5) c++; }
    canopy[k] = n ? Math.round(c / n * 255) : 0;
  }
  // Baumwipfel: lokale Maxima, Mindestabstand je nach Entfernung zur Straße (nah = jeder Baum, fern = Gruppen)
  for (let j = 2; j < S - 2; j++) for (let i = 2; i < S - 2; i++) {
    const h = H[j * S + i]; if (h < 3) continue;
    let isMax = true;
    for (let b = -2; b <= 2 && isMax; b++) for (let a = -2; a <= 2; a++) { const v = H[(j + b) * S + i + a]; if (v > h || (v === h && (b < 0 || (b === 0 && a < 0)))) { isMax = false; break; } }
    if (!isMax) continue;
    const E = E0 + i + 0.5, N = N0 + 1000 - j - 0.5, [lx, ly] = affine(E, N), d = routeDist(lx, ly);
    if (d < 4.5 || d > 1600 || !inBox(lx, ly)) continue;
    const Rm = d < 150 ? 4.5 : d < 500 ? 9 : 16, r = Math.ceil(Rm);
    let keep = true;
    for (let b = -r; b <= r && keep; b++) for (let a = -r; a <= r; a++) {
      if (a * a + b * b > Rm * Rm || (a === 0 && b === 0)) continue;
      const jj = j + b, ii = i + a; if (jj < 0 || ii < 0 || jj >= S || ii >= S) continue;
      const v = H[jj * S + ii]; if (v > h || (v === h && (b < 0 || (b === 0 && a < 0)))) { keep = false; break; }
    }
    if (!keep) continue;
    // Kronenradius: wo fällt die Höhe unter 60 %?
    let rs = 0;
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      let s = 1; const f = Math.hypot(da, db);
      while (s < 9) { const ii = i + da * s, jj = j + db * s; if (ii < 0 || jj < 0 || ii >= S || jj >= S || H[jj * S + ii] < h * 0.6) break; s++; }
      rs += s * f;
    }
    let crown = Math.min(7, Math.max(1.2, rs / 8));
    // Spitze Krone (Nadelbaum) vs. runde Krone (Laubbaum): Höhenabfall im Ring 2–3 m
    let ring = 0, rn = 0;
    for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) { const q = a * a + b * b; if (q < 4 || q > 9 || i + a < 0 || i + a >= S || j + b < 0 || j + b >= S) continue; ring += H[(j + b) * S + i + a]; rn++; }
    const sharp = rn ? (h - ring / rn) / h : 0;
    if (Rm > 4.5) crown = Math.max(crown, Rm * 0.7);
    // Stamm nicht auf Straße/Weg/Wasser/Acker; Krone darf nicht über Fahrbahnen ragen → Krone verkleinern oder Baum weglassen
    if (NO_TRUNK.has(luAt(lx, ly))) { skipped++; continue; }
    crown = Math.min(crown, d - 3.4); // Hauptstrecke: 2,8 m halbe Fahrbahn + Abstand
    for (let a = 0; a < 8 && crown >= 1; a++) {
      const ang = a * Math.PI / 4;
      for (let rr = 1; rr <= crown; rr += 1) if (NO_CROWN.has(luAt(lx + Math.cos(ang) * rr, ly + Math.sin(ang) * rr))) { crown = rr - 0.7; break; }
    }
    if (crown < 1) { skipped++; continue; }
    trees.push([lx, ly, h, crown, sharp]);
  }
}

// ---------- Gelände (DGM1) ----------
function processDgm(t) {
  const E0 = t.ox, N1 = t.oy, S = t.w;
  const sample = (E, N) => {
    const fx = E - E0 - 0.5, fy = N1 - N - 0.5; const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= S - 1 || j >= S - 1) return NaN;
    const u = fx - i, v = fy - j, D = t.data;
    const a = D[j * S + i], b = D[j * S + i + 1], c = D[(j + 1) * S + i], d = D[(j + 1) * S + i + 1];
    if (a < -1000 || b < -1000 || c < -1000 || d < -1000) return NaN;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  for (let k = 0; k < nx * ny; k++) {
    const E = gridUtm[k * 2], N = gridUtm[k * 2 + 1];
    if (E < E0 || E >= E0 + 1000 || N > N1 || N <= N1 - 1000) continue;
    // Mittel über 9 Punkte (Abstand ≈ ⅓ Rasterweite) – das Raster soll die Fläche repräsentieren
    let s = 0, n = 0; const o = cell / 3;
    for (const dy of [-o, 0, o]) for (const dx of [-o, 0, o]) { const v = sample(E + dx, N + dy); if (!isNaN(v)) { s += v; n++; } }
    if (n) { grid[k] = s / n; gridFromDgm[k] = 1; }
  }
  // Straße: quer zur Fahrtrichtung ±6 m abtasten und den Wert nehmen, der der (barometrischen) Aufzeichnung am nächsten liegt
  for (let k = 0; k < routeUtm.length; k++) {
    const [E, N] = routeUtm[k]; if (E < E0 || E >= E0 + 1000 || N > N1 || N <= N1 - 1000) continue;
    const a = routeUtm[Math.max(0, k - 2)], b = routeUtm[Math.min(routeUtm.length - 1, k + 2)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    for (let o = -6; o <= 6; o += 1.5) { const v = sample(E - dy * o, N + dx * o); if (!isNaN(v)) dgmLat[k].push(v); }
  }
  for (const r of sideRoads) r.utm.forEach(([E, N], k) => {
    if (E < E0 || E >= E0 + 1000 || N > N1 || N <= N1 - 1000) return;
    // Mittel aus Mitte und ±1 m quer (DGM1 ist auf der Fahrbahn glatt)
    const v = [sample(E, N), sample(E + 1, N), sample(E - 1, N), sample(E, N + 1), sample(E, N - 1)].filter(q => !isNaN(q));
    if (v.length) r.dgm[k] = v.reduce((a, b) => a + b, 0) / v.length;
  });
}

// ---------- Kacheln abarbeiten ----------
const keys = []; for (let e = e0; e <= e1; e++) for (let n = n0; n <= n1; n++) keys.push([e, n]);
console.log(`${keys.length} Kacheln (${e0}–${e1} / ${n0}–${n1})`);
let done = 0;
for (const [e, n] of keys) {
  const key = `${e}_${n}`, E0 = e * 1000, N0 = n * 1000, affine = tileAffine(E0, N0);
  // Kachel nur, wenn sie das Geländeraster schneidet
  const lod2 = await download('lod2', key);
  const fps = lod2 ? parseLod2(lod2, E0, N0, affine) : [];
  const dgm = await download('dgm1', key);
  if (dgm) processDgm(await readTiff(dgm));
  const nd = await download('ndom', key);
  if (nd) processNdom(await readTiff(nd), rasterizeMask(fps, E0, N0, 1000), E0, N0, affine);
  done++;
  process.stdout.write(`\r${done}/${keys.length} Kacheln · ${buildings.count} Gebäude · ${trees.length} Bäume   `);
}
console.log();

// ---------- Straßenhöhe aus DGM1 ----------
const smooth = (arr, win) => arr.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - win); j <= Math.min(arr.length - 1, i + win); j++) if (!isNaN(arr[j])) { s += arr[j]; c++; } return c ? s / c : NaN; });
// 1) Versatz Aufzeichnung ↔ DGM1 (Median über Mittelwerte quer zur Straße)
const baro = route.h.slice();
const centers = dgmLat.map(l => l.length ? l[l.length >> 1] : NaN);
// Barometer driftet während der Fahrt → Versatz gleitend über ±1 km (Median)
const rawDiff = centers.map((c, k) => c - baro[k]);
const W = Math.round(1000 / route.step);
const offs = baro.map((_, k) => {
  const w = []; for (let j = Math.max(0, k - W); j <= Math.min(baro.length - 1, k + W); j += 4) if (!isNaN(rawDiff[j])) w.push(rawDiff[j]);
  w.sort((a, b) => a - b); return w.length ? w[w.length >> 1] : 0;
});
const off = [...offs].sort((a, b) => a - b)[offs.length >> 1];
// 2) Je Punkt die DGM-Höhe in der Straßenmitte (die Strecke liegt auf der amtlichen Straßenachse).
//    Nur wenn weder die Mitte noch ein Wert quer zur Straße zur verschobenen Aufzeichnung passt
//    (Brücke – das DGM ist Gelände ohne Bauwerke), gilt die Aufzeichnung. Der Höhenmesser liegt
//    gerade am Anfang einer Aufzeichnung oft daneben und darf am Hang nicht den Straßenrand auswählen.
let bridges = 0;
const suspect = new Uint8Array(dgmLat.length);
const dgmRoad = dgmLat.map((l, k) => {
  const ref = baro[k] + offs[k], c = centers[k];
  if (isNaN(c)) { suspect[k] = 1; return NaN; }
  if (Math.abs(c - ref) <= 4) return c;
  let best = NaN, bd = Infinity;
  for (const v of l) if (Math.abs(v - ref) < bd) { bd = Math.abs(v - ref); best = v; }
  if (bd <= 2.5) return best;
  suspect[k] = 1; return c;
});
// Brücken: kurze verdächtige Stücke (≤ 200 m) geradlinig zwischen den Enden überbrücken; lange Stücke = Drift des Höhenmessers → Gelände
for (let k = 0; k < dgmRoad.length; k++) {
  if (!suspect[k]) continue;
  let e = k; while (e + 1 < dgmRoad.length && suspect[e + 1]) e++;
  const a = k - 1, b = e + 1;
  if ((e - k + 1) * route.step <= 200 && a >= 0 && b < dgmRoad.length) {
    for (let i = k; i <= e; i++) dgmRoad[i] = dgmRoad[a] + (dgmRoad[b] - dgmRoad[a]) * (i - a) / (b - a);
    bridges += e - k + 1;
  } else for (let i = k; i <= e; i++) if (isNaN(dgmRoad[i])) dgmRoad[i] = baro[i] + offs[i];
  k = e;
}
console.log(`Versatz Aufzeichnung→DGM1: ${Math.min(...offs).toFixed(1)} … ${Math.max(...offs).toFixed(1)} m (Median ${off.toFixed(1)}) · ${bridges} Punkte (${(bridges * route.step)} m) als Brücke überbrückt`);
// 3) Median gegen Ausreißer, dann glätten
const med = dgmRoad.map((_, i) => { const w = []; for (let j = Math.max(0, i - 6); j <= Math.min(dgmRoad.length - 1, i + 6); j++) w.push(dgmRoad[j]); w.sort((a, b) => a - b); return w[w.length >> 1]; });
route.h = smooth(smooth(med, 6), 6).map(v => Math.round(v * 10) / 10);
let up = 0, maxG = 0, minG = 0;
for (let k = 1; k < route.h.length; k++) up += Math.max(0, route.h[k] - route.h[k - 1]);
for (let k = 4; k < route.h.length; k++) { const g = (route.h[k] - route.h[k - 4]) / (4 * route.step) * 100; maxG = Math.max(maxG, g); minG = Math.min(minG, g); }
route.ascent = Math.round(up); route.maxGrade = Math.round(maxG * 10) / 10; route.minGrade = Math.round(minG * 10) / 10;

// Unverändertes Gelände sichern: daraus berechnet der Client die Beleuchtung (keine Terrassen-Kanten)
fs.writeFileSync(path.join(dir, 'terrain_raw.bin'), Buffer.from(Int16Array.from(grid, h => Math.round(h * 10)).buffer));

// ---------- Höhen der abzweigenden Straßen: DGM1, an der Einmündung auf Höhe der Strecke ----------
const HB = 60, routeHash = new Map();
route.x.forEach((x, k) => { const kk = `${Math.floor(x / HB)}_${Math.floor(route.y[k] / HB)}`; (routeHash.get(kk) ?? routeHash.set(kk, []).get(kk)).push(k); });
const nearestRoute = (x, y) => {
  let best = Infinity, bk = -1; const cx = Math.floor(x / HB), cy = Math.floor(y / HB);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of routeHash.get(`${cx + a}_${cy + b}`) ?? []) { const d = Math.hypot(route.x[k] - x, route.y[k] - y); if (d < best) { best = d; bk = k; } }
  return [bk, best];
};
for (const r of sideRoads) {
  const med = r.dgm.map((_, i) => { const w = []; for (let j = Math.max(0, i - 3); j <= Math.min(r.dgm.length - 1, i + 3); j++) if (!isNaN(r.dgm[j])) w.push(r.dgm[j]); w.sort((p, q) => p - q); return w.length ? w[w.length >> 1] : NaN; });
  let h = smooth(med, 2);
  h = h.map((v, i) => {
    const [bk, d] = nearestRoute(...r.pts[i]);
    if (bk < 0 || d > 30) return v;
    const t = Math.min(1, Math.max(0, (d - 4) / 26)), s = t * t * (3 - 2 * t);
    return isNaN(v) ? route.h[bk] : route.h[bk] + (v - route.h[bk]) * s;
  });
  r.h = h.map(v => isNaN(v) ? 0 : Math.round(v * 10) / 10);
}

// ---------- Straßen ins Gelände einschneiden ----------
// Alle Fahrbahnen (Strecke + Abzweige) als Punkte mit halber Breite. Gelände, das höher als die Fahrbahn liegt,
// wird breit abgesenkt (es darf die Straße nirgends überragen); tieferes Gelände nur nah an der Kante angehoben
// (den Rest verdeckt die Böschung im Client).
const radweg = route.surface ?? [];
const roadPts = [];
route.x.forEach((x, k) => { const d = k * route.step; const rw = radweg.some(s => d >= s.from && d <= s.to); roadPts.push([x, route.y[k], route.h[k], rw ? 1.7 : (route.width?.[k] ?? 5.6) / 2]); });
for (const r of sideRoads) r.pts.forEach(([x, y], k) => roadPts.push([x, y, r.h[k], r.w[k] / 2]));
const ptHash = new Map();
roadPts.forEach((p, k) => { const kk = `${Math.floor(p[0] / HB)}_${Math.floor(p[1] / HB)}`; (ptHash.get(kk) ?? ptHash.set(kk, []).get(kk)).push(k); });
const LOW_FULL = cell * 1.2, LOW_END = cell * 3.5, RAISE_FULL = cell * 0.4, RAISE_END = cell * 2;
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const x = x0 + i * cell, y = y0 + j * cell, cx = Math.floor(x / HB), cy = Math.floor(y / HB), o = grid[j * nx + i];
  let lowest = Infinity, raiseTo = -Infinity;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of ptHash.get(`${cx + a}_${cy + b}`) ?? []) {
    const [px, py, ph, hw] = roadPts[k], e = Math.max(0, Math.hypot(px - x, py - y) - hw), target = ph - 0.5;
    if (e < LOW_END && o > target) { const t = e <= LOW_FULL ? 0 : (e - LOW_FULL) / (LOW_END - LOW_FULL), s = t * t * (3 - 2 * t); lowest = Math.min(lowest, target + (o - target) * s); }
    if (e < RAISE_END && o < target) { const t = e <= RAISE_FULL ? 0 : (e - RAISE_FULL) / (RAISE_END - RAISE_FULL), s = t * t * (3 - 2 * t); raiseTo = Math.max(raiseTo, target + (o - target) * s); }
  }
  if (lowest < Infinity) grid[j * nx + i] = lowest;
  else if (raiseTo > -Infinity) grid[j * nx + i] = raiseTo;
}
// Abzweige mit Höhen speichern
fs.writeFileSync(path.join(dir, 'roads.json'), JSON.stringify({ roads: sideRoads.map(r => ({ w: r.w.map(v => Math.round(v * 10) / 10), p: r.pts.map(([x, y], k) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, r.h[k]]) })) }));
fs.writeFileSync(path.join(dir, 'terrain.bin'), Buffer.from(Int16Array.from(grid, h => Math.round(h * 10)).buffer));
fs.writeFileSync(path.join(dir, 'canopy.bin'), Buffer.from(canopy.buffer));

// ---------- Gebäude auf das Geländenetz setzen und speichern ----------
const meshH = (x, y) => {
  const fx = Math.min(Math.max((x - x0) / cell, 0), nx - 1.001), fy = Math.min(Math.max((y - y0) / cell, 0), ny - 1.001);
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  return grid[j * nx + i] * (1 - u) * (1 - v) + grid[j * nx + i + 1] * u * (1 - v) + grid[(j + 1) * nx + i] * (1 - u) * v + grid[(j + 1) * nx + i + 1] * u * v;
};
// Versatz je Gebäude: Wand-Unterkanten (3 m unter Boden) relativ zum niedrigsten Geländepunkt unter dem Gebäude
const P = buildings.pos, nV = P.length / 3;
const outPos = new Uint16Array(nV * 3), outCol = Uint8Array.from(buildings.col);
const QX = 0.2, QZ = 0.05;
for (const [from, to, open] of buildings.ranges) {
  let minZ = Infinity, minTerrain = Infinity;
  for (let v = from; v < to; v++) minZ = Math.min(minZ, P[v * 3 + 2]);
  for (let v = from; v < to; v++) if (P[v * 3 + 2] <= minZ + 0.5) minTerrain = Math.min(minTerrain, meshH(P[v * 3], P[v * 3 + 1]));
  const off = open ? 0 : (minTerrain - 3) - minZ;  // offene Bauwerke behalten ihre echte Höhe
  for (let v = from; v < to; v++) {
    outPos[v * 3] = Math.max(0, Math.round((P[v * 3] - x0) / QX)); outPos[v * 3 + 1] = Math.max(0, Math.round((P[v * 3 + 1] - y0) / QX));
    outPos[v * 3 + 2] = Math.round((P[v * 3 + 2] + off) / QZ);
  }
}
fs.writeFileSync(path.join(dir, 'buildings.bin'), Buffer.concat([Buffer.from(outPos.buffer), Buffer.from(outCol.buffer)]));

// ---------- Bäume speichern ----------
const sharpSorted = trees.map(t => t[4]).filter(Number.isFinite).sort((a, b) => a - b);
const sharpCut = Math.max(0.12, Math.min(0.4, sharpSorted[Math.floor(sharpSorted.length * 0.45)] ?? 0.2));
console.log(`Kronenspitzen p10/p45/p90: ${[0.1, 0.45, 0.9].map(q => (sharpSorted[Math.floor(sharpSorted.length * q)] ?? 0).toFixed(2)).join(" / ")}`);
const tb = Buffer.alloc(trees.length * 7);
trees.forEach(([x, y, h, r, sharp], k) => {
  tb.writeUInt16LE(Math.round((x - x0) / 0.25), k * 7); tb.writeUInt16LE(Math.round((y - y0) / 0.25), k * 7 + 2);
  tb.writeUInt8(Math.min(255, Math.round(h * 4)), k * 7 + 4); tb.writeUInt8(Math.min(255, Math.round(r * 10)), k * 7 + 5);
  tb.writeUInt8(sharp > sharpCut ? 1 : 0, k * 7 + 6);
});
fs.writeFileSync(path.join(dir, 'trees.bin'), tb);

route.world = {
  buildings: { vertices: nV, triangles: nV / 3, count: buildings.count, qxy: QX, qz: QZ, palette: Object.values(PALETTE) },
  trees: { count: trees.length, qxy: 0.25 },
  canopy: true,
};
route.towers = towers;
route.attribution = 'Geodaten: Geobasis NRW (DGM1, nDOM, 3D-Gebäudemodell LoD2) – Datenlizenz Deutschland Zero 2.0';
fs.writeFileSync(path.join(dir, 'route.json'), JSON.stringify(route));
const dgmShare = gridFromDgm.reduce((a, b) => a + b, 0) / gridFromDgm.length;
console.log(`Gelände aus DGM1: ${(dgmShare * 100).toFixed(0)} % · Straße: ${route.ascent} Hm, ${route.minGrade}…${route.maxGrade} %`);
console.log(`Bäume verworfen (Straße/Weg/Wasser/Acker): ${skipped}`);
console.log(`Gebäude: ${buildings.count} (${(nV / 3).toFixed(0)} Dreiecke, ${(outPos.byteLength / 1e6).toFixed(1)} MB) · Bäume: ${trees.length} (Nadel-Grenze ${sharpCut.toFixed(2)})`);
