// Himmel: Farbverlauf mit Dunst am Horizont, Sonne mit Hof und eine ziehende, sonnenbeschienene Wolkenschicht.
// Die Wolken sind eine prozedurale Schicht in ~1,5 km Höhe (fBm-Rauschen), beleuchtet aus Sonnenrichtung.
import * as THREE from 'three';

export class Sky {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(sunDir: THREE.Vector3, quality: 'low' | 'high') {
    this.uniforms = {
      sunDir: { value: sunDir.clone().normalize() },
      time: { value: 0 },
      zenith: { value: new THREE.Color('#3f74b8') },
      horizon: { value: new THREE.Color('#c9d9e6') },
      coverage: { value: 0.47 },
    };
    const octaves = quality === 'high' ? 6 : 4;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vD;
        void main() {
          vD = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 sunDir; uniform float time; uniform vec3 zenith; uniform vec3 horizon; uniform float coverage;
        varying vec3 vD;
        float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < ${octaves}; i++) { s += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
          return s;
        }
        // Wolkendichte an Position p (km auf der Wolkenschicht)
        float cloud(vec2 p) {
          vec2 w = vec2(time * 0.006, time * 0.002);           // Wind
          float base = fbm(p * 0.35 + w);                       // große Wolkenfelder
          float detail = fbm(p * 1.6 - w * 2.0);                // Quellungen
          float d = base * 0.75 + detail * 0.35;
          return smoothstep(coverage, coverage + 0.22, d);
        }
        void main() {
          vec3 d = normalize(vD);
          float up = max(d.y, 0.0);
          // Grundhimmel: Zenit → Horizont, unterhalb des Horizonts Dunst
          vec3 col = mix(horizon, zenith, pow(up, 0.45));
          col = mix(col, horizon * 0.92, smoothstep(0.0, -0.08, d.y));
          float sd = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.85, 0.6) * pow(sd, 8.0) * 0.25;   // heller Hof um die Sonne
          col += vec3(1.0, 0.9, 0.75) * pow(sd, 64.0) * 0.35;
          // Sonnenscheibe (überstrahlt → nach Tone-Mapping weiß)
          float disk = smoothstep(0.99955, 0.99975, sd);
          vec3 sun = vec3(1.0, 0.95, 0.85) * disk * 30.0;
          if (d.y > 0.01) {
            vec2 p = d.xz / (d.y + 0.08) * 1.5;                 // Schnitt mit der Wolkenschicht
            float c = cloud(p);
            // Licht: Dichte ein Stück Richtung Sonne → dort dichter = Schattenseite
            float toward = cloud(p + normalize(sunDir.xz + 1e-4) * 0.12);
            float lit = clamp(1.0 - (toward - c) * 1.8 - toward * 0.35, 0.0, 1.0);
            vec3 shadowCol = mix(vec3(0.52, 0.57, 0.66), horizon * 0.8, 0.3);
            vec3 cloudCol = mix(shadowCol, vec3(1.0, 0.98, 0.95), lit);
            cloudCol += vec3(1.0, 0.9, 0.7) * pow(sd, 6.0) * (1.0 - c) * 0.8;   // Silberrand im Gegenlicht
            float fade = smoothstep(0.01, 0.18, d.y);                          // am Horizont im Dunst auflösen
            c *= fade;
            col = mix(col, mix(horizon, cloudCol, fade), c * 0.95);
            sun *= 1.0 - smoothstep(0.05, 0.4, c);              // Wolken verdecken die Sonne
          }
          gl_FragColor = vec4(col + sun, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), mat);
    this.mesh.renderOrder = -1; this.mesh.frustumCulled = false;
  }

  update(dt: number) { this.uniforms.time.value = (this.uniforms.time.value as number) + dt; }
}
