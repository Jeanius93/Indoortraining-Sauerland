// Straßenausstattung nach deutschen Regelwerken: Ortstafeln (Z 310/311), Leitpfosten, Schutzplanken,
// Straßenlaternen und Bordsteine. Positionen kommen als Streckenmeter + Seite (+1 links, −1 rechts).
import * as THREE from 'three';
import type { Route } from '../route';

export interface FurnitureData {
  towns: { from: number; to: number; name: string; sub: string }[];
  rails: { from: number; to: number; side: number }[];
  posts: [number, number][];
  lights: [number, number][];
}

const HW = (route: Route, d: number) => (route.data.surface ?? []).some(s => d >= s.from && d <= s.to) ? 1.7 : 2.8;

/** Punkt neben der Strecke: d Meter, Seite (+1 links / −1 rechts), Abstand von der Mitte, Höhe über Fahrbahn */
function place(route: Route, d: number, side: number, off: number, lift = 0) {
  const p = route.pose(d), lx = -Math.cos(p.heading), ly = Math.sin(p.heading);
  const x = p.x + lx * off * side, y = p.y + ly * off * side;
  return { pos: new THREE.Vector3(x, p.h + 0.12 + lift, -y), heading: p.heading };
}

function merge(parts: [THREE.BufferGeometry, string][]) {
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

// ---------- Ortstafel ----------
function signTexture(name: string, sub: string, exit: boolean) {
  const W = 756, H = 420, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f2c500'; g.fillRect(0, 0, W, H);                      // RAL 1023 Verkehrsgelb
  g.strokeStyle = '#111'; g.lineWidth = 14;
  const r = 22, m = 22; g.beginPath();
  g.moveTo(m + r, m); g.arcTo(W - m, m, W - m, H - m, r); g.arcTo(W - m, H - m, m, H - m, r); g.arcTo(m, H - m, m, m, r); g.arcTo(m, m, W - m, m, r); g.closePath(); g.stroke();
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 150;
  do { g.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`; size -= 4; } while (g.measureText(name).width > W - 110 && size > 40);
  g.fillText(name, W / 2, sub ? H * 0.42 : H / 2);
  if (sub) { g.font = `600 56px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`; g.fillText(sub, W / 2, H * 0.76); }
  if (exit) {                                                             // Z 311: roter Schrägbalken
    g.strokeStyle = '#c4161c'; g.lineWidth = 40; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(m + 30, H - m - 30); g.lineTo(W - m - 30, m + 30); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function townSign(name: string, sub: string, exit: boolean) {
  const grp = new THREE.Group();
  const back = new THREE.MeshStandardMaterial({ color: '#8d9298', roughness: 0.5, metalness: 0.6 });
  const face = new THREE.MeshBasicMaterial({ map: signTexture(name, sub, exit) });   // retroreflektierend → hell
  face.toneMapped = false;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.7, 0.025), [back, back, back, back, face, back]);
  plate.position.y = 2.05; plate.castShadow = true;
  grp.add(plate);
  for (const x of [-0.42, 0.42]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 2.45, 10), back);
    post.position.set(x, 1.2, -0.04); post.castShadow = true; grp.add(post);
  }
  return grp;
}

// ---------- Aufbau ----------
export function buildFurniture(route: Route, f: FurnitureData, quality: 'low' | 'high') {
  const group = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();

  // Ortstafeln: Eingang am Anfang, Ausgang am Ende der Ortslage, rechts, zur Fahrerin/zum Fahrer gewandt
  for (const t of f.towns) {
    for (const [d, exit] of [[t.from, false], [t.to, true]] as const) {
      if (d < 20 || d > route.length - 20) continue;
      const p = place(route, d, -1, HW(route, d) + 2.5, -0.1), sign = townSign(t.name, t.sub, exit);
      sign.position.copy(p.pos); sign.rotation.y = -p.heading + 0.12;    // leicht zur Fahrbahn gedreht
      group.add(sign);
    }
  }

  // Leitpfosten: weißer Pfosten, schwarzes Band, rechts ein Rechteck-, links zwei Rundstrahler
  const postGeo = merge([
    [new THREE.BoxGeometry(0.12, 0.75, 0.1).translate(0, 0.375, 0), '#f1f1ee'],
    [new THREE.BoxGeometry(0.122, 0.25, 0.102).translate(0, 0.875, 0), '#151515'],
    [new THREE.BoxGeometry(0.12, 0.02, 0.1).translate(0, 1.01, 0), '#f1f1ee'],
  ]);
  const postMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const reflR = new THREE.BoxGeometry(0.04, 0.16, 0.01).translate(0, 0.875, 0.056);
  const reflL = merge([[new THREE.CylinderGeometry(0.022, 0.022, 0.01, 10).rotateX(Math.PI / 2).translate(0, 0.92, 0.056), '#ffffff'],
    [new THREE.CylinderGeometry(0.022, 0.022, 0.01, 10).rotateX(Math.PI / 2).translate(0, 0.83, 0.056), '#ffffff']]);
  const reflMat = new THREE.MeshBasicMaterial({ color: '#ffb000' }), reflMatL = new THREE.MeshBasicMaterial({ color: '#f4f4f4' });
  const posts = new THREE.InstancedMesh(postGeo, postMat, f.posts.length);
  const rR = new THREE.InstancedMesh(reflR, reflMat, f.posts.length), rL = new THREE.InstancedMesh(reflL, reflMatL, f.posts.length);
  let nR = 0, nL = 0;
  f.posts.forEach(([d, side], i) => {
    const p = place(route, d, side, HW(route, d) + 0.75, -0.14);
    q.setFromAxisAngle(up, -p.heading);
    m.compose(p.pos, q, s1); posts.setMatrixAt(i, m);
    if (side < 0) rR.setMatrixAt(nR++, m); else rL.setMatrixAt(nL++, m);
  });
  rR.count = nR; rL.count = nL;
  posts.castShadow = quality === 'high';
  group.add(posts, rR, rL);

  // Schutzplanken: Profil (3 Streifen = Wellenform) auf Pfosten alle 2 m, Enden zum Boden geneigt
  const railMat = new THREE.MeshStandardMaterial({ color: '#b9bec3', roughness: 0.35, metalness: 0.75, side: THREE.DoubleSide });
  const railPosts: THREE.Matrix4[] = [];
  for (const r of f.rails) {
    const pos: number[] = [], idx: number[] = [];
    const prof = [[0.45, 0.02], [0.55, -0.02], [0.65, 0.02], [0.75, -0.01]];   // Höhe, Ausbuchtung
    let row = 0;
    for (let d = r.from; d <= r.to + 0.01; d += 2) {
      const ramp = Math.min(1, (d - r.from) / 6, (r.to - d) / 6);
      for (const [hgt, bulge] of prof) {
        const p = place(route, d, r.side, HW(route, d) + 0.6 + bulge, -0.12 + Math.max(0, ramp) * hgt);
        pos.push(p.pos.x, p.pos.y, p.pos.z);
      }
      if (row) for (let k = 0; k < prof.length - 1; k++) { const a = (row - 1) * prof.length + k, b = row * prof.length + k; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      if (ramp > 0.5) { const p = place(route, d, r.side, HW(route, d) + 0.68, -0.15); q.setFromAxisAngle(up, -p.heading); railPosts.push(new THREE.Matrix4().compose(p.pos, q, s1)); }
      row++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, railMat); mesh.castShadow = quality === 'high'; group.add(mesh);
  }
  const rp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.72, 0.06).translate(0, 0.36, 0), railMat, Math.max(1, railPosts.length));
  railPosts.forEach((mm, i) => rp.setMatrixAt(i, mm)); rp.count = railPosts.length; group.add(rp);

  // Straßenlaternen: Mast 7 m, Ausleger zur Fahrbahn, flacher LED-Leuchtenkopf
  const lampGeo = merge([
    [new THREE.CylinderGeometry(0.05, 0.08, 7, 8).translate(0, 3.5, 0), '#8f959b'],
    [new THREE.CylinderGeometry(0.035, 0.035, 1.3, 6).rotateZ(Math.PI / 2 - 0.12).translate(0.62, 7.05, 0), '#8f959b'],
    [new THREE.BoxGeometry(0.62, 0.09, 0.26).translate(1.35, 7.08, 0), '#3b3f44'],
    [new THREE.BoxGeometry(0.5, 0.01, 0.2).translate(1.35, 7.03, 0), '#e8eef2'],
  ]);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, f.lights.length));
  f.lights.forEach(([d, side], i) => {
    const p = place(route, d, side, HW(route, d) + 2.3, -0.12);
    q.setFromAxisAngle(up, side < 0 ? Math.PI - p.heading : -p.heading);
    m.compose(p.pos, q, s1); lamps.setMatrixAt(i, m);
  });
  lamps.count = f.lights.length; lamps.castShadow = quality === 'high';
  group.add(lamps);

  // Bordsteine innerorts (beidseitig, 12 cm hoch)
  const curbMat = new THREE.MeshLambertMaterial({ color: '#c9c7c0' });
  for (const t of f.towns) {
    for (const side of [-1, 1]) {
      const pos: number[] = [], idx: number[] = []; let row = 0;
      for (let d = t.from; d <= t.to; d += 4) {
        const hw = HW(route, d);
        for (const [off, lift] of [[hw, 0.0], [hw, 0.12], [hw + 0.2, 0.12], [hw + 0.2, 0.02]] as const) {
          const p = place(route, d, side, off, lift); pos.push(p.pos.x, p.pos.y, p.pos.z);
        }
        if (row) for (let k = 0; k < 3; k++) { const a = (row - 1) * 4 + k, b = row * 4 + k; idx.push(a, b, a + 1, a + 1, b, b + 1); }
        row++;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, curbMat); mesh.material.side = THREE.DoubleSide; mesh.receiveShadow = true; group.add(mesh);
    }
  }
  return group;
}
