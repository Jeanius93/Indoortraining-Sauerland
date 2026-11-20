// Gemeinsame Hilfen für die belebte Welt: Nutzungskarte, Straßen- und Häuser-Abfragen,
// zusammengefügte Geometrien mit Vertexfarben und kachelweise sichtbare Instanzen.
import * as THREE from 'three';
import type { Route } from '../../route';
import type { Heightfield } from '../terrain';
import type { HouseData } from '../houses';

export const GRASS = new Set([1, 12, 13, 14]), FOREST = new Set([3, 4, 5]);

export interface LifeCtx {
  route: Route; hf: Heightfield; quality: 'low' | 'high';
  lu?: Uint8Array; luInfo?: { px: number; w: number; h: number };
  houses?: HouseData & { churches?: number[][] };
  sideRoads?: { w: number[]; p: number[][] }[];
  towns: { from: number; to: number; name: string; sub: string }[];
}

/** Welt (x Ost, y Nord, z Höhe) → Three.js */
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
/** Drehung um die Hochachse, sodass lokales +X in Weltrichtung (dx, dy) zeigt */
export const yawOf = (dx: number, dy: number) => Math.atan2(dy, dx);
const UP = new THREE.Vector3(0, 1, 0);
export function mat(x: number, y: number, z: number, yaw: number, s: number | THREE.Vector3 = 1) {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  return new THREE.Matrix4().compose(V(x, y, z), q, typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
}

export class Land {
  constructor(private ctx: LifeCtx) {}
  at(x: number, y: number) {
    const { lu, luInfo: i } = this.ctx; if (!lu || !i) return 1;
    const li = Math.floor((x - this.ctx.hf.t.x0) / i.px), lj = Math.floor((y - this.ctx.hf.t.y0) / i.px);
    return li < 0 || lj < 0 || li >= i.w || lj >= i.h ? -1 : lu[lj * i.w + li];
  }
  slope(x: number, y: number) { const h = this.ctx.hf; return Math.hypot(h.at(x + 3, y) - h.at(x - 3, y), h.at(x, y + 3) - h.at(x, y - 3)) / 6; }
}

/** Abstand zum nächsten Fahrbahnrand (Hauptstrecke + Nebenstraßen) über ein 25-m-Raster */
export class Roads {
  private grid = new Map<number, number[]>(); private segs: number[] = [];
  constructor(ctx: LifeCtx) {
    const { x, y } = ctx.route.data, w = ctx.route.data.width;
    const add = (x1: number, y1: number, x2: number, y2: number, hw: number) => {
      const s = this.segs.length / 5; this.segs.push(x1, y1, x2, y2, hw);
      const i0 = Math.floor((Math.min(x1, x2) - hw) / 25), i1 = Math.floor((Math.max(x1, x2) + hw) / 25);
      const j0 = Math.floor((Math.min(y1, y2) - hw) / 25), j1 = Math.floor((Math.max(y1, y2) + hw) / 25);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 100003 + j; (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(s); }
    };
    for (let k = 0; k < x.length - 1; k++) add(x[k], y[k], x[k + 1], y[k + 1], (w?.[k] ?? 5.6) / 2);
    for (const r of ctx.sideRoads ?? []) for (let k = 0; k < r.p.length - 1; k++) add(r.p[k][0], r.p[k][1], r.p[k + 1][0], r.p[k + 1][1], r.w[k] / 2);
  }
  /** negativ = auf der Fahrbahn; Suche bis ca. 25 m, sonst 99 */
  dist(px: number, py: number) {
    let best = 99; const ci = Math.floor(px / 25), cj = Math.floor(py / 25), seen = new Set<number>();
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const s of this.grid.get(i * 100003 + j) ?? []) {
      if (seen.has(s)) continue; seen.add(s);
      const S = this.segs, o = s * 5, ax = S[o], ay = S[o + 1], dx = S[o + 2] - ax, dy = S[o + 3] - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t) - S[o + 4]);
    }
    return best;
  }
}

