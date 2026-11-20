// Gelände aus dem Höhenraster, Straße als Band, Wald als Instanzen.
// Koordinaten in Three.js: X = Ost, Y = oben, Z = −Nord
import * as THREE from 'three';
import type { Route } from '../route';
import { fbm, rng } from './noise';
import { ENS, paint } from './lookflag';
export { ENS };

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

type Surface = 'strasse' | 'radweg' | 'neben';

/** Belag als Canvas-Textur: Asphalt mit Körnung, je nach Art mit Markierungen */
function surfaceTexture(kind: Surface) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 1024;
  const g = cv.getContext('2d')!;
  const base = kind === 'radweg' ? [112, 82, 76] : kind === 'neben' ? [88, 89, 92] : [74, 75, 79];
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, 256, 1024);
  const r = rng(kind.length * 7);
  // Körnung + Flicken + Fahrspuren (leicht dunkler)
  for (let i = 0; i < 26000; i++) { const v = (r() - 0.5) * 34; g.fillStyle = `rgba(${base.map(c => Math.max(0, Math.min(255, c + v))).join(',')},0.9)`; g.fillRect(r() * 256, r() * 1024, 1 + r() * 1.5, 1 + r() * 1.5); }
  for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`; g.fillRect(r() * 200, r() * 1000, 30 + r() * 60, 40 + r() * 140); }
  if (kind !== 'radweg') { g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(50, 0, 34, 1024); g.fillRect(172, 0, 34, 1024); }
  if (kind === 'strasse') {
    g.fillStyle = '#e9e7e1'; g.fillRect(8, 0, 7, 1024); g.fillRect(241, 0, 7, 1024);   // Randlinien
    g.fillRect(125, 0, 6, 384);                                                       // Leitlinie (6 m Strich, 12 m Lücke)
  }
  if (kind === 'radweg') {                                                            // feine weiße Randmarkierung, Fahrrad-Piktogramm
    g.fillStyle = 'rgba(235,235,230,0.85)'; g.fillRect(6, 0, 4, 1024); g.fillRect(246, 0, 4, 1024);
    g.strokeStyle = 'rgba(240,240,236,0.9)'; g.lineWidth = 5;
    const bike = (y: number) => { g.beginPath(); g.arc(98, y, 22, 0, Math.PI * 2); g.arc(158, y, 22, 0, Math.PI * 2); g.moveTo(98, y); g.lineTo(122, y - 30); g.lineTo(158, y); g.moveTo(122, y - 30); g.lineTo(150, y - 30); g.stroke(); };
    bike(520);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface RibbonPt { x: number; y: number; h: number; hw: number }

/** Fahrbahnband mit Böschung; v-Koordinate entlang der Strecke (texRepeat Meter je Texturhöhe) */
function ribbon(pts: RibbonPt[], mat: THREE.Material, skirtMat: THREE.Material, lift: number, texRepeat: number, skirtOut = 5, skirtDown = 5, shoulder = 1.5) {
  // Fahrbahn + je Seite: flaches Bankett (shoulder m, leicht abfallend) und Böschung bis skirtDown m tiefer
  const n = pts.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), sp = new Float32Array(n * 18);
  let along = 0;
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 2)], b = pts[Math.min(n - 1, k + 2)], p = pts[k];
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (k) along += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y);
    const hh = p.h + lift, ex = -dy, ey = dx;
    pos.set([p.x + ex * p.hw, hh, -(p.y + ey * p.hw), p.x - ex * p.hw, hh, -(p.y - ey * p.hw)], k * 6);
    uv.set([0, along / texRepeat, 1, along / texRepeat], k * 4);
    for (const [side, off] of [[1, 0], [-1, 9]] as const) {
      const sx = ex * side, sy = ey * side, w1 = p.hw + shoulder, w2 = w1 + skirtOut;
      sp.set([p.x + sx * p.hw, hh - 0.02, -(p.y + sy * p.hw),
        p.x + sx * w1, hh - 0.1, -(p.y + sy * w1),
        p.x + sx * w2, hh - skirtDown, -(p.y + sy * w2)], k * 18 + off);
    }
  }
  const idx: number[] = [], sidx: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    for (const sideOff of [0, 3]) for (const seg of [0, 1]) {
      const c = k * 6 + sideOff + seg, d = c + 6;
      sidx.push(c, d, c + 1, c + 1, d, d + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setIndex(sidx); sg.computeVertexNormals();
  const road = new THREE.Mesh(g, mat), skirt = new THREE.Mesh(sg, skirtMat);
  road.receiveShadow = true; skirt.receiveShadow = true;
  return [road, skirt];
}

const roadMat = (kind: Surface, offset: number) => {
  const map = surfaceTexture(kind); map.colorSpace = THREE.NoColorSpace;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = pow(diffuseColor.rgb, vec3(2.2));'); };
  return m;
};
const skirtMaterial = (color = '#6f8350') => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });

/** Hauptstrecke: Straße (5,6 m, Markierung) bzw. Radweg (3,4 m, roter Belag) je Abschnitt */
export function buildRoad(route: Route, towns: { from: number; to: number }[] = []) {
  const { x, y, h, step } = route.data, n = x.length, surf = route.data.surface ?? [];
  const isRad = (k: number) => surf.some(s => k * step >= s.from && k * step <= s.to);
  const inTown = (k: number) => towns.some(t => k * step >= t.from && k * step <= t.to);
  const state = (k: number) => (isRad(k) ? 2 : 0) + (inTown(k) ? 1 : 0);
  const group = new THREE.Group(), grass = skirtMaterial(), paving = skirtMaterial('#a3a19b');
  const mats = { strasse: roadMat('strasse', -3), radweg: roadMat('radweg', -3) };
  let k = 0;
  while (k < n - 1) {
    const st = state(k), rad = st >= 2, town = (st & 1) === 1; let e = k;
    while (e < n - 1 && state(e + 1) === st) e++;
    const pts: RibbonPt[] = [];
    for (let i = Math.max(0, k - 1); i <= Math.min(n - 1, e + 1); i++) pts.push({ x: x[i], y: y[i], h: h[i], hw: rad ? 1.7 : (route.data.width?.[i] ?? 5.6) / 2 });
    // innerorts: gepflasterter Gehweg statt Grasbankett
    group.add(...ribbon(pts, rad ? mats.radweg : mats.strasse, town ? paving : grass, 0.12, rad ? 26 : 24, 5, 5, town ? 2.0 : 1.5));
    k = e + 1;
  }
  return group;
}

/** Abzweigende Straßen (ohne Markierung), etwas tiefer als die Hauptstrecke, damit diese an Einmündungen oben liegt */
export function buildSideRoads(roads: { w: number[]; p: number[][] }[]) {
  const group = new THREE.Group(), mat = roadMat('neben', -1), skirtMat = skirtMaterial();
  for (const r of roads) {
    if (r.p.length < 2) continue;
    group.add(...ribbon(r.p.map((p, i) => ({ x: p[0], y: p[1], h: p[2], hw: r.w[i] / 2 })), mat, skirtMat, 0.06, 24, 3, 3, 0.8));
  }
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
    const geo = ENS ? lushGeometries() : treeGeometries();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: !ENS });
    if (ENS) mat.onBeforeCompile = sh => {
      sh.uniforms.time = shaderTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float time;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07;
          transformed.x += sin(time * 1.3 + ph) * 0.02 * transformed.y * transformed.y;
          transformed.z += cos(time * 1.1 + ph) * 0.015 * transformed.y * transformed.y;`);
    };
    for (const b of buckets.values()) {
      const near = new THREE.Group(), far = new THREE.Group();
      const tints = [b.spruce.map(() => 1 - r() * 0.15), b.leaf.map(() => 1 - r() * 0.3)];
      ([[geo.spruceNear, geo.spruceFar, b.spruce, tints[0]], [geo.leafNear, geo.leafFar, b.leaf, tints[1]]] as const).forEach(([gn, gf, list, tint]) => {
        if (!list.length) return;
        for (const [g, target] of [[gn, near], [gf, far]] as const) {
          const im = new THREE.InstancedMesh(g, mat, list.length), c = new THREE.Color();
          im.castShadow = quality === 'high' && target === near;
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

function lushGeometries() {
  // Laubkrone aus vielen weichen Blattballen; Farbe von innen/unten dunkel nach außen/oben hell (Licht durchs Blattwerk)
  const shadeByHeight = (g: THREE.BufferGeometry, lo: THREE.Color, hi: THREE.Color, y0: number, y1: number) => {
    const p = g.attributes.position, col: number[] = [], c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0))); c.copy(lo).lerp(hi, t * t); col.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return g;
  };
  const blob = (x: number, y: number, z: number, r: number, seed: number) => {
    // weich gewellte Kugel (Wellung hängt von der Richtung ab → keine Stacheln)
    const g = new THREE.IcosahedronGeometry(r, 3), p = g.attributes.position, ph = seed * 1.7;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i) / r, vy = p.getY(i) / r, vz = p.getZ(i) / r;
      const f = 1 + 0.09 * Math.sin(vx * 4 + ph) * Math.sin(vy * 4 + ph * 0.7) + 0.06 * Math.sin(vz * 7 + ph * 1.3);
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.9, p.getZ(i) * f);
    }
    return g.translate(x, y, z);
  };
  const crown: THREE.BufferGeometry[] = [];
  const r = rng(77);
  for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, d = 0.06 + r() * 0.12, y = 0.5 + r() * 0.38; crown.push(blob(Math.cos(a) * d, y, Math.sin(a) * d, 0.13 + r() * 0.09, i + 1)); }
  const leaf = mergeGeos(crown.map(g => shadeByHeight(g, new THREE.Color('#1e3d12'), new THREE.Color('#86b442'), 0.38, 1.0)));
  const trunk = shadeByHeight(new THREE.CylinderGeometry(0.014, 0.03, 0.55, 7, 1, true).translate(0, 0.27, 0), new THREE.Color('#2e2118'), new THREE.Color('#5b4434'), 0, 0.55);
  const branches = [0, 2.1, 4.2].map(a => shadeByHeight(new THREE.CylinderGeometry(0.006, 0.012, 0.22, 5).rotateZ(0.7).rotateY(a).translate(Math.cos(a) * 0.06, 0.48, Math.sin(a) * 0.06), new THREE.Color('#3a2a1e'), new THREE.Color('#4d3a2b'), 0.4, 0.6));
  // Fichte: 9 hängende Astetagen, dunkel unten, frische Spitzen oben
  const tiers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8, rad = 0.2 * (1 - t * 0.85) + 0.01, h = 0.2 - t * 0.07, y = 0.16 + t * 0.74;
    const cone = new THREE.ConeGeometry(rad, h, 12, 2, true), p = cone.attributes.position;
    for (let k = 0; k < p.count; k++) { const yy = p.getY(k), rr2 = Math.hypot(p.getX(k), p.getZ(k)); p.setY(k, yy - rr2 * rr2 * 1.6); }   // hängende Äste
    tiers.push(shadeByHeight(cone.translate(0, y + h / 2, 0), new THREE.Color('#0f2410'), new THREE.Color(t > 0.85 ? '#5c8f3c' : '#2f5a2a'), y - h, y + h));
  }
  const strunk = shadeByHeight(new THREE.CylinderGeometry(0.012, 0.024, 0.5, 6, 1, true).translate(0, 0.25, 0), new THREE.Color('#2a1d14'), new THREE.Color('#4a3527'), 0, 0.5);
  return {
    spruceNear: mergeGeos([strunk, ...tiers]),
    spruceFar: shadeByHeight(new THREE.ConeGeometry(0.19, 0.86, 8, 1, true).translate(0, 0.57, 0), new THREE.Color('#122a12'), new THREE.Color('#2e5528'), 0.14, 1.0),
    leafNear: mergeGeos([trunk, ...branches, leaf]),
    leafFar: shadeByHeight(new THREE.IcosahedronGeometry(0.3, 1).scale(1, 1.25, 1).translate(0, 0.66, 0), new THREE.Color('#244a16'), new THREE.Color('#6c9c38'), 0.3, 1.0),
  };
}
function mergeGeos(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const g0 of list) {
    g0.computeVertexNormals(); const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); col.push(...g.attributes.color.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function treeGeometries() {
  // Höhe 1 = Baumhöhe. Nah: Stamm + gestufte, unten dunklere Krone; fern: ein Körper ohne Stamm
  const trunk = new THREE.CylinderGeometry(0.014, 0.026, 0.32, 5, 1, true).translate(0, 0.16, 0);
  const tiers = (n: number) => Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1), r = 0.2 * (1 - t * 0.72), hgt = 0.34 - t * 0.08, y = 0.24 + t * 0.6;
    const c = new THREE.Color('#203d26').lerp(new THREE.Color('#3b6340'), t);
    return [new THREE.ConeGeometry(r, hgt, 8, 1, true).translate(0, y + hgt / 2, 0), '#' + c.getHexString()] as [THREE.BufferGeometry, string];
  });
  const blob = (x: number, y: number, z: number, r: number, col: string) => {
    const g = new THREE.IcosahedronGeometry(r, 1); const pos = g.attributes.position, rr = rng(Math.round((x + y + z) * 1000));
    for (let i = 0; i < pos.count; i++) { const f = 0.85 + rr() * 0.3; pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f); }
    return [g.translate(x, y, z), col] as [THREE.BufferGeometry, string];
  };
  return {
    spruceNear: mergeColored([[trunk, '#4a3727'], ...tiers(4)]),
    spruceFar: mergeColored([[new THREE.ConeGeometry(0.19, 0.85, 6, 1, true).translate(0, 0.575, 0), '#2a4a2f']]),
    leafNear: mergeColored([
      [trunk, '#5a4632'],
      blob(0, 0.6, 0, 0.24, '#4c7232'), blob(0.11, 0.72, 0.05, 0.19, '#5a823a'), blob(-0.1, 0.7, -0.06, 0.2, '#466c2f'), blob(0.02, 0.85, -0.02, 0.17, '#638c40'),
    ]),
    leafFar: mergeColored([[new THREE.IcosahedronGeometry(0.3, 0).scale(1, 1.4, 1).translate(0, 0.64, 0), '#4f7533']]),
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
  constructor(hf: Heightfield, b: { pos: Uint16Array; col: Uint8Array; ext?: { u: Uint16Array; base: Uint16Array; meta: Uint8Array } }, info: { qxy: number; qz: number; palette: string[]; rgb?: boolean }, private farDist: number) {
    const tmpC = new THREE.Color();
    const { x0, y0 } = hf.t, nT = b.pos.length / 9, C = 1000;
    const pal = info.palette.map(c => new THREE.Color(c));
    const byChunk = new Map<string, number[]>();
    for (let t = 0; t < nT; t++) {
      const cx = x0 + (b.pos[t * 9] + b.pos[t * 9 + 3] + b.pos[t * 9 + 6]) / 3 * info.qxy, cy = y0 + (b.pos[t * 9 + 1] + b.pos[t * 9 + 4] + b.pos[t * 9 + 7]) / 3 * info.qxy;
      const key = `${Math.floor(cx / C)}_${Math.floor(cy / C)}`;
      (byChunk.get(key) ?? byChunk.set(key, []).get(key)!).push(t);
    }
    const mat = b.ext ? houseMaterial() : buildingMaterial();
    for (const [key, tris] of byChunk) {
      const pos = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9);
      const wu = new Float32Array(tris.length * 6), wb = new Float32Array(tris.length * 3), wm = new Float32Array(tris.length * 3);
      tris.forEach((t, k) => {
        const c = info.rgb ? tmpC.setRGB(b.col[t * 3] / 255, b.col[t * 3 + 1] / 255, b.col[t * 3 + 2] / 255, THREE.SRGBColorSpace) : (pal[b.col[t]] ?? pal[0]);
        for (let v = 0; v < 3; v++) {
          const src = t * 9 + v * 3, dst = k * 9 + v * 3;
          pos[dst] = x0 + b.pos[src] * info.qxy; pos[dst + 1] = b.pos[src + 2] * info.qz; pos[dst + 2] = -(y0 + b.pos[src + 1] * info.qxy);
          col[dst] = c.r; col[dst + 1] = c.g; col[dst + 2] = c.b;
          if (b.ext) { const vi = t * 3 + v, o = k * 3 + v; wu[o * 2] = b.ext.u[vi * 2] * 0.05; wu[o * 2 + 1] = b.ext.u[vi * 2 + 1] * 0.05; wb[o] = b.ext.base[t] * 0.05; wm[o] = b.ext.meta[t]; }
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (b.ext) { g.setAttribute('aWall', new THREE.BufferAttribute(wu, 2)); g.setAttribute('aBase', new THREE.BufferAttribute(wb, 1)); g.setAttribute('aMeta', new THREE.BufferAttribute(wm, 1)); }
      g.computeVertexNormals();
      // entartete Dreiecke haben keine Normale → ungültige Pixel vermeiden
      const nrm = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < nrm.count; i++) { const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i); if (!(x * x + y * y + z * z > 1e-8)) nrm.setXYZ(i, 0, 1, 0); }
      const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = true;
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

// ---------- Gelände mit Nutzungskarte (ALKIS) bzw. Luftbild (DOP) ----------
// Sonne am Nachmittag aus Südwesten, ca. 22° hoch (Three.js: +Z = Süden)
export const SUN = new THREE.Vector3(-0.55, 0.38, 0.74).normalize();

let detailTex: THREE.Texture | null = null;
/** Feine, kachelbare Struktur (Gras/Körnung), damit das 2-m-Luftbild aus der Nähe nicht verwaschen wirkt */
function detailTexture() {
  if (detailTex) return detailTex;
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d')!, img = g.createImageData(N, N), r = rng(11);
  const v = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) v[i] = r();
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {  // leicht weichzeichnen (kachelbar)
    const i = y * N + x; v[i] = (v[i] * 2 + v[y * N + (x + 1) % N] + v[((y + 1) % N) * N + x]) / 4;
  }
  for (let i = 0; i < N * N; i++) { const c = Math.round(Math.min(1, Math.max(0, (v[i] - 0.5) * 2.2 + 0.5)) * 255); img.data.set([c, c, c, 255], i * 4); }
  g.putImageData(img, 0, 0);
  detailTex = new THREE.CanvasTexture(cv);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping; detailTex.anisotropy = 8;
  return detailTex;
}
export const shaderTime = { value: 0 };
function photoMaterial(map: THREE.Texture, classMap: THREE.Texture) {
  const m = new THREE.MeshBasicMaterial({ map, vertexColors: true });
  m.toneMapped = false;
  m.onBeforeCompile = sh => {
    sh.uniforms.detailMap = { value: detailTexture() };
    sh.uniforms.classMap = { value: classMap };
    sh.uniforms.sunDir = { value: SUN };
    sh.uniforms.time = shaderTime;
    sh.uniforms.paint = paint;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform sampler2D detailMap; uniform sampler2D classMap; uniform vec3 sunDir; uniform float time; uniform float paint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = pow(diffuseColor.rgb, vec3(2.2));
        float dd = length(vWP - cameraPosition);
        if (paint > 0.0) {
          // Gemalter Look: Klassenfarbe × Helligkeitsstruktur des Luftbilds
          int pc = int(texture2D(classMap, vMapUv).r * 255.0 + 0.5);
          vec3 pal = vec3(0.30, 0.52, 0.14);                                    // Wiese
          if (pc == 2) pal = vec3(0.62, 0.50, 0.18);                            // Acker
          else if (pc == 3) pal = vec3(0.16, 0.30, 0.07);                       // Laubwald
          else if (pc == 4) pal = vec3(0.08, 0.20, 0.08);                       // Nadelwald
          else if (pc == 5) pal = vec3(0.13, 0.27, 0.08);
          else if (pc == 6 || pc == 13) pal = vec3(0.36, 0.48, 0.18);           // Gärten
          else if (pc == 7) pal = vec3(0.42, 0.40, 0.36);
          else if (pc == 9) pal = vec3(0.20, 0.20, 0.21);
          else if (pc == 10) pal = vec3(0.48, 0.38, 0.24);                      // Weg
          else if (pc == 8) pal = vec3(0.05, 0.20, 0.28);
          else if (pc == 12) pal = vec3(0.50, 0.50, 0.20);
          float L = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
          float n = texture2D(detailMap, vWP.xz / 31.0).r;
          vec3 painted = pal * (0.45 + 1.7 * L) * mix(vec3(0.92, 1.0, 0.86), vec3(1.08, 1.0, 1.1), n);
          diffuseColor.rgb = mix(diffuseColor.rgb, painted, paint);
        }
        float near = 1.0 - smoothstep(40.0, 260.0, dd);
        int cls = int(texture2D(classMap, vMapUv).r * 255.0 + 0.5);
        vec2 p = vWP.xz;
        float n1 = texture2D(detailMap, p / 2.3).r, n2 = texture2D(detailMap, p / 0.6).r, n3 = texture2D(detailMap, p / 9.0).r;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        float isWater = cls == 8 ? 1.0 - smoothstep(0.035, 0.075, lum) : 0.0;   // nur wo das Luftbild dunkles Wasser zeigt
        if (isWater > 0.01) {
          // Wasser: dunkler Grund, Himmelsspiegelung (Fresnel), Wellen und Sonnenglitzern
          vec3 V = normalize(cameraPosition - vWP);
          vec2 w = vec2(texture2D(detailMap, p / 7.0 + vec2(time * 0.012, time * 0.007)).r, texture2D(detailMap, p / 5.0 - vec2(time * 0.01, -time * 0.013)).r) - 0.5;
          vec3 N = normalize(vec3(w.x * 0.18, 1.0, w.y * 0.18));
          float fres = 0.08 + 0.92 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 sky = mix(vec3(0.62, 0.72, 0.82), vec3(0.24, 0.42, 0.68), clamp(reflect(-V, N).y * 1.6, 0.0, 1.0));
          vec3 deep = diffuseColor.rgb * 0.55 + vec3(0.01, 0.03, 0.04);
          float spec = pow(max(dot(reflect(-sunDir, N), V), 0.0), 300.0) * 1.2;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(deep, sky, fres * 0.8) + vec3(1.0, 0.95, 0.85) * spec, isWater);
        } else if (cls == 1 || cls == 0 || cls == 13 || cls == 14 || cls == 12) {
          // Wiese: Halme (gerichtetes Rauschen), Farbvariation, vereinzelte Blüten
          float blades = texture2D(detailMap, vec2(p.x / 0.35, p.y / 1.6)).r * 0.5 + n2 * 0.5;
          vec3 c = diffuseColor.rgb * mix(0.62, 1.38, blades);
          c = mix(c, c * vec3(1.08, 1.12, 0.82), smoothstep(0.55, 0.8, n3) * 0.5);
          float fl = step(0.985, texture2D(detailMap, p / 0.25).r) * step(0.5, n3);
          c = mix(c, n1 > 0.5 ? vec3(0.95, 0.92, 0.75) : vec3(0.95, 0.85, 0.2), fl * 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + 0.3 * n1), c, near);
        } else if (cls == 2) {
          // Acker: Bewirtschaftungsreihen (Richtung je Feld aus großräumigem Rauschen)
          float ang = texture2D(detailMap, p / 220.0).r * 6.2832;
          float rows = sin(dot(p, vec2(cos(ang), sin(ang))) * 6.2832 / 0.75) * 0.5 + 0.5;
          diffuseColor.rgb *= mix(1.0, 0.78 + 0.32 * rows * (0.7 + 0.3 * n2), near) * (0.92 + 0.16 * n1);
        } else if (cls >= 3 && cls <= 5) {
          // Waldboden: Nadeln/Laub, dunkler, fleckig
          diffuseColor.rgb *= mix(0.9 + 0.2 * n1, 0.62 + 0.55 * n2 * n1, near);
        } else {
          diffuseColor.rgb *= mix(1.0, 0.82 + 0.36 * (n1 * 0.6 + n2 * 0.4), near);
        }`);
  };
  return m;
}
// Farben je Nutzungsklasse (Sommer). Acker: je Feld wechselnde Kultur + Bewirtschaftungsstreifen.
const LU_COLORS: Record<number, string> = {
  0: '#86a556', 1: '#8fb35b', 2: '#c2ad66', 3: '#45602f', 4: '#33492b', 5: '#3e5631', 6: '#a3a68a', 7: '#9b9993',
  8: '#4d7390', 9: '#4b4c4f', 10: '#9a8e76', 11: '#6f6359', 12: '#aaa86e', 13: '#79ad5a', 14: '#8eab61', 15: '#a19f99',
};
const CROPS = ['#c9b15f', '#8a6c4b', '#9fc05e', '#b9b46a', '#d1bf78'].map(c => new THREE.Color(c));

export function buildLanduseTerrain(hf: Heightfield, lu: Uint8Array, info: { px: number; w: number; h: number }, routeDist: (x: number, y: number) => number, quality: 'low' | 'high', raw?: Int16Array, ortho?: Map<string, ImageData>) {
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
    // Luftbild (falls vorhanden), sonst Textur aus der Nutzungskarte
    const photo = ENS ? undefined : ortho?.get(`${ci}_${cj}`);
    let t: THREE.Texture, texW: number, texH: number;
    if (photo) {
      const mppPhoto = Math.round(((ci1 - ci) * cell) / photo.width) || 2;
      texW = photo.width * mppPhoto; texH = photo.height * mppPhoto;
      t = new THREE.DataTexture(new Uint8Array(photo.data.buffer), photo.width, photo.height, THREE.RGBAFormat);
      // sRGB → linear im Shader (unabhängig von der GPU-Unterstützung)
      t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    } else {
    // Texturauflösung: nahe der Strecke 2 m, sonst 4 m (Handy überall 4 m)
    const near = routeDist(cx0 + wM / 2, cy0 + hM / 2) < 900;
    const mpp = ENS ? 64 : quality === 'high' && near ? 2 : 4;
    const tw = Math.ceil(wM / mpp), th = Math.ceil(hM / mpp);
    texW = tw * mpp; texH = th * mpp;
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
    t = new THREE.DataTexture(tex, tw, th, THREE.RGBAFormat);
    t.colorSpace = THREE.LinearSRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    }

    // Geometrie der Kachel; Vertexfarbe = Felsen an steilen Hängen
    const pos = new Float32Array(ni * nj * 3), uv = new Float32Array(ni * nj * 2), col = new Float32Array(ni * nj * 3), nor = new Float32Array(ni * nj * 3);
    const rh = (i: number, j: number) => { i = Math.max(0, Math.min(nx - 1, i)); j = Math.max(0, Math.min(ny - 1, j)); return raw ? raw[j * nx + i] * hf.t.scale : hf.raw(i, j); };
    const rock = new THREE.Color('#8a8475'), white = new THREE.Color(1, 1, 1), c = new THREE.Color();
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const gi = ci + i * stride, gj = cj + j * stride, k = j * ni + i, x = x0 + gi * cell, y = y0 + gj * cell;
      pos[k * 3] = x; pos[k * 3 + 1] = hf.raw(gi, gj); pos[k * 3 + 2] = -y;
      uv[k * 2] = (i * cell * stride) / texW; uv[k * 2 + 1] = (j * cell * stride) / texH;
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
    let mesh: THREE.Mesh;
    if (photo) {
      // Luftbild enthält bereits Licht und Schatten → unbeleuchtet, nur Hangschattierung (Vertexfarbe) + Detailstruktur
      const shade = g.attributes.color as THREE.BufferAttribute;
      for (let k = 0; k < shade.count; k++) {
        const d = Math.max(0, nor[k * 3] * SUN.x + nor[k * 3 + 1] * SUN.y + nor[k * 3 + 2] * SUN.z);
        const v = (0.66 + 0.42 * d) * shade.getX(k);
        shade.setXYZ(k, v, v, v);
      }
      // Nutzungsklassen der Kachel (2 m) für Detailmuster und Wasser im Shader
      const cw = Math.ceil(texW / info.px), chh = Math.ceil(texH / info.px), cls = new Uint8Array(cw * chh);
      const ox = Math.round((cx0 - x0) / info.px), oy = Math.round((cy0 - y0) / info.px);
      for (let j2 = 0; j2 < chh; j2++) for (let i2 = 0; i2 < cw; i2++) {
        const li = ox + i2, lj = oy + j2;
        cls[j2 * cw + i2] = li < info.w && lj < info.h ? lu[lj * info.w + li] : 0;
      }
      const ct = new THREE.DataTexture(cls, cw, chh, THREE.RedFormat, THREE.UnsignedByteType);
      ct.magFilter = ct.minFilter = THREE.NearestFilter; ct.needsUpdate = true;
      mesh = new THREE.Mesh(g, photoMaterial(t, ct));
    } else if (ENS) {
      const cw = Math.ceil(texW / info.px), chh = Math.ceil(texH / info.px), cls = new Uint8Array(cw * chh);
      const ox = Math.round((cx0 - x0) / info.px), oy = Math.round((cy0 - y0) / info.px);
      for (let j2 = 0; j2 < chh; j2++) for (let i2 = 0; i2 < cw; i2++) { const li = ox + i2, lj = oy + j2; cls[j2 * cw + i2] = li < info.w && lj < info.h ? lu[lj * info.w + li] : 0; }
      const ct = new THREE.DataTexture(cls, cw, chh, THREE.RedFormat, THREE.UnsignedByteType);
      ct.magFilter = ct.minFilter = THREE.NearestFilter; ct.needsUpdate = true;
      mesh = new THREE.Mesh(g, groundMaterial(ct, new THREE.Vector2(texW, texH)));
      mesh.receiveShadow = true;
    } else {
      mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: t, vertexColors: true }));
      mesh.receiveShadow = true;
    }
    group.add(mesh);
  }
  return group;
}

/** Gebäudematerial: Fenster (Stockwerke à 2,9 m, Achsen à 3,1 m) und Dachdeckung per Shader – blendet mit der Entfernung aus */
function buildingMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bn = normalize(vWNor);
        float fade = 1.0 - smoothstep(120.0, 380.0, length(vWPos - cameraPosition));
        if (abs(bn.y) < 0.3) {
          vec2 tg = normalize(vec2(-bn.z, bn.x));
          float u = dot(vWPos.xz, tg) / 3.1, v = (vWPos.y + 0.7) / 2.9;
          float fu = fract(u), fv = fract(v);
          float win = step(0.30, fu) * step(fu, 0.70) * step(0.30, fv) * step(fv, 0.80);
          float frame = step(0.27, fu) * step(fu, 0.73) * step(0.27, fv) * step(fv, 0.83) - win;
          float rnd = fract(sin(dot(floor(vec2(u, v)), vec2(12.9898, 78.233))) * 43758.5453);
          vec3 glass = mix(vec3(0.10, 0.13, 0.17), vec3(0.42, 0.50, 0.58), rnd * rnd);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.92, 0.89), frame * 0.85 * fade);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * fade);
          diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(0.0, 0.5, fv);
        } else if (bn.y > 0.3) {
          float rows = fract(vWPos.y * 3.0 / max(0.35, 1.0 - bn.y));
          diffuseColor.rgb *= 1.0 - (0.13 * (1.0 - smoothstep(0.0, 0.18, rows))) * fade;
        }`);
  };
  return m;
}

