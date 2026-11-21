// Tiere: Kühe und Schafe auf den Weiden (grasen, schauen auf, gehen ein paar Schritte),
// Vogelschwärme und ein kreisender Greifvogel, Schmetterlinge und Pollen in der Sonne.
import * as THREE from 'three';
import { rng } from '../noise';
import { type LifeCtx, Land, Roads, Houses, merge, box, V, softDot } from './common';

// ---------- Weidetiere ----------
function spots() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d')!, r = rng(9);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#151515';
  for (let i = 0; i < 9; i++) { g.beginPath(); const x = r() * 128, y = r() * 128; for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, rr = 10 + r() * 14; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); } g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TYPES = {
  // Rumpf (eingefärbt), Rest (Beine usw.), Kopf (am Hals, dreht sich), Halsgelenk
  cow: () => ({
    body: box(1.55, 0.72, 0.62, 0, 1.0, 0),
    rest: merge([
      ...[[-0.58, -0.2], [-0.58, 0.2], [0.55, -0.2], [0.55, 0.2]].map(([x, z]) => [box(0.15, 0.68, 0.15, x, 0.36, z), '#e9e4dc'] as [THREE.BufferGeometry, string]),
      ...[[-0.58, -0.2], [-0.58, 0.2], [0.55, -0.2], [0.55, 0.2]].map(([x, z]) => [box(0.16, 0.08, 0.16, x, 0.04, z), '#2b2622'] as [THREE.BufferGeometry, string]),
      [box(0.3, 0.16, 0.3, -0.35, 0.6, 0), '#e8b4a8'], [box(0.06, 0.7, 0.06, -0.8, 0.85, 0).rotateZ(0.02), '#2a2420'],
    ]),
    head: merge([[box(0.5, 0.32, 0.3, 0.27, -0.05, 0), '#1c1a19'], [box(0.14, 0.24, 0.26, 0.55, -0.1, 0), '#d9b5aa'],
      [box(0.08, 0.06, 0.5, 0.08, 0.1, 0), '#e8e2d2'], [box(0.06, 0.12, 0.2, 0.12, 0.02, 0.22), '#1c1a19'], [box(0.06, 0.12, 0.2, 0.12, 0.02, -0.22), '#1c1a19']]),
    neck: new THREE.Vector3(0.72, 1.18, 0), len: 2.2, colors: ['#ffffff', '#ffffff', '#ffffff', '#8a4b2a', '#6b3a22', '#c99a6a'],
  }),
  sheep: () => ({
    body: new THREE.IcosahedronGeometry(0.5, 1).scale(1.35, 0.95, 0.95).translate(0, 0.72, 0),
    rest: merge([...[[-0.38, -0.17], [-0.38, 0.17], [0.38, -0.17], [0.38, 0.17]].map(([x, z]) => [box(0.08, 0.45, 0.08, x, 0.22, z), '#2a2522'] as [THREE.BufferGeometry, string])]),
    head: merge([[box(0.34, 0.24, 0.2, 0.17, -0.05, 0), '#2a2522'], [box(0.06, 0.06, 0.38, 0.06, 0.06, 0), '#2a2522']]),
    neck: new THREE.Vector3(0.58, 0.85, 0), len: 1.3, colors: ['#ece6d6', '#e3dccb', '#f1ece0', '#d8d0bd'],
  }),
};
type Kind = keyof typeof TYPES;
interface Animal { x: number; y: number; yaw: number; tx: number; ty: number; state: number; t: number; pitch: number; turn: number; scale: number; color: THREE.Color }
interface Herd { kind: Kind; cx: number; cy: number; r: number; animals: Animal[]; body: THREE.InstancedMesh; rest: THREE.InstancedMesh; head: THREE.InstancedMesh; neck: THREE.Vector3 }

