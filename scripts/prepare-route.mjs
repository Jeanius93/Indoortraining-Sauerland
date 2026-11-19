// Baut aus einer GPX-Datei ein Strecken-Paket für die 3D-Welt:
//   route.json  – geglättete Straße alle 5 m (lokale Meter-Koordinaten + Höhe aus Geländemodell)
//   terrain.bin – Höhenraster (Int16, Dezimeter) mit eingeschnittener Straße
// Höhendaten: AWS Terrain Tiles (Terrarium, Mapzen/Tilezen – SRTM, EU-DEM u. a.).
// Aufruf: node scripts/prepare-route.mjs routes/hausrunde.gpx public/routes/hausrunde
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const [, , input, outDir] = process.argv;
const ZOOM = 13, CELL = 20, MARGIN = 1200, STEP = 5;
const CACHE = path.join(path.dirname(new URL(import.meta.url).pathname), '.cache');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const xml = fs.readFileSync(input, 'utf8');
const name = xml.match(/<name>([^<]*)<\/name>/)?.[1] ?? 'Strecke';
const gps = [...xml.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">\s*<ele>([-\d.]+)/g)].map(m => [+m[1], +m[2], +m[3]]);

// Lokales Koordinatensystem (Meter, x=Ost, y=Nord) um den Mittelpunkt
const rad = Math.PI / 180, R = 6378137;
const lat0 = (Math.min(...gps.map(p => p[0])) + Math.max(...gps.map(p => p[0]))) / 2;
const lon0 = (Math.min(...gps.map(p => p[1])) + Math.max(...gps.map(p => p[1]))) / 2;
const kx = R * Math.cos(lat0 * rad) * rad, ky = R * rad;
const toXY = ([lat, lon]) => [(lon - lon0) * kx, (lat - lat0) * ky];
const toLL = (x, y) => [lat0 + y / ky, lon0 + x / kx];

// 1) Gleichmäßig neu abtasten
function resample(pts, step) {
  const out = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const seg = Math.hypot(bx - ax, by - ay); let t = step - carry;
    while (t <= seg) { out.push([ax + (bx - ax) * t / seg, ay + (by - ay) * t / seg]); t += step; }
    carry = seg - (t - step);
  }
  return out;
}
const smooth = (arr, win) => arr.map((_, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - win); j <= Math.min(arr.length - 1, i + win); j++) { s += arr[j]; n++; }
  return s / n;
});
let xy = resample(gps.map(toXY), 2);
// Aufgezeichnete Höhe (Barometer) je Punkt per nächstem GPS-Punkt zuordnen – entlang der Spur
const gxy = gps.map(toXY);
// GPS-Zittern rausglätten (±8 m), dann auf 5 m
const sx = smooth(xy.map(p => p[0]), 4), sy = smooth(xy.map(p => p[1]), 4);
xy = resample(sx.map((x, i) => [x, sy[i]]), STEP);

// 2) Höhenkacheln laden
const lon2tile = lon => (lon + 180) / 360 * 2 ** ZOOM;
const lat2tile = lat => (1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * 2 ** ZOOM;
const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
const bx0 = Math.floor((Math.min(...xs) - MARGIN) / CELL) * CELL, by0 = Math.floor((Math.min(...ys) - MARGIN) / CELL) * CELL;
const nx = Math.ceil((Math.max(...xs) + MARGIN - bx0) / CELL) + 1, ny = Math.ceil((Math.max(...ys) + MARGIN - by0) / CELL) + 1;
const [latS, lonW] = toLL(bx0, by0), [latN, lonE] = toLL(bx0 + (nx - 1) * CELL, by0 + (ny - 1) * CELL);
const tx0 = Math.floor(lon2tile(lonW)), tx1 = Math.floor(lon2tile(lonE));
const ty0 = Math.floor(lat2tile(latN)), ty1 = Math.floor(lat2tile(latS));
const tiles = new Map();
for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
  const file = path.join(CACHE, `${ZOOM}_${tx}_${ty}.png`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`);
    if (!res.ok) throw new Error(`Kachel ${tx}/${ty}: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  tiles.set(`${tx}_${ty}`, PNG.sync.read(fs.readFileSync(file)));
}
console.log(`${tiles.size} Höhenkacheln (z${ZOOM})`);
function pix(gx, gy) {
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256), t = tiles.get(`${tx}_${ty}`);
  const i = ((gy - ty * 256) * 256 + (gx - tx * 256)) * 4, d = t.data;
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
}
function demAt(x, y) {
  const [lat, lon] = toLL(x, y);
  const fx = lon2tile(lon) * 256 - 0.5, fy = lat2tile(lat) * 256 - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
  return pix(ix, iy) * (1 - u) * (1 - v) + pix(ix + 1, iy) * u * (1 - v) + pix(ix, iy + 1) * (1 - u) * v + pix(ix + 1, iy + 1) * u * v;
}

