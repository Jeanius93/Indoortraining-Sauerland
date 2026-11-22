// Rand der Landstraßen: Weidezäune entlang der Wiesen, Hochsitze am Waldrand, Holzstapel im Wald,
// Wanderwegweiser (SGV) an Feld- und Waldwegen.
import * as THREE from 'three';
import { rng } from '../noise';
import { type LifeCtx, Land, Roads, Houses, StaticSet, merge, box, cyl, mat, beside, halfWidth, inTown, FOREST } from './common';

function hikeTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const g = cv.getContext('2d')!;
  g.fillStyle = '#f4f4f0'; g.beginPath(); g.moveTo(0, 0); g.lineTo(220, 0); g.lineTo(256, 48); g.lineTo(220, 96); g.lineTo(0, 96); g.fill();
  g.fillStyle = '#1a1a1a'; g.font = '700 34px Arial'; g.textBaseline = 'middle'; g.fillText('SGV', 70, 50);
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 7; g.beginPath(); g.moveTo(16, 24); g.lineTo(52, 72); g.moveTo(52, 24); g.lineTo(16, 72); g.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Roadside {
  readonly set = new StaticSet(450);
  readonly group = new THREE.Group();
  constructor(ctx: LifeCtx, land: Land, roads: Roads, houses: Houses | null) {
    const S = this.set, { route, hf } = ctx, r = rng(91), { step } = route.data, n = route.n;
    const lam = new THREE.MeshLambertMaterial({ vertexColors: true });
    S.kind('post', merge([[box(0.11, 1.35, 0.11, 0, 0.6, 0), '#7a5c3c']]), lam);
    S.kind('wire', merge([[box(1, 0.015, 0.015, 0.5, 0.55, 0), '#bfc3c6'], [box(1, 0.015, 0.015, 0.5, 0.95, 0), '#bfc3c6']]), new THREE.MeshBasicMaterial({ vertexColors: true }));
    const legs = (x: number, z: number) => box(0.12, 4.4, 0.12, x * 0.85, 2.1, z * 0.85).rotateX(-z * 0.12).rotateZ(x * 0.12) as THREE.BufferGeometry;
    S.kind('stand', merge([
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z]) => [legs(x, z), '#6b5034'] as [THREE.BufferGeometry, string]),
      [box(1.6, 0.1, 1.6, 0, 3.6, 0), '#7a5c3c'], [box(1.5, 1.3, 1.5, 0, 4.3, 0), '#6e5236'], [box(1.0, 0.35, 0.05, 0, 4.5, 0.76), '#1f1d1a'],
      [box(1.9, 0.08, 1.9, 0, 5.0, 0).rotateX(0.12), '#3b3f38'],
      [box(0.08, 3.9, 0.08, -0.3, 1.8, 1.4).rotateX(0.38), '#7a5c3c'], [box(0.08, 3.9, 0.08, 0.3, 1.8, 1.4).rotateX(0.38), '#7a5c3c'],
      ...[0.4, 1.0, 1.6, 2.2, 2.8, 3.3].map(h => [box(0.64, 0.05, 0.06, 0, h, 2.08 - h * 0.39), '#7a5c3c'] as [THREE.BufferGeometry, string]),
    ]), lam, true);
    const logs: [THREE.BufferGeometry, string][] = [];
    for (let row = 0; row < 4; row++) for (let k = 0; k < 7 - row; k++) logs.push([cyl(0.17 + (k % 3) * 0.02, 0.17, 4.2, 0, 0, 0, 9).rotateZ(Math.PI / 2).translate(0, 0.18 + row * 0.31, (k - (6 - row) / 2) * 0.36), k % 2 ? '#8a6a45' : '#9c7a50']);
    S.kind('logs', merge(logs), lam, true);
    const hike = new THREE.MeshLambertMaterial({ map: hikeTexture(), side: THREE.DoubleSide, alphaTest: 0.5 });
    S.kind('hikepost', merge([[box(0.1, 2.3, 0.1, 0, 1.15, 0), '#7a5c3c']]), lam);
    S.kind('hikesign', new THREE.PlaneGeometry(0.6, 0.22).translate(0.32, 0, 0), hike);

    const side0 = (k: number, side: number, off: number) => {
      const a = Math.min(n - 2, k), dx = route.data.x[a + 1] - route.data.x[a], dy = route.data.y[a + 1] - route.data.y[a], l = Math.hypot(dx, dy) || 1;
      return [route.data.x[a] - dy / l * off * side, route.data.y[a] + dx / l * off * side] as const;
    };

    // ---------- Weidezäune ----------
    for (const side of [-1, 1]) {
      let prev: [number, number] | null = null, acc = 0;
      for (let k = 0; k < n - 1; k++) {
        const d = k * step, hw = halfWidth(route, d), [x, y] = side0(k, side, hw + 2.9), [x2, y2] = side0(k, side, hw + 9);
        const ok = !inTown(ctx, d) && !(route.data.overlap ?? []).some(o => d > o[0] && d < o[1]) && land.at(x, y) === 1 && land.at(x2, y2) === 1 && roads.dist(x, y) > 1.8 && !houses?.inside(x, y, 2);
        if (!ok) { prev = null; continue; }
        acc += step; if (prev && acc < 3.3) continue; acc = 0;
        const z = hf.at(x, y) - 0.05;
        S.add('post', mat(x, y, z, r() * 0.2));
        if (prev) {
          const [px, py] = prev, len = Math.hypot(x - px, y - py);
          if (len < 8) { const pz = hf.at(px, py) - 0.05, m = mat(px, py, pz, Math.atan2(y - py, x - px), new THREE.Vector3(len, 1, 1)); S.add('wire', m.multiply(new THREE.Matrix4().set(1, 0, 0, 0, z - pz, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1))); }
        }
        prev = [x, y];
      }
    }

    // ---------- Hochsitze am Waldrand ----------
    let lastStand = -1e9;
    for (let k = 0; k < n - 1; k += Math.round(60 / step)) {
      const d = k * step; if (d - lastStand < 600 || inTown(ctx, d) || r() > 0.5) continue;
      const side = r() < 0.5 ? -1 : 1;
      for (let off = 25; off < 140; off += 6) {
        const [x, y] = side0(k, side, off), [fx, fy] = side0(k, side, off + 9);
        if ((land.at(x, y) === 1 || land.at(x, y) === 2) && FOREST.has(land.at(fx, fy)) && roads.dist(x, y) > 12 && land.slope(x, y) < 0.35) {
          const yaw = Math.atan2(y - fy, x - fx) - Math.PI / 2;       // Leiter zur Wiese
          S.add('stand', mat(x, y, hf.at(x, y) - 0.1, yaw)); lastStand = d; break;
        }
      }
    }

    // ---------- Holzstapel am Waldweg ----------
    let lastLogs = -1e9;
    for (let k = 0; k < n - 1; k += Math.round(50 / step)) {
      const d = k * step; if (d - lastLogs < 700 || inTown(ctx, d) || r() > 0.35) continue;
      const side = r() < 0.5 ? -1 : 1, hw = halfWidth(route, d), [x, y] = side0(k, side, hw + 3.4), [bx, by] = side0(k, side, hw + 8);
      if (!FOREST.has(land.at(bx, by)) || roads.dist(x, y) < 2 || land.slope(x, y) > 0.3) continue;
      const p = beside(route, d, side, hw + 3.4);
      S.add('logs', mat(x, y, hf.at(x, y) - 0.05, Math.PI / 2 - p.heading)); lastLogs = d;
    }

    // ---------- Wanderwegweiser an Wegen ----------
    let lastHike = -1e9;
    for (let k = 0; k < n - 1; k++) {
      const d = k * step; if (d - lastHike < 450 || inTown(ctx, d)) continue;
      for (const side of [-1, 1]) {
        const hw = halfWidth(route, d), [wx, wy] = side0(k, side, hw + 3.5);
        if (land.at(wx, wy) !== 10) continue;
        const [x, y] = side0(k + 2, side, hw + 2.2);
        if (roads.dist(x, y) < 1 || land.at(x, y) === 10) continue;
        const z = hf.at(x, y) - 0.05, p = route.pose(d), back = Math.atan2(-Math.cos(p.heading), -Math.sin(p.heading));
        S.add('hikepost', mat(x, y, z, 0));
        S.add('hikesign', mat(x, y, z + 2.0, Math.atan2(wy - y, wx - x)));
        S.add('hikesign', mat(x, y, z + 1.7, back + (r() - 0.5) * 0.4));
        lastHike = d; break;
      }
    }
    S.build(); this.group.add(S.group);
  }
  update(cam: THREE.Vector3) { this.set.update(cam); }
}

