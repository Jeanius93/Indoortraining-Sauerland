// Dörfer: Gärten (Hecken, Zäune, Mülltonnen, Briefkästen, Gartenmöbel, Wäschespinnen),
// Ortsmitten (Kirchtürme aus den amtlichen Gebäudedaten, Bänke, Bushaltestellen, Wegweiser)
// und Rauchfahnen aus Schornsteinen.
import * as THREE from 'three';
import { rng } from '../noise';
import { type LifeCtx, Land, Roads, Houses, StaticSet, merge, box, cyl, mat, beside, halfWidth, V, FOREST, softDot } from './common';

const BIN = ['#4a4d52', '#1f5fa8', '#7a5432', '#e8c21c'];

function geometries() {
  const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hedge = new THREE.MeshLambertMaterial({ color: '#3d5a26' });
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe3ea', transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1, depthWrite: false });
  const tex = (draw: (g: CanvasRenderingContext2D) => void) => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; draw(cv.getContext('2d')!); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const picketMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, map: tex(g => {
    g.fillStyle = '#d8cfb8'; for (let i = 0; i < 10; i++) { const x = 4 + i * 25.4; g.beginPath(); g.moveTo(x, 128); g.lineTo(x, 12); g.lineTo(x + 7.5, 2); g.lineTo(x + 15, 12); g.lineTo(x + 15, 128); g.fill(); }
    g.fillStyle = '#b8ad94'; g.fillRect(0, 34, 256, 8); g.fillRect(0, 88, 256, 8); g.fillStyle = '#a89c80'; g.fillRect(0, 0, 8, 128); }) });
  const meshMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: 0.4, map: tex(g => {
    g.strokeStyle = '#3c4a39'; g.lineWidth = 2; for (let i = 0; i < 256; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); } for (let j = 2; j < 128; j += 14) { g.beginPath(); g.moveTo(0, j); g.lineTo(256, j); g.stroke(); }
    g.fillStyle = '#2f3a2f'; g.fillRect(0, 0, 6, 128); g.fillRect(0, 0, 256, 5); }) });
  return {
    lambert, hedge, glass, picketMat, meshMat,
    hedgeG: box(1.0, 1.0, 0.7, 0, 0.5, 0),
    picket: box(2, 0.95, 0.03, 0, 0.47, 0),
    mesh: box(2, 1.2, 0.02, 0, 0.6, 0),
    wood: merge([[box(0.1, 1.0, 0.1, -0.95, 0.5, 0), '#6b5034'], ...[0.25, 0.55, 0.85].map(h => [box(2, 0.1, 0.03, 0, h, 0.04), '#86663f'] as [THREE.BufferGeometry, string])]),
    bin: merge([[box(0.58, 1.0, 0.72, 0, 0.5, 0), '#ffffff'], [box(0.62, 0.05, 0.78, 0.0, 1.02, 0), '#ffffff'], [cyl(0.1, 0.1, 0.05, -0.28, 0.1, 0.3, 10).rotateX(Math.PI / 2), '#111'], [cyl(0.1, 0.1, 0.05, -0.28, 0.1, -0.3, 10).rotateX(Math.PI / 2), '#111']]),
    mailbox: merge([[box(0.06, 1.0, 0.06, 0, 0.5, 0), '#3a3d42'], [box(0.36, 0.42, 0.18, 0, 1.15, 0), '#2d3238'], [box(0.3, 0.03, 0.01, 0, 1.28, 0.095), '#d8d8d8']]),
    table: merge([[box(1.4, 0.05, 0.85, 0, 0.74, 0), '#8a6a45'], ...[[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]].map(([x, z]) => [box(0.06, 0.72, 0.06, x, 0.36, z), '#6e5234'] as [THREE.BufferGeometry, string]),
      ...[[-0.35, 0.75], [0.35, 0.75], [-0.35, -0.75], [0.35, -0.75]].map(([x, z]) => [box(0.45, 0.45, 0.45, x, 0.23, z), '#efefea'] as [THREE.BufferGeometry, string]),
      [cyl(0.03, 0.03, 2.2, 0, 1.1, 0, 6), '#d9d9d4'], [new THREE.ConeGeometry(1.3, 0.45, 8).translate(0, 2.1, 0), '#e3dfd2']]),
    dryer: merge([[cyl(0.03, 0.03, 1.9, 0, 0.95, 0, 6), '#c8ccd0'], ...[0, 1, 2, 3].map(k => [box(2.4, 0.03, 0.03, 0, 1.85, 0).rotateY(k * Math.PI / 4), '#c8ccd0'] as [THREE.BufferGeometry, string]),
      [box(0.5, 0.6, 0.02, 0.7, 1.55, 0), '#e9e6e0'], [box(0.4, 0.5, 0.02, -0.6, 1.6, 0.25).rotateY(0.8), '#5d7fb0'], [box(0.6, 0.45, 0.02, 0.1, 1.62, -0.75).rotateY(1.6), '#c84f4f'], [box(0.35, 0.55, 0.02, -0.2, 1.57, 0.7).rotateY(1.4), '#f2d36b']]),
    bench: merge([[box(1.8, 0.05, 0.42, 0, 0.45, 0), '#7c5a3a'], [box(1.8, 0.35, 0.05, 0, 0.75, -0.2), '#7c5a3a'], [box(0.06, 0.45, 0.4, -0.8, 0.22, 0), '#3b3d42'], [box(0.06, 0.45, 0.4, 0.8, 0.22, 0), '#3b3d42']]),
  };
}

