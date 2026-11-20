// Häuser sauber aufgebaut (Testkopie): Rechteck-Grundriss, Wände bis zur Traufe, Giebel, Dach mit Überstand
// (Satteldach, Walmdach, Pultdach, Zeltdach, Flachdach), Ortgang-/Traufbretter, Schornsteine.
import * as THREE from 'three';

export interface HouseData { palette: string[]; houses: number[][] }   // [cx, cy, ang, L, W, base, eave, ridge, kind, facade, roofColor, chimney]

const OVER_E = 0.5, OVER_G = 0.35, SINK = 1.5;

export function buildHouses(data: HouseData, material: THREE.Material, chunk = 1000) {
  const groups = new Map<string, number[][]>();
  for (const h of data.houses) { const k = `${Math.floor(h[0] / chunk)}_${Math.floor(h[1] / chunk)}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(h); }
  const pal = data.palette.map(c => new THREE.Color(c));
  const out = new THREE.Group(), chims: THREE.Matrix4[] = [];
  for (const list of groups.values()) {
    const P: number[] = [], C: number[] = [], W: number[] = [], B: number[] = [], M: number[] = [], E: number[] = [];
    for (const [cx, cy, ang, L, Wd, base, eave, ridge, kind, fac, rc, chim] of list) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // lokal (a entlang Firstrichtung, b quer, z Höhe über Grund) → Welt (Three.js)
      const pt = (a: number, b: number, z: number) => [cx + ca * a - sa * b, base + z, -(cy + sa * a + ca * b)];
      const roofCol = pal[rc] ?? pal[0];
      const tri = (p: number[][], u: number[], wallLen: number, isRoof: boolean) => {
        for (let i = 0; i < 3; i++) {
          P.push(...p[i]); W.push(u[i], wallLen); B.push(base); E.push(eave);
          M.push(fac + (isRoof ? 8 : 0));
          const c = isRoof ? roofCol : new THREE.Color(1, 1, 1); C.push(c.r, c.g, c.b);
        }
      };
      const quad = (a: number[], b: number[], c: number[], d: number[], ua: number[], len: number, roof: boolean) => { tri([a, b, c], [ua[0], ua[1], ua[2]], len, roof); tri([a, c, d], [ua[0], ua[2], ua[3]], len, roof); };
      const hl = L / 2, hw = Wd / 2, z0 = -SINK;
      // Wände (Langseiten bis Traufe; Schmalseiten je nach Dachform mit Giebel)
      quad(pt(-hl, -hw, z0), pt(hl, -hw, z0), pt(hl, -hw, eave), pt(-hl, -hw, eave), [0, L, L, 0], L, false);
      const shedHigh = kind === 1;
      const eB = shedHigh ? ridge : eave;
      quad(pt(hl, hw, z0), pt(-hl, hw, z0), pt(-hl, hw, eB), pt(hl, hw, eB), [0, L, L, 0], L, false);
      for (const s of [-1, 1]) {
        const a = s * hl, bl = -s * hw, br = s * hw;   // Blick von außen: von links nach rechts
        const zl = shedHigh ? (bl > 0 ? ridge : eave) : eave, zr = shedHigh ? (br > 0 ? ridge : eave) : eave;
        quad(pt(a, bl, z0), pt(a, br, z0), pt(a, br, zr), pt(a, bl, zl), [0, Wd, Wd, 0], Wd, false);
        if (kind === 2) tri([pt(a, bl, eave), pt(a, br, eave), pt(a, 0, ridge)], [0, Wd, Wd / 2], Wd, false);     // Giebeldreieck
      }
      // Dach
      if (kind === 0) {
        const o = 0.15; quad(pt(-hl - o, -hw - o, eave), pt(hl + o, -hw - o, eave), pt(hl + o, hw + o, eave), pt(-hl - o, hw + o, eave), [0, 0, 0, 0], 0, true);
      } else if (kind === 1) {
        const slope = (ridge - eave) / Wd, dz = slope * OVER_E;
        quad(pt(-hl - OVER_G, -hw - OVER_E, eave - dz), pt(hl + OVER_G, -hw - OVER_E, eave - dz), pt(hl + OVER_G, hw + OVER_E, ridge + dz), pt(-hl - OVER_G, hw + OVER_E, ridge + dz), [0, 0, 0, 0], 0, true);
      } else {
        const slope = (ridge - eave) / hw, dz = slope * OVER_E;
        const rh = kind === 3 ? Math.max(0, hl - hw) : kind === 4 ? 0 : hl + OVER_G;   // halbe Firstlänge
        const ex = kind === 2 ? hl + OVER_G : hl + OVER_E;
        for (const s of [-1, 1]) {   // Traufseiten
          quad(pt(-ex, s * (hw + OVER_E), eave - dz), pt(ex, s * (hw + OVER_E), eave - dz), pt(rh, 0, ridge), pt(-rh, 0, ridge), [0, 0, 0, 0], 0, true);
        }
        if (kind !== 2) for (const s of [-1, 1]) tri([pt(s * ex, -(hw + OVER_E), eave - dz), pt(s * ex, hw + OVER_E, eave - dz), pt(s * rh, 0, ridge)], [0, 0, 0], 0, true);   // Walmflächen
        if (chim) { const m = new THREE.Matrix4().makeRotationY(-ang); m.setPosition(...(pt(rh * 0.45, -0.4, ridge - 0.7) as [number, number, number])); chims.push(m); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(W, 2)); g.setAttribute('aBase', new THREE.Float32BufferAttribute(B, 1));
    g.setAttribute('aMeta', new THREE.Float32BufferAttribute(M, 1)); g.setAttribute('aEave', new THREE.Float32BufferAttribute(E, 1));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material); mesh.castShadow = mesh.receiveShadow = true; out.add(mesh);
  }
  const cg = new THREE.BoxGeometry(0.55, 1.8, 0.55).translate(0, 0.9, 0);
  const ci = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: '#3b3d42', roughness: 0.9 }), chims.length);
  chims.forEach((m, i) => ci.setMatrixAt(i, m)); ci.castShadow = true; out.add(ci);
  return out;
}
