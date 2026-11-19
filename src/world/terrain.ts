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
  // Böschung: von der Fahrbahnkante 4 m nach außen und 3 m nach unten – verdeckt Spalten zum gröberen Gelände
  const sp = new Float32Array(n * 12), sidx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2);
    let dx = x[b] - x[a], dy = y[b] - y[a]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const hh = h[k] + 0.1;
    for (const [side, off] of [[1, 0], [-1, 6]] as const) {
      const ex = -dy * side, ey = dx * side;
      sp.set([x[k] + ex * width / 2, hh, -(y[k] + ey * width / 2), x[k] + ex * (width / 2 + 4), hh - 3, -(y[k] + ey * (width / 2 + 4))], k * 12 + off);
    }
  }
  for (let k = 0; k < n - 1; k++) for (const off of [0, 2]) { const a = k * 4 + off; sidx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setIndex(sidx); sg.computeVertexNormals();
  const skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: '#7f9458', side: THREE.DoubleSide }));
  skirt.receiveShadow = true;
  const m = new THREE.MeshLambertMaterial({ map: roadTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true;
  const group = new THREE.Group(); group.add(mesh, skirt);
  return group;
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

/** Bäume aus dem nDOM: x,y (Uint16, 0,25 m), Höhe (Uint8, 0,25 m), Kronenradius (Uint8, 0,1 m), Typ (1 = Nadelbaum).
 *  In 1-km-Kacheln aufgeteilt: nah detailliert, fern vereinfacht, hinter dem Dunst ausgeblendet. */
export class TreeField {
  readonly group = new THREE.Group();
  count = 0;
  private chunks: { center: THREE.Vector3; near: THREE.Object3D; far: THREE.Object3D }[] = [];
  constructor(hf: Heightfield, data: Uint8Array, routeDist: (x: number, y: number) => number, quality: 'low' | 'high', private nearDist: number, private farDist: number) {
    const { x0, y0 } = hf.t, dv = new DataView(data.buffer, data.byteOffset, data.byteLength), n = data.byteLength / 7;
    const C = 1000, buckets = new Map<string, { spruce: THREE.Matrix4[]; leaf: THREE.Matrix4[]; cx: number; cy: number }>();
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
      const ci = Math.floor(x / C), cj = Math.floor(y / C), key = `${ci}_${cj}`;
      const b = buckets.get(key) ?? buckets.set(key, { spruce: [], leaf: [], cx: (ci + 0.5) * C, cy: (cj + 0.5) * C }).get(key)!;
      (conifer ? b.spruce : b.leaf).push(m.compose(p, q, s).clone());
      this.count++;
    }
    const geo = treeGeometries();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const b of buckets.values()) {
      const near = new THREE.Group(), far = new THREE.Group();
      const tints = [b.spruce.map(() => 1 - r() * 0.15), b.leaf.map(() => 1 - r() * 0.3)];
      ([[geo.spruceNear, geo.spruceFar, b.spruce, tints[0]], [geo.leafNear, geo.leafFar, b.leaf, tints[1]]] as const).forEach(([gn, gf, list, tint]) => {
        if (!list.length) return;
        for (const [g, target] of [[gn, near], [gf, far]] as const) {
          const im = new THREE.InstancedMesh(g, mat, list.length), c = new THREE.Color();
          list.forEach((mm, i) => { im.setMatrixAt(i, mm); c.setScalar(tint[i]); im.setColorAt(i, c); });
          im.computeBoundingSphere(); target.add(im);
        }
      });
      const center = new THREE.Vector3(b.cx, hf.at(b.cx, b.cy), -b.cy);
      near.visible = false; far.visible = false;
      this.group.add(near, far);
      this.chunks.push({ center, near, far });
    }
  }
  /** Detailstufe je Kachel nach Abstand zur Kamera wählen */
  update(cam: THREE.Vector3) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z) - 710; // Abstand zum Kachelrand (grob)
      c.near.visible = d < this.nearDist;
      c.far.visible = !c.near.visible && d < this.farDist;
    }
  }
}

