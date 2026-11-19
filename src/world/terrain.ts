// Gelände aus dem Höhenraster, Straße als Band, Wald als Instanzen.
// Koordinaten in Three.js: X = Ost, Y = oben, Z = −Nord
import * as THREE from 'three';
import type { Route } from '../route';
import { fbm, rng } from './noise';

export class Heightfield {
  constructor(private hts: Int16Array, readonly t: Route['data']['terrain']) {}
  at(x: number, y: number) {
    const { x0, y0, cell, nx, ny, scale } = this.t;
    const fx = Math.min(Math.max((x - x0) / cell, 0), nx - 1.001), fy = Math.min(Math.max((y - y0) / cell, 0), ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, H = this.hts;
    const a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i], d = H[(j + 1) * nx + i + 1];
    return (a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v) * scale;
  }
  raw(i: number, j: number) { return this.hts[j * this.t.nx + i] * this.t.scale; }
}

/** Wald-Anteil 0…1 an einer Stelle (Sauerland: viel Wald an den Hängen, Wiesen in den Tälern) */
export function forestAt(x: number, y: number, slope: number) {
  const n = fbm(x / 900 + 31.7, y / 900 - 12.3, 4);
  return n + Math.min(slope, 0.5) * 0.7 - 0.55;
}

export function buildTerrain(hf: Heightfield, routeDist: (x: number, y: number) => number, canopy?: Uint8Array) {
  const { x0, y0, cell, nx, ny } = hf.t;
  const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3);
  const meadow = new THREE.Color('#7f9e4f'), meadow2 = new THREE.Color('#a3ae5c'), forest = new THREE.Color('#2f4a2a');
  const rock = new THREE.Color('#7a7466'), verge = new THREE.Color('#8fa85a'), c = new THREE.Color();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * cell, y = y0 + j * cell, h = hf.raw(i, j);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -y;
    const hx = hf.raw(Math.min(i + 1, nx - 1), j) - hf.raw(Math.max(i - 1, 0), j);
    const hy = hf.raw(i, Math.min(j + 1, ny - 1)) - hf.raw(i, Math.max(j - 1, 0));
    const slope = Math.hypot(hx, hy) / (2 * cell);
    const rd = routeDist(x, y);
    c.copy(meadow).lerp(meadow2, fbm(x / 140, y / 140, 3));
    // Waldboden: echtes Kronendach (nDOM) oder – ohne Daten – nachempfunden
    const forestShare = canopy ? Math.min(1, canopy[k] / 255 * 1.4) : (rd > 25 ? Math.min(1, Math.max(0, forestAt(x, y, slope) * 6)) : 0);
    c.lerp(forest, forestShare);
    if (slope > 0.6) c.lerp(rock, Math.min(1, (slope - 0.6) * 2));
    if (rd < 30) c.lerp(verge, 1 - rd / 30);
    const shade = 0.9 + fbm(x / 35, y / 35, 2) * 0.2;
    col[k * 3] = c.r * shade; col[k * 3 + 1] = c.g * shade; col[k * 3 + 2] = c.b * shade;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c2 = a + nx, d = c2 + 1;
    idx[p++] = a; idx[p++] = b; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = c2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function roadTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 512;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#4a4b4e'; g.fillRect(0, 0, 128, 512);
  const r = rng(7);
  for (let i = 0; i < 5000; i++) { const v = 55 + r() * 40; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(r() * 128, r() * 512, 1.5, 1.5); }
  g.fillStyle = '#e8e6df'; g.fillRect(4, 0, 4, 512); g.fillRect(120, 0, 4, 512); // Randlinien
  g.fillRect(62, 0, 4, 300);                                                      // Mittellinie gestrichelt
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildRoad(route: Route, width = 5.6) {
  const { x, y, h, step } = route.data, n = x.length;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2);
    let dx = x[b] - x[a], dy = y[b] - y[a]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const px = -dy * width / 2, py = dx * width / 2, hh = h[k] + 0.12;
    pos.set([x[k] + px, hh, -(y[k] + py), x[k] - px, hh, -(y[k] - py)], k * 6);
    const v = k * step / 24;
    uv.set([0, v, 1, v], k * 4);
  }
  const idx: number[] = [];
  for (let k = 0; k < n - 1; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshLambertMaterial({ map: roadTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true;
  return mesh;
}

export function buildTrees(hf: Heightfield, routeDist: (x: number, y: number) => number, route: Route, quality: 'low' | 'high') {
  const spacing = quality === 'high' ? 15 : 22, reach = quality === 'high' ? 900 : 550;
  const xs = route.data.x, ys = route.data.y;
  const minX = Math.min(...xs) - reach, maxX = Math.max(...xs) + reach, minY = Math.min(...ys) - reach, maxY = Math.max(...ys) + reach;
  const r = rng(42), spruce: THREE.Matrix4[] = [], leaf: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let y = minY; y < maxY; y += spacing) for (let x = minX; x < maxX; x += spacing) {
    const tx = x + (r() - 0.5) * spacing * 0.9, ty = y + (r() - 0.5) * spacing * 0.9;
    const rd = routeDist(tx, ty);
    if (rd < 9 || rd > reach) continue;
    const slope = Math.abs(hf.at(tx + 10, ty) - hf.at(tx - 10, ty)) / 20 + Math.abs(hf.at(tx, ty + 10) - hf.at(tx, ty - 10)) / 20;
    const f = forestAt(tx, ty, slope);
    const solitary = r() < 0.012; // einzelne Bäume auf Wiesen
    if (f < 0.02 && !solitary) continue;
    if (!solitary && r() > Math.min(1, f * 5)) continue;
    const isSpruce = fbm(tx / 400, ty / 400, 2) + (r() - 0.5) * 0.3 > 0.45;
    const height = (isSpruce ? 17 : 13) * (0.7 + r() * 0.6);
    p.set(tx, hf.at(tx, ty) - 0.3, -ty);
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    s.set(height * (0.9 + r() * 0.2), height, height * (0.9 + r() * 0.2));
    (isSpruce ? spruce : leaf).push(m.compose(p, q, s).clone());
  }
  return treeMeshes(spruce, leaf, r);
}

function mergeColored(parts: [THREE.BufferGeometry, string][]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const [g0, color] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals();
    const c = new THREE.Color(color);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** Abstandsfeld zur Strecke (Chamfer-Distanztransformation auf 10-m-Raster) */
export function makeRouteDistance(route: Route, t: Route['data']['terrain'], cell = 10) {
  const w = Math.ceil((t.nx - 1) * t.cell / cell) + 1, hgt = Math.ceil((t.ny - 1) * t.cell / cell) + 1;
  const D = new Float32Array(w * hgt).fill(1e9);
  const { x, y } = route.data;
  for (let k = 0; k < x.length; k++) {
    const i = Math.round((x[k] - t.x0) / cell), j = Math.round((y[k] - t.y0) / cell);
    if (i >= 0 && j >= 0 && i < w && j < hgt) D[j * w + i] = 0;
  }
  const a = cell, b = cell * Math.SQRT2;
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i; let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + a);
    if (j > 0) { v = Math.min(v, D[k - w] + a); if (i > 0) v = Math.min(v, D[k - w - 1] + b); if (i < w - 1) v = Math.min(v, D[k - w + 1] + b); }
    D[k] = v;
  }
  for (let j = hgt - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i; let v = D[k];
    if (i < w - 1) v = Math.min(v, D[k + 1] + a);
    if (j < hgt - 1) { v = Math.min(v, D[k + w] + a); if (i < w - 1) v = Math.min(v, D[k + w + 1] + b); if (i > 0) v = Math.min(v, D[k + w - 1] + b); }
    D[k] = v;
  }
  return (px: number, py: number) => {
    const fx = (px - t.x0) / cell, fy = (py - t.y0) / cell;
    if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= hgt - 1) return 1e9;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * w + i;
    return D[k] * (1 - u) * (1 - v) + D[k + 1] * u * (1 - v) + D[k + w] * (1 - u) * v + D[k + w + 1] * u * v;
  };
}