function tableSign(lines: string[]) {
  const W = 600, H = 120 + lines.length * 110, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d')!;
  g.fillStyle = '#f2c500'; g.fillRect(0, 0, W, H); g.strokeStyle = '#111'; g.lineWidth = 12; g.strokeRect(14, 14, W - 28, H - 28);
  g.fillStyle = '#111'; g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = 85 + i * 110; const [name, km] = l.split('|');
    g.beginPath(); g.moveTo(48, y + 30); g.lineTo(48, y - 10); g.lineTo(32, y - 10); g.lineTo(62, y - 42); g.lineTo(92, y - 10); g.lineTo(76, y - 10); g.lineTo(76, y + 30); g.fill();
    let s = 76; do { g.font = `700 ${s}px "Barlow Condensed","Arial Narrow",Arial,sans-serif`; s -= 3; } while (g.measureText(name).width > W - 260 && s > 30);
    g.textAlign = 'left'; g.fillText(name, 120, y); g.textAlign = 'right'; g.font = `700 70px "Barlow Condensed","Arial Narrow",Arial,sans-serif`; g.fillText(km, W - 42, y);
  });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return { t, aspect: H / W };
}
function busSignTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d')!;
  g.fillStyle = '#f2c500'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#11704a'; g.lineWidth = 10; g.stroke();
  g.fillStyle = '#11704a'; g.font = '700 84px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 64, 68);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function clockTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d')!;
  g.fillStyle = '#1d2228'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#d4af37'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#d4af37'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(64 + Math.cos(a) * 48 - 3, 64 + Math.sin(a) * 48 - 3, 6, 6); }
  g.strokeStyle = '#d4af37'; g.lineCap = 'round'; g.lineWidth = 7; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 30); g.stroke(); g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(92, 74); g.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Village {
  readonly group = new THREE.Group();
  readonly set = new StaticSet(300);
  private smoke: Smoke | null = null;
  constructor(ctx: LifeCtx, land: Land, roads: Roads, houses: Houses | null) {
    const G = geometries(), S = this.set, r = rng(55), { route } = ctx;
    S.kind('hedge', G.hedgeG, G.hedge, true); S.kind('picket', G.picket, G.picketMat); S.kind('mesh', G.mesh, G.meshMat); S.kind('wood', G.wood, G.lambert);
    S.kind('bin', G.bin, new THREE.MeshLambertMaterial({ vertexColors: true }), true); S.kind('mailbox', G.mailbox, G.lambert); S.kind('table', G.table, G.lambert, true);
    S.kind('dryer', G.dryer, G.lambert, true); S.kind('bench', G.bench, G.lambert, true);
    const hf = ctx.hf, routeNear = (x: number, y: number) => roads.dist(x, y);

    // ---------- Gärten ----------
    if (houses) houses.list.forEach((h, hi) => {
      const [cx, cy, ang, L, W, , eave] = h;
      if (L * W > 380 || L * W < 40 || eave > 9 || routeNear(cx, cy) > 60) return;
      const lc = land.at(cx, cy); if (lc !== 6 && lc !== 13 && lc !== 1) return;
      const c = Math.cos(ang), s = Math.sin(ang), mg = 3 + r() * 3.5, ha = L / 2 + mg, hb = W / 2 + mg;
      const wp = (a: number, b: number) => [cx + c * a - s * b, cy + s * a + c * b] as const;
      // Seite zur Straße: die Kante, deren Mitte der Straße am nächsten liegt
      const edges = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ea, eb]) => { const [x, y] = wp(ea * ha, eb * hb); return { ea, eb, d: routeNear(x, y) }; });
      const front = edges.reduce((a, b) => (b.d < a.d ? b : a));
      const style = r(), kind = style < 0.42 ? 'hedge' : style < 0.66 ? 'picket' : style < 0.82 ? 'mesh' : style < 0.9 ? 'wood' : '';
      const ok = (x: number, y: number, gap = 0.9) => routeNear(x, y) > gap && !houses.inside(x, y, 0.4, hi) && !FOREST.has(land.at(x, y)) && land.at(x, y) !== 8;
      if (kind) for (const e of edges) {
        const len = e.ea ? hb * 2 : ha * 2, seg = kind === 'hedge' ? 1.0 : 2.0, nseg = Math.floor(len / seg);
        const yaw = e.ea ? ang + Math.PI / 2 : ang, hh = 0.85 + r() * 0.5;
        let run: number[] = [];
        const flush = () => {            // Hecke: zusammenhängende Stücke als ein langer Quader
          if (!run.length) return;
          const t = (run[0] + run[run.length - 1]) / 2, [x, y] = e.ea ? wp(e.ea * ha, t) : wp(t, e.eb * hb);
          S.add('hedge', mat(x, y, hf.at(x, y) - 0.05, yaw, new THREE.Vector3(run.length * seg, hh, 1))); run = [];
        };
        for (let k = 0; k < nseg; k++) {
          const t = -len / 2 + (k + 0.5) * seg;
          const [x, y] = e.ea ? wp(e.ea * ha, t) : wp(t, e.eb * hb);
          if ((e === front && Math.abs(t) < 1.8) || !ok(x, y) || (kind === 'hedge' && run.length >= 8)) { flush(); if ((e === front && Math.abs(t) < 1.8) || !ok(x, y)) continue; }
          if (kind === 'hedge') run.push(t); else S.add(kind, mat(x, y, hf.at(x, y) - 0.05, yaw));
        }
        flush();
      }
      // Briefkasten und Mülltonnen an der Einfahrt
      const fa = front.ea * (front.ea ? ha - 0.5 : 0), fb = front.eb * (front.eb ? hb - 0.5 : 0);
      const along = front.ea ? [0, 1] : [1, 0];
      if (r() < 0.8) { const [x, y] = wp(fa + along[0] * 2.3, fb + along[1] * 2.3); if (ok(x, y, 0.5)) S.add('mailbox', mat(x, y, hf.at(x, y) - 0.05, Math.atan2(y - cy, x - cx))); }
      if (r() < 0.7) {
        const nb = 2 + Math.floor(r() * 2), sgn = r() < 0.5 ? -1 : 1;
        for (let b = 0; b < nb; b++) {
          const off = sgn * (2.6 + b * 0.7), [x, y] = wp(fa * 0.82 + along[0] * off, fb * 0.82 + along[1] * off);
          if (ok(x, y, 0.6)) S.add('bin', mat(x, y, hf.at(x, y) - 0.03, Math.atan2(cy - y, cx - x) + (r() - 0.5) * 0.3), new THREE.Color(BIN[(b + Math.floor(r() * 4)) % 4]));
        }
      }
      // Garten hinter dem Haus: Sitzgruppe oder Wäschespinne
      const ba = -front.ea * (L / 2 + mg * 0.5), bb = -front.eb * (W / 2 + mg * 0.5);
      if (mg > 4 && r() < 0.45) {
        const [x, y] = wp(ba + along[0] * (r() - 0.5) * 3, bb + along[1] * (r() - 0.5) * 3);
        if (ok(x, y, 2.5) && !houses.inside(x, y, 1.6, hi) && !houses.inside(x, y, 0.9)) S.add(r() < 0.55 ? 'table' : 'dryer', mat(x, y, hf.at(x, y) - 0.04, ang + r() * 3));
      }
    });

    // ---------- Kirchtürme ----------
    const plaster = new THREE.MeshLambertMaterial({ color: '#e8e2d6' }), stone = new THREE.MeshLambertMaterial({ color: '#8f877a' });
    const slate = new THREE.MeshStandardMaterial({ color: '#2f3338', roughness: 0.6, metalness: 0.15 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d4af37', roughness: 0.3, metalness: 0.9 });
    const dark = new THREE.MeshLambertMaterial({ color: '#1e2226' });
    const clock = new THREE.MeshBasicMaterial({ map: clockTexture() });
    for (const [tx, ty, base, tip, side, ang] of ctx.houses?.churches ?? []) {
      const t = new THREE.Group(), shaft = Math.max(10, tip * 0.6), helm = tip - shaft;
      const body = new THREE.Mesh(new THREE.BoxGeometry(side, shaft + 2, side).translate(0, (shaft + 2) / 2 - 2, 0), r() < 0.7 ? plaster : stone);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(side * 0.74, helm, 4).rotateY(Math.PI / 4).translate(0, shaft + helm / 2, 0), slate);
      const eaves = new THREE.Mesh(new THREE.BoxGeometry(side + 0.4, 0.3, side + 0.4).translate(0, shaft, 0), slate);
      const cross = new THREE.Mesh(merge([[box(0.12, 1.6, 0.12, 0, 0.8, 0), '#fff'], [box(0.8, 0.12, 0.12, 0, 1.1, 0), '#fff'], [new THREE.SphereGeometry(0.22, 10, 8).translate(0, 0, 0), '#fff']]).translate(0, tip, 0), gold);
      body.castShadow = roof.castShadow = true; t.add(body, roof, eaves, cross);
      for (let k = 0; k < 4; k++) {
        const face = new THREE.Group(); face.rotation.y = k * Math.PI / 2;
        const lou = new THREE.Mesh(new THREE.BoxGeometry(side * 0.22, 1.6, 0.1).translate(0, shaft - 2.4, side / 2 + 0.01), dark);
        const lou2 = lou.clone(); lou.position.x = -side * 0.18; lou2.position.x = side * 0.18;
        const ck = new THREE.Mesh(new THREE.CircleGeometry(Math.min(0.9, side * 0.2), 24).translate(0, shaft - 4.6, side / 2 + 0.03), clock);
        face.add(lou, lou2, ck); t.add(face);
      }
      t.position.copy(V(tx, ty, base)); t.rotation.y = ang; this.group.add(t);
      // zwei Bänke in der Nähe
      for (let b = 0, tries = 0; b < 2 && tries < 12; tries++) {
        const a = r() * Math.PI * 2, dd = side + 4 + r() * 8, x = tx + Math.cos(a) * dd, y = ty + Math.sin(a) * dd;
        if (roads.dist(x, y) > 1.2 && !houses?.inside(x, y, 1.2) && !FOREST.has(land.at(x, y))) { S.add('bench', mat(x, y, hf.at(x, y) - 0.03, Math.atan2(ty - y, tx - x) - Math.PI / 2)); b++; }
      }
    }

    // ---------- Bushaltestellen ----------
    const shelter = merge([[box(0.08, 2.4, 0.08, -1.45, 1.2, -0.7), '#4a4f55'], [box(0.08, 2.4, 0.08, 1.45, 1.2, -0.7), '#4a4f55'], [box(0.08, 2.4, 0.08, -1.45, 1.2, 0.6), '#4a4f55'], [box(0.08, 2.4, 0.08, 1.45, 1.2, 0.6), '#4a4f55'],
      [box(3.2, 0.12, 1.7, 0, 2.45, 0), '#5a5f66'], [box(2.4, 0.05, 0.4, 0, 0.48, -0.48), '#7c5a3a'], [box(0.06, 0.45, 0.06, -1, 0.24, -0.48), '#3b3d42'], [box(0.06, 0.45, 0.06, 1, 0.24, -0.48), '#3b3d42']]);
    const panes = merge([[box(2.9, 2.0, 0.02, 0, 1.3, -0.72), '#fff'], [box(0.02, 2.0, 1.2, -1.47, 1.3, -0.1), '#fff'], [box(0.02, 2.0, 1.2, 1.47, 1.3, -0.1), '#fff']]);
    const busSign = new THREE.MeshBasicMaterial({ map: busSignTexture() });
    for (const tw of ctx.towns) {
      if (tw.to - tw.from < 250) continue;
      for (const [frac, side] of [[0.5, -1], [0.5, 1]] as const) {
        if (side > 0 && r() < 0.5) continue;
        for (let tries = 0; tries < 8; tries++) {
          const d = tw.from + (tw.to - tw.from) * frac + (tries % 2 ? 1 : -1) * tries * 15 + (side > 0 ? 12 : 0), hw = halfWidth(route, d);
          const p = beside(route, d, side, hw + 2.6), fx = Math.sin(p.heading), fy = Math.cos(p.heading);
          if ([-1.8, 0, 1.8].some(a => houses?.inside(p.x + fx * a, p.y + fy * a, 1.2) || roads.dist(p.x + fx * a, p.y + fy * a) < 0.8)) continue;
          const yaw = Math.atan2(fy, fx) + (side < 0 ? Math.PI : 0), m = mat(p.x, p.y, p.h + 0.1, yaw);
          const g1 = new THREE.Mesh(shelter, G.lambert), g2 = new THREE.Mesh(panes, G.glass);
          g1.applyMatrix4(m); g2.applyMatrix4(m); g1.castShadow = true; this.group.add(g1, g2);
          const sp = beside(route, d + 2.5 * (side < 0 ? 1 : -1), side, hw + 0.9);
          const pole = new THREE.Mesh(cyl(0.04, 0.04, 2.6, 0, 1.3, 0, 8), G.lambert.clone()); (pole.material as THREE.MeshLambertMaterial).vertexColors = false; (pole.material as THREE.MeshLambertMaterial).color.set('#9aa0a6');
          const sign = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24).translate(0, 2.55, 0.05), busSign);
          const back = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24).rotateY(Math.PI).translate(0, 2.55, 0.04), busSign);
          for (const o of [pole, sign, back]) { o.position.copy(V(sp.x, sp.y, sp.h + 0.1)); o.rotation.y = -sp.heading; this.group.add(o); }
          break;
        }
      }
    }

    // ---------- Wegweiser an den Ortsausgängen ----------
    const towns = [...ctx.towns].sort((a, b) => a.from - b.from), L = route.length;
    towns.forEach((tw, i) => {
      const ahead: string[] = [];
      for (let k = 1; k < towns.length && ahead.length < 2; k++) {
        const nx = towns[(i + k) % towns.length]; if (!route.loop && i + k >= towns.length) break;
        let dist = nx.from - tw.to; if (dist < 0) dist += L;
        if (nx.name !== tw.name && !ahead.some(a => a.startsWith(nx.name + '|'))) ahead.push(`${nx.name}|${Math.max(1, Math.round(dist / 1000))}`);
      }
      const d = tw.to + 45; if (!ahead.length || (!route.loop && d > L - 30)) return;
      const hw = halfWidth(route, d), p = beside(route, d, -1, hw + 2.4);
      if (houses?.inside(p.x, p.y, 0.6) || roads.dist(p.x, p.y) < 0.6) return;
      const { t, aspect } = tableSign(ahead), w = 1.5, hgt = w * aspect;
      const back = new THREE.MeshStandardMaterial({ color: '#8d9298', roughness: 0.5, metalness: 0.6 }), face = new THREE.MeshBasicMaterial({ map: t }); face.toneMapped = false;
      const grp = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 0.03), [back, back, back, back, face, back]); plate.position.y = 1.6 + hgt / 2; plate.castShadow = true;
      grp.add(plate); for (const x of [-0.5, 0.5]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7 + hgt, 10), back); post.position.set(x, (1.7 + hgt) / 2, -0.05); grp.add(post); }
      grp.position.copy(V(p.x, p.y, p.h)); grp.rotation.y = -p.heading + 0.12; this.group.add(grp);
    });

    // ---------- Schornsteinrauch ----------
    if (houses) {
      const list: number[][] = [];
      houses.list.forEach(h => {
        const [cx, cy, ang, Ln, W, base, , ridge, kind, , , chim] = h;
        if (!chim || (kind !== 2 && kind !== 3)) return;
        const hh = Math.abs(Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453) % 1; if (hh > 0.35) return;
        const hl = Ln / 2, hw = W / 2, rh = kind === 3 ? Math.max(0, hl - hw) : hl + 0.35, a = rh * 0.45, b = -0.4;
        list.push([cx + Math.cos(ang) * a - Math.sin(ang) * b, cy + Math.sin(ang) * a + Math.cos(ang) * b, base + ridge + 1.1]);
      });
      if (list.length) { this.smoke = new Smoke(list, ctx.quality); this.group.add(this.smoke.points); }
    }
    S.build(); this.group.add(S.group);
  }
  update(dt: number, cam: THREE.Vector3, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) { this.smoke?.update(dt, cam, renderer, camera); }
}

