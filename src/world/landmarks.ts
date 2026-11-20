// Sehenswürdigkeiten und Bauwerke: Oestertalsperre, Aqua Magis, Türme der Nordhelle, Funkmasten,
// Hochspannungsleitungen. Lage aus Luftbildern/LoD2, Höhen aus DGM1 (scripts/prepare-landmarks.py).
import * as THREE from 'three';
import type { Heightfield } from './terrain';

export interface LandmarkData {
  dam: { crest: number[][]; towers: number[][]; lake: number; downstream: number[] } | null;
  aqua: null | { slides: { pts: number[][]; color: string; stripe: string | null; r: number }[]; tower: number[]; funnel: number[]; pools: number[][][]; ground: number };
  power: { pylons: number[][]; lines: [number, number][] };
  towers: [number, number, number, number, number, string][];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);   // lokal (x Ost, y Nord, z Höhe) → Three.js
const std = (color: string, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- Oestertalsperre: Bruchstein-Bogenmauer mit Krone, Brüstung, Laternen, Entnahmetürmen ----------
function masonry() {
  return canvasTex(512, 512, g => {
    g.fillStyle = '#7d776c'; g.fillRect(0, 0, 512, 512);
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < 512; y += 22) for (let x = -(y % 44); x < 512; x += 30 + r() * 26) {
      const w = 26 + r() * 30, h = 18 + r() * 6, v = 95 + r() * 60;
      g.fillStyle = `rgb(${v + 8},${v + 2},${v - 8})`; g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, (r() - 0.5) * 0.3, 0, Math.PI * 2); g.fill();
    }
  }, true);
}

function buildDam(d: NonNullable<LandmarkData['dam']>, hf: Heightfield) {
  const grp = new THREE.Group(), c = d.crest, n = c.length;
  const dsx = d.downstream[0], dsy = d.downstream[1];
  // Kronenlinie fein unterteilen (Catmull-Rom)
  const curve = new THREE.CatmullRomCurve3(c.map(p => new THREE.Vector3(p[0], p[1], p[2])));
  const pts = curve.getPoints(Math.max(40, n * 8));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const ROWS = 44, crestW = 5;
  let along = 0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b.y - a.y), ny = b.x - a.x; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * dsx + ny * dsy < 0) { nx = -nx; ny = -ny; }                       // n zeigt talwärts
    if (i) along += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    // Querschnitt: Wasserseite senkrecht (−12 m), Krone 5 m, Luftseite mit Anzug 0,65 bis zum Talboden
    const row: [number, number, number][] = [];
    row.push([-1, 0, p.z - 14], [-1, 0, p.z + 0.2], [crestW - 1, 0, p.z + 0.2]);
    for (let t = 1; t <= ROWS; t++) {
      const off = crestW - 1 + t * 0.65, z = p.z + 0.2 - t, g = hf.at(p.x + nx * off, p.y + ny * off);
      row.push([off, 0, Math.max(z, g - 1.5)]);
    }
    row.forEach(([off, , z], k) => {
      pos.push(...V(p.x + nx * off, p.y + ny * off, z).toArray());
      uv.push(along / 8, k < 3 ? k * 0.3 : (p.z - z) / 8);
    });
  });
  const per = ROWS + 3;
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < per - 1; k++) {
    const a = i * per + k, b = a + per; idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const wall = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: masonry(), roughness: 0.9, side: THREE.DoubleSide }));
  wall.castShadow = wall.receiveShadow = true; grp.add(wall);
  // Brüstungen + Laternen auf der Krone
  const stone = std('#9a948a', 0.85);
  for (const side of [-0.8, crestW - 1.2]) {
    const bp: THREE.Vector3[] = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(b.y - a.y), ny = b.x - a.x; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if (nx * dsx + ny * dsy < 0) { nx = -nx; ny = -ny; }
      return V(p.x + nx * side, p.y + ny * side, p.z + 0.65);
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bp), pts.length, 0.35, 4), stone);
    tube.castShadow = true; grp.add(tube);
  }
  for (let i = 4; i < pts.length; i += 10) {
    const p = pts[i], lamp = new THREE.Group();
    lamp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 8).translate(0, 2, 0), std('#2b2d30', 0.5, 0.6)));
    lamp.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8).translate(0, 4.2, 0), new THREE.MeshBasicMaterial({ color: '#f6f1e2' })));
    lamp.position.copy(V(p.x, p.y, p.z + 0.2)); grp.add(lamp);
  }
  // Entnahmetürme im See (rund, mit Kegeldach und Steg)
  for (const t of d.towers) {
    const top = c[0][2] + 4, h = 22;
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, h, 20).translate(0, -h / 2 + top, 0), new THREE.MeshStandardMaterial({ map: masonry(), roughness: 0.9 }));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.0, 3, 20).translate(0, top + 1.5, 0), std('#3b4045', 0.6));
    tw.position.set(t[0], 0, -t[1]); roof.position.copy(tw.position);
    tw.castShadow = roof.castShadow = true; grp.add(tw, roof);
  }
  return grp;
}

