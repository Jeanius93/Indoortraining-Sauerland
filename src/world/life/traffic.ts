// Verkehr: Autos überholen (mit Abstand, warten bei Gegenverkehr), Gegenverkehr, parkende Autos in den Orten.
// Die Fahrerin/der Fahrer fährt rechts; auf Radwegen gibt es keinen Autoverkehr.
import * as THREE from 'three';
import { rng } from '../noise';
import { inRoundabout } from '../roads';
import { type LifeCtx, Land, Roads, Houses, StaticSet, merge, box, cyl, mat, beside, halfWidth, isRadweg, inTown, V } from './common';

const COLORS = ['#e8e8e6', '#1d1f22', '#8b9096', '#c4c7cb', '#24324f', '#6e1b1b', '#2f4a39', '#f2f2f0', '#3a3d42', '#9a2c22', '#d8d2c4', '#174a7c'];

function carGeometry() {
  const body = merge([
    [box(4.25, 0.62, 1.78, 0, 0.62, 0), '#ffffff'], [box(1.0, 0.12, 1.7, 1.55, 0.98, 0), '#ffffff'],
    [box(2.2, 0.12, 1.62, -0.25, 1.46, 0), '#ffffff'],
    [box(0.12, 0.5, 1.6, 0.98, 1.18, 0).rotateZ(0), '#ffffff'],
  ]);
  const detail = merge([
    [box(2.25, 0.46, 1.6, -0.25, 1.18, 0), '#1b2026'],                       // Fenster
    [box(0.6, 0.48, 1.58, 0.85, 1.18, 0).rotateZ(0), '#1b2026'],
    ...[[1.35, 0.86], [1.35, -0.86], [-1.3, 0.86], [-1.3, -0.86]].map(([x, z]) => [cyl(0.33, 0.33, 0.24, 0, 0, 0, 14).rotateX(Math.PI / 2).translate(x, 0.33, z), '#161616'] as [THREE.BufferGeometry, string]),
    [box(0.04, 0.12, 0.32, 2.13, 0.78, 0.6), '#f4f2e8'], [box(0.04, 0.12, 0.32, 2.13, 0.78, -0.6), '#f4f2e8'],
    [box(0.04, 0.1, 0.36, -2.13, 0.82, 0.62), '#b01414'], [box(0.04, 0.1, 0.36, -2.13, 0.82, -0.62), '#b01414'],
    [box(0.05, 0.16, 0.52, -2.14, 0.55, 0), '#e7e7e0'], [box(0.05, 0.12, 0.5, 2.14, 0.5, 0), '#e7e7e0'],   // Kennzeichen
  ]);
  return { body, detail };
}

interface Car { dir: number; d: number; v: number; lat: number; wait: number; color: THREE.Color; on: boolean }