export class Animals {
  readonly group = new THREE.Group();
  private herds: Herd[] = [];
  private birds: Birds; private bugs: Butterflies; private pollen: Pollen;
  constructor(private ctx: LifeCtx, land: Land, roads: Roads, houses: Houses | null) {
    const { route } = ctx, { x, y, step } = route.data, r = rng(77), n = x.length;
    const geos = { cow: TYPES.cow(), sheep: TYPES.sheep() };
    const cowMat = new THREE.MeshLambertMaterial({ map: spots() }), sheepMat = new THREE.MeshLambertMaterial({ flatShading: true });
    const restMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const ok = (px: number, py: number, roadGap: number) => land.at(px, py) === 1 && roads.dist(px, py) > roadGap && !(houses?.inside(px, py, 6)) && land.slope(px, py) < 0.32;
    const every = Math.round(140 / step), prob = ctx.quality === 'high' ? 0.32 : 0.18;
    for (let k = 0; k < n - 1; k += every) for (const side of [-1, 1]) {
      if (r() > prob) continue;
      const dx = x[k + 1] - x[k], dy = y[k + 1] - y[k], l = Math.hypot(dx, dy) || 1, off = 35 + Math.pow(r(), 1.3) * 260;
      const cx = x[k] - dy / l * off * side, cy = y[k] + dx / l * off * side;
      if (!ok(cx, cy, 14)) continue;
      const kind: Kind = r() < 0.65 ? 'cow' : 'sheep', g = geos[kind];
      const want = kind === 'cow' ? 3 + Math.floor(r() * 7) : 6 + Math.floor(r() * 12), rad = kind === 'cow' ? 20 : 13;
      const animals: Animal[] = [];
      const herdCol = g.colors[Math.floor(r() * g.colors.length)];
      for (let t = 0; t < want * 4 && animals.length < want; t++) {
        const ax = cx + (r() - 0.5) * 2 * rad, ay = cy + (r() - 0.5) * 2 * rad;
        if (!ok(ax, ay, 5) || animals.some(a => Math.hypot(a.x - ax, a.y - ay) < g.len * 0.9)) continue;
        const col = new THREE.Color(r() < 0.7 ? herdCol : g.colors[Math.floor(r() * g.colors.length)]).multiplyScalar(0.92 + r() * 0.12);
        animals.push({ x: ax, y: ay, yaw: r() * Math.PI * 2, tx: ax, ty: ay, state: 0, t: r() * 12, pitch: -0.9, turn: 0, scale: 0.9 + r() * 0.2, color: col });
      }
      if (animals.length < 2) continue;
      const herd: Herd = {
        kind, cx, cy, r: rad, animals, neck: g.neck,
        body: new THREE.InstancedMesh(g.body, kind === 'cow' ? cowMat : sheepMat, animals.length),
        rest: new THREE.InstancedMesh(g.rest, restMat, animals.length),
        head: new THREE.InstancedMesh(g.head, restMat, animals.length),
      };
      animals.forEach((a, i) => herd.body.setColorAt(i, a.color));
      for (const m of [herd.body, herd.rest, herd.head]) { m.visible = false; m.boundingSphere = new THREE.Sphere(V(cx, cy, this.ctx.hf.at(cx, cy)), rad + 6); this.group.add(m); }
      this.herds.push(herd); this.pose(herd);
    }
    this.birds = new Birds(ctx); this.bugs = new Butterflies(ctx, land, roads); this.pollen = new Pollen(ctx, land);
    this.group.add(this.birds.group, this.bugs.group, this.pollen.points);
  }

