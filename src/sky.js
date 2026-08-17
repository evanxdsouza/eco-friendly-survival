// ---------------------------------------------------------------------------
// SKY, SUN AND IMAGE-BASED LIGHTING
// ---------------------------------------------------------------------------
// The single biggest contributor to a photoreal look: physically-modelled
// atmospheric scattering (Preetham sky) rendered into an equirect environment
// map via PMREM, so *every* PBR surface reflects a real sky instead of a flat
// ambient colour. The sun light is driven from the same vector, so shadows,
// specular highlights and reflections always agree.
//
// Tweak points:
//  - setTimeOfDay(hour) drives sun elevation/azimuth, light colour, and the
//    day↔night blend used to switch street lighting on
//  - The env map is only re-baked when the sun actually moves (it's far too
//    expensive to regenerate per frame)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { applyEnvironment } from './materials.js';

const DEG = Math.PI / 180;

// Colour of direct sunlight at various elevations — warm and dim at the
// horizon, neutral and bright overhead.
const SUN_HORIZON = new THREE.Color(0xff9d4a);
const SUN_LOW = new THREE.Color(0xffc98a);
const SUN_HIGH = new THREE.Color(0xfff4e0);
const MOONLIGHT = new THREE.Color(0x7d96c9);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function createSkySystem(scene, renderer, quality = 'high') {
  // --- sky dome ---------------------------------------------------------
  const sky = new Sky();
  sky.scale.setScalar(20000);
  scene.add(sky);

  // The Preetham model outputs radiance far above the range the rest of the
  // scene is calibrated for, so at an exposure that renders the buildings
  // correctly the sky clips to flat white. Scale its output down in-shader so
  // one exposure setting suits both.
  const skyScale = { value: 0.09 };
  sky.material.onBeforeCompile = (shader) => {
    shader.uniforms.uSkyScale = skyScale;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uSkyScale;\nvoid main() {')
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        'gl_FragColor = vec4( texColor * uSkyScale, 1.0 );'
      );
  };
  sky.material.needsUpdate = true;

  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 3.2;      // haze / particulate load
  skyUniforms.rayleigh.value = 2.1;       // blue-ness of the sky
  skyUniforms.mieCoefficient.value = 0.006;
  skyUniforms.mieDirectionalG.value = 0.82; // tightness of the sun's glow

  // --- lights -----------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.castShadow = true;
  const shadowRes = quality === 'low' ? 1024 : quality === 'medium' ? 2048 : 4096;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  const extent = 27;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.022;
  scene.add(sun);
  scene.add(sun.target);

  // Sky-bounce fill. Ground colour feeds a little green back up into the
  // undersides of the buildings and canopies, which sells the outdoor look.
  const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x4a5a35, 0.55);
  scene.add(hemi);

  // Very soft opposite-side fill so shadowed facades never crush to black.
  const fill = new THREE.DirectionalLight(0xbdd4ff, 0.35);
  fill.position.set(-30, 18, -22);
  scene.add(fill);

  // Linear fog, not exponential: we want *zero* haze over the site itself and
  // a hard fade only out where the terrain runs out, which exponential falloff
  // can't give you without greying the whole model.
  scene.fog = new THREE.Fog(0xbdd0e0, 88, 172);

  // --- environment baking ----------------------------------------------
  // IMPORTANT: we deliberately do NOT run PMREM over the Sky shader itself.
  // The Preetham model's radiance around the sun disc overflows half-float
  // to Infinity, and PMREM's blur then spreads that as NaN across the whole
  // mip chain. A single NaN texel poisons every lit material it touches —
  // even at envMapIntensity 0, because 0 * NaN is still NaN — and the entire
  // scene renders black.
  //
  // Instead we bake IBL from a bounded, analytically-generated equirect sky
  // that tracks the same sun vector. The visible dome still uses the real
  // Sky shader, so nothing is lost visually.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const ENV_H = 128;
  const ENV_W = ENV_H * 2;
  const envData = new Float32Array(ENV_W * ENV_H * 4);
  const envTexture = new THREE.DataTexture(envData, ENV_W, ENV_H, THREE.RGBAFormat, THREE.FloatType);
  envTexture.mapping = THREE.EquirectangularReflectionMapping;
  let envRT = null;

  const SUN_PEAK = 26;   // bounded well inside half-float range
  const tmpDir = new THREE.Vector3();

  /** Paints an approximate sky/ground sphere around the current sun vector. */
  function paintEnvTexture() {
    const elev = state.elevation;
    const day = smoothstep(-6, 10, elev);
    const warm = smoothstep(30, -2, elev);

    // palette shifts from midday blue → sunset amber → night indigo
    const zenith = new THREE.Color(0x2f6dc4).lerp(new THREE.Color(0x243f7a), warm * 0.5);
    const horizon = new THREE.Color(0xcfe0ee).lerp(new THREE.Color(0xff9448), warm);
    const ground = new THREE.Color(0x4a4f3d).lerp(new THREE.Color(0x2e2a22), warm);

    const nightZenith = new THREE.Color(0x05070f);
    const nightHorizon = new THREE.Color(0x121a2c);
    const nightGround = new THREE.Color(0x070806);

    zenith.lerp(nightZenith, 1 - day);
    horizon.lerp(nightHorizon, 1 - day);
    ground.lerp(nightGround, 1 - day);

    const sunColour = new THREE.Color().copy(SUN_HIGH).lerp(SUN_HORIZON, warm);
    const sunIntensity = SUN_PEAK * day;
    const skyGain = 0.25 + day * 1.15;

    let i = 0;
    for (let y = 0; y < ENV_H; y++) {
      const phi = ((y + 0.5) / ENV_H) * Math.PI;      // 0 at zenith
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);                    // +1 up, -1 down

      for (let x = 0; x < ENV_W; x++) {
        const theta = ((x + 0.5) / ENV_W) * Math.PI * 2 - Math.PI;
        tmpDir.set(sinPhi * Math.cos(theta), cosPhi, sinPhi * Math.sin(theta));

        let r, g, b;
        if (cosPhi >= 0) {
          // sky hemisphere: horizon → zenith gradient, brighter near horizon
          const t = Math.pow(cosPhi, 0.42);
          r = THREE.MathUtils.lerp(horizon.r, zenith.r, t) * skyGain;
          g = THREE.MathUtils.lerp(horizon.g, zenith.g, t) * skyGain;
          b = THREE.MathUtils.lerp(horizon.b, zenith.b, t) * skyGain;
        } else {
          // ground hemisphere: bounce light, fading with depth below horizon
          const t = Math.pow(-cosPhi, 0.6);
          r = THREE.MathUtils.lerp(horizon.r * 0.5, ground.r, t) * skyGain * 0.6;
          g = THREE.MathUtils.lerp(horizon.g * 0.5, ground.g, t) * skyGain * 0.6;
          b = THREE.MathUtils.lerp(horizon.b * 0.5, ground.b, t) * skyGain * 0.6;
        }

        // sun disc plus a wide mie-like glow
        const cosAngle = tmpDir.dot(sunDir);
        if (cosAngle > 0.9) {
          const disc = smoothstep(0.9993, 0.9998, cosAngle);
          const glow = Math.pow(Math.max(0, cosAngle), 340) * 0.55;
          const add = (disc + glow) * sunIntensity;
          r += sunColour.r * add;
          g += sunColour.g * add;
          b += sunColour.b * add;
        }

        // clamp defensively — a non-finite texel here would break everything
        envData[i++] = Number.isFinite(r) ? Math.min(r, SUN_PEAK * 2) : 0;
        envData[i++] = Number.isFinite(g) ? Math.min(g, SUN_PEAK * 2) : 0;
        envData[i++] = Number.isFinite(b) ? Math.min(b, SUN_PEAK * 2) : 0;
        envData[i++] = 1;
      }
    }
    envTexture.needsUpdate = true;
  }

  function bakeEnvironment() {
    paintEnvTexture();
    if (envRT) envRT.dispose();
    envRT = pmrem.fromEquirectangular(envTexture);
    scene.environment = envRT.texture;
    applyEnvironment(envRT.texture);
  }

  // --- state ------------------------------------------------------------
  const sunDir = new THREE.Vector3();
  const state = { hour: 10.5, elevation: 0, nightFactor: 0 };
  const listeners = [];

  /**
   * @param {number} hour 0–24. Sun rises ~6:00 and sets ~18:00.
   */
  function setTimeOfDay(hour) {
    state.hour = hour;

    const dayT = (hour - 6) / 12;               // 0 at sunrise, 1 at sunset
    const elevation = Math.sin(dayT * Math.PI) * 72; // degrees (negative = night)
    const azimuth = -128 + dayT * 205;
    state.elevation = elevation;

    const phi = (90 - elevation) * DEG;
    const theta = azimuth * DEG;
    sunDir.setFromSphericalCoords(1, phi, theta);
    skyUniforms.sunPosition.value.copy(sunDir);

    // Position the shadow-casting light along the sun vector.
    sun.position.copy(sunDir).multiplyScalar(70);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    // Daylight ramps in as the sun clears the horizon.
    const day = smoothstep(-5, 9, elevation);
    state.nightFactor = 1 - day;

    // Warm the sunlight near the horizon (Rayleigh reddening).
    const warm = smoothstep(28, 2, elevation);
    const colour = new THREE.Color().copy(SUN_HIGH);
    colour.lerp(SUN_LOW, warm);
    colour.lerp(SUN_HORIZON, smoothstep(14, -2, elevation));

    if (day > 0.01) {
      sun.color.copy(colour);
      sun.intensity = 3.6 * day;
    } else {
      // moonlight: dim, blue, and casting soft shadows from roughly overhead
      sun.color.copy(MOONLIGHT);
      sun.intensity = 0.28;
      sun.position.set(28, 52, 18);
      sun.target.updateMatrixWorld();
    }

    hemi.intensity = 0.12 + day * 0.55;
    hemi.color.setHex(0xbcd7ff).lerp(new THREE.Color(0x2b3a5c), state.nightFactor);
    fill.intensity = 0.06 + day * 0.32;

    // Haze thickens at dawn/dusk; the sky is bluer at noon.
    skyUniforms.turbidity.value = 2.6 + warm * 4.5;
    skyUniforms.rayleigh.value = 1.4 + warm * 1.9;

    // Fog picks up the horizon colour so distant geometry melts into the sky.
    const fogDay = new THREE.Color(0xbdd0e0).lerp(new THREE.Color(0xd9a173), warm * 0.8);
    scene.fog.color.copy(fogDay).lerp(new THREE.Color(0x0a1020), state.nightFactor);

    bakeEnvironment();
    listeners.forEach((fn) => fn(state));
  }

  setTimeOfDay(state.hour);

  return {
    sky,
    sun,
    hemi,
    state,
    /** Brightness of the visible sky dome relative to the scene exposure. */
    skyScale,
    setTimeOfDay,
    /** Register a callback fired whenever the time of day changes. */
    onChange: (fn) => listeners.push(fn),
    getNightFactor: () => state.nightFactor,
    dispose() {
      if (envRT) envRT.dispose();
      pmrem.dispose();
    },
  };
}
