// Straßennetz um die Strecke (ATKIS Basis-DLM): Nebenstraßen, Wirtschaftswege, Radwege, Kreisverkehre und
// saubere Einmündungen. Alle Fahrbahnen teilen sich ein Material: Asphalt-Körnung aus einer Textur, Markierungen
// je Straßenart im Shader (Randlinien, Leitlinie, Innenring), Schotterwege mit Grasnarbe.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Route } from '../route';
import { rng } from './noise';

export interface SideRoad { p: number[][]; w: number[]; k?: string; s?: number[]; x?: number[][]; o?: number; n?: string }
export interface Ring { x: number; y: number; r: number; w: number }
/** Einmündung an der Strecke: Streckenmeter, Seite (+1 links / −1 rechts), halbe Mündungslänge entlang der Strecke */
export interface Junction { d: number; side: number; half: number }

const KIND: Record<string, number> = { G: 0, B: 1, L: 1, K: 1, H: 2, F: 3, P: 4, R: 5 };
const LIFT = [0.06, 0.065, 0.14, 0.14, 0.14, 0.135];    // Höhe über Grund je Art (Strecke: 0,12); Wege liegen auf dem Gelände auf
const REPEAT = 24;                                        // Meter je Texturhöhe

// ---------- Material ----------
function grainTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 1024; const g = cv.getContext('2d')!;
  const base = [74, 75, 79]; g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, 256, 1024);
  const r = rng(77);
  for (let i = 0; i < 26000; i++) { const v = (r() - 0.5) * 34; g.fillStyle = `rgba(${base.map(c => Math.max(0, Math.min(255, c + v))).join(',')},0.9)`; g.fillRect(r() * 256, r() * 1024, 1 + r() * 1.5, 1 + r() * 1.5); }
  for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(r() * 220, r() * 1000, 20 + r() * 50, 40 + r() * 140); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
  return t;
}
let shared: THREE.MeshStandardMaterial | null = null;
export function roadNetMaterial() {
  if (shared) return shared;
  const m = new THREE.MeshStandardMaterial({ map: grainTexture(), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoad; varying vec3 vRoad; varying vec2 vXY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad; vXY = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vRoad; varying vec2 vXY;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float nse(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
      float band(float x, float a, float b) { float w = fwidth(x) * 0.8; return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb = pow(diffuseColor.rgb, vec3(2.2));
      {
        float W = vRoad.x, kind = vRoad.y, town = vRoad.z;
        float across = vMapUv.x * W, fromR = W - across, along = vMapUv.y * ${REPEAT.toFixed(1)};
        vec3 white = vec3(0.78);
        if (W < 0.0) {
          // Einmündungs-/Knotenfläche: nur Asphalt
        } else if (kind < 0.5) {
          // Ortsstraße: leichte Flickstellen, keine Markierung
          diffuseColor.rgb *= 0.95 + 0.1 * nse(vXY * 0.15);
        } else if (kind < 1.5) {
          // Kreis-/Landes-/Bundesstraße: Randlinien, Leitlinie (außerorts 6 m / 12 m, innerorts 3 m / 6 m)
          float edge = (W > 5.0) ? band(across, 0.25, 0.37) + band(fromR, 0.25, 0.37) : 0.0;
          float period = town > 0.5 ? 9.0 : 18.0;
          float ctr = band(across - W * 0.5, -0.06, 0.06) * step(fract(along / period), 0.3334);
          diffuseColor.rgb = mix(diffuseColor.rgb, white, clamp(edge + ctr, 0.0, 1.0));
        } else if (kind < 2.5) {
          // Hauptwirtschaftsweg: Asphalt, ausgefranste Ränder
          float e = min(across, fromR) + nse(vXY * 1.7) * 0.35;
          diffuseColor.rgb = mix(vec3(0.20, 0.25, 0.10), diffuseColor.rgb * 1.08, smoothstep(0.05, 0.3, e));
        } else if (kind < 3.5) {
          // Schotterweg mit Grasnarbe in der Mitte und an den Rändern
          vec3 grav = mix(vec3(0.36, 0.32, 0.25), vec3(0.47, 0.43, 0.35), nse(vXY * 3.0)) * (0.9 + 0.2 * hsh(floor(vXY * 9.0)));
          float gm = 1.0 - smoothstep(0.18, 0.38, abs(across - W * 0.5) + nse(vXY * 2.3) * 0.12);
          float ge = 1.0 - smoothstep(0.08, 0.35, min(across, fromR) + nse(vXY * 1.9) * 0.25);
          diffuseColor.rgb = mix(grav, vec3(0.17, 0.25, 0.08) * (0.85 + 0.3 * nse(vXY * 4.0)), clamp(gm + ge, 0.0, 1.0));
        } else if (kind < 4.5) {
          // Rad- und Fußweg: etwas hellerer Asphalt
          diffuseColor.rgb *= 1.12;
        } else {
          // Kreisfahrbahn: innen überfahrbarer Pflasterring, außen Randlinie
          float apron = W > 6.2 ? 1.2 : 0.9;
          if (across < apron) {
            vec2 c = vec2(across * 6.0, along * 6.0); vec2 f = fract(c);
            float joint = step(0.9, max(f.x, f.y));
            diffuseColor.rgb = mix(vec3(0.33, 0.29, 0.27) * (0.85 + 0.3 * hsh(floor(c))), vec3(0.16), joint);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, white, band(fromR, 0.25, 0.37));
          diffuseColor.rgb = mix(diffuseColor.rgb, white, band(across, apron, apron + 0.12));
        }
      }`);
  };
  shared = m; return m;
}

// ---------- Geometrie-Hilfen ----------
interface Pt { x: number; y: number; h: number; hw: number }
/** Fahrbahnband (u quer 0…1 von links nach rechts, v entlang in Texturhöhen) + Bankett/Böschung mit Vertexfarbe */
function band(pts: Pt[], lift: number, kind: number, town: number, closed = false, skirtOff?: (k: number, side: number) => boolean) {
  const n = pts.length, P: number[] = [], U: number[] = [], A: number[] = [], I: number[] = [];
  const S: number[] = [], C: number[] = [], SI: number[] = [];
  const slope = new THREE.Color('#6a7f4b'), col = new THREE.Color(town ? '#a3a19b' : '#6f8350'), shoulder = kind === 5 ? (town ? 2.0 : 1.2) : town ? 1.6 : kind >= 2 ? 0.4 : 0.8;
  let along = 0;
  for (let k = 0; k < n; k++) {
    const a = pts[closed ? (k - 1 + n) % n : Math.max(0, k - 1)], b = pts[closed ? (k + 1) % n : Math.min(n - 1, k + 1)], p = pts[k];
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (k) along += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y);
    const ex = -dy, ey = dx, hh = p.h + lift;
    P.push(p.x + ex * p.hw, hh, -(p.y + ey * p.hw), p.x - ex * p.hw, hh, -(p.y - ey * p.hw));
    U.push(0, along / REPEAT, 1, along / REPEAT); A.push(p.hw * 2, kind, town, p.hw * 2, kind, town);
    const drop = kind >= 2 && kind <= 4 ? 0.6 : 2.5, out = kind >= 2 && kind <= 4 ? 0.8 : 2.5;   // aufliegende Wege: nur flache Kante
    for (const side of [1, -1]) {
      const w1 = p.hw + shoulder, w2 = w1 + out;
      S.push(p.x + ex * side * p.hw, hh - 0.03, -(p.y + ey * side * p.hw), p.x + ex * side * w1, hh - 0.1, -(p.y + ey * side * w1), p.x + ex * side * w2, hh - drop, -(p.y + ey * side * w2));
      C.push(col.r, col.g, col.b, col.r, col.g, col.b, slope.r, slope.g, slope.b);   // Bankett/Gehweg, Böschung grün
    }
  }
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = k * 2, b = ((k + 1) % n) * 2; I.push(a, b, a + 1, a + 1, b, b + 1);
    if (kind >= 2 && kind <= 4) continue;                         // aufliegende Wege: keine Böschung nötig
    for (const off of [0, 3]) {
      const side = off === 0 ? 1 : -1;
      if (skirtOff && (skirtOff(k, side) || skirtOff((k + 1) % n, side))) continue;
      for (const sg of [0, 1]) { const c = k * 6 + off + sg, d = ((k + 1) % n) * 6 + off + sg; SI.push(c, d, c + 1, c + 1, d, d + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(A, 3)); g.setIndex(I); g.computeVertexNormals();
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(S, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); sg.setIndex(SI); sg.computeVertexNormals();
  return [g, sg];
}
/** ebene Asphaltfläche (Einmündung, Knoten) aus einem Umriss; Höhe je Punkt */
function patch(outline: { x: number; y: number; h: number }[]) {
  const tris = THREE.ShapeUtils.triangulateShape(outline.map(p => new THREE.Vector2(p.x, p.y)), []);
  const P: number[] = [], U: number[] = [], A: number[] = [];
  for (const p of outline) { P.push(p.x, p.h, -p.y); U.push(p.x / 5, p.y / REPEAT); A.push(-1, 0, 0); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(A, 3)); g.setIndex(tris.flat()); g.computeVertexNormals();
  return g;
}
const disc = (x: number, y: number, h: number, r: number, seg = 18) => patch(Array.from({ length: seg }, (_, i) => ({ x: x + Math.cos(i / seg * Math.PI * 2) * r, y: y + Math.sin(i / seg * Math.PI * 2) * r, h })));

/** nächster Streckenpunkt (Raster) */
function routeIndex(route: Route) {
  const { x, y } = route.data, C = 40, grid = new Map<string, number[]>();
  x.forEach((v, k) => { const key = `${Math.floor(v / C)}_${Math.floor(y[k] / C)}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); });
  return (px: number, py: number) => {
    let best = -1, bd = Infinity; const cx = Math.floor(px / C), cy = Math.floor(py / C);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of grid.get(`${cx + a}_${cy + b}`) ?? []) { const d = (x[k] - px) ** 2 + (y[k] - py) ** 2; if (d < bd) { bd = d; best = k; } }
    return best;
  };
}
const hwRoute = (route: Route, k: number) => (route.data.surface ?? []).some(s => k * route.data.step >= s.from && k * route.data.step <= s.to) ? 1.7 : (route.data.width?.[k] ?? 5.6) / 2;