function treeGeometries() {
  // Höhe 1 = Baumhöhe. Nah: Stamm + zwei Kegel bzw. Krone; fern: ein Körper ohne Stamm
  const trunk = new THREE.CylinderGeometry(0.018, 0.028, 0.3, 4, 1, true).translate(0, 0.15, 0);
  return {
    spruceNear: mergeColored([
      [trunk, '#4d3a2a'],
      [new THREE.ConeGeometry(0.2, 0.55, 7, 1, true).translate(0, 0.42, 0), '#2c4a2e'],
      [new THREE.ConeGeometry(0.15, 0.45, 7, 1, true).translate(0, 0.75, 0), '#33553a'],
    ]),
    spruceFar: mergeColored([[new THREE.ConeGeometry(0.19, 0.85, 5, 1, true).translate(0, 0.575, 0), '#2e4e31']]),
    leafNear: mergeColored([
      [trunk, '#56432f'],
      [new THREE.IcosahedronGeometry(0.3, 0).scale(1, 1.15 * 1.6, 1).translate(0, 0.62, 0), '#557a35'],
    ]),
    leafFar: mergeColored([[new THREE.OctahedronGeometry(0.3, 0).scale(1, 1.6, 1).translate(0, 0.62, 0), '#527633']]),
  };
}

function treeMeshes(spruce: THREE.Matrix4[], leaf: THREE.Matrix4[], r: () => number) {
  const geo = treeGeometries();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const group = new THREE.Group();
  for (const [g, list, tint] of [[geo.spruceNear, spruce, 0.15], [geo.leafNear, leaf, 0.3]] as const) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(g, mat, list.length);
    const c = new THREE.Color();
    list.forEach((mm, i) => { im.setMatrixAt(i, mm); c.setScalar(1 - r() * tint); im.setColorAt(i, c); });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return { group, count: spruce.length + leaf.length };
}

