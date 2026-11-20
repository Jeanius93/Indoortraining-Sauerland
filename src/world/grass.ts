// Grasbüschel und Wiesenblumen neben der Strecke (nur auf Wiesen/Bankett laut Nutzungskarte),
// in Abschnitte geteilt und nur nahe der Kamera sichtbar.
import * as THREE from 'three';
import type { Route } from '../route';
import type { Heightfield } from './terrain';
import { rng } from './noise';
import { ENS } from './lookflag';

function bladeTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d')!, r = rng(5);
  for (let i = 0; i < 140; i++) {
    const x = 8 + r() * 240, h = 90 + r() * 160, bend = (r() - 0.5) * 60, w = 2 + r() * 4;
    const grad = g.createLinearGradient(0, 256, 0, 256 - h);
    const l = 0.75 + r() * 0.5;
    grad.addColorStop(0, `rgb(${30 * l},${55 * l},${18 * l})`); grad.addColorStop(0.6, `rgb(${95 * l},${150 * l},${45 * l})`); grad.addColorStop(1, `rgb(${170 * l},${200 * l},${90 * l})`);
    g.strokeStyle = grad; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, 256); g.quadraticCurveTo(x + bend * 0.3, 256 - h * 0.6, x + bend, 256 - h); g.stroke();
  }
  for (let i = 0; i < 9; i++) {
    const x = 20 + r() * 216, y = 50 + r() * 90, col = ['#f6f3e8', '#f3d23c', '#c8a0e6', '#ffffff'][Math.floor(r() * 4)];
    g.fillStyle = col; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + Math.cos(k * 1.26) * 4, y + Math.sin(k * 1.26) * 4, 3.2, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#e8b400'; g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GrassField {
  readonly group = new THREE.Group();
  private chunks: { c: THREE.Vector3; mesh: THREE.InstancedMesh }[] = [];
  constructor(route: Route, hf: Heightfield, lu: Uint8Array, info: { px: number; w: number; h: number }, quality: 'low' | 'high') {
    const { x, y, step } = route.data, n = x.length, r = rng(21), { x0, y0 } = hf.t;
    // Büschel: drei gekreuzte Flächen, 0,6 m breit, 0,5 m hoch
    const geo = new THREE.BufferGeometry(), pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3, cx = Math.cos(a) * 0.3, cz = Math.sin(a) * 0.3, b = k * 4;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, 0.5, cz, -cx, 0.5, -cz); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const nrm = geo.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);   // Licht wie Boden
    const mat = ENS ? new THREE.MeshBasicMaterial({ map: bladeTexture(), alphaTest: 0.4, side: THREE.DoubleSide, color: new THREE.Color(0.95, 0.98, 0.85) }) : new THREE.MeshLambertMaterial({ map: bladeTexture(), alphaTest: 0.45, side: THREE.DoubleSide });
    const MEADOW = new Set([0, 1, 12, 13, 14]);
    const perMeter = ENS ? 5 : quality === 'high' ? 3.0 : 0.9, CH = 300;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (let start = 0; start < n - 1; start += Math.round(CH / step)) {
      const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
      const end = Math.min(n - 1, start + Math.round(CH / step));
      for (let k = start; k < end; k++) {
        const hw = (route.data.width?.[k] ?? 5.6) / 2, dx = x[Math.min(n - 1, k + 1)] - x[k], dy = y[Math.min(n - 1, k + 1)] - y[k], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        for (let c = 0; c < step * perMeter * 2; c++) {
          const side = r() < 0.5 ? -1 : 1, off = hw + 1.7 + Math.pow(r(), ENS ? 1.2 : 1.6) * (ENS ? 55 : 28), along = r() * step;
          const px = x[k] + dx / l * along + nx * off * side, py = y[k] + dy / l * along + ny * off * side;
          const li = Math.floor((px - x0) / info.px), lj = Math.floor((py - y0) / info.px);
          if (li < 0 || lj < 0 || li >= info.w || lj >= info.h || !MEADOW.has(lu[lj * info.w + li])) continue;
          p.set(px, hf.at(px, py) - 0.03, -py); q.setFromAxisAngle(up, r() * Math.PI);
          const sc = (ENS ? 0.9 : 1.0) + r() * 1.1; s.set(sc * 1.3, sc * (ENS ? 1.0 + r() * 0.7 : 0.8 + r() * 0.5), sc * 1.3);
          mats.push(m.compose(p, q, s).clone()); cols.push(ENS ? col.setHSL(0.22 + r() * 0.06, 0.35, 0.62 + r() * 0.2).clone() : col.setHSL(0.2 + r() * 0.07, 0.4, 0.62 + r() * 0.2).clone());
        }
      }
      if (!mats.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cols[i]); });
      im.computeBoundingSphere(); im.visible = false;
      const mid = Math.round((start + end) / 2);
      this.chunks.push({ c: new THREE.Vector3(x[mid], 0, -y[mid]), mesh: im }); this.group.add(im);
    }
  }
  update(cam: THREE.Vector3) { for (const c of this.chunks) c.mesh.visible = Math.hypot(c.c.x - cam.x, c.c.z - cam.z) < 200; }
}
