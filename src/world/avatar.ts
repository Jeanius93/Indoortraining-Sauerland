// Rennradfahrer-Avatar: detailliertes Rennrad + Fahrer mit Bein- und Arm-IK, Wiegetritt am Berg.
// Lokales System: Blick nach +Z, +Y oben. Maße in Metern (Fahrer ca. 1,80 m, Rahmen 56).
import * as THREE from 'three';

export interface AvatarStyle { bike: string }
/** Trikot im Stil des Frauenteams Canyon//SRAM 2026 („Luminous“), ohne Sponsorenlogos – einziges Trikot im Spiel */
const KIT = { jersey: '#33173f', jersey2: '#2ed3c6', shorts: '#24102e', shortsBand: '#ff7a59' };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

/** Körperteil zwischen zwei Punkten (Kapsel, optional verjüngt über Skalierung) */
class Segment {
  readonly mesh: THREE.Mesh;
  private nominal: number;
  constructor(radius: number, length: number, mat: THREE.Material, parent: THREE.Object3D, private squash = 1, taper?: number) {
    this.nominal = length;
    const body = Math.max(0.005, length - radius * 2), g = new THREE.CapsuleGeometry(radius, body, 6, 14);
    if (taper) { // zum oberen Ende hin dicker (Oberschenkel, Wade, Brustkorb)
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) / (length / 2), f = 1 + taper * Math.max(-1, Math.min(1, y)); p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); }
      g.computeVertexNormals();
    }
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true; parent.add(this.mesh);
  }
  set(a: THREE.Vector3, b: THREE.Vector3, len?: number, roll = 0) {
    const d = b.clone().sub(a), l = len ?? d.length();
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    if (roll) this.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
    this.mesh.scale.set(1, l / this.nominal, this.squash);
  }
}

/** Rumpf als Querschnitts-Loft (y −0,5…0,5, Breite x, Tiefe z; +z = Bauchseite) mit UV (u rundum ab Bauchmitte, v unten→oben) */
function loft(profile: [number, number, number, number][], seg = 28) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  profile.forEach(([t, hw, hd, oz]) => {
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, sx = Math.sin(a), cz = Math.cos(a);
      const e = 2 / 2.6, fx = Math.sign(sx) * Math.pow(Math.abs(sx), e), fz = Math.sign(cz) * Math.pow(Math.abs(cz), e);   // etwas kantiger als eine Ellipse
      pos.push(fx * hw, t - 0.5, fz * hd + oz); uv.push(i / seg, t);
    }
  });
  for (let r = 0; r < profile.length - 1; r++) for (let i = 0; i < seg; i++) {
    const a = r * (seg + 1) + i, b = a + seg + 1; idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
class Loft {
  readonly mesh: THREE.Mesh;
  constructor(g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) { this.mesh = new THREE.Mesh(g, mat); this.mesh.castShadow = true; parent.add(this.mesh); }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a); this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize()); this.mesh.scale.set(1, d.length(), 1);
  }
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
/** Trikot im Stil „Luminous“: dunkles Violett mit Lichtbrechung in Türkis, Pink, Koralle und Rot (ohne Logos).
 *  u = 0 Bauchmitte, 0,5 Rückenmitte; oben im Bild = Schultern */
