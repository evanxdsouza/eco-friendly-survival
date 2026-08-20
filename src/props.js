// ---------------------------------------------------------------------------
// VEGETATION AND STREET PROPS
// ---------------------------------------------------------------------------
// Trees are grown recursively (trunk → boughs → twigs) and finished with
// alpha-cut leaf cards, then baked down to two geometries and drawn with
// InstancedMesh. A 30-tree canopy therefore costs 2 draw calls per variant.
//
// Everything vegetal shares a wind shader injected via onBeforeCompile:
// grass blades bend from their base, leaf cards drift as a mass. Static
// vegetation is one of the strongest "this is CG" tells, so it's worth the
// few lines of GLSL.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { MeshBuilder } from './parts.js';
import { mats, painted, plastic, emissive } from './materials.js';

// Shared clock uniform so every windy material animates in lockstep.
export const windUniforms = { uTime: { value: 0 } };

/**
 * Injects vertex-stage wind displacement into any standard material.
 * mode 'blade' bends from the base (grass), 'leaf' drifts uniformly (canopy).
 */
function applyWind(material, { mode = 'leaf', strength = 0.08 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindStrength = { value: strength };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uWindStrength;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           // world position drives the phase so neighbouring plants don't
           // sway in unison (that instantly looks artificial)
           #ifdef USE_INSTANCING
             vec4 windWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
           #else
             vec4 windWorld = modelMatrix * vec4(transformed, 1.0);
           #endif

           float gust = sin(uTime * 0.55 + windWorld.x * 0.13 + windWorld.z * 0.11);
           float sway = sin(uTime * 1.7 + windWorld.x * 0.9 + windWorld.z * 0.7)
                      + 0.45 * sin(uTime * 3.1 + windWorld.z * 1.6);
           float amount = uWindStrength * (0.65 + 0.35 * gust);
           ${mode === 'blade'
             ? 'float reach = max(transformed.y, 0.0);'
             : 'float reach = 1.0;'}
           transformed.x += sway * amount * reach;
           transformed.z += sway * amount * 0.55 * reach;
         }`
      );
  };
  material.customProgramCacheKey = () => `wind-${mode}-${strength}`;
  return material;
}

// ---------------------------------------------------------------------------
// Leaf texture — a cluster of leaves drawn to canvas, used as an alpha cutout
// ---------------------------------------------------------------------------
let leafTexture = null;
function getLeafTexture() {
  if (leafTexture) return leafTexture;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Scatter individual leaflets so one card reads as a dense sprig of
  // foliage. Coverage matters: sparse cards make a tree look bare no matter
  // how many you hang on it.
  const leaves = 26;
  for (let i = 0; i < leaves; i++) {
    const cx = size * (0.12 + Math.random() * 0.76);
    const cy = size * (0.12 + Math.random() * 0.76);
    const len = size * (0.22 + Math.random() * 0.2);
    const wid = len * (0.42 + Math.random() * 0.2);
    const rot = Math.random() * Math.PI * 2;

    const shade = 92 + Math.floor(Math.random() * 62);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    const grad = ctx.createLinearGradient(0, -len / 2, 0, len / 2);
    grad.addColorStop(0, `rgb(${Math.floor(shade * 0.5)}, ${shade}, ${Math.floor(shade * 0.42)})`);
    grad.addColorStop(1, `rgb(${Math.floor(shade * 0.32)}, ${Math.floor(shade * 0.72)}, ${Math.floor(shade * 0.3)})`);
    ctx.fillStyle = grad;

    // simple pointed-ellipse leaf silhouette
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.quadraticCurveTo(wid / 2, 0, 0, len / 2);
    ctx.quadraticCurveTo(-wid / 2, 0, 0, -len / 2);
    ctx.fill();

    // midrib
    ctx.strokeStyle = `rgba(${Math.floor(shade * 0.3)}, ${Math.floor(shade * 0.55)}, 30, 0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.lineTo(0, len / 2);
    ctx.stroke();
    ctx.restore();
  }

  leafTexture = new THREE.CanvasTexture(canvas);
  leafTexture.colorSpace = THREE.SRGBColorSpace;
  leafTexture.anisotropy = 8;
  return leafTexture;
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

function taperedSegment(builder, from, to, rFrom, rTo, material, segments = 7) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-4) return;
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );
  const m = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  builder.addGeometry(new THREE.CylinderGeometry(rTo, rFrom, len, segments, 1), material, m);
}