/** Neuer Gebäudestil: Fassaden (Putz, Schiefer, Fachwerk, Blech, Holz), Sockel, Fenster mit Rahmen,
 *  Fensterbänken und Läden, Haustüren, Dachziegel – alles prozedural aus Wandkoordinaten. */
export function houseMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWall; attribute float aBase; attribute float aMeta; attribute float aEave; varying vec2 vWall; varying float vBase; varying float vMeta; varying float vEave; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall; vBase = aBase; vMeta = aMeta; vEave = aEave; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vWall; varying float vBase; varying float vMeta; varying float vEave; varying vec3 vWP; varying vec3 vWN;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float glassMask = 0.0;
        {
          vec3 n = vWN / max(length(vWN), 1e-5);
          float style = mod(vMeta, 8.0); bool roof = vMeta >= 7.5;
          float h = vWP.y - vBase;
          if (!roof && abs(n.y) < 0.5) {
            float u = vWall.x, L = vWall.y;
            vec3 c;
            float nz = vn(vec2(u, h) * 3.0) * 0.5 + vn(vec2(u, h) * 0.7) * 0.5;
            if (style < 0.5) c = vec3(0.90, 0.89, 0.85) * (0.94 + 0.08 * nz);                     // weißer Putz
            else if (style < 1.5) {                                                                  // Schieferverkleidung
              float row = floor(h / 0.2); float su = u / 0.3 + mod(row, 2.0) * 0.5;
              float e = min(fract(su), 1.0 - fract(su)) * 6.0; float ev = fract(h / 0.2);
              c = vec3(0.21, 0.24, 0.28) * (0.85 + 0.25 * h21(vec2(floor(su), row))) * mix(0.7, 1.0, smoothstep(0.0, 0.25, ev)) * mix(0.8, 1.0, clamp(e, 0.0, 1.0));
            } else if (style < 2.5) {                                                                // Fachwerk
              c = vec3(0.93, 0.91, 0.86) * (0.95 + 0.06 * nz);
              float fv2 = mod(h - 0.6, 2.8), bu = fract(u / 1.25);
              bool beam = fv2 < 0.2 || fv2 > 2.68 || bu < 0.09 || (mod(floor(u / 1.25), 3.0) < 0.5 && abs(fract(u / 1.25) - fv2 / 2.8) < 0.05);
              if (beam && h > 0.6) c = vec3(0.17, 0.11, 0.07);
            } else if (style < 3.5) {                                                                // Trapezblech
              float r = abs(fract(u / 0.25) - 0.5); c = vec3(0.62, 0.66, 0.68) * (0.85 + 0.3 * smoothstep(0.1, 0.4, r));
            } else if (style < 4.5) {                                                                // Holzverschalung
              float bd = fract(u / 0.18); c = vec3(0.42, 0.29, 0.18) * (0.75 + 0.35 * h21(vec2(floor(u / 0.18), 1.0))) * (bd < 0.08 ? 0.6 : 1.0);
            } else c = vec3(0.92, 0.85, 0.70) * (0.94 + 0.08 * nz);                                   // cremefarbener Putz
            if (h < 0.55) c = vec3(0.38, 0.37, 0.35) * (0.85 + 0.2 * vn(vec2(u, h) * 6.0));           // Sockel
            // Fenster: je Stockwerk (2,8 m) mittig auf der Wand verteilt, Abstand 2,6 m
            float FH = 2.8; float fl = floor((h - 0.55) / FH); float fv = mod(h - 0.55, FH);
            float slot = style > 2.5 && style < 3.5 ? 5.0 : 2.6;
            float nw = floor((L - 1.0) / slot); float margin = (L - nw * slot) * 0.5;
            float lu = u - margin; float idx = floor(lu / slot); float fu = lu - idx * slot;
            float ww = style > 2.5 && style < 3.5 ? 3.6 : 1.1, wl = (slot - ww) * 0.5;
            bool inSlot = nw >= 1.0 && lu > 0.0 && idx < nw && h > 0.55 && (vEave <= 0.0 || fl * FH + 0.55 + 2.35 < vEave);
            bool door = inSlot && fl < 0.5 && abs(idx - floor(nw * 0.5)) < 0.5 && style != 3.0 && L > 5.0 && h21(vec2(floor(vBase * 3.0), floor(L))) > 0.35;
            if (door && fu > wl && fu < slot - wl && fv < 2.2 && h > 0.55) {
              c = vec3(0.30, 0.18, 0.10) * (0.85 + 0.15 * step(0.5, fract(fu * 4.0)));
              if (fv > 2.05 || fu < wl + 0.08 || fu > slot - wl - 0.08) c = vec3(0.92);
            } else if (inSlot && fv > 0.85 && fv < 2.15 && fu > wl && fu < slot - wl) {
              float fx = fu - wl, fy = fv - 0.85;
              bool frame = fx < 0.07 || fx > ww - 0.07 || fy < 0.07 || fy > 1.23 || abs(fx - ww * 0.5) < 0.035 || abs(fy - 0.8) < 0.035;
              if (frame) c = vec3(0.95, 0.95, 0.93);
              else { float refl = 0.25 + 0.5 * smoothstep(0.0, 1.3, fy) + 0.2 * h21(vec2(idx, fl)); c = mix(vec3(0.05, 0.08, 0.11), vec3(0.45, 0.58, 0.70), refl * 0.6); glassMask = 1.0; }
            } else if (inSlot && fv > 0.72 && fv < 0.85 && fu > wl - 0.06 && fu < slot - wl + 0.06) {
              c = vec3(0.55, 0.55, 0.53);                                                            // Fensterbank
            } else if (inSlot && (style > 0.5 && style < 2.5) && fv > 0.85 && fv < 2.15 && ((fu > wl - 0.42 && fu < wl - 0.04) || (fu > slot - wl + 0.04 && fu < slot - wl + 0.42))) {
              c = vec3(0.12, 0.28, 0.18) * (0.8 + 0.3 * step(0.5, fract(fv * 8.0)));                // Fensterläden
            }
            diffuseColor.rgb = c;
          } else if (n.y >= 0.5) {
            vec3 base = diffuseColor.rgb;
            if (n.y > 0.97) diffuseColor.rgb = base * (0.85 + 0.25 * vn(vWP.xz * 2.0));               // Flachdach (Kies)
            else {
              vec2 dn = n.xz / max(length(n.xz), 1e-5); vec2 along = vec2(-dn.y, dn.x);
              float row = floor(vWP.y / 0.3); float tu = dot(vWP.xz, along) / 0.28 + mod(row, 2.0) * 0.5;
              float ev = fract(vWP.y / 0.3), eu = min(fract(tu), 1.0 - fract(tu));
              diffuseColor.rgb = base * (0.82 + 0.22 * h21(vec2(floor(tu), row))) * mix(0.62, 1.0, smoothstep(0.0, 0.3, ev)) * mix(0.85, 1.0, smoothstep(0.0, 0.08, eu));
            }
          }
        }
        roughnessFactor = mix(roughnessFactor, 0.15, glassMask);`);
  };
  return m;
}

/** Schornsteine (Instanzen) */
export function buildChimneys(list: number[][]) {
  const geo = new THREE.BoxGeometry(0.55, 1.6, 0.55).translate(0, 0.8, 0);
  const cap = new THREE.BoxGeometry(0.7, 0.12, 0.7).translate(0, 1.66, 0);
  const g = new THREE.Group(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
  const a = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#3d3f44', roughness: 0.9 }), list.length);
  const b = new THREE.InstancedMesh(cap, new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.8 }), list.length);
  list.forEach(([x, y, z], i) => { m.compose(new THREE.Vector3(x, z - 0.6, -y), q, s1); a.setMatrixAt(i, m); b.setMatrixAt(i, m); });
  a.castShadow = true; g.add(a, b);
  return g;
}

/** Selbst gestalteter Boden: Farben und Muster je Nutzungsklasse, natürliche, unregelmäßige Übergänge */
function groundMaterial(classMap: THREE.Texture, size: THREE.Vector2) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.uniforms.classMap = { value: classMap }; sh.uniforms.detailMap = { value: detailTexture() };
    sh.uniforms.texSize = { value: size }; sh.uniforms.sunDir = { value: SUN }; sh.uniforms.time = shaderTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec2 vCUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz; vCUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec2 vCUv; uniform sampler2D classMap; uniform sampler2D detailMap; uniform vec2 texSize; uniform vec3 sunDir; uniform float time;
        float dn(vec2 p) { return texture2D(detailMap, p).r; }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        int clsAt(vec2 uv) { return int(texture2D(classMap, uv).r * 255.0 + 0.5); }
        vec3 fieldColor(vec2 cellId) {
          float r = h21(cellId);
          if (r < 0.3) return vec3(0.55, 0.45, 0.17);    // Getreide
          if (r < 0.5) return vec3(0.33, 0.23, 0.13);    // gepflügt
          if (r < 0.75) return vec3(0.30, 0.44, 0.12);   // junge Saat
          if (r < 0.88) return vec3(0.42, 0.47, 0.16);   // Mais / Grünfutter
          return vec3(0.62, 0.55, 0.20);                 // Stoppeln
        }`)
      .replace('#include <map_fragment>', `
        vec2 p = vWP.xz;
        float dd = length(vWP - cameraPosition);
        float near = 1.0 - smoothstep(40.0, 260.0, dd);
        // unregelmäßige Grenzen: Klassenkarte mit verrauschtem Versatz (±2 m) abfragen
        vec2 jit = (vec2(dn(p / 13.0), dn(p / 13.0 + 0.37)) - 0.5) * 4.0 / texSize;
        int cls = clsAt(vCUv + jit);
        float n1 = dn(p / 2.3), n2 = dn(p / 0.6), n3 = dn(p / 9.0), n4 = dn(p / 47.0), n5 = dn(p / 170.0);
        vec3 c;
        if (cls == 8) {
          vec3 V = normalize(cameraPosition - vWP);
          vec2 w = vec2(dn(p / 7.0 + vec2(time * 0.012, time * 0.007)), dn(p / 5.0 - vec2(time * 0.01, -time * 0.013))) - 0.5;
          vec3 N = normalize(vec3(w.x * 0.18, 1.0, w.y * 0.18));
          float fres = 0.06 + 0.94 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 sky = mix(vec3(0.62, 0.74, 0.85), vec3(0.22, 0.43, 0.72), clamp(reflect(-V, N).y * 1.6, 0.0, 1.0));
          c = mix(vec3(0.02, 0.10, 0.12), sky, fres * 0.85) + vec3(1.0, 0.95, 0.85) * pow(max(dot(reflect(-sunDir, N), V), 0.0), 300.0) * 1.2;
        } else if (cls == 2) {
          vec2 q = p / 85.0 + (vec2(n5, dn(p / 170.0 + 0.5)) - 0.5) * 0.8; vec2 id = floor(q);
          c = fieldColor(id);
          float ang = h21(id + 3.1) * 3.1416;
          float rows = sin(dot(p, vec2(cos(ang), sin(ang))) * 6.2832 / 0.8) * 0.5 + 0.5;
          c *= mix(1.0, 0.8 + 0.3 * rows, near) * (0.9 + 0.2 * n3) * (0.92 + 0.12 * n2);
          vec2 fe = abs(fract(q) - 0.5); float edge = smoothstep(0.47, 0.5, max(fe.x, fe.y));
          c = mix(c, vec3(0.25, 0.38, 0.12), edge * 0.8);                                   // Feldrain
        } else if (cls >= 3 && cls <= 5) {
          c = mix(vec3(0.13, 0.11, 0.06), vec3(0.20, 0.24, 0.09), n3) * (0.75 + 0.45 * n2 * n1);   // Waldboden
          if (cls == 4) c *= vec3(1.05, 0.92, 0.85);
        } else if (cls == 9) {
          c = vec3(0.17, 0.17, 0.18) * (0.85 + 0.3 * n2);
        } else if (cls == 10) {
          c = mix(vec3(0.45, 0.38, 0.27), vec3(0.55, 0.49, 0.37), n2) * (0.85 + 0.25 * n1);      // Schotterweg
        } else if (cls == 11) {
          c = vec3(0.32, 0.29, 0.26) * (0.8 + 0.3 * n2);
        } else if (cls == 7) {
          // Gewerbe/Platz: Pflaster mit Rasenflächen dazwischen
          vec3 pave = vec3(0.47, 0.46, 0.43) * (0.85 + 0.2 * n2);
          c = mix(pave, vec3(0.28, 0.45, 0.11) * (0.85 + 0.3 * n1), smoothstep(0.5, 0.65, n4));
        } else {
          // Wiese / Rasen / Brache: sattes Grün mit trockenen Flecken, Halmstruktur, Blüten
          vec3 g1 = vec3(0.20, 0.38, 0.08), g2 = vec3(0.33, 0.48, 0.12), dry = vec3(0.52, 0.50, 0.20);
          c = mix(g1, g2, n4);
          c = mix(c, dry, smoothstep(0.62, 0.85, n5) * 0.6 + (cls == 12 ? 0.45 : 0.0));
          if (cls == 6 || cls == 13) c = mix(c, vec3(0.30, 0.50, 0.13), 0.5);
          float blades = dn(vec2(p.x / 0.3, p.y / 1.4)) * 0.5 + n2 * 0.5;
          c *= mix(0.88 + 0.24 * n1, 0.7 + 0.55 * blades, near);
          float fl = step(0.985, dn(p / 0.25)) * step(0.55, n3) * near;
          c = mix(c, n1 > 0.5 ? vec3(0.95, 0.93, 0.80) : vec3(0.95, 0.80, 0.15), fl);
        }
        diffuseColor.rgb *= c * 1.15;`);
  };
  return m;
}