function luminousTexture() {
  return canvasTex(1024, 512, g => {
    const W = 1024, H = 512;
    const base = g.createLinearGradient(0, 0, 0, H); base.addColorStop(0, '#3a1a4e'); base.addColorStop(1, '#1d0c29');
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    // Lichtbrechung: schräge, sich überlagernde Scherben mit Farbverlauf (vorn und hinten gespiegelt)
    const shards: [number, number, number, number, number][] = [   // Mitte u, Breite, Neigung, Deckkraft, Phase
      [0.02, 0.10, 0.9, 0.85, 0], [0.11, 0.05, 1.1, 0.6, 0.3], [0.88, 0.07, -0.8, 0.7, 0.6], [0.95, 0.04, -1.2, 0.5, 0.15],
      [0.46, 0.12, 0.8, 0.85, 0.45], [0.56, 0.06, 1.0, 0.65, 0.8], [0.38, 0.05, -0.9, 0.55, 0.2], [0.63, 0.04, -1.1, 0.5, 0.7],
    ];
    g.globalCompositeOperation = 'screen';
    for (const [u, w, tilt, a, ph] of shards) {
      const x = u * W, bw = w * W, gr = g.createLinearGradient(x - bw, 0, x + bw, H);
      const cols = ['#2ed3c6', '#ff5fa2', '#ff7a59', '#e8323c', '#2ed3c6'];
      cols.forEach((c, i) => gr.addColorStop(Math.min(1, (i / 4 + ph) % 1.0001), c));
      g.globalAlpha = a; g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - bw / 2 - tilt * 120, 0); g.lineTo(x + bw / 2 - tilt * 120, 0); g.lineTo(x + bw / 2 + tilt * 120, H); g.lineTo(x - bw / 2 + tilt * 120, H); g.closePath(); g.fill();
      // feine helle Kante
      g.globalAlpha = a * 0.7; g.strokeStyle = '#ffd6e6'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + bw / 2 - tilt * 120, 0); g.lineTo(x + bw / 2 + tilt * 120, H); g.stroke();
    }
    // weiche Lichtflecken
    for (const [u, v, r, c] of [[0.05, 0.35, 90, '#ff5fa2'], [0.5, 0.3, 120, '#2ed3c6'], [0.52, 0.7, 80, '#ff7a59'], [0.93, 0.6, 70, '#2ed3c6']] as [number, number, number, string][]) {
      const rg = g.createRadialGradient(u * W, v * H, 0, u * W, v * H, r); rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.45; g.fillStyle = rg; g.fillRect(u * W - r, v * H - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    // dunkle Seitenteile, Schulterpasse, Kragenrand
    g.fillStyle = '#1d0c29';
    for (const cu of [0.25, 0.75]) { g.beginPath(); g.moveTo((cu - 0.07) * W, H); g.lineTo((cu + 0.07) * W, H); g.lineTo((cu + 0.03) * W, H * 0.1); g.lineTo((cu - 0.03) * W, H * 0.1); g.fill(); }
    g.fillStyle = '#2a1238'; g.fillRect(0, 0, W, H * 0.06); g.fillStyle = '#ff7a59'; g.fillRect(0, H * 0.06, W, 3);
    // Rückentaschen, Reißverschluss, Bund
    const px0 = W * 0.39, px1 = W * 0.61, py = H * 0.8;
    g.fillStyle = 'rgba(20,8,28,0.55)'; g.fillRect(px0, py, px1 - px0, H - py);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; for (const k of [1, 2]) { const x = px0 + (px1 - px0) * k / 3; g.beginPath(); g.moveTo(x, py); g.lineTo(x, H); g.stroke(); }
    g.fillStyle = '#2ed3c6'; g.fillRect(px0, py - 4, px1 - px0, 5);
    g.fillStyle = '#120818'; g.fillRect(0, 0, 5, H * 0.8); g.fillRect(W - 5, 0, 5, H * 0.8);
    g.fillStyle = '#1d0c29'; g.fillRect(0, H - 12, W, 12);
    g.globalAlpha = 0.05; g.fillStyle = '#000'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1); g.globalAlpha = 1;
  });
}
/** Ärmel/Hosenbein: v = 0 oben (Schulter/Hüfte) … v = 1 unten; Stoff bis `end`, dann Haut */
function sleeveTexture(cloth: string, band: string, skin: string, end: number, bandW = 0.06) {
  return canvasTex(64, 256, g => {
    g.fillStyle = skin; g.fillRect(0, 0, 64, 256);
    const sk = g.createLinearGradient(0, 0, 0, 256); sk.addColorStop(0, 'rgba(0,0,0,0)'); sk.addColorStop(1, 'rgba(90,40,20,0.12)'); g.fillStyle = sk; g.fillRect(0, 0, 64, 256);
    // Canvas oben = v 1 (unteres Ende des Segments)
    g.fillStyle = cloth; g.fillRect(0, 256 * (1 - end), 64, 256 * end + 1);
    g.fillStyle = band; g.fillRect(0, 256 * (1 - end), 64, 256 * bandW);
  });
}

/** Statisches Rohr zwischen zwei Punkten (Rahmen) */
function tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, mat: THREE.Material, seg = 12) {
  const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  m.castShadow = true;
  return m;
}

