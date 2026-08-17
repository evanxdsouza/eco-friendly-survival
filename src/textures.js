// ---------------------------------------------------------------------------
// PROCEDURAL PBR TEXTURE LIBRARY
// ---------------------------------------------------------------------------
// Every surface in the city gets a real albedo + normal + roughness map, all
// generated at runtime as DataTextures (no external image assets, so the whole
// project stays self-contained and dependency-free).
//
// Tiling matters: a texture that seams is instantly readable as fake. We get
// perfectly tileable noise by sampling 4D simplex noise on the surface of a
// torus — walking u and v around two circles means the pattern wraps exactly.
//
// Tweak points:
//  - TEXTURE_SIZE trades generation time / VRAM against surface detail
//  - each PRESETS entry owns one material's height/shade functions
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';

const TAU = Math.PI * 2;

// Deterministic PRNG so the city looks identical on every reload.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260817);
const simplex = new SimplexNoise({ random: rng });

/**
 * Tileable 2D noise: map (u,v) in [0,1) onto a torus in 4D so the result
 * wraps seamlessly in both directions.
 */
function tileNoise(u, v, freq) {
  const r = freq / TAU;
  return simplex.noise4d(
    Math.cos(u * TAU) * r,
    Math.sin(u * TAU) * r,
    Math.cos(v * TAU) * r,
    Math.sin(v * TAU) * r
  );
}

/** Fractional Brownian motion built from tileable octaves. Returns ~[-1,1]. */
function fbm(u, v, octaves = 4, freq = 4, persistence = 0.5, lacunarity = 2) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += tileNoise(u, v, f) * amp;
    norm += amp;
    amp *= persistence;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise — good for cracks, veins and wave crests. */
function ridged(u, v, octaves, freq) {
  return 1 - Math.abs(fbm(u, v, octaves, freq));
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Converts a heightfield into a tangent-space normal map using a Sobel
 * filter. Wrapping the index keeps the normal map as seamless as the height.
 */
function heightToNormal(height, size, strength) {
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;

      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz / len) * 0.5 * 255 + 127.5;
      data[i + 3] = 255;
    }
  }
  return data;
}

function makeTexture(data, size, { srgb = false, repeat = 1, aniso = 8 }) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Core generator. `height(u,v)` drives the normal map; `shade(u,v,h)` returns
 * the albedo colour and roughness for that texel.
 */
function generate(size, { height, shade, normalStrength = 2, repeat = 1, aniso = 8 }) {
  const heightField = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      heightField[y * size + x] = height(x / size, y / size);
    }
  }

  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const col = { r: 0, g: 0, b: 0, rough: 0.8, metal: 0 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      shade(x / size, y / size, heightField[idx], col);
      const i = idx * 4;
      albedo[i] = clamp01(col.r) * 255;
      albedo[i + 1] = clamp01(col.g) * 255;
      albedo[i + 2] = clamp01(col.b) * 255;
      albedo[i + 3] = 255;
      // three reads roughness from G and metalness from B of their maps
      const rv = clamp01(col.rough) * 255;
      rough[i] = rv;
      rough[i + 1] = rv;
      rough[i + 2] = clamp01(col.metal) * 255;
      rough[i + 3] = 255;
    }
  }

  return {
    map: makeTexture(albedo, size, { srgb: true, repeat, aniso }),
    normalMap: makeTexture(heightToNormal(heightField, size, normalStrength), size, { repeat, aniso }),
    roughnessMap: makeTexture(rough, size, { repeat, aniso }),
  };
}