/**
 * Recursively grows one tree into a MeshBuilder.
 * Randomised branch angles/lengths mean no two instances read as clones.
 */
function growBranch(builder, opts) {
  const { from, dir, length, radius, depth, rng, barkMat, leafMat, leafSize } = opts;
  const to = from.clone().addScaledVector(dir, length);
  taperedSegment(builder, from, to, radius, radius * 0.68, barkMat, depth > 1 ? 8 : 5);

  // Leaves are hung on the outer TWO levels, not just the tips — a canopy
  // built only from tip clusters reads as a bare winter tree with spots of
  // green stuck on it.
  if (depth <= 1) {
    const cards = depth === 0 ? 11 : 6;
    for (let i = 0; i < cards; i++) {
      const s = leafSize * (0.75 + rng() * 0.5) * (depth === 0 ? 1 : 0.8);
      const geo = new THREE.PlaneGeometry(s, s);
      const pos = to.clone().add(
        new THREE.Vector3(
          (rng() - 0.5) * leafSize * 0.85,
          (rng() - 0.3) * leafSize * 0.7,
          (rng() - 0.5) * leafSize * 0.85
        )
      );
      const euler = new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      const m = new THREE.Matrix4().compose(
        pos,
        new THREE.Quaternion().setFromEuler(euler),
        new THREE.Vector3(1, 1, 1)
      );
      builder.addGeometry(geo, leafMat, m);
    }
    return;
  }

  const children = depth > 2 ? 2 + (rng() > 0.55 ? 1 : 0) : 2;
  for (let i = 0; i < children; i++) {
    // spread children around the parent axis, tilting outward
    const tilt = 0.42 + rng() * 0.44;
    const spin = (i / children) * Math.PI * 2 + rng() * 0.9;

    const axis = new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin)).normalize();
    const childDir = dir
      .clone()
      .applyAxisAngle(axis, tilt)
      .normalize()
      .addScaledVector(new THREE.Vector3(0, 1, 0), 0.12) // branches reach for light
      .normalize();

    growBranch(builder, {
      ...opts,
      from: to,
      dir: childDir,
      length: length * (0.62 + rng() * 0.16),
      radius: radius * 0.63,
      depth: depth - 1,
    });
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds N distinct tree "species" ready for instancing. */
function buildTreeVariants(count = 3, quality = 'high') {
  const leafMat = new THREE.MeshStandardMaterial({
    map: getLeafTexture(),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.9,
    color: 0xffffff,
  });
  applyWind(leafMat, { mode: 'leaf', strength: 0.055 });

  const depth = quality === 'low' ? 4 : 5;
  const variants = [];

  for (let v = 0; v < count; v++) {
    const rng = mulberry32(1337 + v * 977);
    const builder = new MeshBuilder();
    const trunkH = 2.1 + rng() * 1.0;
    const radius = 0.17 + rng() * 0.06;

    // trunk with a slight lean and a flared base
    builder.addGeometry(
      new THREE.CylinderGeometry(radius * 1.05, radius * 1.55, 0.35, 9),
      mats().bark,
      new THREE.Matrix4().makeTranslation(0, 0.17, 0)
    );

    growBranch(builder, {
      from: new THREE.Vector3(0, 0.3, 0),
      dir: new THREE.Vector3((rng() - 0.5) * 0.14, 1, (rng() - 0.5) * 0.14).normalize(),
      length: trunkH,
      radius,
      depth,
      rng,
      barkMat: mats().bark,
      leafMat,
      leafSize: 1.5 + rng() * 0.5,
    });

    const group = builder.build(`tree-variant-${v}`);
    const parts = group.children.map((mesh) => ({
      geometry: mesh.geometry,
      material: mesh.material,
    }));
    variants.push(parts);
  }
  return variants;
}