class Smoke {
  readonly points: THREE.Points;
  private active: number[][] = []; private timer = 0; private P = 12; private n: number;
  private age: Float32Array;
  constructor(private list: number[][], quality: 'low' | 'high') {
    this.n = quality === 'high' ? 14 : 8;
    const N = this.n * this.P, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(N), 1));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(new Float32Array(N), 1));
    this.age = new Float32Array(N).map((_, i) => (i % this.P) / this.P);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDot() }, scale: { value: 500 }, fogColor: { value: new THREE.Color('#c9d6d2') }, fogDensity: { value: 0.0006 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; uniform float scale; varying float vA; varying float vD; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * scale / max(1.0, -mv.z); vA = aAlpha; vD = -mv.z; }',
      fragmentShader: 'uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity; varying float vA; varying float vD; void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.01) discard; float f = 1.0 - exp(-pow(fogDensity * vD, 2.0)); gl_FragColor = vec4(mix(vec3(0.86, 0.86, 0.84), fogColor, f), a); }',
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false;
  }
  update(dt: number, cam: THREE.Vector3, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1;
      const cx = cam.x, cy = -cam.z;
      this.active = this.list.map(c => [Math.hypot(c[0] - cx, c[1] - cy), ...c]).filter(c => c[0] < 380).sort((a, b) => a[0] - b[0]).slice(0, this.n).map(c => c.slice(1));
    }
    const u = (this.points.material as THREE.ShaderMaterial).uniforms;
    u.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute, size = this.points.geometry.attributes.aSize as THREE.BufferAttribute, al = this.points.geometry.attributes.aAlpha as THREE.BufferAttribute;
    const LIFE = 7, t = performance.now() / 1000;
    for (let e = 0; e < this.n; e++) for (let k = 0; k < this.P; k++) {
      const i = e * this.P + k, c = this.active[e];
      this.age[i] = (this.age[i] + dt / LIFE) % 1;
      if (!c) { al.setX(i, 0); continue; }
      const a = this.age[i], rise = a * LIFE;
      pos.setXYZ(i, c[0] + rise * 0.9 + Math.sin(t * 0.7 + i) * 0.3 * a, c[2] + rise * 0.55 + a * a * 1.5, -(c[1] + rise * 0.35));
      size.setX(i, 0.5 + a * 3.2); al.setX(i, Math.sin(Math.min(1, a * 6) * Math.PI / 2) * (1 - a) * 0.32);
    }
    pos.needsUpdate = size.needsUpdate = al.needsUpdate = true;
  }
}
