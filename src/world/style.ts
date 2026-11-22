// Grafikstil: Licht, Himmel, Dunst und Nachbearbeitung (Bloom, Farbkorrektur, Vignette).
//   ens  – Standard „Sauerland“: warmes Licht, Dunst, satte harmonische Farben
//   real – bisheriger Luftbild-Stil ohne Nachbearbeitung
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const LOOKS = ['real', 'ens'] as const;
export type Look = typeof LOOKS[number];
export const usesPhoto = (l: Look) => l === 'real';

export interface Layers { terrain: THREE.Object3D[]; roads: THREE.Object3D[]; buildings: THREE.Object3D[]; trees: THREE.Object3D[]; grass: THREE.Object3D[]; other: THREE.Object3D[] }
export interface LookTarget {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; layers: Layers;
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


/** Dunst erst ab 150 m und höhenabhängig: Kuppen über der Kamera bleiben klar, Täler darunter dunstiger */
let fogPatched = false;
function heightFog() {
  if (fogPatched) return; fogPatched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying float vFogRise;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z; vFogRise = (transpose(mat3(viewMatrix)) * mvPosition.xyz).y;\n#endif';
  C.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor; varying float vFogDepth; varying float vFogRise;\n #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear; uniform float fogFar;\n #endif\n#endif';
  C.fog_fragment = `#ifdef USE_FOG
 #ifdef FOG_EXP2
  float fogD = max(0.0, vFogDepth - 150.0) * fogDensity;
  float fogFactor = 1.0 - exp(-fogD * fogD * clamp(exp(-vFogRise * 0.003), 0.7, 1.3));
 #else
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
 #endif
 gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}

/** Look anwenden. Liefert einen EffectComposer (oder null, wenn normal gerendert wird). */
export function applyLook(look: Look, t: LookTarget): EffectComposer | null {
  const { scene, renderer } = t;
  const grade = new ShaderPass(GradeShader);
  const u = grade.uniforms as Record<string, THREE.IUniform>;
  let bloom: UnrealBloomPass | null = null;

  if (look === 'real') return null;



  if (look === 'ens') {
    // Stilisierter Realismus: warmes Licht, Dunst, satte harmonische Farben, weiche Kontraste
    const su = (t.sky.material as THREE.ShaderMaterial).uniforms;
    su.zenith.value = new THREE.Color('#3a7bd0'); su.horizon.value = new THREE.Color('#d9e6e8'); su.coverage.value = 0.5;
    const haze = new THREE.Color('#c9d6d2');
    scene.background = haze; scene.fog = new THREE.FogExp2(haze, 0.0005);
    heightFog();
    t.sun.color.set('#ffdca8'); t.sun.intensity = 3.4;
    t.hemi.color.set('#cfe0ff'); t.hemi.groundColor.set('#4d5a2c'); t.hemi.intensity = 1.25;
    renderer.toneMappingExposure = 1.1;
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.36, 0.7, 0.84);
    u.saturation.value = 1.12; u.contrast.value = 1.06; u.brightness.value = 0.01; u.vignette.value = 0.4; u.tint.value = new THREE.Color(1.04, 1.0, 0.92);
  }







  // Mehrfachabtastung (MSAA) im Zwischenbild: glatte Kanten trotz Nachbearbeitung
  const size = renderer.getSize(new THREE.Vector2()), pr0 = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr0, size.y * pr0, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
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
