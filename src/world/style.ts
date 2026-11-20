// Grafikstile („Looks“): tauschen Materialien, Himmel, Licht und Nachbearbeitung aus.
//   real    – bisheriger Stil (Luftbilder)
//   game    – Luftbilder + Spiele-Nachbearbeitung (Bloom, Farbkorrektur, Vignette)
//   toon    – stilisiert/Comic: flache Farben aus der Nutzungskarte, Stufen-Licht, Umrisslinien
//   neon    – Synthwave: dunkle Welt, leuchtendes Raster, Gebäudekanten, Neon-Sonne
//   diorama – Miniaturwelt: Toon + Tilt-Shift-Unschärfe und satte Farben
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const LOOKS = ['real', 'game', 'toon', 'neon', 'diorama', 'cinema'] as const;
export type Look = typeof LOOKS[number];
export const usesPhoto = (l: Look) => l === 'real' || l === 'game' || l === 'cinema';

export interface Layers { terrain: THREE.Object3D[]; roads: THREE.Object3D[]; buildings: THREE.Object3D[]; trees: THREE.Object3D[]; grass: THREE.Object3D[]; other: THREE.Object3D[] }
export interface LookTarget {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; layers: Layers;
}

const meshes = (objs: THREE.Object3D[], fn: (m: THREE.Mesh) => void) => objs.forEach(o => o.traverse(c => { if ((c as THREE.Mesh).isMesh) fn(c as THREE.Mesh); }));

function toonRamp(steps: number[]) {
  const t = new THREE.DataTexture(new Uint8Array(steps.flatMap(v => [v, v, v, 255])), steps.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

// ---------- Farbkorrektur / Vignette / Umrisse / Tilt-Shift in einem Durchgang ----------
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) },
    saturation: { value: 1 }, contrast: { value: 1 }, brightness: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) },
    vignette: { value: 0 }, outline: { value: 0 }, tilt: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float saturation, contrast, brightness, vignette, outline, tilt; uniform vec3 tint;
    varying vec2 vUv;
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec2 px = 1.0 / resolution;
      vec4 col = texture2D(tDiffuse, vUv);
      if (tilt > 0.0) {                                 // Tilt-Shift: oben/unten unscharf
        float b = smoothstep(0.18, 0.5, abs(vUv.y - 0.48)) * tilt;
        vec4 acc = vec4(0.0); float w = 0.0;
        for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) {
          float k = exp(-float(i * i + j * j) / 10.0); acc += texture2D(tDiffuse, vUv + vec2(i, j) * px * b * 2.2) * k; w += k;
        }
        col = acc / w;
      }
      if (outline > 0.0) {                              // Umrisse: Kantenfilter auf der Helligkeit
        float tl = lum(texture2D(tDiffuse, vUv + px * vec2(-1, 1)).rgb), t = lum(texture2D(tDiffuse, vUv + px * vec2(0, 1)).rgb), tr = lum(texture2D(tDiffuse, vUv + px * vec2(1, 1)).rgb);
        float l = lum(texture2D(tDiffuse, vUv + px * vec2(-1, 0)).rgb), r = lum(texture2D(tDiffuse, vUv + px * vec2(1, 0)).rgb);
        float bl = lum(texture2D(tDiffuse, vUv + px * vec2(-1, -1)).rgb), b = lum(texture2D(tDiffuse, vUv + px * vec2(0, -1)).rgb), br = lum(texture2D(tDiffuse, vUv + px * vec2(1, -1)).rgb);
        float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br, gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
        float e = smoothstep(0.12, 0.35, sqrt(gx * gx + gy * gy));
        col.rgb = mix(col.rgb, col.rgb * 0.18, e * outline);
      }
      vec3 c = col.rgb * tint;
      c = mix(vec3(lum(c)), c, saturation);
      c = (c - 0.5) * contrast + 0.5 + brightness;
      float d = distance(vUv, vec2(0.5)); c *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(c, col.a);
    }`,
};

// ---------- Neon: Rastergelände ----------
function neonTerrainMaterial(fog: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { fogColor: { value: fog } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */`
      uniform vec3 fogColor; varying vec3 vW;
      void main() {
        vec2 q = vW.xz / 40.0; vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
        float grid = 1.0 - min(min(g.x, g.y), 1.0);
        float hq = vW.y / 15.0; float hc = abs(fract(hq - 0.5) - 0.5) / max(fwidth(hq), 1e-4);
        float contour = (1.0 - min(hc, 1.0)) * 0.6;
        float t = clamp((vW.y - 200.0) / 350.0, 0.0, 1.0);
        vec3 lineCol = mix(vec3(1.0, 0.16, 0.6), vec3(0.1, 0.85, 1.0), t);
        vec3 c = mix(vec3(0.035, 0.012, 0.075), lineCol * 1.6, max(grid, contour));
        float d = length(vW - cameraPosition);
        c = mix(c, fogColor, smoothstep(200.0, 2600.0, d));
        gl_FragColor = vec4(c, 1.0);
      }`,
    extensions: { derivatives: true } as never,
  });
}
function neonSkyMaterial(sunDir: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { sunDir: { value: sunDir.clone().setY(0.12).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 sunDir; varying vec3 vD;
      void main() {
        vec3 d = normalize(vD); float up = clamp(d.y, -0.1, 1.0);
        vec3 c = mix(vec3(0.95, 0.25, 0.55), vec3(0.18, 0.04, 0.32), smoothstep(0.0, 0.35, up));
        c = mix(c, vec3(0.02, 0.0, 0.06), smoothstep(0.35, 0.9, up));
        float s = dot(d, sunDir);
        float disk = smoothstep(0.9965, 0.9972, s);
        float stripes = step(0.5, fract((d.y - sunDir.y) * 60.0)) + step(sunDir.y + 0.005, d.y);
        vec3 sunCol = mix(vec3(1.0, 0.3, 0.45), vec3(1.0, 0.85, 0.25), smoothstep(-0.05, 0.08, d.y - sunDir.y + 0.04));
        c = mix(c, sunCol * 1.6, disk * min(stripes, 1.0));
        c += vec3(1.0, 0.3, 0.6) * pow(max(s, 0.0), 30.0) * 0.4;
        float stars = step(0.9985, fract(sin(dot(floor(d.xz / max(d.y, 0.05) * 300.0), vec2(12.9898, 78.233))) * 43758.5453)) * smoothstep(0.3, 0.6, up);
        gl_FragColor = vec4(c + stars, 1.0);
      }`,
  });
}

