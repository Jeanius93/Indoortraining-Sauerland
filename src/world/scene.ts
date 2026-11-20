// 3D-Welt: Renderer, Himmel, Licht, Kameras
import * as THREE from 'three';
import type { Route, WorldData } from '../route';
import { Avatar, type AvatarStyle } from './avatar';
import { Sky } from './sky';
import { SUN, BuildingField, Heightfield, TreeField, buildLanduseTerrain, buildRoad, buildSideRoads, buildTerrain, buildTrees, makeRouteDistance } from './terrain';

export const cameraModes = ['Verfolger', 'Seite', 'Ego', 'Drohne'] as const;
export type CameraMode = typeof cameraModes[number];

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 9000);
  readonly avatar: Avatar;
  readonly hf: Heightfield;
  cameraMode: CameraMode = 'Verfolger';
  private sun = new THREE.DirectionalLight('#fff0d4', 2.6);
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private first = true;
  treeCount = 0;
  private sky!: Sky;
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
    this.renderer.toneMappingExposure = 1.05;

    const haze = new THREE.Color('#c9d9e6');
    this.scene.background = haze;
    this.scene.fog = new THREE.Fog(haze, 300, quality === 'high' ? 4200 : 2600);
    this.scene.add(new THREE.HemisphereLight('#d6e6ff', '#5f6a48', 1.35));
    this.sun.position.copy(SUN).multiplyScalar(600);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const R = quality === 'high' ? 45 : 14, sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 1500;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.sky = new Sky(SUN, quality);
    this.camera.add(this.sky.mesh); this.scene.add(this.camera);

    this.hf = new Heightfield(heights, route.data.terrain);
    const dist = makeRouteDistance(route, route.data.terrain);
    const lu = route.data.landuse;
    this.scene.add(data.landuse && lu ? buildLanduseTerrain(this.hf, data.landuse, lu, dist, quality, data.rawHeights, data.ortho) : buildTerrain(this.hf, dist, data.canopy));
    this.scene.add(buildRoad(route));
    if (data.sideRoads) this.scene.add(buildSideRoads(data.sideRoads));
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
    this.sun.position.copy(a.position).addScaledVector(SUN, 600);
    this.sky.update(dt);
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