/** Einmündungen an der Strecke (für Randlinie, Bankett, Bordsteine, Leitpfosten) */
export function findJunctions(route: Route, roads: SideRoad[]): Junction[] {
  const near = routeIndex(route), out: Junction[] = [];
  for (const r of roads) for (const end of [0, 1] as const) {
    if (r.s?.[end] !== 1 || r.p.length < 2) continue;
    const pts = end === 0 ? r.p : [...r.p].reverse(), j = pts[0];
    let q = pts[pts.length - 1]; for (const p of pts) if (Math.hypot(p[0] - j[0], p[1] - j[1]) > hwRoute(route, near(j[0], j[1])) + 6) { q = p; break; }
    const k = near(j[0], j[1]); if (k < 0) continue;
    const pose = route.pose(k * route.data.step), tx = Math.sin(pose.heading), ty = Math.cos(pose.heading), lx = -Math.cos(pose.heading), ly = Math.sin(pose.heading);
    let vx = q[0] - j[0], vy = q[1] - j[1]; const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
    const sinT = Math.abs(vx * ty - vy * tx), hw = (end === 0 ? r.w[0] : r.w[r.w.length - 1]) / 2;
    out.push({ d: k * route.data.step, side: vx * lx + vy * ly >= 0 ? 1 : -1, half: Math.min(25, hw / Math.max(0.3, sinT) + 5) });
  }
  return out;
}
export const inMouth = (js: Junction[], route: Route, d: number, side: number, extra = 0) => {
  const dd = route.wrap(d); return js.some(j => j.side === side && Math.abs(j.d - dd) < j.half + extra);
};
export const inRoundabout = (route: Route, d: number, extra = 0) => {
  const dd = route.wrap(d); return (route.data.roundabouts ?? []).some(r => dd >= r.from - extra && dd <= r.to + extra);
};