/**
 * Instanced forest. `positions` is an array of [x, z]; each tree gets a
 * random variant, rotation and scale.
 */
export function createForest(positions, quality = 'high') {
  const group = new THREE.Group();
  group.name = 'forest';
  if (!positions.length) return group;

  const variants = buildTreeVariants(3, quality);
  const rng = mulberry32(4242);

  // bucket positions per variant
  const buckets = variants.map(() => []);
  positions.forEach((p) => buckets[Math.floor(rng() * variants.length)].push(p));

  const dummy = new THREE.Object3D();
  variants.forEach((parts, vi) => {
    const list = buckets[vi];
    if (!list.length) return;

    parts.forEach((part) => {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      list.forEach(([x, z], i) => {
        const scale = 0.85 + rng() * 0.75;
        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      group.add(inst);
    });
  });
  return group;
}

// ---------------------------------------------------------------------------
// Grass
// ---------------------------------------------------------------------------

/**
 * Instanced grass tufts. Each tuft is three crossed tapered blades, which
 * reads as volume from any angle without needing a shell/fin technique.
 */
export function createGrassField(sampler, count, quality = 'high') {
  if (count <= 0) return new THREE.Group();

  const bladeH = 0.3;
  const builder = new MeshBuilder();
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x6d9440,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: 0.85,
  });
  applyWind(bladeMat, { mode: 'blade', strength: 0.42 });

  // a single tuft: 3 blades at 60° to each other, tapered toward the tip
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.PlaneGeometry(0.055, bladeH, 1, 3);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = (y + bladeH / 2) / bladeH;          // 0 at root, 1 at tip
      pos.setX(v, pos.getX(v) * (1 - t * 0.75));    // taper
      pos.setZ(v, pos.getZ(v) + t * t * 0.06);      // natural arc
      pos.setY(v, y + bladeH / 2);                  // sit on the ground
    }
    geo.computeVertexNormals();
    builder.addGeometry(
      geo,
      bladeMat,
      new THREE.Matrix4().makeRotationY((i / 3) * Math.PI)
    );
  }

  const tuft = builder.build('grass-tuft').children[0];
  const inst = new THREE.InstancedMesh(tuft.geometry, tuft.material, count);
  // Grass does not cast. 16,000 tufts is ~290k triangles pushed through the
  // 4096² shadow map every frame, to produce 30cm shadows that are entirely
  // hidden under the blades that cast them. It still RECEIVES shadow, which is
  // the part you actually see.
  inst.castShadow = false;
  inst.receiveShadow = true;
  inst.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const rng = mulberry32(90210);
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 30) {
    guard++;
    const p = sampler(rng);
    if (!p) continue;
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    const s = 0.7 + rng() * 0.9;
    dummy.scale.set(s, s * (0.8 + rng() * 0.6), s);
    dummy.updateMatrix();
    inst.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

/** Clipped hedge block with an irregular, slightly noisy surface. */
export function createHedge({ width, depth, height = 0.85 }) {
  const geo = new THREE.BoxGeometry(width, height, depth, 12, 6, 8);
  const pos = geo.attributes.position;
  const rng = mulberry32(777);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // only ruffle the outer surface, keep the base flat on the ground
    const edge = Math.abs(y) > height * 0.42 || Math.abs(pos.getX(i)) > width * 0.42;
    const amt = edge ? 0.05 : 0.03;
    pos.setX(i, pos.getX(i) + (rng() - 0.5) * amt);
    pos.setY(i, pos.getY(i) + (rng() - 0.5) * amt);
    pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * amt);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x3f6b31,
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.8,
  });
  applyWind(mat, { mode: 'leaf', strength: 0.012 });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