// ---------------------------------------------------------------------------
// Material presets — each describes one real-world surface.
// ---------------------------------------------------------------------------
const PRESETS = {
  // Cast concrete: broad mottling, fine aggregate pitting, occasional
  // hairline cracks and darker water staining.
  concrete: {
    normalStrength: 1.6,
    repeat: 3,
    height: (u, v) => {
      const broad = fbm(u, v, 4, 5) * 0.5;
      const grain = fbm(u, v, 3, 48) * 0.28;
      const crack = smoothstep(0.93, 1.0, ridged(u, v, 3, 7)) * -0.9;
      return broad + grain + crack;
    },
    shade: (u, v, h, out) => {
      const stain = smoothstep(0.1, 0.75, fbm(u * 0.9, v, 3, 3.5) * 0.5 + 0.5);
      const base = lerp(0.70, 0.80, stain) + h * 0.06;
      const warm = fbm(u, v, 2, 9) * 0.02;
      out.r = base + warm;
      out.g = base + warm * 0.85;
      out.b = base * 0.985;
      out.rough = clamp01(0.72 + h * 0.12 + (1 - stain) * 0.08);
      out.metal = 0;
    },
  },

  // Weathered / darker concrete for plinths, retaining walls, kerbs.
  weatheredConcrete: {
    normalStrength: 2.1,
    repeat: 3,
    height: (u, v) => fbm(u, v, 5, 6) * 0.55 + fbm(u, v, 3, 40) * 0.3 + smoothstep(0.9, 1, ridged(u, v, 3, 9)) * -1,
    shade: (u, v, h, out) => {
      const dirt = smoothstep(-0.2, 0.6, fbm(u, v, 4, 4));
      const base = lerp(0.42, 0.62, dirt) + h * 0.08;
      out.r = base * 1.02;
      out.g = base;
      out.b = base * 0.95;
      out.rough = clamp01(0.82 + h * 0.1);
      out.metal = 0;
    },
  },

  // Road asphalt: dense angular aggregate, slightly polished wheel paths.
  asphalt: {
    normalStrength: 2.6,
    repeat: 6,
    height: (u, v) => fbm(u, v, 3, 90) * 0.75 + fbm(u, v, 3, 18) * 0.3,
    shade: (u, v, h, out) => {
      const agg = fbm(u, v, 3, 90) * 0.5 + 0.5;
      const patch = fbm(u, v, 3, 5) * 0.5 + 0.5;
      const base = lerp(0.055, 0.105, agg) + patch * 0.02;
      out.r = base * 1.03;
      out.g = base;
      out.b = base * 1.06;
      out.rough = clamp01(0.88 - agg * 0.14);
      out.metal = 0;
    },
  },

  // Lawn / meadow: blade-scale high frequency detail with dry patches.
  grass: {
    normalStrength: 2.2,
    repeat: 26,
    height: (u, v) => fbm(u, v, 3, 60) * 0.7 + fbm(u, v, 2, 12) * 0.35,
    shade: (u, v, h, out) => {
      const blade = fbm(u, v, 3, 55) * 0.5 + 0.5;
      const dry = smoothstep(0.35, 0.85, fbm(u, v, 3, 6) * 0.5 + 0.5);
      out.r = lerp(0.055, 0.20, blade) + dry * 0.14;
      out.g = lerp(0.16, 0.36, blade) + dry * 0.08;
      out.b = lerp(0.03, 0.10, blade) + dry * 0.02;
      out.rough = clamp01(0.86 + blade * 0.1);
      out.metal = 0;
    },
  },

  // Planter soil / potting mix: clumpy, dark, damp.
  soil: {
    normalStrength: 3.0,
    repeat: 2,
    height: (u, v) => fbm(u, v, 4, 26) * 0.8 + fbm(u, v, 3, 70) * 0.35,
    shade: (u, v, h, out) => {
      const clump = fbm(u, v, 4, 24) * 0.5 + 0.5;
      out.r = lerp(0.055, 0.135, clump);
      out.g = lerp(0.036, 0.092, clump);
      out.b = lerp(0.024, 0.058, clump);
      out.rough = clamp01(0.92 - clump * 0.08);
      out.metal = 0;
    },
  },

  // Brushed stainless — streaks run along U so it reads as a milled finish.
  brushedMetal: {
    normalStrength: 1.1,
    repeat: 2,
    height: (u, v) => fbm(u * 0.06, v, 3, 120) * 0.9,
    shade: (u, v, h, out) => {
      const streak = fbm(u * 0.06, v, 3, 120) * 0.5 + 0.5;
      const base = lerp(0.52, 0.68, streak);
      out.r = base;
      out.g = base * 1.005;
      out.b = base * 1.02;
      out.rough = clamp01(0.28 + streak * 0.16);
      out.metal = 1;
    },
  },

  // Powder-coated steel: subtle "orange peel" in the paint film.
  paintedMetal: {
    normalStrength: 0.7,
    repeat: 2,
    height: (u, v) => fbm(u, v, 3, 55) * 0.5,
    shade: (u, v, h, out) => {
      const peel = fbm(u, v, 3, 55) * 0.5 + 0.5;
      const base = 0.86 + peel * 0.1;
      out.r = base;
      out.g = base;
      out.b = base;
      out.rough = clamp01(0.34 + peel * 0.12);
      out.metal = 0;
    },
  },

  // Timber decking: directional grain plus darker growth rings.
  wood: {
    normalStrength: 1.8,
    repeat: 2,
    height: (u, v) => {
      const grain = Math.sin((v * 26 + fbm(u, v, 3, 4) * 5) * Math.PI) * 0.35;
      return grain + fbm(u * 0.15, v, 3, 60) * 0.4;
    },
    shade: (u, v, h, out) => {
      const ring = Math.sin((v * 26 + fbm(u, v, 3, 4) * 5) * Math.PI) * 0.5 + 0.5;
      const fibre = fbm(u * 0.15, v, 3, 70) * 0.5 + 0.5;
      out.r = lerp(0.26, 0.44, ring) * lerp(0.85, 1.05, fibre);
      out.g = lerp(0.155, 0.28, ring) * lerp(0.85, 1.05, fibre);
      out.b = lerp(0.085, 0.16, ring) * lerp(0.85, 1.05, fibre);
      out.rough = clamp01(0.62 + ring * 0.2);
      out.metal = 0;
    },
  },

  // Standing-seam metal roof: hard ribs at a regular pitch, faint patina.
  roofMetal: {
    normalStrength: 4.5,
    repeat: 3,
    height: (u, v) => {
      const seam = Math.abs(((u * 8) % 1) - 0.5);
      const rib = smoothstep(0.5, 0.42, seam) * 1.4;
      return rib + fbm(u, v, 3, 40) * 0.12;
    },
    shade: (u, v, h, out) => {
      const wear = fbm(u, v, 4, 8) * 0.5 + 0.5;
      const base = lerp(0.16, 0.26, wear);
      out.r = base * 0.92;
      out.g = base * 1.0;
      out.b = base * 1.05;
      out.rough = clamp01(0.42 + wear * 0.22);
      out.metal = 0.85;
    },
  },

  // Photovoltaic laminate: cell grid, busbars, blue anti-reflective coating.
  solarPanel: {
    normalStrength: 1.2,
    repeat: 1,
    height: (u, v) => {
      const cellU = Math.abs(((u * 6) % 1) - 0.5);
      const cellV = Math.abs(((v * 10) % 1) - 0.5);
      const gap = smoothstep(0.46, 0.5, Math.max(cellU, cellV)) * -1.2;
      const busbar = smoothstep(0.02, 0.0, Math.abs(((v * 10) % 1) - 0.25)) * 0.5;
      return gap + busbar + fbm(u, v, 2, 60) * 0.05;
    },
    shade: (u, v, h, out) => {
      const cellU = Math.abs(((u * 6) % 1) - 0.5);
      const cellV = Math.abs(((v * 10) % 1) - 0.5);
      const inCell = 1 - smoothstep(0.44, 0.5, Math.max(cellU, cellV));
      const busbar = smoothstep(0.022, 0.008, Math.abs(((v * 10) % 1) - 0.25));
      const crystal = fbm(u, v, 3, 40) * 0.5 + 0.5;

      // dark blue silicon, silver busbars, near-black frame gaps
      out.r = lerp(0.02, 0.035 + crystal * 0.02, inCell) + busbar * 0.62;
      out.g = lerp(0.022, 0.055 + crystal * 0.03, inCell) + busbar * 0.64;
      out.b = lerp(0.03, 0.14 + crystal * 0.05, inCell) + busbar * 0.66;
      out.rough = lerp(0.5, 0.16, inCell) - busbar * 0.05;
      out.metal = lerp(0.2, 0.55, inCell) + busbar * 0.4;
    },
  },

  // Laminated rubber bearing pads under the earthquake building.
  rubber: {
    normalStrength: 1.4,
    repeat: 1,
    height: (u, v) => {
      const band = Math.sin(v * Math.PI * 18) * 0.45; // steel shim laminations
      return band + fbm(u, v, 3, 70) * 0.25;
    },
    shade: (u, v, h, out) => {
      const band = Math.sin(v * Math.PI * 18) * 0.5 + 0.5;
      const base = lerp(0.028, 0.062, band);
      out.r = base;
      out.g = base;
      out.b = base * 1.05;
      out.rough = clamp01(0.86 - band * 0.22);
      out.metal = band * 0.35;
      out.rough = clamp01(out.rough);
    },
  },

  // Precast paving slabs for footpaths: recessed joints, per-slab tonal
  // variation, and worn/chipped corners.
  paving: {
    normalStrength: 2.8,
    repeat: 5,
    height: (u, v) => {
      const SX = 4, SY = 8;
      const fx = Math.abs(((u * SX) % 1) - 0.5);
      const fy = Math.abs(((v * SY) % 1) - 0.5);
      const joint = smoothstep(0.5, 0.43, Math.max(fx, fy)) - 1; // recessed groove
      const wear = fbm(u, v, 3, 40) * 0.18;
      return joint * 0.9 + wear;
    },
    shade: (u, v, h, out) => {
      const SX = 4, SY = 8;
      const cellU = Math.floor(u * SX);
      const cellV = Math.floor(v * SY);
      // hash the slab index so each slab gets its own tone
      const hash = Math.abs(Math.sin(cellU * 12.9898 + cellV * 78.233) * 43758.5453) % 1;
      const fx = Math.abs(((u * SX) % 1) - 0.5);
      const fy = Math.abs(((v * SY) % 1) - 0.5);
      const inSlab = 1 - smoothstep(0.43, 0.5, Math.max(fx, fy));

      const grit = fbm(u, v, 3, 55) * 0.5 + 0.5;
      const base = lerp(0.46, 0.63, hash) * lerp(0.9, 1.08, grit);
      const jointDark = lerp(0.55, 1.0, inSlab);
      out.r = base * jointDark;
      out.g = base * jointDark * 0.995;
      out.b = base * jointDark * 0.96;
      out.rough = clamp01(0.74 + grit * 0.16 + (1 - inSlab) * 0.08);
      out.metal = 0;
    },
  },

  // Fired clay roof / terracotta pots.
  terracotta: {
    normalStrength: 2.0,
    repeat: 2,
    height: (u, v) => fbm(u, v, 4, 20) * 0.6 + fbm(u, v, 2, 60) * 0.25,
    shade: (u, v, h, out) => {
      const t = fbm(u, v, 4, 18) * 0.5 + 0.5;
      out.r = lerp(0.30, 0.46, t);
      out.g = lerp(0.125, 0.20, t);
      out.b = lerp(0.075, 0.115, t);
      out.rough = clamp01(0.78 + t * 0.14);
      out.metal = 0;
    },
  },
};

