// Rennradfahrer-Avatar: detailliertes Rennrad + Fahrer mit Bein- und Arm-IK, Wiegetritt am Berg.
// Lokales System: Blick nach +Z, +Y oben. Maße in Metern (Fahrer ca. 1,80 m, Rahmen 56).
import * as THREE from 'three';

export interface AvatarStyle { jersey: string; jersey2: string; bike: string }

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
  private torso!: Segment; private pelvis!: THREE.Mesh; private chestBand!: THREE.Mesh; private neck!: Segment; private head = new THREE.Group();
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
      jersey: std(style.jersey, 0.75), jersey2: std(style.jersey2, 0.75), shorts: std('#101114', 0.55), skin: std('#d6a07c', 0.65),
      sock: std('#f2f2f0', 0.8), shoe: std('#f4f4f2', 0.4), sole: std('#202124', 0.6), helmet: std('#f5f5f5', 0.35),
      lens: std('#1a2430', 0.08, 0.9), bottle: std('#e8eef2', 0.3),
    };
    this.root.add(this.lean);
    this.lean.add(this.bike, this.rider);
    this.buildBike(M);
    this.buildRider(M);
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

  private buildRider(M: Record<string, THREE.MeshStandardMaterial>) {
    const r = this.rider;
    this.pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), M.shorts); this.pelvis.scale.set(1.2, 0.72, 0.92); r.add(this.pelvis);
    this.torso = new Segment(0.15, 0.56, M.jersey, r, 0.75, 0.15);
    this.chestBand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.165, 0.07, 18, 1, true), M.jersey2); r.add(this.chestBand);
    this.neck = new Segment(0.045, 0.12, M.skin, r);
    // Kopf, Helm mit Lüftungsschlitzen, Brille
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 16), M.skin); head.scale.set(0.9, 1.05, 1.0);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.helmet);
    helmet.scale.set(0.98, 0.92, 1.3); helmet.position.set(0, 0.025, -0.012);
    for (const x of [-0.04, 0, 0.04]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.11), M.black); vent.position.set(x, 0.116, 0.005); helmet.add(vent);
      vent.scale.set(1 / 0.98, 1 / 0.92, 1 / 1.3);
    }
    const accent = new THREE.Mesh(new THREE.TorusGeometry(0.117, 0.006, 6, 32, Math.PI), M.jersey); accent.rotation.set(0, Math.PI / 2, 0); accent.scale.set(1.3, 0.92, 1); accent.position.y = 0.025;
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 8, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.42, Math.PI * 0.16), M.lens);
    lens.scale.set(0.98, 1, 1.06);
    this.head.add(head, helmet, accent, lens); r.add(this.head);
    for (const side of [-1, 1]) {
      const thigh = new Segment(0.072, 0.445, M.shorts, r, 1, 0.22), shin = new Segment(0.052, 0.38, M.skin, r, 1, 0.3), sock = new Segment(0.041, 0.1, M.sock, r);
      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.16, 4, 10), M.shoe); shoe.scale.set(1, 1, 0.72);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.015, 0.25), M.sole); sole.position.y = -0.035; shoe.add(sole);
      r.add(shoe);
      this.legs.push({ thigh, shin, sock, shoe, side });
      const upper = new Segment(0.05, 0.29, M.jersey, r), fore = new Segment(0.039, 0.28, M.skin, r, 1, 0.15);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), M.black); glove.scale.set(0.8, 1, 1.25); r.add(glove);
      this.arms.push({ upper, fore, glove, side });
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
    this.torso.set(hip.clone().add(V(0, 0.04, 0.02)), shoulder, undefined);
    this.chestBand.position.copy(hip).lerp(shoulder, 0.7);
    this.chestBand.quaternion.copy(this.torso.mesh.quaternion);
    this.chestBand.scale.set(1.12, 1, 0.82);

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
      leg.shoe.quaternion.setFromUnitVectors(UP, footDir);
    }
  }
}