/** Street lamp with a real PointLight that switches on after dark. */
export function createStreetLamp({ height = 4.4 }) {
  const group = new THREE.Group();
  const b = new MeshBuilder();
  const poleMat = painted(0x2f3438, 0.42, 0.5);

  b.cyl(0.13, 0.17, 0.22, mats().concreteDark, { pos: [0, 0.11, 0], segments: 12 });
  b.cyl(0.07, 0.085, height, poleMat, { pos: [0, height / 2, 0], segments: 12 });
  // access hatch on the column
  b.flat(0.11, 0.3, 0.02, mats().steelDark, { pos: [0, 0.75, 0.075] });

  // curved arm built from short chords
  const arm = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    arm.push(new THREE.Vector3(t * 0.95, height + Math.sin(t * Math.PI * 0.5) * 0.42, 0));
  }
  for (let i = 0; i < arm.length - 1; i++) {
    const a = arm[i];
    const c = arm[i + 1];
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    b.addGeometry(
      new THREE.CylinderGeometry(0.05, 0.05, len * 1.05, 10),
      poleMat,
      new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))
    );
  }

  const head = arm[arm.length - 1];
  // luminaire housing
  b.box(0.46, 0.11, 0.26, poleMat, { pos: [head.x + 0.16, head.y - 0.02, 0], radius: 0.04 });
  group.add(b.build('lamp-post'));

  // emissive lens (always present, brightness driven by time of day)
  const lensMat = emissive(0xffd9a0, 0).clone();
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.2), lensMat);
  lens.position.set(head.x + 0.16, head.y - 0.075, 0);
  group.add(lens);

  // Starts hidden. A PointLight that is `visible` contributes to every lit
  // material's shader (NUM_POINT_LIGHTS) and costs a per-fragment evaluation
  // across the whole screen even at intensity 0 — and by day all twelve of
  // these are at intensity 0. setNight() switches them on after dark.
  const light = new THREE.PointLight(0xffca82, 0, 13, 2);
  light.position.set(head.x + 0.16, head.y - 0.12, 0);
  light.visible = false;
  group.add(light);

  group.userData.setNight = (night) => {
    lensMat.emissiveIntensity = night * 6;
    light.intensity = night * 11;
    light.visible = night > 0.05;
  };
  return group;
}

/** Park bench: cast ends, timber slats, visible fixings. */
export function createBench() {
  const b = new MeshBuilder();
  const frame = painted(0x2c3a33, 0.45, 0.4);
  const slat = mats().wood;
  const width = 1.7;

  for (const s of [-1, 1]) {
    const x = (s * width) / 2;
    b.flat(0.06, 0.42, 0.5, frame, { pos: [x, 0.21, 0] });        // leg plate
    b.flat(0.06, 0.5, 0.06, frame, { pos: [x, 0.66, -0.2] });     // back upright
    b.flat(0.06, 0.06, 0.52, frame, { pos: [x, 0.43, 0] });       // seat bearer
  }
  // seat slats
  for (let i = 0; i < 4; i++) {
    b.box(width + 0.12, 0.035, 0.1, slat, { pos: [0, 0.46, -0.18 + i * 0.12], radius: 0.008 });
  }
  // back slats
  for (let i = 0; i < 3; i++) {
    b.box(width + 0.12, 0.09, 0.03, slat, { pos: [0, 0.62 + i * 0.13, -0.23], radius: 0.008 });
  }
  return b.build('bench');
}