/**
 * Waves for the reflective Water surface. Water.js consumes a plain normal
 * map, so we build a tileable one from layered directional swell + chop.
 */
function generateWaterNormals(size, aniso) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const swell = Math.sin((u * 2 + v * 1) * TAU) * 0.35 + Math.sin((u * 1 - v * 3) * TAU) * 0.25;
      const chop = fbm(u, v, 4, 9) * 0.8;
      const ripple = fbm(u, v, 3, 34) * 0.32;
      height[y * size + x] = swell * 0.5 + chop + ripple;
    }
  }
  return makeTexture(heightToNormal(height, size, 2.4), size, { repeat: 1, aniso });
}

let library = null;

/**
 * Builds (and caches) every texture set. Sizes scale with quality so a
 * mid-range laptop can still load quickly.
 */
export function initTextureLibrary(renderer, quality = 'high') {
  if (library) return library;

  const size = quality === 'low' ? 128 : quality === 'medium' ? 192 : 256;
  const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality === 'low' ? 2 : 8);

  library = {};
  for (const [name, preset] of Object.entries(PRESETS)) {
    library[name] = generate(size, { ...preset, aniso });
  }
  library.waterNormals = generateWaterNormals(size, aniso);
  return library;
}

export function getTextures() {
  if (!library) throw new Error('initTextureLibrary(renderer) must run first');
  return library;
}

/**
 * Clones a texture set with a different tiling density — lets one preset
 * serve both a 40m ground plane and a 2m planter box without stretching.
 */
export function retile(set, repeat) {
  const out = {};
  for (const key of ['map', 'normalMap', 'roughnessMap']) {
    if (!set[key]) continue;
    const t = set[key].clone();
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    out[key] = t;
  }
  return out;
}