  private pose(h: Herd) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), hm = new THREE.Matrix4(), e = new THREE.Euler();
    h.animals.forEach((a, i) => {
      const z = this.ctx.hf.at(a.x, a.y) - 0.04;
      q.setFromAxisAngle(up, a.yaw); s.setScalar(a.scale); m.compose(V(a.x, a.y, z), q, s);
      h.body.setMatrixAt(i, m); h.rest.setMatrixAt(i, m);
      e.set(0, a.turn, a.pitch, 'YXZ'); hm.makeRotationFromEuler(e).setPosition(h.neck); h.head.setMatrixAt(i, hm.premultiply(m));
    });
    h.body.instanceMatrix.needsUpdate = h.rest.instanceMatrix.needsUpdate = h.head.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, cam: THREE.Vector3, rider: THREE.Vector3) {
    for (const h of this.herds) {
      const d = Math.hypot(h.cx - cam.x, -h.cy - cam.z);
      const vis = d < 750; for (const m of [h.body, h.rest, h.head]) { m.visible = vis; m.castShadow = d < 60; }
      if (!vis || d > 250) continue;
      const r = Math.random;
      for (const a of h.animals) {
        a.t -= dt;
        if (a.t <= 0) {        // 0 grasen · 1 aufschauen · 2 gehen
          a.state = r() < 0.55 ? 0 : r() < 0.5 ? 1 : 2; a.t = a.state === 0 ? 5 + r() * 14 : a.state === 1 ? 2 + r() * 4 : 3 + r() * 5;
          if (a.state === 2) { const ang = r() * Math.PI * 2, rr = r() * h.r * 0.8; a.tx = h.cx + Math.cos(ang) * rr; a.ty = h.cy + Math.sin(ang) * rr; }
          a.turn = a.state === 1 ? (r() - 0.5) * 1.2 : (r() - 0.5) * 0.3;
        }
        const target = a.state === 0 ? -0.95 + Math.sin(performance.now() / 700 + a.x) * 0.06 : a.state === 1 ? 0.15 : -0.15;
        a.pitch += (target - a.pitch) * Math.min(1, dt * 2.5);
        if (a.state === 2) {
          const dx = a.tx - a.x, dy = a.ty - a.y, l = Math.hypot(dx, dy);
          if (l < 0.5) { a.state = 0; a.t = 6 + r() * 10; continue; }
          const want = Math.atan2(dy, dx); let dyaw = want - a.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
          a.yaw += Math.sign(dyaw) * Math.min(Math.abs(dyaw), dt * 0.8);
          if (Math.abs(dyaw) < 0.6) { const v = (h.kind === 'cow' ? 0.45 : 0.6) * dt; a.x += Math.cos(a.yaw) * v; a.y += Math.sin(a.yaw) * v; }
        }
      }
      this.pose(h);
    }
    this.birds.update(dt, rider); this.bugs.update(dt, cam); this.pollen.update(dt, cam);
  }
}