/** Bäume aus dem nDOM: x,y (Uint16, 0,25 m), Höhe (Uint8, 0,25 m), Kronenradius (Uint8, 0,1 m), Typ (1 = Nadelbaum) */
export function buildRealTrees(hf: Heightfield, data: Uint8Array, routeDist: (x: number, y: number) => number, quality: 'low' | 'high') {
  const { x0, y0 } = hf.t, dv = new DataView(data.buffer, data.byteOffset, data.byteLength), n = data.byteLength / 7;
  const spruce: THREE.Matrix4[] = [], leaf: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const r = rng(3);
  for (let i = 0; i < n; i++) {
    const x = x0 + dv.getUint16(i * 7, true) * 0.25, y = y0 + dv.getUint16(i * 7 + 2, true) * 0.25;
    const h = dv.getUint8(i * 7 + 4) / 4, crown = dv.getUint8(i * 7 + 5) / 10, conifer = dv.getUint8(i * 7 + 6) === 1;
    if (quality === 'low' && routeDist(x, y) > 250 && (i & 1)) continue; // Handy: in der Ferne ausdünnen
    p.set(x, hf.at(x, y) - 0.3, -y);
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    const sxz = conifer ? Math.min(crown / 0.2, h * 0.32 / 0.2) : crown / 0.3;
    s.set(sxz, h, sxz);
    (conifer ? spruce : leaf).push(m.compose(p, q, s).clone());
  }
  return treeMeshes(spruce, leaf, r);
}