// ---------- Aufbau ----------
export function buildRoadNetwork(route: Route, data: { roads: SideRoad[]; rings?: Ring[] }, junctions: Junction[], townAt: (x: number, y: number) => boolean) {
  const group = new THREE.Group(), mat = roadNetMaterial();
  const skirtMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const tiles = new Map<string, { road: THREE.BufferGeometry[]; skirt: THREE.BufferGeometry[]; cx: number; cy: number }>();
  const tile = (x: number, y: number) => { const i = Math.floor(x / 1000), j = Math.floor(y / 1000), k = `${i}_${j}`; return tiles.get(k) ?? tiles.set(k, { road: [], skirt: [], cx: (i + 0.5) * 1000, cy: (j + 0.5) * 1000 }).get(k)!; };
  const near = routeIndex(route);

  // Nebenstraßen und Ringe
  const ends = new Map<string, { x: number; y: number; h: number; hw: number; lift: number; n: number }>();
  for (const r of data.roads) {
    if (r.p.length < 2) continue;
    const kind = KIND[r.k ?? 'G'] ?? 0, closed = r.k === 'R';
    const mid = r.p[r.p.length >> 1], town = townAt(mid[0], mid[1]) ? 1 : 0;
    let pts: Pt[] = r.p.map((p, i) => ({ x: p[0], y: p[1], h: p[2] ?? 0, hw: r.w[i] / 2 }));
    if (closed && Math.hypot(pts[0].x - pts.at(-1)!.x, pts[0].y - pts.at(-1)!.y) < 0.5) pts = pts.slice(0, -1);
    // Kreisfahrbahn: innen keine Böschung (Bordstein der Insel), außen nicht über die Zufahrten
    let skirtOff: ((k: number, side: number) => boolean) | undefined;
    if (closed && data.rings) {
      const R = data.rings.find(q => Math.abs(pts[0].x - (q.x + q.r)) < 1 && Math.abs(pts[0].y - q.y) < 1);
      const armAng: [number, number][] = [];
      if (R) for (const a of data.roads) for (const e of [0, 1] as const) {
        if (a.s?.[e] !== 2) continue; const q = e === 0 ? a.p[0] : a.p[a.p.length - 1];
        if (Math.abs(Math.hypot(q[0] - R.x, q[1] - R.y) - R.r) < 1.5) armAng.push([Math.atan2(q[1] - R.y, q[0] - R.x), ((e === 0 ? a.w[0] : a.w[a.w.length - 1]) / 2 + 4) / R.r]);
      }
      skirtOff = (k, side) => side > 0 || (!!R && armAng.some(([t, w]) => Math.abs(((Math.atan2(pts[k].y - R.y, pts[k].x - R.x) - t + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < w));
    }
    const [g, sg] = band(pts, LIFT[kind], kind, town, closed, skirtOff);
    const t = tile(mid[0], mid[1]); t.road.push(g); t.skirt.push(sg);
    if (!closed) for (const [e, i] of [[0, 0], [1, pts.length - 1]] as const) {
      if (r.s?.[e]) continue;
      const p = pts[i], key = `${Math.round(p.x * 2)}_${Math.round(p.y * 2)}`, o = ends.get(key);
      if (o) { o.hw = Math.max(o.hw, p.hw); o.lift = Math.max(o.lift, LIFT[kind]); o.n++; }
      else ends.set(key, { x: p.x, y: p.y, h: p.h, hw: p.hw, lift: LIFT[kind], n: 1 });
    }
    // Zufahrt am Kreisverkehr: Fläche über der äußeren Randlinie
    if (data.rings) for (const [e, i] of [[0, 0], [1, pts.length - 1]] as const) {
      if (r.s?.[e] !== 2) continue;
      const p = pts[i], R = data.rings.find(q => Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - q.r) < 1.5); if (!R) continue;
      const dc = Math.hypot(p.x - R.x, p.y - R.y) || 1, ox = R.x + (p.x - R.x) / dc * (R.r + R.w / 4), oy = R.y + (p.y - R.y) / dc * (R.r + R.w / 4);
      tile(ox, oy).road.push(disc(ox, oy, p.h + LIFT[5] + 0.006, p.hw + 0.9));
    }
  }
  // Knoten zwischen Nebenstraßen: runde Asphaltfläche deckt Überlappungen ab
  for (const e of ends.values()) if (e.n >= 2) tile(e.x, e.y).road.push(disc(e.x, e.y, e.h + e.lift + 0.008, e.hw + 0.35));

  // Einmündungen an der Strecke: Ecken ausrunden
  for (const r of data.roads) for (const end of [0, 1] as const) {
    if (r.s?.[end] !== 1 || r.p.length < 2) continue;
    const pts = end === 0 ? r.p : [...r.p].reverse(), J = pts[0], k = near(J[0], J[1]); if (k < 0) continue;
    const hwR = hwRoute(route, k), hwS = (end === 0 ? r.w[0] : r.w[r.w.length - 1]) / 2;
    let q = pts[pts.length - 1]; for (const p of pts) if (Math.hypot(p[0] - J[0], p[1] - J[1]) > hwR + 8) { q = p; break; }
    const pose = route.pose(k * route.data.step), t = [Math.sin(pose.heading), Math.cos(pose.heading)], nL = [-Math.cos(pose.heading), Math.sin(pose.heading)];
    let v = [q[0] - J[0], q[1] - J[1]]; const vl = Math.hypot(v[0], v[1]) || 1; v = [v[0] / vl, v[1] / vl];
    const side = v[0] * nL[0] + v[1] * nL[1] >= 0 ? 1 : -1, n = [nL[0] * side, nL[1] * side];
    const sinT = Math.abs(v[0] * t[1] - v[1] * t[0]); if (sinT < 0.3) continue;
    const m = [-v[1], v[0]], R = townAt(J[0], J[1]) ? 4 : 6, edge = hwR - 0.3;
    const outline: number[][] = [];
    for (const sgn of [1, -1]) {
      // Schnittpunkt Streckenrand J + n·edge + t·u  =  Seitenrand J + m·sgn·hwS + v·w   →   t·u − v·w = D
      const D = [m[0] * sgn * hwS - n[0] * edge, m[1] * sgn * hwS - n[1] * edge], det = -t[0] * v[1] + t[1] * v[0];
      const w = (t[0] * D[1] - t[1] * D[0]) / det;
      const C = [J[0] + m[0] * sgn * hwS + v[0] * w, J[1] + m[1] * sgn * hwS + v[1] * w];
      const dirT = Math.sign((C[0] - J[0]) * t[0] + (C[1] - J[1]) * t[1]) || sgn;   // entlang des Streckenrands von der Mündung weg
      const P1 = [C[0] + t[0] * dirT * R, C[1] + t[1] * dirT * R], P2 = [C[0] + v[0] * R, C[1] + v[1] * R];
      const curve: number[][] = [];
      for (let i = 0; i <= 8; i++) { const s = i / 8, a = (1 - s) ** 2, b = 2 * (1 - s) * s, c = s * s; curve.push([P1[0] * a + C[0] * b + P2[0] * c, P1[1] * a + C[1] * b + P2[1] * c]); }
      if (sgn === 1) outline.push(...curve); else outline.push(...curve.reverse());
    }
    const pl = outline.map(([x, y]) => { const kk = near(x, y); return { x, y, h: (kk >= 0 ? route.data.h[kk] : pose.h) + 0.115 }; });
    // Umlaufsinn prüfen (Triangulierung braucht einfachen Umriss)
    if (pl.length >= 3) tile(J[0], J[1]).road.push(patch(pl));
  }

  // Kreisverkehre: Bordstein und begrünte Mittelinsel (geneigt wie die Fahrbahn)
  const islands: THREE.BufferGeometry[] = [], curbs: THREE.BufferGeometry[] = [];
  for (const R of data.rings ?? []) {
    const ring = data.roads.find(r => r.k === 'R' && Math.abs(r.p[0][0] - (R.x + R.r)) < 1 && Math.abs(r.p[0][1] - R.y) < 1);
    const hs = ring ? ring.p.map(p => p[2] ?? 0) : [route.data.h[near(R.x, R.y)]];
    // Ebene z = a·x + b·y + c durch die Ringhöhen
    let a = 0, b = 0, c = hs.reduce((s, v) => s + v, 0) / hs.length;
    if (ring && ring.p.length > 8) {
      let sxx = 0, syy = 0, sxz = 0, syz = 0;
      for (const p of ring.p) { const dx = p[0] - R.x, dy = p[1] - R.y, dz = (p[2] ?? c) - c; sxx += dx * dx; syy += dy * dy; sxz += dx * dz; syz += dy * dz; }
      a = sxz / sxx; b = syz / syy;
    }
    const H = (x: number, y: number) => c + a * (x - R.x) + b * (y - R.y) + LIFT[5];
    const ri = R.r - R.w / 2, seg = 48, P: number[] = [], I: number[] = [], CP: number[] = [], CI: number[] = [];
    for (let i = 0; i < seg; i++) {
      const t = i / seg * Math.PI * 2, cx = Math.cos(t), cy = Math.sin(t), x = R.x + cx * ri, y = R.y + cy * ri, h = H(x, y);
      CP.push(x, h - 0.05, -y, x, h + 0.14, -y, R.x + cx * (ri - 0.25), h + 0.14, -(R.y + cy * (ri - 0.25)), R.x + cx * (ri - 0.25), h + 0.1, -(R.y + cy * (ri - 0.25)));
      const j = (i + 1) % seg; for (let s = 0; s < 3; s++) CI.push(i * 4 + s, j * 4 + s, i * 4 + s + 1, i * 4 + s + 1, j * 4 + s, j * 4 + s + 1);
      P.push(R.x + cx * (ri - 0.25), h + 0.12 + 0, -(R.y + cy * (ri - 0.25)));
    }
    P.push(R.x, H(R.x, R.y) + 0.35, -R.y);                      // leicht gewölbt
    for (let i = 0; i < seg; i++) I.push(seg, i, (i + 1) % seg);
    const ig = new THREE.BufferGeometry(); ig.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); ig.setIndex(I); ig.computeVertexNormals(); islands.push(ig);
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(CP, 3)); cg.setIndex(CI); cg.computeVertexNormals(); curbs.push(cg);
    // Bepflanzung: niedrige Sträucher im Kreis, bei großen Inseln ein Baum in der Mitte
    const r = rng(Math.round(R.x * 7 + R.y)), bushes: THREE.BufferGeometry[] = [];
    const nb = Math.max(5, Math.round(ri * 1.2));
    for (let i = 0; i < nb; i++) {
      const t = i / nb * Math.PI * 2 + r() * 0.3, rr = ri * (0.45 + r() * 0.25), x = R.x + Math.cos(t) * rr, y = R.y + Math.sin(t) * rr, s = 0.5 + r() * 0.5;
      bushes.push(new THREE.IcosahedronGeometry(s, 0).scale(1.2, 0.8, 1.2).translate(x, H(x, y) + 0.3 + s * 0.5, -y));
    }
    if (ri > 7) {
      const h0 = H(R.x, R.y) + 0.3;
      bushes.push(new THREE.CylinderGeometry(0.12, 0.18, 2.6, 7).translate(R.x, h0 + 1.3, -R.y));
      bushes.push(new THREE.IcosahedronGeometry(1.9, 1).scale(1, 1.15, 1).translate(R.x, h0 + 3.6, -R.y));
    }
    const bg = mergeGeometries(bushes.map(g => g.index ? g.toNonIndexed() : g));
    if (bg) { const mesh = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ color: '#3f6a2c', flatShading: true })); mesh.castShadow = true; group.add(mesh); }
  }
  if (islands.length) {
    const im = new THREE.Mesh(mergeGeometries(islands)!, new THREE.MeshLambertMaterial({ color: '#6f9a45' })); im.receiveShadow = true; group.add(im);
    const cm = new THREE.Mesh(mergeGeometries(curbs)!, new THREE.MeshLambertMaterial({ color: '#c9c7c0', side: THREE.DoubleSide })); cm.receiveShadow = true; group.add(cm);
  }

  // Kacheln zusammenfügen; ferne Kacheln ausblenden (der Dunst verdeckt sie ohnehin)
  const parts: { mesh: THREE.Object3D; cx: number; cy: number }[] = [];
  for (const t of tiles.values()) for (const [list, m] of [[t.road, mat], [t.skirt, skirtMat]] as const) {
    const g = mergeGeometries(list); if (!g) continue;
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; group.add(mesh); parts.push({ mesh, cx: t.cx, cy: t.cy });
  }
  group.userData.update = (cam: THREE.Vector3) => { for (const p of parts) p.mesh.visible = Math.hypot(p.cx - cam.x, p.cy + cam.z) < 1900; };
  return group;
}