// 3) Straßenhöhe: aufgezeichnete Höhe (auf der Straße gemessen) ist an Talstraßen genauer als das
//    grobe Geländemodell. Sie wird über ~150 m geglättet und per Median-Versatz ans Gelände angepasst.
// Zuordnung über den relativen Streckenanteil (robust gegen Pausen/Schleifen)
const gd = [0];
for (let k = 1; k < gxy.length; k++) gd.push(gd[k - 1] + Math.hypot(gxy[k][0] - gxy[k - 1][0], gxy[k][1] - gxy[k - 1][1]));
let gi = 0;
const recH = xy.map((_, k) => {
  const d = k / (xy.length - 1) * gd.at(-1);
  while (gi < gd.length - 2 && gd[gi + 1] < d) gi++;
  const t = Math.min(1, Math.max(0, (d - gd[gi]) / (gd[gi + 1] - gd[gi] || 1)));
  return gps[gi][2] + (gps[gi + 1][2] - gps[gi][2]) * t;
});
const diffs = xy.map(([x, y], k) => demAt(x, y) - recH[k]).sort((a, b) => a - b);
const offset = diffs[diffs.length >> 1];
console.log(`Versatz Gelände − Aufzeichnung: ${offset.toFixed(1)} m`);
const roadH = smooth(smooth(recH.map(h => h + offset), 8), 8);

// 4) Höhenraster + Straße einschneiden
const grid = new Float32Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) grid[j * nx + i] = demAt(bx0 + i * CELL, by0 + j * CELL);
const HB = 60, hash = new Map();
xy.forEach(([x, y], k) => {
  const key = `${Math.floor(x / HB)}_${Math.floor(y / HB)}`;
  (hash.get(key) ?? hash.set(key, []).get(key)).push(k);
});
const FLAT = 14, BLEND = 55;
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const x = bx0 + i * CELL, y = by0 + j * CELL, cx = Math.floor(x / HB), cy = Math.floor(y / HB);
  let best = Infinity, bk = -1;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
    for (const k of hash.get(`${cx + a}_${cy + b}`) ?? []) {
      const d = Math.hypot(xy[k][0] - x, xy[k][1] - y); if (d < best) { best = d; bk = k; }
    }
  if (bk < 0 || best > BLEND) continue;
  const target = roadH[bk] - 0.6, o = grid[j * nx + i];
  const t = best <= FLAT ? 0 : (best - FLAT) / (BLEND - FLAT), s = t * t * (3 - 2 * t);
  grid[j * nx + i] = target + (o - target) * s;
}
const i16 = new Int16Array(nx * ny);
grid.forEach((h, k) => { i16[k] = Math.round(h * 10); });
fs.writeFileSync(path.join(outDir, 'terrain.bin'), Buffer.from(i16.buffer));

// 5) Statistik + route.json
let up = 0, maxG = 0, minG = 0;
for (let k = 1; k < roadH.length; k++) up += Math.max(0, roadH[k] - roadH[k - 1]);
for (let k = 4; k < roadH.length; k++) { const g = (roadH[k] - roadH[k - 4]) / (4 * STEP) * 100; maxG = Math.max(maxG, g); minG = Math.min(minG, g); }
const r1 = v => Math.round(v * 10) / 10;
const route = {
  name, step: STEP, origin: { lat: lat0, lon: lon0 },
  length: (xy.length - 1) * STEP, ascent: Math.round(up), maxGrade: r1(maxG), minGrade: r1(minG),
  x: xy.map(p => r1(p[0])), y: xy.map(p => r1(p[1])), h: roadH.map(r1),
  terrain: { x0: bx0, y0: by0, cell: CELL, nx, ny, scale: 0.1 },
  attribution: 'Höhendaten: Mapzen Terrain Tiles (AWS Open Data; SRTM, EU-DEM u. a.)',
};
fs.writeFileSync(path.join(outDir, 'route.json'), JSON.stringify(route));
console.log(`${name}: ${(route.length / 1000).toFixed(2)} km, ${route.ascent} Hm, Steigung ${route.minGrade}…${route.maxGrade} %, Raster ${nx}×${ny}`);
