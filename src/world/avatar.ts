// Radfahrer-Avatar: Rennrad + Fahrer, Beine per 2-Knochen-IK an den Pedalen.
// Lokales System: +Z = vorwärts, +Y = oben (Three.js: Blick nach +Z → +X ist links)
import * as THREE from 'three';

export interface AvatarStyle { jersey: string; jersey2: string; bike: string }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class Limb {
  mesh: THREE.Mesh;
  constructor(radius: number, mat: THREE.Material, parent: THREE.Object3D, radius2 = radius) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius2, radius, 1, 8).translate(0, 0.5, 0), mat);
    this.mesh.castShadow = true; parent.add(this.mesh);
  }
  private static up = V(0, 1, 0);
  set(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a), len = d.length();
    this.mesh.position.copy(a);
    this.mesh.quaternion.setFromUnitVectors(Limb.up, d.divideScalar(len || 1));
    this.mesh.scale.set(1, len, 1);
  }
}

export class Avatar {
  readonly root = new THREE.Group();   // Position/Richtung auf der Straße
  private lean = new THREE.Group();    // Schräglage + Steigung
  private wheels: THREE.Object3D[] = [];
  private crank = new THREE.Group();
  private legs: { thigh: Limb; shin: Limb; foot: THREE.Mesh; side: number }[] = [];
  private torso: Limb; private arms: Limb[] = []; private head: THREE.Group;
  private crankAngle = 0; private wheelAngle = 0; private bob = 0;
  private hip = V(0, 0.98, -0.2);
  private readonly BB = V(0, 0.29, -0.02);
  private readonly CRANK = 0.17;