/** Gebäude aus LoD2 in 1-km-Kacheln (Ausblenden hinter dem Dunst) */
export class BuildingField {
  readonly group = new THREE.Group();
  private chunks: { center: THREE.Vector3; mesh: THREE.Mesh }[] = [];
  constructor(hf: Heightfield, b: { pos: Uint16Array; col: Uint8Array }, info: { qxy: number; qz: number; palette: string[] }, private farDist: number) {
    const { x0, y0 } = hf.t, nT = b.pos.length / 9, C = 1000;
    const pal = info.palette.map(c => new THREE.Color(c));
    const byChunk = new Map<string, number[]>();
    for (let t = 0; t < nT; t++) {
      const cx = x0 + (b.pos[t * 9] + b.pos[t * 9 + 3] + b.pos[t * 9 + 6]) / 3 * info.qxy, cy = y0 + (b.pos[t * 9 + 1] + b.pos[t * 9 + 4] + b.pos[t * 9 + 7]) / 3 * info.qxy;
      const key = `${Math.floor(cx / C)}_${Math.floor(cy / C)}`;
      (byChunk.get(key) ?? byChunk.set(key, []).get(key)!).push(t);
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (const [key, tris] of byChunk) {
      const pos = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9);
      tris.forEach((t, k) => {
        const c = pal[b.col[t]] ?? pal[0];
        for (let v = 0; v < 3; v++) {
          const src = t * 9 + v * 3, dst = k * 9 + v * 3;
          pos[dst] = x0 + b.pos[src] * info.qxy; pos[dst + 1] = b.pos[src + 2] * info.qz; pos[dst + 2] = -(y0 + b.pos[src + 1] * info.qxy);
          col[dst] = c.r; col[dst + 1] = c.g; col[dst + 2] = c.b;
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true;
      const [ci, cj] = key.split('_').map(Number);
      this.chunks.push({ center: new THREE.Vector3((ci + 0.5) * C, 0, -(cj + 0.5) * C), mesh });
      this.group.add(mesh);
    }
  }
  get count() { return this.chunks.length; }
  update(cam: THREE.Vector3) {
    for (const c of this.chunks) c.mesh.visible = Math.hypot(c.center.x - cam.x, c.center.z - cam.z) - 710 < this.farDist;
  }
}

// ---------- Gelände mit Nutzungskarte (ALKIS) ----------
// Farben je Nutzungsklasse (Sommer). Acker: je Feld wechselnde Kultur + Bewirtschaftungsstreifen.
const LU_COLORS: Record<number, string> = {
  0: '#86a556', 1: '#8fb35b', 2: '#c2ad66', 3: '#45602f', 4: '#33492b', 5: '#3e5631', 6: '#a3a68a', 7: '#9b9993',
  8: '#4d7390', 9: '#4b4c4f', 10: '#9a8e76', 11: '#6f6359', 12: '#aaa86e', 13: '#79ad5a', 14: '#8eab61', 15: '#a19f99',
};
const CROPS = ['#c9b15f', '#8a6c4b', '#9fc05e', '#b9b46a', '#d1bf78'].map(c => new THREE.Color(c));

export function buildLanduseTerrain(hf: Heightfield, lu: Uint8Array, info: { px: number; w: number; h: number }, routeDist: (x: number, y: number) => number, quality: 'low' | 'high', raw?: Int16Array) {
  const { x0, y0, cell, nx, ny } = hf.t;
  const group = new THREE.Group();
  const CH = Math.round(1000 / cell); // Zellen je Kachel (1 km)
  const stride = quality === 'low' && cell < 20 ? 2 : 1; // Handy: jeden zweiten Rasterpunkt
  const pal = new Map(Object.entries(LU_COLORS).map(([k, v]) => [Number(k), new THREE.Color(v)]));
  const base = pal.get(0)!;
  // Liegt ein Pixel im Ort? (Siedlung/Gewerbe/Platz im Umkreis von ~20 m)
  const townAt = (li: number, lj: number) => {
    for (const [a, b] of [[10, 0], [-10, 0], [0, 10], [0, -10], [7, 7], [-7, -7], [7, -7], [-7, 7]]) {
      const i = li + a, j = lj + b; if (i < 0 || j < 0 || i >= info.w || j >= info.h) continue;
      const c = lu[j * info.w + i]; if (c === 6 || c === 7) return true;
    }
    return false;
  };
  for (let cj = 0; cj < ny - 1; cj += CH) for (let ci = 0; ci < nx - 1; ci += CH) {
    const ci1 = Math.min(ci + CH, nx - 1), cj1 = Math.min(cj + CH, ny - 1);
    const ni = Math.floor((ci1 - ci) / stride) + 1, nj = Math.floor((cj1 - cj) / stride) + 1;
    const cx0 = x0 + ci * cell, cy0 = y0 + cj * cell, wM = (ni - 1) * cell * stride, hM = (nj - 1) * cell * stride;
    // Texturauflösung: nahe der Strecke 2 m, sonst 4 m (Handy überall 4 m)
    const near = routeDist(cx0 + wM / 2, cy0 + hM / 2) < 900;
    const mpp = quality === 'high' && near ? 2 : 4;
    const tw = Math.ceil(wM / mpp), th = Math.ceil(hM / mpp);
    const tex = new Uint8Array(tw * th * 4), c = new THREE.Color();
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const x = cx0 + (tx + 0.5) * mpp, y = cy0 + (ty + 0.5) * mpp;
      const li = Math.floor((x - x0) / info.px), lj = Math.floor((y - y0) / info.px);
      let cls = li >= 0 && lj >= 0 && li < info.w && lj < info.h ? lu[lj * info.w + li] : 0;
      // Straßenfläche direkt neben unserer Fahrbahn: in Orten Gehweg (gepflastert), sonst Bankett (Gras)
      if ((cls === 9 || cls === 10) && routeDist(x, y) < 12) cls = townAt(li, lj) ? 15 : 14;
      if (cls === 2) {
        // Feld: Kultur wechselt großräumig, Streifen in wechselnder Richtung
        const crop = CROPS[Math.floor(fbm(x / 260 + 7, y / 260 - 3, 2) * CROPS.length * 1.3) % CROPS.length];
        const ang = fbm(x / 400 - 11, y / 400 + 5, 2) * Math.PI * 2;
        const stripe = Math.sin((x * Math.cos(ang) + y * Math.sin(ang)) * Math.PI / 4) * 0.06;
        c.copy(crop).multiplyScalar(0.95 + stripe);
      } else {
        c.copy(pal.get(cls) ?? base);
        if (cls === 1 || cls === 0 || cls === 13 || cls === 14) c.lerp(pal.get(12)!, fbm(x / 90, y / 90, 3) * 0.35); // Wiese: Flecken
        if (cls === 6) c.lerp(pal.get(13)!, fbm(x / 12, y / 12, 2) * 0.6);                                   // Siedlung: Gärten
        if (cls >= 3 && cls <= 5) c.multiplyScalar(0.85 + fbm(x / 25, y / 25, 2) * 0.3);                      // Waldboden
      }
      c.multiplyScalar(0.94 + fbm(x / 7, y / 7, 2) * 0.12);
      const o = (ty * tw + tx) * 4;
      tex[o] = Math.min(255, c.r * 255); tex[o + 1] = Math.min(255, c.g * 255); tex[o + 2] = Math.min(255, c.b * 255); tex[o + 3] = 255;
    }
    const t = new THREE.DataTexture(tex, tw, th, THREE.RGBAFormat);
    t.colorSpace = THREE.LinearSRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;

    // Geometrie der Kachel; Vertexfarbe = Felsen an steilen Hängen
    const pos = new Float32Array(ni * nj * 3), uv = new Float32Array(ni * nj * 2), col = new Float32Array(ni * nj * 3), nor = new Float32Array(ni * nj * 3);
    const rh = (i: number, j: number) => { i = Math.max(0, Math.min(nx - 1, i)); j = Math.max(0, Math.min(ny - 1, j)); return raw ? raw[j * nx + i] * hf.t.scale : hf.raw(i, j); };
    const rock = new THREE.Color('#8a8475'), white = new THREE.Color(1, 1, 1);
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const gi = ci + i * stride, gj = cj + j * stride, k = j * ni + i, x = x0 + gi * cell, y = y0 + gj * cell;
      pos[k * 3] = x; pos[k * 3 + 1] = hf.raw(gi, gj); pos[k * 3 + 2] = -y;
      uv[k * 2] = (i * cell * stride) / (tw * mpp); uv[k * 2 + 1] = (j * cell * stride) / (th * mpp);
      // Normale aus dem glatten Gelände (ohne Straßeneinschnitt)
      const hx = rh(gi + stride, gj) - rh(gi - stride, gj), hy = rh(gi, gj + stride) - rh(gi, gj - stride), span = 2 * cell * stride;
      const slope = Math.hypot(hx, hy) / span;
      const nl = Math.hypot(hx, span, hy);
      nor[k * 3] = -hx / nl; nor[k * 3 + 1] = span / nl; nor[k * 3 + 2] = hy / nl;
      // Fels nur an sehr steilen Hängen abseits der Straße (Straßenböschungen sind im DGM1 steil, aber bewachsen)
      const rockShare = routeDist(x, y) > 30 ? Math.min(0.6, Math.max(0, (slope - 1.0) * 1.2)) : 0;
      c.copy(white).lerp(rock, rockShare);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    const idx: number[] = [];
    for (let j = 0; j < nj - 1; j++) for (let i = 0; i < ni - 1; i++) { const a = j * ni + i, b = a + 1, d = a + ni, e = d + 1; idx.push(a, b, e, a, e, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: t, vertexColors: true }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