// ---------- Aqua Magis: Rutschen, Rutschenturm, Trichter, Außenbecken ----------
function stripeTex(color: string, stripe: string | null) {
  return canvasTex(64, 256, g => {
    g.fillStyle = color; g.fillRect(0, 0, 64, 256);
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, 0, 64, 6);                      // Glanzkante
    if (stripe) { g.fillStyle = stripe; for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 64, 22); }
    else { g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 64, 2); }   // Rohrstöße
  }, true);
}

function buildAqua(a: NonNullable<LandmarkData['aqua']>, hf: Heightfield) {
  const grp = new THREE.Group(), steel = std('#c9ced3', 0.4, 0.7);
  for (const s of a.slides) {
    const curve = new THREE.CatmullRomCurve3(s.pts.map(p => V(p[0], p[1], p[2])));
    const len = curve.getLength(), tex = stripeTex(s.color, s.stripe);
    tex.repeat.set(1, len / 6);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.ceil(len / 1.2), s.r, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.05 }));
    tube.castShadow = true; grp.add(tube);
    // Stützen alle ~7 m bis zum Boden
    for (let u = 0.04; u < 1; u += 7 / len) {
      const p = curve.getPointAt(u), g = hf.at(p.x, -p.z);
      if (p.y - g < 1.2) continue;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, p.y - g, 6), steel);
      post.position.set(p.x, (p.y + g) / 2, p.z); grp.add(post);
    }
  }
  // Rutschenturm: Stahlgerüst mit Treppenpodesten und Dach
  const [tx, ty, tz, th] = a.tower, tower = new THREE.Group();
  for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) tower.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, th, 0.35).translate(dx, th / 2, dz), steel));
  for (let y = 3; y < th; y += 3) tower.add(new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.25, 6.4).translate(0, y, 0), std('#8b9096', 0.6, 0.4)));
  tower.add(new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.4, 4).rotateY(Math.PI / 4).translate(0, th + 1.2, 0), std('#e8eaec', 0.5)));
  tower.position.copy(V(tx, ty, tz)); tower.traverse(o => { o.castShadow = true; }); grp.add(tower);
  // Trichterrutsche (schwarz-weiß gestreift)
  const [fx, fy, fz, fr] = a.funnel;
  const ftex = canvasTex(512, 64, g => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#1d1d1f'; g.fillRect(i * 32, 0, 32, 64); } });
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(fr, 1.4, 4.5, 48, 1, true), new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, roughness: 0.3 }));
  funnel.position.copy(V(fx, fy, fz)); funnel.castShadow = true; grp.add(funnel);
  for (let i = 0; i < 6; i++) {
    const ang = i / 6 * Math.PI * 2, px = fx + Math.cos(ang) * fr * 0.8, py = fy + Math.sin(ang) * fr * 0.8, g = hf.at(px, py);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, fz - g, 6), steel); leg.position.copy(V(px, py, (fz + g) / 2)); grp.add(leg);
  }
  // Außenbecken
  const water = waterMaterial();
  for (const poly of a.pools) {
    const sh = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
    const geo = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const m = new THREE.Mesh(geo, water); m.position.y = hf.at(cx, cy) + 0.25; grp.add(m);
    const rim = new THREE.Mesh(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#e8e4dc' })); rim.position.y = m.position.y + 0.02; grp.add(rim);
  }
  return grp;
}

export function waterMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#2d8fc4', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92 });
}