  constructor(style: AvatarStyle) {
    const mat = (c: string, r = 0.6, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const frameM = mat(style.bike, 0.35, 0.3), black = mat('#16181b', 0.8), jersey = mat(style.jersey, 0.7), jersey2 = mat(style.jersey2, 0.7);
    const skin = mat('#d9a47f', 0.8), helmet = mat('#f2f2f2', 0.4), tire = mat('#1c1c1c', 0.9), rim = mat('#2a2d33', 0.4, 0.6);
    this.root.add(this.lean);
    const bike = new THREE.Group(); this.lean.add(bike);

    // Räder
    for (const z of [-0.5, 0.5]) {
      const w = new THREE.Group(); w.position.set(0, 0.34, z);
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.014, 8, 40), tire); t.rotation.y = Math.PI / 2;
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.016, 6, 40), rim); r.rotation.y = Math.PI / 2;
      w.add(t, r);
      for (let i = 0; i < 3; i++) { // Speichen (Carbon-Tri-Spoke-Look, gut sichtbar beim Drehen)
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.6, 0.022), rim); s.rotation.x = i * Math.PI / 3; w.add(s);
      }
      t.castShadow = true; bike.add(w); this.wheels.push(w);
    }
    // Rahmen
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material = frameM) => new Limb(r, m, bike).set(a, b);
    const seatTop = V(0, 0.82, -0.17), headTop = V(0, 0.8, 0.36), headBot = V(0, 0.64, 0.4), rear = V(0, 0.34, -0.5), front = V(0, 0.34, 0.5);
    tube(this.BB, seatTop, 0.017); tube(seatTop, headTop, 0.016); tube(this.BB, headBot, 0.022); tube(headBot, headTop, 0.02);
    tube(this.BB, rear, 0.012); tube(seatTop.clone().add(V(0, -0.06, 0)), rear, 0.01); tube(headBot, front, 0.012);
    tube(seatTop, V(0, 0.95, -0.22), 0.012, black); // Sattelstütze
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.26), black); saddle.position.set(0, 0.96, -0.2); bike.add(saddle);
    tube(headTop, V(0, 0.9, 0.42), 0.015, black); // Vorbau
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), black); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.9, 0.46); bike.add(bar);
    for (const x of [-0.2, 0.2]) { const d = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 12, Math.PI), black); d.rotation.y = Math.PI / 2; d.position.set(x, 0.82, 0.48); bike.add(d); }
    // Kurbel + Kettenblatt
    this.crank.position.copy(this.BB); bike.add(this.crank);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 24), rim); ring.rotation.z = Math.PI / 2; ring.position.x = 0.06; this.crank.add(ring);

    // Fahrer
    const body = new THREE.Group(); this.lean.add(body);
    this.torso = new Limb(0.13, jersey, body, 0.15);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.08, 10), jersey2); this.torso.mesh.add(stripe); stripe.position.y = 0.55;
    for (const side of [-1, 1]) {
      this.legs.push({ thigh: new Limb(0.065, black, body, 0.075), shin: new Limb(0.045, skin, body, 0.055), foot: new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.24), black), side });
      body.add(this.legs.at(-1)!.foot);
      this.arms.push(new Limb(0.04, jersey, body, 0.045), new Limb(0.032, skin, body));
    }
    this.head = new THREE.Group(); body.add(this.head);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), skin); headM.castShadow = true;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet); helm.scale.set(1, 0.9, 1.3); helm.position.set(0, 0.02, -0.02);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.04), black); visor.position.set(0, 0.0, 0.1);
    this.head.add(headM, helm, visor);
    this.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.updatePose(0);
  }

  private updatePose(effort: number) {
    // Oberkörper: tiefer bei hoher Anstrengung
    const hip = this.hip.clone().add(V(0, this.bob, 0));
    const shoulder = V(0, 1.36 - effort * 0.06 + this.bob * 0.5, 0.25);
    this.torso.set(hip, shoulder);
    this.head.position.copy(shoulder).add(V(0, 0.13, 0.1));
    this.head.rotation.x = 0.35 - effort * 0.1;
    let ai = 0;
    for (const side of [-1, 1]) {
      const sh = shoulder.clone().add(V(side * 0.17, -0.02, 0)), hand = V(side * 0.19, 0.84, 0.5);
      const elbow = sh.clone().lerp(hand, 0.5).add(V(side * 0.05, -0.08 - effort * 0.04, -0.04));
      this.arms[ai++].set(sh, elbow); this.arms[ai++].set(elbow, hand);
    }
    // Beine: Fuß auf Pedal, Knie per IK
    for (const leg of this.legs) {
      const a = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const pedal = V(leg.side * 0.11, this.BB.y + Math.cos(a) * this.CRANK, this.BB.z + Math.sin(a) * this.CRANK);
      const h = hip.clone().add(V(leg.side * 0.1, 0, 0));
      const L1 = 0.44, L2 = 0.44, d = Math.min(h.distanceTo(pedal), L1 + L2 - 0.001);
      const dir = pedal.clone().sub(h).normalize();
      const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d), off = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      const fwd = new THREE.Vector3(0, -dir.z, dir.y).normalize(); // senkrecht in der Y-Z-Ebene, Richtung vorne
      if (fwd.z < 0) fwd.negate();
      const knee = h.clone().add(dir.clone().multiplyScalar(along)).add(fwd.multiplyScalar(off));
      leg.thigh.set(h, knee); leg.shin.set(knee, pedal);
      leg.foot.position.copy(pedal).add(V(0, 0.02, 0.03));
    }
  }

  /** dt in s, speed m/s, cadence U/min, curvature 1/m (positiv = links), grade % */
  update(dt: number, speed: number, cadence: number, curvature: number, grade: number, effort: number) {
    this.wheelAngle += speed / 0.335 * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    this.crankAngle += (cadence / 60) * Math.PI * 2 * dt;
    this.crank.rotation.x = this.crankAngle;
    this.bob = Math.sin(this.crankAngle * 2) * 0.008 * Math.min(1, cadence / 60);
    const targetLean = Math.atan(speed * speed * curvature / 9.81) * -1;
    this.lean.rotation.z += (Math.max(-0.6, Math.min(0.6, targetLean)) - this.lean.rotation.z) * Math.min(1, dt * 4);
    this.lean.rotation.x = -Math.atan(grade / 100);
    this.updatePose(effort);
  }
}