/** Zwei-Knochen-IK: Gelenkpunkt zwischen a und c, Beugerichtung `bend` */
function solveIK(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, bend: THREE.Vector3) {
  const ac = c.clone().sub(a), d = Math.min(ac.length(), l1 + l2 - 1e-4);
  const dir = ac.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const perp = bend.clone().sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize();
  return a.clone().addScaledVector(dir, along).addScaledVector(perp, off);
}

export class Avatar {
  readonly root = new THREE.Group();      // Position/Richtung auf der Straße
  private lean = new THREE.Group();       // Schräglage, Steigung, Wiegetritt
  private bike = new THREE.Group();
  private rider = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private blurDiscs: THREE.Mesh[] = [];
  private crank = new THREE.Group();
  private pedals: THREE.Mesh[] = [];
  private legs: { thigh: Segment; shin: Segment; sock: Segment; shoe: THREE.Mesh; side: number }[] = [];
  private arms: { upper: Segment; fore: Segment; glove: THREE.Mesh; side: number }[] = [];
  private torso!: Loft; private pelvis!: THREE.Mesh; private delts: THREE.Mesh[] = []; private collar!: THREE.Mesh; private neck!: Segment; private head = new THREE.Group();
  private crankAngle = 0; private wheelAngle = 0; private standT = 0;

  // Rahmengeometrie
  private readonly BB = V(0, 0.27, 0);
  private readonly CRANK = 0.1725;
  private readonly REAR = V(0, 0.336, -0.41);
  private readonly FRONT = V(0, 0.336, 0.585);
  private readonly SADDLE = V(0, 0.985, -0.2);
  private readonly HOOD = 0.205; // halbe Breite an den Bremsgriffen