// ---------- Türme ----------
function bands(n: number, a: string, b: string) {
  return canvasTex(8, 256, g => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * 256 / n, 8, 256 / n); } });
}
/** Fernmeldeturm (Typenturm): Betonschaft, Betriebskanzeln, große Plattform, Antennenträger */
function telecomTower(h: number) {
  const g = new THREE.Group(), concrete = std('#c9c8c3', 0.85), dark = std('#5d6166', 0.6), white = std('#eeeeee', 0.6);
  const shaftH = h * 0.76;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.8, shaftH, 32).translate(0, shaftH / 2, 0), concrete));
  for (const [y, r, t] of [[h * 0.52, 8.5, 3], [h * 0.58, 10, 4.5], [h * 0.64, 9, 3]] as const) {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, t, 40).translate(0, y, 0), concrete));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.05, t * 0.45, 40, 1, true).translate(0, y, 0), dark)); // Fensterband
  }
  const pY = shaftH;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(16.5, 15.5, 1.6, 64).translate(0, pY, 0), concrete));          // Plattform Ø 33 m
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(16.4, 16.4, 1.1, 64, 1, true).translate(0, pY + 1.3, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', wireframe: true })));
  const antH = h - pY;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, antH * 0.6, 16).translate(0, pY + antH * 0.3, 0), white));
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, antH * 0.4, 12).translate(0, pY + antH * 0.8, 0), new THREE.MeshStandardMaterial({ map: bands(8, '#d1262b', '#f2f2f2') }));
  g.add(tip);
  for (let i = 0; i < 6; i++) { const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), white); dish.rotation.x = Math.PI / 2; dish.position.set(Math.cos(i) * 3.6, h * 0.6, Math.sin(i) * 3.6); dish.lookAt(Math.cos(i) * 20, h * 0.6, Math.sin(i) * 20); g.add(dish); }
  return g;
}
/** Aussichtsturm (weiß, rund, Galerie, Laterne mit rotem Dach) */
function lookoutTower(h: number) {
  const g = new THREE.Group(), white = std('#f1efe9', 0.75);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.6, h * 0.86, 28).translate(0, h * 0.43, 0), white));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.0, 0.6, 32).translate(0, h * 0.86, 0), white));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 1.0, 32, 1, true).translate(0, h * 0.86 + 0.8, 0), new THREE.MeshStandardMaterial({ color: '#dddddd', wireframe: true })));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, h * 0.08, 20).translate(0, h * 0.9, 0), std('#5c6670', 0.3, 0.5)));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(3.0, h * 0.07, 20).translate(0, h * 0.965, 0), std('#b5452f', 0.6)));
  for (let i = 0; i < 12; i++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.1), std('#3c4148', 0.3)); const a = i / 12 * Math.PI * 2; w.position.set(Math.cos(a) * 3.15, h * (0.2 + (i % 4) * 0.15), Math.sin(a) * 3.15); w.lookAt(0, w.position.y, 0); g.add(w); }
  return g;
}
/** Funkmast: rot-weiß, dreieckig abgespannt */
function radioMast(h: number) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, h, 3).translate(0, h / 2, 0), new THREE.MeshStandardMaterial({ map: bands(14, '#d1262b', '#f2f2f2'), roughness: 0.6 })));
  for (let i = 0; i < 4; i++) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.25).translate(Math.cos(i * 1.57) * 0.9, h * 0.88, Math.sin(i * 1.57) * 0.9), std('#e6e6e6', 0.5)));
  const guy: number[] = [];
  for (const f of [0.35, 0.65, 0.92]) for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.3; guy.push(0, h * f, 0, Math.cos(a) * h * 0.42, 0, Math.sin(a) * h * 0.42); }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(guy, 3));
  g.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: '#7d8287' })));
  return g;
}