/** Look anwenden. Liefert einen EffectComposer (oder null, wenn normal gerendert wird). */
export function applyLook(look: Look, t: LookTarget): EffectComposer | null {
  const { scene, renderer, layers } = t;
  const fog = scene.fog as THREE.Fog;
  const grade = new ShaderPass(GradeShader);
  const u = grade.uniforms as Record<string, THREE.IUniform>;
  let bloom: UnrealBloomPass | null = null;

  if (look === 'real') return null;

  if (look === 'game') {
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.82);
    u.saturation.value = 1.18; u.contrast.value = 1.12; u.vignette.value = 0.45; u.tint.value = new THREE.Color(1.04, 1.0, 0.94);
    t.sun.intensity = 3.0;
  }

  if (look === 'cinema') {
    // Filmischer Abend-Look: warmes Gegenlicht, Dunst, Teal-Orange-Farbkorrektur, starke Glanzlichter
    const su = (t.sky.material as THREE.ShaderMaterial).uniforms;
    su.zenith.value = new THREE.Color('#2c5d9c'); su.horizon.value = new THREE.Color('#f6b98a'); su.coverage.value = 0.52;
    const haze = new THREE.Color('#e7b48f'); scene.background = haze; fog.color.copy(haze); fog.near = 120; fog.far = 3200;
    t.sun.color.set('#ffb36b'); t.sun.intensity = 3.6; t.hemi.color.set('#9fb8ff'); t.hemi.groundColor.set('#6b4a35'); t.hemi.intensity = 1.0;
    renderer.toneMappingExposure = 1.15;
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.7, 0.7);
    u.saturation.value = 1.3; u.contrast.value = 1.22; u.brightness.value = -0.02; u.vignette.value = 0.65; u.tint.value = new THREE.Color(1.1, 0.97, 0.86);
  }

  if (look === 'toon' || look === 'diorama') {
    const ramp = toonRamp([90, 170, 255]);
    const toon = (old: THREE.Material, extra: THREE.MeshToonMaterialParameters = {}) => {
      const o = old as THREE.MeshStandardMaterial;
      return new THREE.MeshToonMaterial({ map: o.map ?? null, color: o.color ?? new THREE.Color(1, 1, 1), vertexColors: !!o.vertexColors, gradientMap: ramp, side: o.side, transparent: o.transparent, alphaTest: o.alphaTest, ...extra });
    };
    meshes([...layers.terrain, ...layers.roads, ...layers.buildings, ...layers.trees, ...layers.other], m => {
      if (Array.isArray(m.material) || (m.material as THREE.ShaderMaterial).isShaderMaterial) return;
      m.material = toon(m.material as THREE.Material);
    });
    meshes(layers.grass, m => { m.material = toon(m.material as THREE.Material, { color: new THREE.Color('#9fe06a') }); });
    // Bäume kräftiger und runder wirken lassen
    meshes(layers.trees, m => { (m.material as THREE.MeshToonMaterial).color = new THREE.Color('#7fd36b'); });
    const su = (t.sky.material as THREE.ShaderMaterial).uniforms;
    su.zenith.value = new THREE.Color('#2f86e8'); su.horizon.value = new THREE.Color('#bfe6ff'); su.coverage.value = 0.56;
    scene.background = new THREE.Color('#bfe6ff'); fog.color.set('#bfe6ff'); fog.near = 500;
    t.hemi.intensity = 1.7; t.sun.intensity = 2.4;
    u.saturation.value = look === 'diorama' ? 1.55 : 1.4; u.contrast.value = 1.08; u.brightness.value = 0.02; u.outline.value = 0.85;
    if (look === 'diorama') { u.tilt.value = 1.0; u.vignette.value = 0.3; }
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.4, 0.9);
  }

  if (look === 'neon') {
    const night = new THREE.Color('#14062e');
    scene.background = night; fog.color.copy(night); fog.near = 150; fog.far = 2600;
    t.hemi.intensity = 0.25; t.sun.intensity = 0.4; t.sun.color.set('#ff6ad5');
    t.sky.material = neonSkyMaterial(t.sun.position.clone().normalize());
    const terr = neonTerrainMaterial(night);
    meshes(layers.terrain, m => { m.material = terr; });
    meshes(layers.grass, m => { m.visible = false; }); layers.grass.forEach(g => { g.visible = false; });
    const roadMat = (old: THREE.Material) => new THREE.MeshBasicMaterial({ map: (old as THREE.MeshStandardMaterial).map ?? null, color: '#5b4f8c', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    meshes(layers.roads, m => { m.material = (m.material as THREE.MeshStandardMaterial).map ? roadMat(m.material as THREE.Material) : new THREE.MeshBasicMaterial({ color: '#1a0b35', side: THREE.DoubleSide }); });
    const glass = new THREE.MeshBasicMaterial({ color: '#0d0820' });
    const edge = new THREE.LineBasicMaterial({ color: '#2de2ff' });
    meshes(layers.buildings, m => {
      m.material = glass;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), edge);
      m.add(lines);
    });
    meshes(layers.trees, m => { m.material = new THREE.MeshBasicMaterial({ color: '#1d0c3f', vertexColors: false }); });
    meshes(layers.other, m => {
      const o = m.material as THREE.MeshStandardMaterial;
      if (Array.isArray(m.material) || (m.material as THREE.ShaderMaterial).isShaderMaterial) return;
      m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color ?? '#ffffff').multiplyScalar(0.25).add(new THREE.Color('#2a0b4a')) });
    });
    renderer.toneMappingExposure = 1.1;
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.25, 0.55, 0.12);
    u.saturation.value = 1.25; u.contrast.value = 1.1; u.vignette.value = 0.55;
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, t.camera));
  if (bloom) composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  const resize = () => {
    const s = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr); composer.setSize(s.x, s.y);
    (u.resolution.value as THREE.Vector2).set(s.x * pr, s.y * pr);
  };
  resize();
  (composer as unknown as { fit: () => void }).fit = resize;
  return composer;
}