// ---------- Vögel ----------
class Birds {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh; private wl: THREE.InstancedMesh; private wr: THREE.InstancedMesh;
  private flocks: { cx: number; cy: number; alt: number; rad: number; a: number; w: number; n: number; size: number; raptor: boolean }[] = [];
  private total = 0;
  constructor(private ctx: LifeCtx) {
    const mat = new THREE.MeshLambertMaterial({ color: '#2b2a28', side: THREE.DoubleSide });
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0.12, 0, 0, -0.1, 0, 0, -0.05, 0, 0.42, 0.12, 0, 0, -0.05, 0, 0.42, 0.04, 0, 0.36], 3)); wing.computeVertexNormals();
    const n = ctx.quality === 'high' ? 3 : 2;
    for (let i = 0; i < n; i++) this.flocks.push({ cx: 0, cy: 0, alt: 0, rad: 0, a: 0, w: 0, n: 10 + i * 4, size: 1, raptor: false });
    this.flocks.push({ cx: 0, cy: 0, alt: 0, rad: 0, a: 0, w: 0, n: 1, size: 3.2, raptor: true });
    this.total = this.flocks.reduce((s, f) => s + f.n, 0);
    this.body = new THREE.InstancedMesh(box(0.3, 0.06, 0.07), mat, this.total);
    this.wl = new THREE.InstancedMesh(wing, mat, this.total); this.wr = new THREE.InstancedMesh(wing.clone().scale(1, 1, -1), mat, this.total);
    for (const m of [this.body, this.wl, this.wr]) { m.frustumCulled = false; this.group.add(m); }
  }
  private respawn(f: Birds['flocks'][number], rider: THREE.Vector3, first: boolean) {
    const r = Math.random, ang = r() * Math.PI * 2, dist = first ? 80 + r() * 300 : 350 + r() * 300;
    f.cx = rider.x + Math.cos(ang) * dist; f.cy = -rider.z + Math.sin(ang) * dist;
    f.rad = f.raptor ? 45 + r() * 30 : 60 + r() * 140; f.w = (f.raptor ? 0.12 : 0.18 + r() * 0.15) * (r() < 0.5 ? 1 : -1);
    f.alt = (f.raptor ? 70 : 30) + r() * 45; f.a = r() * Math.PI * 2;
  }
  update(dt: number, rider: THREE.Vector3) {
    const t = performance.now() / 1000, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), wm = new THREE.Matrix4();
    let i = 0;
    for (const f of this.flocks) {
      if (!f.rad || Math.hypot(f.cx - rider.x, -f.cy - rider.z) > 900) this.respawn(f, rider, !f.rad);
      f.a += f.w * dt;
      const ground = this.ctx.hf.at(f.cx, f.cy);
      for (let k = 0; k < f.n; k++, i++) {
        const lag = k * 0.035, a = f.a - lag * Math.sign(f.w);
        const jx = Math.sin(t * 0.7 + k * 1.7) * 6, jy = Math.cos(t * 0.5 + k * 2.3) * 6, jz = Math.sin(t * 0.9 + k) * 3;
        const px = f.cx + Math.cos(a) * (f.rad + jx), py = f.cy + Math.sin(a) * (f.rad + jy);
        const heading = a + Math.PI / 2 * Math.sign(f.w);
        const flap = f.raptor ? (Math.sin(t * 0.4) > 0.85 ? Math.sin(t * 9) * 0.6 : 0.12) : Math.sin(t * 13 + k * 1.3) * 0.75;
        e.set(0, Math.atan2(Math.sin(heading), Math.cos(heading)), -0.25 * Math.sign(f.w) * (f.raptor ? 0.6 : 0.3), 'YXZ'); q.setFromEuler(e);
        s.setScalar(f.size); m.compose(V(px, py, ground + f.alt + jz), q, s);
        this.body.setMatrixAt(i, m);
        wm.makeRotationX(-flap); this.wl.setMatrixAt(i, wm.clone().premultiply(m));
        wm.makeRotationX(flap); this.wr.setMatrixAt(i, wm.premultiply(m));
      }
    }
    this.body.instanceMatrix.needsUpdate = this.wl.instanceMatrix.needsUpdate = this.wr.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Schmetterlinge ----------
