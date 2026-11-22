// 3D-Welt: Renderer, Himmel, Licht, Kameras
import * as THREE from 'three';
import type { Route, WorldData } from '../route';
import { Avatar, type AvatarStyle } from './avatar';
import { Sky } from './sky';
import { buildHouses, updateHouses } from './houses';
import { ENS } from './lookflag';
import { applyLook, usesPhoto, type Look, type Layers } from './style';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { buildFurniture } from './furniture';
import { buildLandmarks } from './landmarks';
import { GrassField } from './grass';
import { Life } from './life';
import { SUN, shaderTime, BuildingField, Heightfield, TreeField, buildLanduseTerrain, buildChimneys, houseMaterial, buildRoad, updateTerrainLod, buildTerrain, buildTrees, makeRouteDistance } from './terrain';
import { buildRoadNetwork, findJunctions } from './roads';
import { Roads, type LifeCtx } from './life/common';

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
  private houses: THREE.Object3D | null = null;
  private fpsAcc = 0; private fpsN = 0; private fpsWarm = 0; private dpr = 1; private maxDpr = 1;
  private grass: GrassField | null = null;
  private life: Life | null = null;
  private terrain: THREE.Object3D | null = null;
  private furniture: THREE.Object3D | null = null;
  private roadNet: THREE.Object3D | null = null;
  private lat = 0;
  /** Test-/Entwicklungsansicht: feste Kamera (lokale Koordinaten x Ost, y Nord, z Höhe) */
  debugView: { from: number[]; to: number[] } | null = null;
  readonly look: Look;
  private composer: EffectComposer | null = null;

  constructor(canvas: HTMLCanvasElement, private route: Route, heights: Int16Array, data: WorldData, style: AvatarStyle, quality: 'low' | 'high') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    // volle Bildschirmauflösung (MSI Claw: 1,5); nur bei sehr niedriger Bildrate leicht reduzieren, nie unter 1
    this.maxDpr = Math.min(window.devicePixelRatio, 2); this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const haze = new THREE.Color('#c9d9e6');
    this.scene.background = haze;
    this.scene.fog = new THREE.Fog(haze, 300, quality === 'high' ? 4200 : 2600);
    this.look = ENS ? 'ens' : 'real';
    const hemi = new THREE.HemisphereLight('#d6e6ff', '#5f6a48', 1.35);
    this.scene.add(hemi);
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
    const layers: Layers = { terrain: [], roads: [], buildings: [], trees: [], grass: [], other: [] };
    const add = (k: keyof Layers, o: THREE.Object3D) => { this.scene.add(o); layers[k].push(o); };
    const ortho = usesPhoto(this.look) ? data.ortho : undefined;
    this.terrain = data.landuse && lu ? buildLanduseTerrain(this.hf, data.landuse, lu, dist, quality, data.rawHeights, ortho) : buildTerrain(this.hf, dist, data.canopy);
    add('terrain', this.terrain);
    const junctions = findJunctions(route, data.sideRoads ?? []);
    add('roads', buildRoad(route, data.furniture?.towns, junctions));
    if (data.furniture) { this.furniture = buildFurniture(route, data.furniture, quality, junctions); add('other', this.furniture); }
    if (data.landmarks) add('other', buildLandmarks(data.landmarks, this.hf));
    if (data.landuse && lu) {
      const rd = new Roads({ route, sideRoads: data.sideRoads } as LifeCtx);
      this.grass = new GrassField(route, this.hf, data.landuse, lu, quality, (x, y) => rd.dist(x, y)); add('grass', this.grass.group);
    }
    if (data.sideRoads) {
      // innerorts: Siedlungs-/Gewerbefläche im Umkreis von 20 m (Gehwege statt Bankett, kurze Leitlinien)
      const lum = data.landuse, townAt = (x: number, y: number) => {
        if (!lum || !lu) return false;
        for (const [a, b] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) {
          const i = Math.floor((x + a - route.data.terrain.x0) / lu.px), j = Math.floor((y + b - route.data.terrain.y0) / lu.px);
          if (i >= 0 && j >= 0 && i < lu.w && j < lu.h && (lum[j * lu.w + i] === 6 || lum[j * lu.w + i] === 7)) return true;
        }
        return false;
      };
      this.roadNet = buildRoadNetwork(route, { roads: data.sideRoads, rings: data.rings }, junctions, townAt); add('roads', this.roadNet);
    }
    const w = route.data.world;
    const fogFar = (this.scene.fog as THREE.Fog).far;
    if (data.houses) {
      this.houses = buildHouses(data.houses, houseMaterial()); add('buildings', this.houses); this.buildingCount = data.houses.houses.length;
    } else if (data.buildings && w) {
      this.buildings = new BuildingField(this.hf, data.buildings, w.buildings, fogFar);
      add('buildings', this.buildings.group); this.buildingCount = w.buildings.count;
      if (route.data.chimneys && data.buildings.ext) add('buildings', buildChimneys(route.data.chimneys));
    }
    if (data.trees) {
      this.trees = new TreeField(this.hf, data.trees, dist, quality, quality === 'high' ? 200 : 130, ENS ? Math.min(fogFar, 2700) : fogFar);
      add('trees', this.trees.group); this.treeCount = this.trees.count;
    } else {
      const trees = buildTrees(this.hf, dist, route, quality);
      this.treeCount = trees.count; add('trees', trees.group);
    }
    if (this.look === 'ens' && new URLSearchParams(location.search).get('leben') !== '0') {
      this.life = new Life({ route, hf: this.hf, quality, lu: data.landuse, luInfo: lu, houses: data.houses, sideRoads: data.sideRoads, towns: data.furniture?.towns ?? [] });
      add('other', this.life.group);
    }
    this.composer = applyLook(this.look, { scene: this.scene, renderer: this.renderer, camera: this.camera, sky: this.sky.mesh, sun: this.sun, hemi, layers });

    this.avatar = new Avatar(style);
    this.scene.add(this.avatar.root);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 72 : 60; // Hochformat (Handy): etwas weiter
    this.camera.updateProjectionMatrix();
    (this.composer as unknown as { fit?: () => void } | null)?.fit?.();
  }

  /** Avatar an Streckenposition d setzen, Kamera nachführen, rendern */
  frame(d: number, dt: number, speed: number, cadence: number, effort: number) {
    const p = this.route.pose(d);
    const a = this.avatar.root;
    // rechts fahren (nicht auf Radwegen): seitlicher Versatz, weich nachgeführt
    const latT = this.life ? this.life.traffic.riderOffset(this.route.wrap(d)) : 0;
    this.lat += (latT - this.lat) * Math.min(1, dt * 1.5);
    const shift = new THREE.Vector3(Math.cos(p.heading), 0, Math.sin(p.heading)).multiplyScalar(this.lat);   // nach rechts
    a.position.set(p.x, p.h + 0.12, -p.y).add(shift);
    a.rotation.y = Math.PI - p.heading;
    this.avatar.update(dt, speed, cadence, p.curvature, p.grade, effort);

    // Kamera
    const fwd = new THREE.Vector3(Math.sin(p.heading), 0, -Math.cos(p.heading));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x); // links der Fahrtrichtung
    const ahead = this.route.pose(this.route.loop ? d + 25 : Math.min(d + 25, this.route.length));
    const lookAhead = new THREE.Vector3(ahead.x, ahead.h + 1, -ahead.y).add(shift);
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
    if (this.cameraMode === 'Verfolger' || this.cameraMode === 'Drohne') pos.add(shift);
    // Kamera nicht unter das Gelände
    const ground = this.hf.at(pos.x, -pos.z) + 1.2;
    if (pos.y < ground) pos.y = ground;
    const k = this.first ? 1 : 1 - Math.exp(-dt * (this.cameraMode === 'Ego' ? 12 : 4));
    this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    if (this.first) { this.camPos.copy(pos); this.camLook.copy(look); this.first = false; }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (this.debugView) {
      const [fx, fy, fz] = this.debugView.from, [tx, ty, tz] = this.debugView.to;
      this.camera.position.set(fx, fz, -fy); this.camera.lookAt(tx, tz, -ty);
    }
    this.avatar.root.visible = this.cameraMode !== 'Ego';

    // Detailstufen nachführen (alle 0,4 s)
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) { this.lodTimer = 0.4; if (this.terrain) updateTerrainLod(this.terrain, this.camera.position); this.furniture?.userData.update?.(this.camera.position); this.roadNet?.userData.update?.(this.camera.position); this.trees?.update(this.camera.position); this.buildings?.update(this.camera.position); if (this.houses) updateHouses(this.houses, this.camera.position, 2200); this.grass?.update(this.camera.position); }

    // Schatten-Kamera folgt dem Avatar
    this.sun.position.copy(a.position).addScaledVector(SUN, 600);
    this.sky.update(dt);
    shaderTime.value += dt;
    this.sun.target.position.copy(a.position);
    this.life?.update(dt, this.camera.position, a.position, this.route.wrap(d), speed, this.lat, this.renderer, this.camera);
    this.adaptResolution(dt);   // vor dem Zeichnen: eine Größenänderung leert das Bild, sonst blitzt es schwarz
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }

  /** Auflösung an die Bildrate anpassen: nur verkleinern (unter 40 fps, alle 3 s, nie unter 1), nicht wieder hochpendeln */
  private adaptResolution(dt: number) {
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc < 3) return;
    const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
    if (this.fpsWarm++ < 2) return;            // Ladephase nicht werten
    const next = fps < 40 ? Math.max(Math.min(1, this.maxDpr), this.dpr - 0.25) : this.dpr;
    if (Math.abs(next - this.dpr) < 0.01) return;
    this.dpr = next; this.renderer.setPixelRatio(next);
    const size = this.renderer.getSize(new THREE.Vector2()); this.renderer.setSize(size.x, size.y, false);
    (this.composer as unknown as { fit?: () => void } | null)?.fit?.();
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