/** Häuser-Grundrisse für Kollisionsprüfungen */
export class Houses {
  private grid = new Map<number, number[]>();
  constructor(readonly list: number[][]) {
    list.forEach((h, i) => {
      const r = Math.hypot(h[3], h[4]) / 2 + 1;
      for (let a = Math.floor((h[0] - r) / 25); a <= Math.floor((h[0] + r) / 25); a++) for (let b = Math.floor((h[1] - r) / 25); b <= Math.floor((h[1] + r) / 25); b++) {
        const k = a * 100003 + b; (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(i);
      }
    });
  }
  inside(x: number, y: number, margin = 0.5, skip = -1) {
    for (const i of this.grid.get(Math.floor(x / 25) * 100003 + Math.floor(y / 25)) ?? []) {
      if (i === skip) continue;
      const [cx, cy, ang, L, W] = this.list[i], c = Math.cos(ang), s = Math.sin(ang), dx = x - cx, dy = y - cy;
      if (Math.abs(dx * c + dy * s) < L / 2 + margin && Math.abs(-dx * s + dy * c) < W / 2 + margin) return true;
    }
    return false;
  }
}

/** Mehrere Teile zu einer Geometrie mit Vertexfarben zusammenfügen */
export function merge(parts: [THREE.BufferGeometry, string | THREE.Color][]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [];
  for (const [g0, color] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0; if (!g.attributes.normal) g.computeVertexNormals();
    const c = new THREE.Color(color);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    if (g.attributes.uv) uv.push(...g.attributes.uv.array); else for (let i = 0; i < g.attributes.position.count; i++) uv.push(0, 0);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
export const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
export const cyl = (r1: number, r2: number, h: number, x = 0, y = 0, z = 0, seg = 8) => new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y, z);

/** Statische Instanzen, in 500-m-Kacheln geteilt und nur nahe der Kamera sichtbar */
export class StaticSet {
  readonly group = new THREE.Group();
  private kinds = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean; items: Map<number, { m: THREE.Matrix4[]; c: (THREE.Color | null)[] }> }>();
  private chunks: { c: THREE.Vector3; mesh: THREE.InstancedMesh; shadow: boolean }[] = [];
  constructor(private far = 450) {}
  kind(name: string, geo: THREE.BufferGeometry, material: THREE.Material, shadow = false) { this.kinds.set(name, { geo, mat: material, shadow, items: new Map() }); }
  add(name: string, m: THREE.Matrix4, color: THREE.Color | null = null) {
    const k = this.kinds.get(name)!, e = new THREE.Vector3().setFromMatrixPosition(m);
    const key = Math.floor(e.x / 500) * 100003 + Math.floor(e.z / 500);
    const it = k.items.get(key) ?? k.items.set(key, { m: [], c: [] }).get(key)!; it.m.push(m); it.c.push(color);
  }
  build() {
    for (const k of this.kinds.values()) for (const it of k.items.values()) {
      const im = new THREE.InstancedMesh(k.geo, k.mat, it.m.length);
      const c = new THREE.Vector3();
      it.m.forEach((m, i) => { im.setMatrixAt(i, m); c.add(new THREE.Vector3().setFromMatrixPosition(m)); if (it.c[i]) im.setColorAt(i, it.c[i]!); });
      if (it.c.some(x => x)) it.c.forEach((x, i) => { if (!x) im.setColorAt(i, new THREE.Color(1, 1, 1)); });
      im.computeBoundingSphere(); im.visible = false; im.receiveShadow = true;
      this.chunks.push({ c: c.divideScalar(it.m.length), mesh: im, shadow: k.shadow }); this.group.add(im);
    }
    return this;
  }
  update(cam: THREE.Vector3) {
    for (const ch of this.chunks) { const d = Math.hypot(ch.c.x - cam.x, ch.c.z - cam.z); ch.mesh.visible = d < this.far + 200; ch.mesh.castShadow = ch.shadow && d < 400; }
  }
}

/** Punkt neben der Strecke: Streckenmeter d, Seite (+1 links / −1 rechts), Abstand von der Mitte */
export function beside(route: Route, d: number, side: number, off: number) {
  const p = route.pose(d), lx = -Math.cos(p.heading), ly = Math.sin(p.heading);
  return { x: p.x + lx * off * side, y: p.y + ly * off * side, h: p.h, heading: p.heading };
}
export const halfWidth = (route: Route, d: number) => (route.data.surface ?? []).some(s => d >= s.from && d <= s.to) ? 1.7
  : (route.data.width?.[Math.min(route.n - 1, Math.max(0, Math.round(route.wrap(d) / route.data.step)))] ?? 5.6) / 2;
export const isRadweg = (route: Route, d: number) => (route.data.surface ?? []).some(s => d >= s.from && d <= s.to);
export const inTown = (ctx: LifeCtx, d: number) => ctx.towns.some(t => d >= t.from && d <= t.to);

/** weiche, runde Partikel-Textur */
export function softDot() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv);
}