  constructor(style: AvatarStyle) {
    const std = (c: string, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
    const M = {
      frame: std(style.bike, 0.28, 0.35), carbon: std('#15171a', 0.35, 0.2), black: std('#111214', 0.7), tire: std('#1b1b1c', 0.85),
      alu: std('#9aa0a6', 0.35, 0.8), chain: std('#4a4d52', 0.4, 0.8), tape: std('#18191b', 0.9),
      jersey: std(KIT.jersey, 0.75), jersey2: std(KIT.jersey2, 0.75), shorts: std(KIT.shorts, 0.5), skin: std('#c98f6b', 0.55),
      hair: std('#3b2a1f', 0.9), strap: std('#222326', 0.7),
      sock: std('#f2f2f0', 0.8), shoe: std('#f4f4f2', 0.4), sole: std('#202124', 0.6), helmet: std('#f5f5f5', 0.35),
      lens: std('#1a2430', 0.08, 0.9), bottle: std('#e8eef2', 0.3),
    };
    this.root.add(this.lean);
    this.lean.add(this.bike, this.rider);
    this.buildBike(M);
    this.buildRider(M, style);
    this.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.update(0, 0, 0, 0, 0, 0);
  }

  private buildBike(M: Record<string, THREE.MeshStandardMaterial>) {
    const b = this.bike, BB = this.BB;
    // Laufräder: Carbon-Hochprofilfelge, Reifen, 20 Speichen, Nabe, Bewegungsunschärfe-Scheibe
    for (const c of [this.REAR, this.FRONT]) {
      const w = new THREE.Group(); w.position.copy(c);
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.322, 0.0135, 10, 64), M.tire); tire.rotation.y = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.024, 64, 1, true), M.carbon); rim.rotation.z = Math.PI / 2;
      const rimIn = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.265, 0.018, 64, 1, true), M.carbon); rimIn.rotation.z = Math.PI / 2;
      const wall = new THREE.Mesh(new THREE.RingGeometry(0.265, 0.31, 64), M.carbon);
      const wall2 = wall.clone(); wall.rotation.y = Math.PI / 2; wall.position.x = 0.012; wall2.rotation.y = -Math.PI / 2; wall2.position.x = -0.012;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 12), M.alu); hub.rotation.z = Math.PI / 2;
      w.add(tire, rim, rimIn, wall, wall2, hub);
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2, side = i % 2 ? 1 : -1;
        w.add(tube(V(side * 0.035, 0, 0), V(0, Math.cos(a) * 0.266, Math.sin(a) * 0.266), 0.0013, 0.0013, M.chain, 4));
      }
      const blur = new THREE.Mesh(new THREE.CircleGeometry(0.265, 32), new THREE.MeshBasicMaterial({ color: '#2a2c30', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      blur.rotation.y = Math.PI / 2;
      w.add(blur); this.blurDiscs.push(blur);
      b.add(w); this.wheels.push(w);
    }
    // Rahmen (Sitzrohr, Oberrohr, Unterrohr, Steuerrohr, Streben) + Gabel
    const seatTop = V(0, 0.8, -0.13), headTop = V(0, 0.82, 0.42), headBot = V(0, 0.665, 0.46);
    b.add(tube(BB, seatTop, 0.02, 0.016, M.frame), tube(seatTop, headTop, 0.018, 0.017, M.frame), tube(BB, headBot, 0.026, 0.022, M.frame),
      tube(headBot, headTop, 0.022, 0.019, M.frame));
    for (const x of [-0.065, 0.065]) {
      b.add(tube(V(x * 0.5, BB.y, BB.z - 0.02), V(x, this.REAR.y, this.REAR.z), 0.012, 0.008, M.frame));
      b.add(tube(V(x * 0.4, seatTop.y - 0.04, seatTop.z), V(x, this.REAR.y + 0.01, this.REAR.z), 0.009, 0.007, M.frame));
      b.add(tube(V(x * 0.4, headBot.y, headBot.z), V(x * 0.85, this.FRONT.y, this.FRONT.z), 0.016, 0.009, M.frame));
    }
    // Sattelstütze + Sattel (Draufsicht-Umriss extrudiert)
    b.add(tube(seatTop, this.SADDLE.clone().add(V(0, -0.03, 0.01)), 0.0135, 0.0135, M.carbon));
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.14); sh.bezierCurveTo(0.075, -0.14, 0.075, -0.06, 0.06, -0.02); sh.bezierCurveTo(0.025, 0.05, 0.02, 0.1, 0.015, 0.13);
    sh.lineTo(-0.015, 0.13); sh.bezierCurveTo(-0.02, 0.1, -0.025, 0.05, -0.06, -0.02); sh.bezierCurveTo(-0.075, -0.06, -0.075, -0.14, 0, -0.14);
    const saddle = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: 12 }), M.black);
    saddle.rotation.x = -Math.PI / 2; saddle.position.copy(this.SADDLE).add(V(0, -0.02, 0.0)); b.add(saddle);
    // Vorbau + Lenker (Unterlenker) + Bremsgriffe
    const stemEnd = V(0, 0.865, 0.535);
    b.add(tube(headTop, V(0, 0.85, 0.43), 0.018, 0.018, M.carbon), tube(V(0, 0.85, 0.43), stemEnd, 0.016, 0.016, M.carbon));
    for (const s of [-1, 1]) {
      const H = this.HOOD;
      const curve = new THREE.CatmullRomCurve3([
        V(0, 0.865, 0.535), V(s * 0.12, 0.865, 0.535), V(s * H, 0.866, 0.55), V(s * H, 0.87, 0.615), V(s * (H + 0.005), 0.84, 0.655),
        V(s * (H + 0.01), 0.78, 0.645), V(s * (H + 0.012), 0.745, 0.6), V(s * (H + 0.012), 0.74, 0.53),
      ]);
      b.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.0125, 8), M.tape));
      const hood = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.06, 4, 8), M.black);
      hood.position.set(s * H, 0.895, 0.615); hood.rotation.x = Math.PI / 2 - 0.25; b.add(hood);
      b.add(tube(V(s * H, 0.885, 0.64), V(s * (H + 0.004), 0.78, 0.67), 0.006, 0.005, M.alu, 6));
    }
    // Antrieb: Kettenblatt, Kurbeln mit Pedalen, Kassette, Kette
    this.crank.position.copy(BB); b.add(this.crank);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 6, 48), M.alu); ring.rotation.y = Math.PI / 2; ring.position.x = -0.045;
    const spider = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.006, 5), M.carbon); spider.rotation.z = Math.PI / 2; spider.position.x = -0.045;
    this.crank.add(ring, spider);
    for (const s of [-1, 1]) {
      // Kurbelarme entlang der lokalen Y-Achse (Kurbelgruppe dreht um X); rechts (+) zeigt bei Winkel 0 nach oben
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, this.CRANK + 0.02, 0.03), M.carbon);
      arm.position.set(s * 0.06, s * this.CRANK / 2, 0); this.crank.add(arm);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.09), M.black);
      pedal.position.set(s * 0.105, s * this.CRANK, 0);
      this.crank.add(pedal); this.pedals.push(pedal);
    }
    const cassette = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), M.chain); cassette.rotation.z = Math.PI / 2;
    cassette.position.copy(this.REAR).add(V(-0.04, 0, 0)); b.add(cassette);
    for (const dy of [0.1, -0.1]) b.add(tube(V(-0.045, BB.y + dy, BB.z), V(-0.045, this.REAR.y + dy * 0.5, this.REAR.z), 0.003, 0.003, M.chain, 5));
    const derailleur = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.035), M.black); derailleur.position.copy(this.REAR).add(V(-0.05, -0.06, 0.01)); b.add(derailleur);
    // Flaschenhalter + Flasche am Unterrohr
    const bottle = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.15, 4, 12), M.bottle);
    bottle.position.copy(BB).lerp(headBot, 0.5).add(V(0, 0.045, -0.025)); bottle.quaternion.setFromUnitVectors(UP, headBot.clone().sub(BB).normalize()); b.add(bottle);
  }

  private buildRider(M: Record<string, THREE.MeshStandardMaterial>, style: AvatarStyle) {
    const r = this.rider, skinC = '#' + M.skin.color.getHexString();
    const jerseyMat = new THREE.MeshStandardMaterial({ map: luminousTexture(), roughness: 0.72 });
    const sleeveMat = new THREE.MeshStandardMaterial({ map: sleeveTexture(KIT.jersey, KIT.jersey2, skinC, 0.62), roughness: 0.68 });
    const legMat = new THREE.MeshStandardMaterial({ map: sleeveTexture(KIT.shorts, KIT.shortsBand, skinC, 0.8, 0.07), roughness: 0.55 });
    // Becken (Hose) und geformter Rumpf: Hüfte, Taille, Brustkorb, breite Schultern, leicht runder Rücken
    this.pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), M.shorts); this.pelvis.scale.set(1.25, 0.75, 0.95); r.add(this.pelvis);
    this.torso = new Loft(loft([
      [0.0, 0.07, 0.05, 0], [0.04, 0.13, 0.095, 0], [0.12, 0.15, 0.105, -0.004], [0.3, 0.14, 0.098, -0.012], [0.5, 0.155, 0.11, -0.018],
      [0.68, 0.172, 0.118, -0.016], [0.82, 0.188, 0.112, -0.01], [0.9, 0.19, 0.1, -0.004], [0.96, 0.15, 0.075, 0], [1.0, 0.07, 0.04, 0],
    ]), jerseyMat, r);
    for (let k = 0; k < 2; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 10), M.jersey); d.scale.set(1, 0.9, 1.1); r.add(d); this.delts.push(d); }
    this.collar = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.04, 16, 1, true), M.jersey2); r.add(this.collar);
    this.neck = new Segment(0.046, 0.13, M.skin, r);
    // Kopf: Gesicht mit Nase, Kinn, Ohren, Haaransatz
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.093, 22, 18), M.skin); head.scale.set(0.88, 1.06, 1.02);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), M.skin); jaw.scale.set(1.1, 0.85, 1.05); jaw.position.set(0, -0.06, 0.03);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.04, 8), M.skin); nose.rotation.x = Math.PI / 2 + 0.4; nose.position.set(0, -0.012, 0.098);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.097, 18, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.35), M.hair); hair.scale.set(0.9, 1.06, 1.02); hair.rotation.x = -0.9;
    head.add(hair);
    const face = new THREE.Group(); face.add(head, jaw, nose);
    for (const sd of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), M.skin); ear.scale.set(0.45, 1.25, 0.85); ear.position.set(sd * 0.083, -0.01, -0.005); face.add(ear); }
    // Rennradhelm: lang gezogene Schale, Lüftungskanäle, Zweitfarbe, Kinnriemen
    const shellG = new THREE.SphereGeometry(0.12, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), sp = shellG.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      const back = Math.max(0, -z / 0.12);                       // hinten länger und spitz zulaufend
      sp.setXYZ(i, x * (1 - back * 0.25), y * 0.9 - back * back * 0.02, z * (1.12 + back * 0.28));
    }
    shellG.computeVertexNormals();
    const helmet = new THREE.Mesh(shellG, M.helmet); helmet.position.set(0, 0.026, -0.006);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.008, 6, 40), M.jersey); rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1.2, 1); rim.position.set(0, 0.03, -0.01);
    helmet.add(rim);
    for (let k = -3; k <= 3; k++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.085 - Math.abs(k) * 0.008), M.black);
      const ang = k * 0.32; vent.position.set(Math.sin(ang) * 0.106, Math.cos(ang) * 0.098 - 0.006, 0.02); vent.rotation.z = -ang; helmet.add(vent);
      const vent2 = vent.clone(); vent2.position.z = -0.075; vent2.scale.z = 0.7; helmet.add(vent2);
    }
    for (const sd of [-1, 1]) {
      face.add(tube(V(sd * 0.088, 0.02, 0.02), V(sd * 0.05, -0.105, 0.045), 0.0035, 0.0035, M.strap, 5));
      face.add(tube(V(sd * 0.09, 0.02, -0.05), V(sd * 0.05, -0.105, 0.045), 0.0035, 0.0035, M.strap, 5));
    }
    // Sportbrille: Scheibe + Bügel
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 8, Math.PI / 2 - 1.0, 2.0, Math.PI * 0.42, Math.PI * 0.15), M.lens);
    lens.scale.set(0.98, 1, 1.07);
    for (const sd of [-1, 1]) face.add(tube(V(sd * 0.085, 0.012, 0.04), V(sd * 0.085, 0.015, -0.04), 0.003, 0.003, M.black, 5));
    this.head.add(face, helmet, lens); r.add(this.head);
    for (const side of [-1, 1]) {
      const thigh = new Segment(0.074, 0.445, legMat, r, 1, 0.24), shin = new Segment(0.05, 0.38, M.skin, r, 1, 0.38), sock = new Segment(0.04, 0.1, M.sock, r);
      // Radschuh: Schale mit Kappe, Fersenteil, Drehverschluss, Carbonsohle
      const shoe = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.037, 0.17, 6, 12), M.shoe); upper.scale.set(1, 1, 0.66); upper.position.y = 0.004;
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8), M.shoe); toe.scale.set(1.05, 0.6, 0.75); toe.position.set(0, 0.095, 0.006);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12), M.black); dial.position.set(0, 0.0, -0.026); dial.rotation.x = Math.PI / 2;
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.25, 0.012), M.sole); sole.position.set(0, 0.0, 0.026);
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.012), M.black); cleat.position.set(0, 0.03, 0.035);
      shoe.add(upper, toe, dial, sole, cleat); r.add(shoe);
      this.legs.push({ thigh, shin, sock, shoe: shoe as unknown as THREE.Mesh, side });
      const upperArm = new Segment(0.05, 0.29, sleeveMat, r, 1, 0.12), fore = new Segment(0.038, 0.28, M.skin, r, 1, 0.22);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), M.black); glove.scale.set(0.8, 1, 1.25); r.add(glove);
      this.arms.push({ upper: upperArm, fore, glove, side });
    }
  }

  /** dt in s, speed m/s, cadence U/min, curvature 1/m (positiv = links), grade %, effort = Leistung/FTP */
  update(dt: number, speed: number, cadence: number, curvature: number, grade: number, effort: number) {
    // Räder + Bewegungsunschärfe ab ~20 km/h
    this.wheelAngle += speed / 0.336 * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    const blur = Math.min(0.55, Math.max(0, (speed - 5) / 10) * 0.55);
    for (const d of this.blurDiscs) (d.material as THREE.MeshBasicMaterial).opacity = blur;

    this.crankAngle += (cadence / 60) * Math.PI * 2 * dt;
    this.crank.rotation.x = this.crankAngle;

    // Wiegetritt: am Berg bei hoher Last aus dem Sattel
    const wantStand = cadence > 30 && grade > 5 && effort > 1.05 ? 1 : 0;
    this.standT += (wantStand - this.standT) * Math.min(1, dt * 2.5);
    const st = this.standT, ca = this.crankAngle;
    const rock = Math.sin(ca) * 0.09 * st;                       // Rad schwankt im Wiegetritt

    // Schräglage in Kurven + Steigung
    const targetLean = -Math.atan(speed * speed * curvature / 9.81);
    this.lean.rotation.z += (Math.max(-0.6, Math.min(0.6, targetLean)) - this.lean.rotation.z) * Math.min(1, dt * 4);
    this.lean.rotation.x = -Math.atan(grade / 100);
    this.bike.rotation.z = rock;

    // Becken: im Sattel leichtes Wippen, im Stehen nach vorn/oben und gegenläufig zum Rad
    const sway = Math.sin(ca) * 0.012 * Math.min(1, cadence / 60);
    const hip = this.SADDLE.clone().add(V(sway * (1 - st), 0.07 + Math.abs(Math.sin(ca)) * 0.004, 0.03))
      .lerp(V(-rock * 0.6, 1.11, 0.03), st);
    const shoulder = V(-sway * 0.4, 1.37 - Math.min(0.35, effort) * 0.08 + st * 0.06, 0.245 + st * 0.05);
    this.pelvis.position.copy(hip).add(V(0, -0.015, 0.02));
    this.pelvis.rotation.z = sway * 4 + rock * 0.3;
    this.torso.set(hip.clone().add(V(0, -0.01, 0.0)), shoulder.clone().add(V(0, 0.05, 0.03)));
    this.delts.forEach((d, i) => d.position.copy(shoulder).add(V((i ? 1 : -1) * 0.165, -0.005, 0)));
    this.collar.position.copy(shoulder).add(V(0, 0.045, 0.045)); this.collar.quaternion.setFromUnitVectors(UP, V(0, 0.55, 0.85).normalize());

    // Kopf
    const neckTop = shoulder.clone().add(V(0, 0.07, 0.08));
    this.neck.set(shoulder.clone().add(V(0, 0.02, 0.02)), neckTop);
    this.head.position.copy(neckTop).add(V(0, 0.065, 0.04));
    this.head.rotation.x = 0.45 - st * 0.15 + Math.sin(ca * 2) * 0.01;

    // Arme: Hände an den Bremsgriffen, Ellbogen leicht gebeugt nach außen/unten
    for (const a of this.arms) {
      const sh = shoulder.clone().add(V(a.side * 0.17, -0.01, 0));
      const hand = V(a.side * (this.HOOD + 0.005), 0.905, 0.625).applyAxisAngle(V(0, 0, 1), rock);
      const elbow = solveIK(sh, hand, 0.29, 0.28, V(a.side * 0.6, -0.5, -0.4));
      a.upper.set(sh, elbow); a.fore.set(elbow, hand);
      a.glove.position.copy(hand).add(V(0, 0.005, 0.01));
    }

    // Beine: Fuß auf dem Pedal, Ferse leicht abgesenkt je nach Kurbelstellung (Ankling), Knie per IK
    const crankRot = this.bike.rotation.z;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i], a = ca + (leg.side > 0 ? 0 : Math.PI);
      const pedal = V(leg.side * 0.115, this.BB.y + Math.cos(a) * this.CRANK, this.BB.z + Math.sin(a) * this.CRANK).applyAxisAngle(V(0, 0, 1), crankRot);
      this.pedals[i].rotation.x = -ca;   // Pedal bleibt waagerecht
      const ankleTilt = -0.25 + Math.sin(a + 0.6) * 0.18;       // Ferse unten im Druck, oben gestreckt
      const footDir = V(0, Math.sin(ankleTilt), Math.cos(ankleTilt));
      const ankle = pedal.clone().add(V(0, 0.075, 0)).addScaledVector(footDir, -0.07);
      const h = hip.clone().add(V(leg.side * 0.095, -0.03, -0.01));
      const knee = solveIK(h, ankle, 0.445, 0.435, V(leg.side * 0.08, 0.2, 1));
      leg.thigh.set(h, knee);
      leg.shin.set(knee, ankle.clone().lerp(knee, 0.12));
      leg.sock.set(ankle.clone().lerp(knee, 0.2), ankle);
      leg.shoe.position.copy(pedal).add(V(0, 0.035, 0)).addScaledVector(footDir, 0.02);
      leg.shoe.quaternion.setFromUnitVectors(UP, footDir);   // lokale +Y = Fußspitze, +Z = Sohle (unten)
    }
  }
}