// ---------- Hochspannung: Gittermasten (Donaumast) + Leiterseile ----------
function pylonLines(h: number, dir: number, x: number, y: number, z: number, out: number[], tips: THREE.Vector3[]) {
  const ca = Math.cos(dir), sa = Math.sin(dir);  // dir = Leitungsrichtung (rad, 0 = Nord); Traversen quer dazu
  const P = (u: number, v: number, w: number) => { // u quer, v längs, w Höhe (Meter)
    const ex = u * ca + v * sa, ey = -u * sa + v * ca; return [x + ex, z + w, -(y + ey)];
  };
  const seg = (a: number[], b: number[]) => out.push(...a, ...b);
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const half = (w: number) => 3.2 - (w / h) * 2.6;           // Mast verjüngt sich
  const levels = [0, 0.18, 0.36, 0.52, 0.62, 0.72, 0.82, 0.92, 1].map(f => f * h);
  for (let i = 0; i < levels.length - 1; i++) {
    const w0 = levels[i], w1 = levels[i + 1], h0 = half(w0), h1 = half(w1);
    for (let k = 0; k < 4; k++) {
      const [su, sv] = legs[k], [tu, tv] = legs[(k + 1) % 4];
      seg(P(su * h0, sv * h0, w0), P(su * h1, sv * h1, w1));                   // Eckstiel
      seg(P(su * h1, sv * h1, w1), P(tu * h1, tv * h1, w1));                   // Riegel
      seg(P(su * h0, sv * h0, w0), P(tu * h1, tv * h1, w1));                   // Diagonale
      seg(P(tu * h0, tv * h0, w0), P(su * h1, sv * h1, w1));
    }
  }
  // Traversen (unten breit, oben schmaler) + Erdseilspitze
  for (const [w, span] of [[0.62 * h, 11], [0.82 * h, 8]] as const) {
    const hw = half(w);
    for (const s of [-1, 1]) {
      seg(P(s * hw, -hw, w), P(s * span, 0, w)); seg(P(s * hw, hw, w), P(s * span, 0, w));
      seg(P(s * hw, -hw, w + 1.6), P(s * span, 0, w)); seg(P(s * hw, hw, w + 1.6), P(s * span, 0, w));
      const tip = P(s * span, 0, w - 2.5); seg(P(s * span, 0, w), tip);       // Isolatorkette
      tips.push(new THREE.Vector3(...tip));
    }
  }
  tips.push(new THREE.Vector3(...P(0, 0, h)));
}

function buildPower(p: LandmarkData['power'], hf: Heightfield) {
  const lat: number[] = [], tipsAll: THREE.Vector3[][] = [];
  for (const [x, y, , h, dir] of p.pylons) {
    const tips: THREE.Vector3[] = []; pylonLines(h, dir, x, y, hf.at(x, y) - 0.3, lat, tips); tipsAll.push(tips);
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lat, 3));
  const grp = new THREE.Group();
  grp.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#59605d' })));
  // Leiterseile mit Durchhang (Parabel)
  const cab: number[] = [];
  for (const [i, j] of p.lines) {
    const A = tipsAll[i], B = tipsAll[j];
    if (!A || !B) continue;
    for (let c = 0; c < A.length; c++) {
      // passendes Gegenstück: nächster Aufhängepunkt am anderen Mast
      let best = B[0], bd = Infinity;
      for (const b of B) { const d = Math.abs(b.y - A[c].y) * 3 + b.distanceTo(A[c]) * 0.01 + Math.abs(new THREE.Vector2(b.x - A[c].x, b.z - A[c].z).length()); if (d < bd && Math.abs(b.y - A[c].y) < 30) { bd = d; best = b; } }
      const span = A[c].distanceTo(best), sag = span * 0.035;
      let prev = A[c];
      for (let s = 1; s <= 14; s++) {
        const t = s / 14, pt = A[c].clone().lerp(best, t); pt.y -= sag * 4 * t * (1 - t);
        cab.push(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z); prev = pt;
      }
    }
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cab, 3));
  grp.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#3e4245', transparent: true, opacity: 0.85 })));
  return grp;
}

export function buildLandmarks(d: LandmarkData, hf: Heightfield) {
  const grp = new THREE.Group();
  if (d.dam) grp.add(buildDam(d.dam, hf));
  if (d.aqua) grp.add(buildAqua(d.aqua, hf));
  grp.add(buildPower(d.power, hf));
  for (const [x, y, , h, size, fn] of d.towers) {
    const base = hf.at(x, y) - 0.5;
    let m: THREE.Object3D;
    if (fn === '51002_1220') m = radioMast(h);
    else if (h > 100) m = telecomTower(h);
    else if (size > 4 && h > 35) m = lookoutTower(h);
    else m = telecomTower(h);
    m.position.copy(V(x, y, base)); m.traverse(o => { o.castShadow = true; });
    grp.add(m);
  }
  return grp;
}
