// ---------------------------------------------------------------------------
// POST-PROCESSING PIPELINE
// ---------------------------------------------------------------------------
// Render → ambient occlusion → bloom → tone map → photographic grade → AA.
//
// The three passes that do the heavy lifting for realism:
//  - GTAO   : ground-truth ambient occlusion darkens creases and contact
//             points that IBL alone leaves flat (under eaves, between stilts)
//  - Bloom  : narrow, high-threshold — only genuine specular hits bloom,
//             which is what a real lens does
//  - Grade  : vignette + chromatic aberration + film grain. Subtle, but it's
//             what separates "3D render" from "photograph"
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/** Final photographic grade: vignette, edge chromatic aberration, film grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0016 },
    uSaturation: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSaturation;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // Lateral chromatic aberration grows toward the frame edge, as in a
      // real lens — zero in the centre so the subject stays crisp.
      vec2 offset = centered * r2 * uAberration;
      vec3 color;
      color.r = texture2D(tDiffuse, vUv + offset).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - offset).b;

      // Gentle saturation lift
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);

      // Optical vignette
      float vig = smoothstep(0.85, 0.15, r2 * uVignette * 2.0);
      color *= mix(0.72, 1.0, vig);

      // Animated film grain, scaled by luminance so shadows stay cleaner
      float grain = hash(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5;
      color += grain * uGrain * (0.35 + 0.65 * (1.0 - luma));

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export function createComposer(renderer, scene, camera, quality = 'high') {
  const size = renderer.getSize(new THREE.Vector2());

  // A multisampled target keeps geometry edges clean; post-processing would
  // otherwise throw away the renderer's own MSAA.
  // 2x rather than 4x at high: SMAA already runs on the final LDR image, so
  // 4x MSAA on a half-float target was buying a second pass at edge cleanup
  // for a large amount of bandwidth at devicePixelRatio 2.
  const samples = quality === 'high' ? 2 : quality === 'medium' ? 2 : 0;
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples,
  });

  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  // --- ambient occlusion ---
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.9;
  gtao.updateGtaoMaterial({
    radius: 0.85,          // world units — tuned to building-scale creases
    distanceExponent: 1.2,
    thickness: 1.0,
    scale: 1.0,
    samples: quality === 'high' ? 16 : 8,
    distanceFallOff: 1.0,
    screenSpaceRadius: false,
  });
  gtao.enabled = quality !== 'low';
  composer.addPass(gtao);

  // --- bloom: only true highlights (sun glints on glass/metal) ---
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.55, 0.92);
  bloom.enabled = quality !== 'low';
  composer.addPass(bloom);

  // --- tone mapping + colour space ---
  composer.addPass(new OutputPass());

  // --- photographic grade ---
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  // --- antialiasing on the final LDR image (catches specular shimmer) ---
  const smaa = new SMAAPass(size.x, size.y);
  smaa.enabled = quality !== 'low';
  composer.addPass(smaa);

  return {
    composer,
    passes: { gtao, bloom, grade, smaa },

    render(dt) {
      if (globalThis.__eco?.frozen === undefined) grade.uniforms.uTime.value += dt;
      composer.render();
    },

    setSize(width, height) {
      composer.setSize(width, height);
      gtao.setSize(width, height);
      bloom.setSize(width, height);
      smaa.setSize(width, height);
    },

    setQuality(next) {
      gtao.enabled = next !== 'low';
      bloom.enabled = next !== 'low';
      smaa.enabled = next !== 'low';
      gtao.updateGtaoMaterial({ samples: next === 'high' ? 16 : 8 });
    },
  };
}