/** Litter bin with a domed lid and an aperture. */
export function createBin() {
  const b = new MeshBuilder();
  const body = painted(0x36474f, 0.5, 0.35);
  b.cyl(0.24, 0.21, 0.72, body, { pos: [0, 0.36, 0], segments: 18 });
  b.add(new THREE.TorusGeometry(0.245, 0.018, 8, 22), mats().steel, { pos: [0, 0.68, 0], rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.SphereGeometry(0.245, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats().steelDark, {
    pos: [0, 0.72, 0],
    scale: [1, 0.42, 1],
  });
  b.flat(0.22, 0.1, 0.02, mats().steelDark, { pos: [0, 0.62, 0.22] });
  return b.build('bin');
}

/** Simple parked car — enough form and glazing to read at street scale. */
export function createCar(bodyColor = 0x9aa6b2) {
  const b = new MeshBuilder();
  const body = painted(bodyColor, 0.22, 0.55);
  const trim = mats().steelDark;
  const glass = mats().glass;

  // lower body + cabin greenhouse
  b.box(4.15, 0.62, 1.78, body, { pos: [0, 0.68, 0], radius: 0.22 });
  b.box(2.35, 0.56, 1.62, body, { pos: [-0.2, 1.2, 0], radius: 0.24 });
  b.box(4.2, 0.16, 1.82, trim, { pos: [0, 0.4, 0], radius: 0.06 });

  // glazing
  b.flat(1.05, 0.44, 1.5, glass, { pos: [0.72, 1.22, 0], rot: [0, 0, -0.62] });
  b.flat(0.9, 0.42, 1.5, glass, { pos: [-1.24, 1.22, 0], rot: [0, 0, 0.68] });
  for (const s of [-1, 1]) {
    b.flat(2.0, 0.4, 0.02, glass, { pos: [-0.2, 1.24, s * 0.8] });
  }

  // wheels with rims
  for (const sx of [-1.28, 1.32]) {
    for (const sz of [-1, 1]) {
      b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 20), mats().rubber, {
        pos: [sx, 0.36, sz * 0.82],
        rot: [Math.PI / 2, 0, 0],
      });
      b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 12), mats().steel, {
        pos: [sx, 0.36, sz * 0.83],
        rot: [Math.PI / 2, 0, 0],
      });
    }
  }

  // lamps
  b.flat(0.1, 0.16, 0.42, emissive(0xfff2d0, 0.6), { pos: [2.06, 0.78, 0.55] });
  b.flat(0.1, 0.16, 0.42, emissive(0xfff2d0, 0.6), { pos: [2.06, 0.78, -0.55] });
  b.flat(0.08, 0.14, 0.36, emissive(0xd93b2b, 0.5), { pos: [-2.08, 0.8, 0.6] });
  b.flat(0.08, 0.14, 0.36, emissive(0xd93b2b, 0.5), { pos: [-2.08, 0.8, -0.6] });

  // mirrors
  for (const s of [-1, 1]) {
    b.box(0.16, 0.1, 0.06, body, { pos: [0.85, 1.12, s * 0.95], radius: 0.02 });
  }
  return b.build('car');
}

/** Post-and-rail boundary fence running along X. */
export function createFence({ length, height = 1.05 }) {
  const b = new MeshBuilder();
  const posts = Math.max(2, Math.round(length / 1.8) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -length / 2 + (length * i) / (posts - 1);
    b.box(0.09, height, 0.09, mats().wood, { pos: [x, height / 2, 0], radius: 0.012 });
    b.add(new THREE.ConeGeometry(0.075, 0.09, 4), mats().wood, { pos: [x, height + 0.045, 0], rot: [0, Math.PI / 4, 0] });
  }
  for (const y of [height * 0.34, height * 0.72]) {
    b.box(length, 0.07, 0.04, mats().wood, { pos: [0, y, 0], radius: 0.008 });
  }
  return b.build('fence');
}

/** Concrete bollard with a reflective band. */
export function createBollard() {
  const b = new MeshBuilder();
  b.cyl(0.11, 0.13, 0.9, mats().concreteDark, { pos: [0, 0.45, 0], segments: 14 });
  b.add(new THREE.TorusGeometry(0.115, 0.014, 6, 18), emissive(0xf2e14a, 0.35), {
    pos: [0, 0.78, 0],
    rot: [Math.PI / 2, 0, 0],
  });
  return b.build('bollard');
}