export class Traffic {
  readonly group = new THREE.Group();
  readonly parked: StaticSet;
  private cars: Car[] = [];
  private body: THREE.InstancedMesh; private detail: THREE.InstancedMesh;
  constructor(private ctx: LifeCtx, land: Land, roads: Roads, houses: Houses | null) {
    const { route } = ctx, g = carGeometry(), r = rng(31);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 });
    const detMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2 });
    const n = ctx.quality === 'high' ? 10 : 6;
    this.body = new THREE.InstancedMesh(g.body, bodyMat, n); this.detail = new THREE.InstancedMesh(g.detail, detMat, n);
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color(COLORS[Math.floor(r() * COLORS.length)]); this.body.setColorAt(i, c);
      this.cars.push({ dir: i % 2 ? -1 : 1, d: 0, v: 0, lat: 0, wait: r() * 20, color: c, on: false });
    }
    for (const m of [this.body, this.detail]) { m.frustumCulled = false; m.castShadow = true; this.group.add(m); }

    // parkende Autos am Straßenrand innerorts
    this.parked = new StaticSet(500);
    this.parked.kind('body', g.body, bodyMat, true); this.parked.kind('detail', g.detail, detMat, true);
    // Autos stehen quer in Einfahrten/Stellplätzen hinter dem Gehweg (nicht auf Gehweg oder Fahrbahn)
    for (const t of ctx.towns) for (let d = t.from + 30; d < t.to - 30; d += 14) {
      if (r() > 0.3 || isRadweg(route, d)) continue;
      const side = r() < 0.5 ? -1 : 1, hw = halfWidth(route, d), p = beside(route, d, side, hw + 2.3 + 2.4);
      const fx = Math.sin(p.heading), fy = Math.cos(p.heading), ox = -Math.cos(p.heading) * side, oy = Math.sin(p.heading) * side;
      const z = this.ctx.hf.at(p.x, p.y);
      if (Math.abs(z - p.h) > 0.8) continue;
      let bad = false;
      for (const a of [-1.3, 0, 1.3]) for (const b of [-2.3, -1.1, 0, 1.1, 2.3]) {
        const x = p.x + fx * a + ox * b, y = p.y + fy * a + oy * b, lc = land.at(x, y);
        if (houses?.inside(x, y, 0.5) || roads.dist(x, y) < 0.5 || lc === 8 || lc === 2 || lc === 3 || lc === 4 || lc === 5 || Math.abs(this.ctx.hf.at(x, y) - z) > 0.45) bad = true;
      }
      if (bad) continue;
      const m = mat(p.x, p.y, z - 0.02, Math.atan2(oy, ox) + (r() < 0.6 ? Math.PI : 0));
      this.parked.add('body', m, new THREE.Color(COLORS[Math.floor(r() * COLORS.length)])); this.parked.add('detail', m);
      d += 8;
    }
    this.parked.build(); this.group.add(this.parked.group);
  }

  /** Seitlicher Versatz der Fahrerin/des Fahrers nach rechts (m) */
  riderOffset(d: number) {
    let s = 0; for (const o of [-12, -6, 0, 6, 12]) { const dd = this.ctx.route.wrap(d + o); s += isRadweg(this.ctx.route, dd) ? 0 : Math.max(0, halfWidth(this.ctx.route, dd) - 1.15); }
    return s / 5;
  }

  private rel(a: number, b: number) { const L = this.ctx.route.length; let x = a - b; if (this.ctx.route.loop) x = ((x % L) + 1.5 * L) % L - L / 2; return x; }

  update(dt: number, riderD: number, riderSpeed: number, riderLat: number) {
    const route = this.ctx.route, L = route.length, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    const hide = (i: number) => { m.makeScale(0, 0, 0); this.body.setMatrixAt(i, m); this.detail.setMatrixAt(i, m); };
    this.cars.forEach((c, i) => {
      if (!c.on) {
        c.wait -= dt; hide(i);
        if (c.wait > 0) return;
        c.d = c.dir > 0 ? riderD - 500 - Math.random() * 400 : riderD + 700 + Math.random() * 700;
        if (!route.loop && (c.d < 0 || c.d > L)) { c.wait = 5; return; }
        c.d = route.wrap(c.d); c.on = true; c.v = -1; c.lat = c.dir > 0 ? -2 : 2;
      }
      const dd = route.wrap(c.d), hw = halfWidth(route, dd), town = inTown(this.ctx, dd), p = route.pose(dd);
      let vmax = (town ? 13 : 20) * (0.9 + (i % 4) * 0.05);
      vmax = Math.min(vmax, Math.sqrt(3.2 / Math.max(1e-4, Math.abs(p.curvature))));
      const rel = this.rel(c.d, riderD);
      let lat = c.dir > 0 ? -hw * 0.5 : hw * 0.5;
      if (c.dir > 0 && rel > -45 && rel < 9 && hw > 2.3) {
        // hinter dem Rad: überholen nur ohne Gegenverkehr, sonst dahinter bleiben
        const blocked = this.cars.some(o => o.on && o.dir < 0 && this.rel(o.d, c.d) > -25 && this.rel(o.d, c.d) < 170);
        const passing = c.lat > -hw * 0.5 + 0.6;
        if (blocked && !passing && rel < -8) vmax = Math.min(vmax, rel < -14 ? riderSpeed + 1 : riderSpeed * 0.95);
        else lat = Math.min(hw * 0.5, -riderLat + 2.6);
      }
      for (const o of this.cars) if (o !== c && o.on && o.dir === c.dir) { const g = this.rel(o.d, c.d) * c.dir; if (g > 0 && g < 14 && Math.abs(o.lat - c.lat) < 1.5) vmax = Math.min(vmax, o.v * 0.95); }
      if (c.v < 0) c.v = vmax;
      c.v = Math.max(0, c.v + Math.max(-4 * dt, Math.min(2.2 * dt, vmax - c.v)));
      c.lat += Math.max(-1.6 * dt, Math.min(1.6 * dt, lat - c.lat));
      c.d += c.v * c.dir * dt;
      const off = this.rel(c.d, riderD);
      if ((c.dir > 0 && off > 1300) || (c.dir < 0 && off < -250) || (!route.loop && (c.d < 0 || c.d > L))) { c.on = false; c.wait = 2 + Math.random() * 25; hide(i); return; }
      if (isRadweg(route, dd)) { hide(i); return; }
      if (c.dir < 0 && inRoundabout(route, dd, 12)) { hide(i); return; }   // Gegenverkehr würde im Kreisel falsch herum fahren
      const lx = -Math.cos(p.heading), ly = Math.sin(p.heading);
      const x = p.x + lx * c.lat, y = p.y + ly * c.lat;
      const fx = Math.sin(p.heading) * c.dir, fy = Math.cos(p.heading) * c.dir;
      e.set(0, Math.atan2(fy, fx), Math.atan(p.grade / 100) * c.dir, 'YXZ'); q.setFromEuler(e);
      m.compose(V(x, y, p.h + 0.1), q, one); this.body.setMatrixAt(i, m); this.detail.setMatrixAt(i, m);
    });
    this.body.instanceMatrix.needsUpdate = this.detail.instanceMatrix.needsUpdate = true;
  }
}
