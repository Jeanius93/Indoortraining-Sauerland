// 3D-Welt: Renderer, Himmel, Licht, Kameras
import * as THREE from 'three';
import type { Route, WorldData } from '../route';
import { Avatar, type AvatarStyle } from './avatar';
import { BuildingField, Heightfield, TreeField, buildLanduseTerrain, buildRoad, buildTerrain, buildTrees, makeRouteDistance } from './terrain';

export const cameraModes = ['Verfolger', 'Seite', 'Ego', 'Drohne'] as const;
export type CameraMode = typeof cameraModes[number];

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 9000);
  readonly avatar: Avatar;
  readonly hf: Heightfield;
  cameraMode: CameraMode = 'Verfolger';
  private sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private first = true;
  treeCount = 0;
  buildingCount = 0;
  private trees: TreeField | null = null;
  private buildings: BuildingField | null = null;
  private lodTimer = 0;

  constructor(canvas: HTMLCanvasElement, private route: Route, heights: Int16Array, data: WorldData, style: AvatarStyle, quality: 'low' | 'high') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const sky = new THREE.Color('#9cc3e6'), haze = new THREE.Color('#c9d8de');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(haze, 300, quality === 'high' ? 4200 : 2600);
    this.scene.add(new THREE.HemisphereLight('#dceaff', '#6b7a55', 1.7));
    this.sun.position.set(-300, 500, 200);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 1500;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.skyDome(sky, haze));

    this.hf = new Heightfield(heights, route.data.terrain);
    const dist = makeRouteDistance(route, route.data.terrain);
    const lu = route.data.landuse;
    this.scene.add(data.landuse && lu ? buildLanduseTerrain(this.hf, data.landuse, lu, dist, quality, data.rawHeights) : buildTerrain(this.hf, dist, data.canopy));
    this.scene.add(buildRoad(route));
    const w = route.data.world;
    const fogFar = (this.scene.fog as THREE.Fog).far;
    if (data.buildings && w) {
      this.buildings = new BuildingField(this.hf, data.buildings, w.buildings, fogFar);
      this.scene.add(this.buildings.group); this.buildingCount = w.buildings.count;
    }
    if (data.trees) {
      this.trees = new TreeField(this.hf, data.trees, dist, quality, quality === 'high' ? 500 : 300, fogFar);
      this.scene.add(this.trees.group); this.treeCount = this.trees.count;
    } else {
      const trees = buildTrees(this.hf, dist, route, quality);
      this.treeCount = trees.count; this.scene.add(trees.group);
    }

    this.avatar = new Avatar(style);
    this.scene.add(this.avatar.root);
  }

  private skyDome(top: THREE.Color, horizon: THREE.Color) {
    const g = new THREE.SphereGeometry(8000, 24, 12);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: top.clone().multiplyScalar(0.85) }, horizon: { value: horizon } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float t = pow(clamp(vP.y,0.0,1.0),0.55); gl_FragColor = vec4(mix(horizon, top, t),1.0); }',
    });
    const mesh = new THREE.Mesh(g, m); mesh.renderOrder = -1; mesh.frustumCulled = false;
    this.camera.add(mesh); this.scene.add(this.camera);
    return new THREE.Group();
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 72 : 60; // Hochformat (Handy): etwas weiter
    this.camera.updateProjectionMatrix();
  }

  /** Avatar an Streckenposition d setzen, Kamera nachführen, rendern */
  frame(d: number, dt: number, speed: number, cadence: number, effort: number) {
    const p = this.route.pose(d);
    const a = this.avatar.root;
    a.position.set(p.x, p.h + 0.12, -p.y);
    a.rotation.y = Math.PI - p.heading;
    this.avatar.update(dt, speed, cadence, p.curvature, p.grade, effort);

    // Kamera
    const fwd = new THREE.Vector3(Math.sin(p.heading), 0, -Math.cos(p.heading));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x); // links der Fahrtrichtung
    const ahead = this.route.pose(Math.min(d + 25, this.route.length));
    const lookAhead = new THREE.Vector3(ahead.x, ahead.h + 1, -ahead.y);
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const back = (m: number) => this.route.pose(Math.max(0, d - m));
    switch (this.cameraMode) {
      case 'Verfolger': {
        const b = back(6.5); pos.set(b.x, b.h + 2.4, -b.y); look.copy(a.position).add(new THREE.Vector3(0, 1.1, 0)).lerp(lookAhead, 0.25); break;
      }
      case 'Seite': pos.copy(a.position).addScaledVector(side, 4.2).addScaledVector(fwd, 1.2).add(new THREE.Vector3(0, 1.3, 0)); look.copy(a.position).add(new THREE.Vector3(0, 0.9, 0)); break;
      case 'Ego': pos.copy(a.position).addScaledVector(fwd, 0.35).add(new THREE.Vector3(0, 1.55, 0)); look.copy(lookAhead).add(new THREE.Vector3(0, 0.4, 0)); break;
      case 'Drohne': { const b = back(40); pos.set(b.x, b.h + 32, -b.y); look.copy(a.position).lerp(lookAhead, 0.4); break; }
    }
    // Kamera nicht unter das Gelände
    const ground = this.hf.at(pos.x, -pos.z) + 1.2;
    if (pos.y < ground) pos.y = ground;
    const k = this.first ? 1 : 1 - Math.exp(-dt * (this.cameraMode === 'Ego' ? 12 : 4));
    this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    if (this.first) { this.camPos.copy(pos); this.camLook.copy(look); this.first = false; }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.avatar.root.visible = this.cameraMode !== 'Ego';

    // Detailstufen nachführen (alle 0,4 s)
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) { this.lodTimer = 0.4; this.trees?.update(this.camera.position); this.buildings?.update(this.camera.position); }

    // Schatten-Kamera folgt dem Avatar
    this.sun.position.copy(a.position).add(new THREE.Vector3(-300, 500, 200));
    this.sun.target.position.copy(a.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Kamera ohne Nachziehen neu setzen (nach einem Sprung) */
  snapCamera() { this.first = true; this.lodTimer = 0; }

  nextCamera(dir = 1) {
    const i = cameraModes.indexOf(this.cameraMode);
    this.cameraMode = cameraModes[(i + dir + cameraModes.length) % cameraModes.length];
    this.first = true;
    return this.cameraMode;
  }
}