function treeMeshes(spruce: THREE.Matrix4[], leaf: THREE.Matrix4[], r: () => number) {
  // Fichte: zwei Kegel + Stamm, Laubbaum: Kugel-Krone + Stamm (Höhe 1 = Baumhöhe)
  const trunk = new THREE.CylinderGeometry(0.018, 0.028, 0.3, 5).translate(0, 0.15, 0);
  const spruceGeo = mergeColored([
    [trunk, '#4d3a2a'],
    [new THREE.ConeGeometry(0.2, 0.55, 7).translate(0, 0.42, 0), '#2c4a2e'],
    [new THREE.ConeGeometry(0.15, 0.45, 7).translate(0, 0.75, 0), '#33553a'],
  ]);
  const leafGeo = mergeColored([
    [trunk, '#56432f'],
    [new THREE.IcosahedronGeometry(0.3, 0).scale(1, 1.15 * 1.6, 1).translate(0, 0.62, 0), '#557a35'],
  ]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const group = new THREE.Group();
  for (const [geo, list, tint] of [[spruceGeo, spruce, 0.15], [leafGeo, leaf, 0.3]] as const) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const c = new THREE.Color();
    list.forEach((mm, i) => { im.setMatrixAt(i, mm); c.setHSL(0, 0, 1 - r() * tint); im.setColorAt(i, c); });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return { group, count: spruce.length + leaf.length };
}

/** Gebäude aus LoD2: Dreiecke (Uint16 x,y in qxy-Schritten ab x0/y0, z in qz-Schritten), Farbe je Dreieck */
export function buildBuildings(hf: Heightfield, b: { pos: Uint16Array; col: Uint8Array }, info: { qxy: number; qz: number; palette: string[] }) {
  const { x0, y0 } = hf.t, n = b.pos.length / 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const pal = info.palette.map(c => new THREE.Color(c));
  for (let v = 0; v < n; v++) {
    pos[v * 3] = x0 + b.pos[v * 3] * info.qxy;
    pos[v * 3 + 1] = b.pos[v * 3 + 2] * info.qz;
    pos[v * 3 + 2] = -(y0 + b.pos[v * 3 + 1] * info.qxy);
    const c = pal[b.col[Math.floor(v / 3)]] ?? pal[0];
    col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}