class Butterflies {
  readonly group = new THREE.Group();
  private wl: THREE.InstancedMesh; private wr: THREE.InstancedMesh;
  private b: { x: number; y: number; z: number; vx: number; vy: number; ph: number; alive: boolean }[] = [];
  constructor(private ctx: LifeCtx, private land: Land, private roads: Roads) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d')!;
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(26, 22, 22, 18, -0.4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(22, 46, 14, 13, 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(30, 20, 5, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(0.11, 0.11).rotateX(-Math.PI / 2).translate(0, 0, 0.055);
    const n = ctx.quality === 'high' ? 36 : 16;
    this.wl = new THREE.InstancedMesh(geo, mat, n); this.wr = new THREE.InstancedMesh(geo.clone().scale(1, 1, -1), mat, n);
    const cols = ['#f4f1e6', '#f6d64a', '#f08a2c', '#9fc4ff', '#ffffff', '#f4f1e6'];
    for (let i = 0; i < n; i++) { const c = new THREE.Color(cols[i % cols.length]); this.wl.setColorAt(i, c); this.wr.setColorAt(i, c); this.b.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, ph: Math.random() * 9, alive: false }); }
    for (const m of [this.wl, this.wr]) { m.frustumCulled = false; this.group.add(m); }
  }
  update(dt: number, cam: THREE.Vector3) {
    const t = performance.now() / 1000, m = new THREE.Matrix4(), q = new THREE.Quaternion(), wm = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const cx = cam.x, cy = -cam.z;
    this.b.forEach((b, i) => {
      if (!b.alive || Math.hypot(b.x - cx, b.y - cy) > 45) {
        b.alive = false;
        for (let tries = 0; tries < 3 && !b.alive; tries++) {
          const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 34, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
          const lc = this.land.at(x, y);
          if ((lc === 1 || lc === 12 || lc === 13 || lc === 14) && this.roads.dist(x, y) > 1.5) { b.x = x; b.y = y; b.z = 0.4 + Math.random() * 0.8; b.alive = true; }
        }
      }
      if (!b.alive) { m.makeScale(0, 0, 0); this.wl.setMatrixAt(i, m); this.wr.setMatrixAt(i, m); return; }
      b.vx += (Math.random() - 0.5) * dt * 6; b.vy += (Math.random() - 0.5) * dt * 6;
      const sp = Math.hypot(b.vx, b.vy); if (sp > 1.4) { b.vx *= 1.4 / sp; b.vy *= 1.4 / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      const z = this.ctx.hf.at(b.x, b.y) + b.z + Math.sin(t * 3 + b.ph) * 0.25;
      q.setFromAxisAngle(up, Math.atan2(b.vy, b.vx)); m.compose(V(b.x, b.y, z), q, one);
      const flap = 0.2 + Math.abs(Math.sin(t * 16 + b.ph)) * 1.2;
      wm.makeRotationX(-flap); this.wl.setMatrixAt(i, wm.clone().premultiply(m));
      wm.makeRotationX(flap); this.wr.setMatrixAt(i, wm.premultiply(m));
    });
    this.wl.instanceMatrix.needsUpdate = this.wr.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Pollen ----------
class Pollen {
  readonly points: THREE.Points;
  private base: Float32Array; private fade = 0; private timer = 0;
  constructor(private ctx: LifeCtx, private land: Land) {
    const n = ctx.quality === 'high' ? 280 : 120; this.base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.base[i * 3] = Math.random() * 60 - 30; this.base[i * 3 + 1] = Math.random() * 6; this.base[i * 3 + 2] = Math.random() * 60 - 30; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.06, map: softDot(), transparent: true, opacity: 0, depthWrite: false, color: '#fff3c8', blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false;
  }
  update(dt: number, cam: THREE.Vector3) {
    this.timer -= dt;
    if (this.timer <= 0) {         // über Wiesen sichtbar, im Wald und im Ort kaum
      this.timer = 1; let g = 0;
      for (let k = 0; k < 9; k++) { const c = this.land.at(cam.x + (k % 3 - 1) * 15, -cam.z + (Math.floor(k / 3) - 1) * 15); if (c === 1 || c === 12 || c === 14 || c === 13) g++; }
      this.fade = g / 9;
    }
    const mat = this.points.material as THREE.PointsMaterial; mat.opacity += (this.fade * 0.8 - mat.opacity) * Math.min(1, dt);
    const t = performance.now() / 1000, p = this.points.geometry.attributes.position as THREE.BufferAttribute, b = this.base;
    for (let i = 0; i < p.count; i++) {
      const wrap = (v: number) => ((v % 60) + 90) % 60 - 30;
      const x = wrap(b[i * 3] + t * 0.35 - cam.x) + cam.x, zz = wrap(b[i * 3 + 2] + t * 0.12 - cam.z) + cam.z;
      const y = this.ctx.hf.at(x, -zz) + 0.3 + b[i * 3 + 1] + Math.sin(t * 0.8 + i) * 0.3;
      p.setXYZ(i, x + Math.sin(t * 0.6 + i * 1.3) * 0.4, y, zz);
    }
    p.needsUpdate = true;
  }
}
