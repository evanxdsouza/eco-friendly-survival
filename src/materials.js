// ---------------------------------------------------------------------------
// PBR MATERIAL LIBRARY
// ---------------------------------------------------------------------------
// One shared library so every building samples the same physical surfaces —
// consistent response to the sky IBL is a large part of why a render reads as
// "real" rather than as a collection of separately-tuned objects.
//
// Materials are cached by key: geometry gets instanced, materials get shared,
// so the whole city stays at a low draw-call / program count.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { getTextures, retile } from './textures.js';

let M = null;
const cache = new Map();

function keyed(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

export function initMaterials() {
  if (M) return M;
  const T = getTextures();

  M = {
    // ---- structural surfaces -------------------------------------------
    concrete: new THREE.MeshStandardMaterial({
      ...T.concrete,
      // the map already carries final albedo — tinting again would double-darken
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.8, 0.8),
      envMapIntensity: 0.85,
    }),

    concreteWarm: new THREE.MeshStandardMaterial({
      ...T.concrete,
      color: 0xf6ecd8,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.7, 0.7),
      envMapIntensity: 0.85,
    }),

    concreteDark: new THREE.MeshStandardMaterial({
      ...T.weatheredConcrete,
      color: 0xd8d5ce,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.0, 1.0),
      envMapIntensity: 0.8,
    }),

    // kerbs / retaining walls take heavier tiling so the grain stays fine
    kerb: new THREE.MeshStandardMaterial({
      ...retile(T.weatheredConcrete, 8),
      color: 0xeceae4,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.8,
    }),

    paving: new THREE.MeshStandardMaterial({
      ...T.paving,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.1, 1.1),
      envMapIntensity: 0.8,
    }),

    asphalt: new THREE.MeshStandardMaterial({
      ...T.asphalt,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: 0.5,
    }),

    grass: new THREE.MeshStandardMaterial({
      ...T.grass,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.1, 1.1),
      envMapIntensity: 0.7,
    }),

    soil: new THREE.MeshStandardMaterial({
      ...T.soil,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.4, 1.4),
      envMapIntensity: 0.6,
    }),

    wood: new THREE.MeshStandardMaterial({
      ...T.wood,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.9, 0.9),
      envMapIntensity: 0.75,
    }),

    // metalnessMap reads the BLUE channel, which our generator packs into the
    // same texture as roughness — so one lookup drives both.
    roofMetal: new THREE.MeshStandardMaterial({
      ...T.roofMetal,
      metalnessMap: T.roofMetal.roughnessMap,
      color: 0xc9d3da,
      roughness: 1,
      metalness: 1,
      normalScale: new THREE.Vector2(1.0, 1.0),
      envMapIntensity: 1.1,
    }),

    steel: new THREE.MeshStandardMaterial({
      ...T.brushedMetal,
      metalnessMap: T.brushedMetal.roughnessMap,
      color: 0xe8ecee,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 1.2,
    }),

    steelDark: new THREE.MeshStandardMaterial({
      ...T.brushedMetal,
      metalnessMap: T.brushedMetal.roughnessMap,
      color: 0x4a5157,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 1.0,
    }),

    rubber: new THREE.MeshStandardMaterial({
      ...T.rubber,
      metalnessMap: T.rubber.roughnessMap,
      color: 0x3a3f45,
      roughness: 1,
      metalness: 1,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: 0.6,
    }),

    terracotta: new THREE.MeshStandardMaterial({
      ...T.terracotta,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.7,
    }),

    solarPanel: new THREE.MeshPhysicalMaterial({
      ...T.solarPanel,
      metalnessMap: T.solarPanel.roughnessMap,
      color: 0xffffff,
      roughness: 1,
      metalness: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.5,
    }),

    // ---- glazing --------------------------------------------------------
    // Architectural glass is mostly *reflective*: with a real sky IBL behind
    // it, a dark tinted clearcoat surface reads far better (and far cheaper)
    // than transmission.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x121c22,
      metalness: 0.05,
      roughness: 0.045,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.68,
      envMapIntensity: 2.0,
      side: THREE.DoubleSide,
    }),

    // "sealed / coated" glazing for the acid-rain building — visibly glossier
    // and slightly iridescent so the protective coating reads at a glance.
    glassCoated: new THREE.MeshPhysicalMaterial({
      color: 0x0e1f26,
      metalness: 0.1,
      roughness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.008,
      iridescence: 0.55,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [120, 420],
      transparent: true,
      opacity: 0.72,
      envMapIntensity: 2.4,
      side: THREE.DoubleSide,
    }),

    // ---- vegetation -----------------------------------------------------
    // Slight sheen + double-sided keeps foliage from going flat-black when
    // it's backlit by the sun.
    foliage: new THREE.MeshStandardMaterial({
      color: 0x4a7c3f,
      roughness: 0.78,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.9,
      flatShading: false,
    }),

    foliageLight: new THREE.MeshStandardMaterial({
      color: 0x6b9b45,
      roughness: 0.74,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 1.0,
    }),

    crop: new THREE.MeshStandardMaterial({
      color: 0x5fa83c,
      roughness: 0.7,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 1.0,
    }),

    bark: new THREE.MeshStandardMaterial({
      ...retile(getTextures().wood, 4),
      color: 0x6b5641,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.6, 1.6),
      envMapIntensity: 0.6,
    }),

    // ---- water ----------------------------------------------------------
    // Used for the small collection tanks; the main channel uses Water.js.
    tankWater: new THREE.MeshPhysicalMaterial({
      color: 0x2b5f6e,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.7,
      thickness: 0.6,
      ior: 1.33,
      transparent: true,
      envMapIntensity: 1.4,
    }),
  };

  return M;
}

export function mats() {
  if (!M) throw new Error('initMaterials() must run first');
  return M;
}

/** Powder-coated paint in any colour, cached per colour+finish. */
export function painted(color, roughness = 0.45, metalness = 0.0) {
  return keyed(`paint-${color}-${roughness}-${metalness}`, () => {
    const T = getTextures();
    return new THREE.MeshStandardMaterial({
      ...T.paintedMetal,
      color,
      roughness,
      metalness,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.0,
    });
  });
}

/** Flat plastic / painted trim without texture — for small parts. */
export function plastic(color, roughness = 0.55) {
  return keyed(`plastic-${color}-${roughness}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: 0.9 })
  );
}

/** Self-illuminated surfaces: lamp lenses, lit windows, indicator LEDs. */
export function emissive(color, intensity = 2) {
  return keyed(`emit-${color}-${intensity}`, () =>
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.4,
      metalness: 0,
      toneMapped: false,
    })
  );
}

/** Applies the scene environment map to every cached + library material. */
export function applyEnvironment(envMap) {
  const touch = (m) => {
    if (m && 'envMap' in m) {
      // Only the FIRST assignment changes the shader program. Swapping the
      // texture afterwards is a uniform update. Re-flagging needsUpdate on
      // every time-of-day step forced a full recompile of every material in
      // the scene, which is what made dragging that slider stall.
      const firstAssignment = !m.envMap;
      m.envMap = envMap;
      if (firstAssignment) m.needsUpdate = true;
    }
  };
  if (M) Object.values(M).forEach(touch);
  cache.forEach(touch);
}
