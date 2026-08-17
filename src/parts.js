// ---------------------------------------------------------------------------
// REUSABLE ARCHITECTURAL DETAIL COMPONENTS
// ---------------------------------------------------------------------------
// Real buildings are made of thousands of small parts — mullions, sills,
// brackets, bolts, louvres, handrails. Modelling those is what pushes a scene
// from "blocky massing" to "believable structure".
//
// To keep that affordable, everything is assembled through MeshBuilder, which
// bakes many small geometries into ONE merged mesh per material. A window wall
// with 60 panes and 140 mullion bars ends up as 2 draw calls, not 200.
//
// Note on edges: nothing in the real world has a perfectly sharp edge. Using
// rounded boxes almost everywhere gives every corner a highlight, which is a
// surprisingly large part of reading as photographic.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mats, painted, plastic } from './materials.js';

// ---------------------------------------------------------------------------
// Geometry plumbing
// ---------------------------------------------------------------------------

/** Strips a geometry to position/normal/uv, non-indexed, so any two can merge. */
function normalize(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  return g;
}

/**
 * Accumulates geometry per material, then merges into one mesh per material.
 * This is the workhorse behind every detailed component in this file.
 */
export class MeshBuilder {
  constructor() {
    this.buckets = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  /** Add raw geometry with an explicit matrix. */
  addGeometry(geo, material, matrix) {
    const g = normalize(geo);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
    return this;
  }

  /** Add geometry positioned/rotated/scaled by loose transform options. */
  add(geo, material, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
    this._e.set(rot[0], rot[1], rot[2]);
    this._q.setFromEuler(this._e);
    this._v.set(pos[0], pos[1], pos[2]);
    this._s.set(scale[0], scale[1], scale[2]);
    this._m.compose(this._v, this._q, this._s);
    return this.addGeometry(geo, material, this._m);
  }

  /** Rounded box convenience — the default primitive for built form. */
  box(w, h, d, material, opts = {}) {
    const r = opts.radius ?? Math.min(w, h, d) * 0.06;
    return this.add(roundedBox(w, h, d, r), material, opts);
  }

  /** Sharp box, for thin panels where a bevel would be invisible. */
  flat(w, h, d, material, opts = {}) {
    return this.add(new THREE.BoxGeometry(w, h, d), material, opts);
  }

  cyl(rTop, rBot, h, material, opts = {}) {
    const seg = opts.segments ?? 16;
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), material, opts);
  }

  build(name = 'part') {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.buckets) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

// Rounded-box geometry cache — these get reused constantly.
const boxCache = new Map();
export function roundedBox(w, h, d, radius = 0.02, segments = 2) {
  const r = Math.max(0.001, Math.min(radius, Math.min(w, h, d) / 2 - 0.001));
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}|${segments}`;
  if (!boxCache.has(key)) boxCache.set(key, new RoundedBoxGeometry(w, h, d, segments, r));
  return boxCache.get(key);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * A glazed facade: recessed reveal, mullion/transom grid, glass panes and a
 * projecting sill. Panes get slight per-pane tint variation, because a real
 * curtain wall never reflects perfectly uniformly.
 *
 * Returns a Group; `+Z` is the outward face.
 */
export function createWindowWall({
  width,
  height,
  cols = 3,
  rows = 2,
  frameMaterial = mats().steelDark,
  glassMaterial = mats().glass,
  mullion = 0.06,
  depth = 0.12,
  sill = true,
  sillMaterial = mats().concreteDark,
}) {
  const b = new MeshBuilder();
  const group = new THREE.Group();

  // outer frame
  const half = mullion / 2;
  b.flat(width, mullion, depth, frameMaterial, { pos: [0, height / 2 - half, 0] });
  b.flat(width, mullion, depth, frameMaterial, { pos: [0, -height / 2 + half, 0] });
  b.flat(mullion, height, depth, frameMaterial, { pos: [-width / 2 + half, 0, 0] });
  b.flat(mullion, height, depth, frameMaterial, { pos: [width / 2 - half, 0, 0] });

  // vertical mullions
  const cellW = width / cols;
  for (let c = 1; c < cols; c++) {
    b.flat(mullion * 0.8, height, depth * 0.9, frameMaterial, {
      pos: [-width / 2 + c * cellW, 0, 0],
    });
  }
  // horizontal transoms
  const cellH = height / rows;
  for (let r = 1; r < rows; r++) {
    b.flat(width, mullion * 0.8, depth * 0.9, frameMaterial, {
      pos: [0, -height / 2 + r * cellH, 0],
    });
  }

  if (sill) {
    b.box(width + 0.18, 0.08, depth + 0.16, sillMaterial, {
      pos: [0, -height / 2 - 0.04, 0.02],
      radius: 0.02,
    });
  }

  group.add(b.build('window-frame'));

  // Glass panes sit slightly behind the frame line (a real reveal), and are
  // separate meshes so they can be transparent-sorted.
  const paneGeo = new THREE.PlaneGeometry(cellW - mullion, cellH - mullion);
  const glassGroup = new THREE.Group();
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const pane = new THREE.Mesh(paneGeo, glassMaterial);
      pane.position.set(
        -width / 2 + cellW * (c + 0.5),
        -height / 2 + cellH * (r + 0.5),
        -depth * 0.18
      );
      glassGroup.add(pane);
    }
  }
  group.add(glassGroup);
  return group;
}

/**
 * Handrail with posts, top/mid rails and balusters. Used on balconies,
 * walkways and stairs.
 */
export function createRailing({
  length,
  height = 1.05,
  material = mats().steel,
  postSpacing = 1.1,
  balusterSpacing = 0.13,
  balusters = true,
}) {
  const b = new MeshBuilder();
  const postCount = Math.max(2, Math.round(length / postSpacing) + 1);

  for (let i = 0; i < postCount; i++) {
    const x = -length / 2 + (length * i) / (postCount - 1);
    b.cyl(0.024, 0.028, height, material, { pos: [x, height / 2, 0], segments: 10 });
    // base plate + bolts
    b.cyl(0.055, 0.055, 0.02, material, { pos: [x, 0.01, 0], segments: 10 });
  }

  // top rail (slightly oval, like a real extruded handrail) and mid rail
  b.add(new THREE.CylinderGeometry(0.032, 0.032, length, 12), material, {
    pos: [0, height, 0],
    rot: [0, 0, Math.PI / 2],
    scale: [1, 1, 0.75],
  });
  b.add(new THREE.CylinderGeometry(0.018, 0.018, length, 8), material, {
    pos: [0, height * 0.52, 0],
    rot: [0, 0, Math.PI / 2],
  });

  if (balusters) {
    const n = Math.floor(length / balusterSpacing);
    for (let i = 1; i < n; i++) {
      const x = -length / 2 + i * balusterSpacing;
      b.cyl(0.008, 0.008, height * 0.98, material, { pos: [x, height * 0.49, 0], segments: 6 });
    }
  }
  return b.build('railing');
}

/**
 * Stair flight with treads, risers, side stringers and optional handrails.
 * Climbs along +Z, rising in +Y.
 */
export function createStairs({
  steps = 10,
  rise = 0.18,
  run = 0.29,
  width = 1.2,
  treadMaterial = mats().concreteDark,
  structureMaterial = mats().steelDark,
  railings = true,
}) {
  const group = new THREE.Group();
  const b = new MeshBuilder();

  for (let i = 0; i < steps; i++) {
    const y = rise * (i + 1);
    const z = -run * i;
    // tread with a small nosing overhang
    b.box(width, 0.05, run + 0.03, treadMaterial, { pos: [0, y - 0.025, z], radius: 0.012 });
    // riser plate set back under the nosing
    b.flat(width * 0.98, rise - 0.05, 0.02, structureMaterial, {
      pos: [0, y - rise / 2 - 0.01, z - run / 2 + 0.01],
    });
  }

  // Diagonal stringers down each side.
  const totalRise = rise * steps;
  const totalRun = run * steps;
  const stringerLen = Math.hypot(totalRise, totalRun);
  const angle = Math.atan2(totalRise, totalRun);
  for (const side of [-1, 1]) {
    b.flat(0.06, 0.24, stringerLen, structureMaterial, {
      pos: [side * (width / 2 + 0.03), totalRise / 2 - 0.08, -totalRun / 2 + run / 2],
      rot: [angle, 0, 0],
    });
  }
  group.add(b.build('stairs'));

  if (railings) {
    for (const side of [-1, 1]) {
      const rail = createRailing({ length: stringerLen, height: 0.98, balusterSpacing: 0.16 });
      rail.rotation.x = angle;
      rail.rotation.y = Math.PI / 2;
      rail.position.set(side * (width / 2 + 0.05), totalRise / 2, -totalRun / 2 + run / 2);
      group.add(rail);
    }
  }
  group.userData.totalRise = totalRise;
  group.userData.totalRun = totalRun;
  return group;
}

/**
 * Rooftop air-handling unit: louvred sides, fan grille, service panel and
 * anti-vibration feet.
 */
export function createHVAC({ width = 1.5, height = 0.8, depth = 1.0, seed = 0 }) {
  const b = new MeshBuilder();
  const shell = painted(0xb8bcc0, 0.5, 0.35);

  b.box(width, height, depth, shell, { pos: [0, height / 2, 0], radius: 0.035 });

  // louvre fins on both long sides
  const fins = Math.floor(height / 0.085);
  for (let i = 1; i < fins; i++) {
    const y = (height * i) / fins;
    for (const side of [-1, 1]) {
      b.flat(width * 0.82, 0.045, 0.02, mats().steelDark, {
        pos: [0, y, side * (depth / 2 + 0.008)],
        rot: [0.35 * side, 0, 0],
      });
    }
  }

  // fan cowl + grille bars on top
  b.cyl(0.26, 0.28, 0.1, mats().steelDark, { pos: [0, height + 0.05, 0], segments: 20 });
  for (let i = 0; i < 7; i++) {
    b.flat(0.5, 0.012, 0.022, mats().steel, {
      pos: [0, height + 0.105, -0.24 + i * 0.08],
    });
  }

  // service access panel + handle
  b.flat(width * 0.4, height * 0.55, 0.015, painted(0x9aa0a6, 0.45, 0.3), {
    pos: [width / 2 + 0.008, height * 0.45, 0],
    rot: [0, Math.PI / 2, 0],
  });

  // vibration-isolating feet
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl(0.05, 0.05, 0.06, mats().rubber, {
        pos: [sx * (width / 2 - 0.12), 0.03, sz * (depth / 2 - 0.12)],
        segments: 8,
      });
    }
  }
  return b.build('hvac');
}

/**
 * Builds a run of pipe through a list of points, with elbow spheres at the
 * joints and wall brackets. Used for downpipes, irrigation and gutters.
 */
export function createPipeRun(points, { radius = 0.05, material = mats().steel, brackets = false } = {}) {
  const b = new MeshBuilder();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const mat4 = new THREE.Matrix4();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const c = points[i + 1];
    dir.subVectors(c, a);
    const len = dir.length();
    if (len < 1e-4) continue;
    mid.addVectors(a, c).multiplyScalar(0.5);
    quat.setFromUnitVectors(up, dir.clone().normalize());
    mat4.compose(mid, quat, scale);
    b.addGeometry(new THREE.CylinderGeometry(radius, radius, len, 12), material, mat4);

    // elbow at interior joints
    if (i > 0) {
      b.add(new THREE.SphereGeometry(radius * 1.18, 12, 10), material, {
        pos: [a.x, a.y, a.z],
      });
    }
    if (brackets && len > 0.8) {
      const n = Math.floor(len / 0.9);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const p = a.clone().lerp(c, t);
        b.add(new THREE.TorusGeometry(radius * 1.4, radius * 0.28, 6, 14), material, {
          pos: [p.x, p.y, p.z],
          rot: [Math.PI / 2, 0, 0],
        });
      }
    }
  }
  return b.build('pipe-run');
}

/**
 * Cylindrical storage tank with reinforcing bands, domed lid, inlet/outlet
 * fittings, a level gauge and a service ladder.
 */
export function createWaterTank({
  radius = 0.6,
  height = 1.9,
  material = mats().steel,
  accent = 0x2f6f8e,
  ladder = true,
}) {
  const b = new MeshBuilder();
  const shell = painted(accent, 0.42, 0.35);

  b.cyl(radius, radius, height, shell, { pos: [0, height / 2, 0], segments: 28 });

  // reinforcing bands
  for (const t of [0.18, 0.52, 0.86]) {
    b.add(new THREE.TorusGeometry(radius + 0.012, 0.022, 8, 30), material, {
      pos: [0, height * t, 0],
      rot: [Math.PI / 2, 0, 0],
    });
  }

  // domed lid + hatch
  b.add(new THREE.SphereGeometry(radius, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), material, {
    pos: [0, height, 0],
    scale: [1, 0.34, 1],
  });
  b.cyl(radius * 0.28, radius * 0.28, 0.06, mats().steelDark, {
    pos: [0, height + radius * 0.34, 0],
    segments: 16,
  });

  // base plinth + anchor bolts
  b.cyl(radius + 0.08, radius + 0.1, 0.12, mats().concreteDark, { pos: [0, 0.06, 0], segments: 28 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cyl(0.018, 0.018, 0.05, mats().steelDark, {
      pos: [Math.cos(a) * (radius + 0.04), 0.14, Math.sin(a) * (radius + 0.04)],
      segments: 6,
    });
  }

  // outlet valve assembly
  b.cyl(0.045, 0.045, 0.3, material, {
    pos: [radius + 0.1, 0.35, 0],
    rot: [0, 0, Math.PI / 2],
    segments: 10,
  });
  b.add(new THREE.TorusGeometry(0.07, 0.016, 6, 16), painted(0xb2402f, 0.5), {
    pos: [radius + 0.26, 0.35, 0],
    rot: [0, Math.PI / 2, 0],
  });

  // sight-glass level gauge
  b.cyl(0.02, 0.02, height * 0.6, mats().glass, {
    pos: [0, height * 0.45, radius + 0.03],
    segments: 8,
  });

  if (ladder) {
    for (const side of [-1, 1]) {
      b.cyl(0.014, 0.014, height, mats().steel, {
        pos: [-radius - 0.06, height / 2, side * 0.16],
        segments: 6,
      });
    }
    const rungs = Math.floor(height / 0.28);
    for (let i = 1; i < rungs; i++) {
      b.cyl(0.011, 0.011, 0.32, mats().steel, {
        pos: [-radius - 0.06, i * 0.28, 0],
        rot: [Math.PI / 2, 0, 0],
        segments: 6,
      });
    }
  }
  return b.build('water-tank');
}

/** Roof parapet: upstand wall with a capping band and internal drain scuppers. */
export function createParapet({ width, depth, height = 0.5, thickness = 0.16, material = mats().concrete }) {
  const b = new MeshBuilder();
  const cap = mats().concreteDark;

  const runs = [
    { w: width, d: thickness, x: 0, z: depth / 2 - thickness / 2 },
    { w: width, d: thickness, x: 0, z: -depth / 2 + thickness / 2 },
    { w: thickness, d: depth - thickness * 2, x: width / 2 - thickness / 2, z: 0 },
    { w: thickness, d: depth - thickness * 2, x: -width / 2 + thickness / 2, z: 0 },
  ];
  for (const r of runs) {
    b.box(r.w, height, r.d, material, { pos: [r.x, height / 2, r.z], radius: 0.02 });
    // metal capping / coping stone on top
    b.box(r.w + 0.06, 0.05, r.d + 0.06, cap, { pos: [r.x, height + 0.025, r.z], radius: 0.015 });
  }
  return b.build('parapet');
}

/** Gutter channel with end caps and support brackets, running along X. */
export function createGutter({ length, material = mats().steel, radius = 0.07 }) {
  const b = new MeshBuilder();
  // open half-round channel
  b.add(new THREE.CylinderGeometry(radius, radius, length, 14, 1, true, 0, Math.PI), material, {
    pos: [0, 0, 0],
    rot: [0, 0, Math.PI / 2],
  });
  for (const s of [-1, 1]) {
    b.add(new THREE.CircleGeometry(radius, 14, 0, Math.PI), material, {
      pos: [(s * length) / 2, 0, 0],
      rot: [0, Math.PI / 2, Math.PI / 2],
    });
  }
  const brackets = Math.max(2, Math.floor(length / 0.9));
  for (let i = 0; i <= brackets; i++) {
    const x = -length / 2 + (length * i) / brackets;
    b.add(new THREE.TorusGeometry(radius + 0.014, 0.012, 6, 14, Math.PI), material, {
      pos: [x, 0, 0],
      rot: [0, Math.PI / 2, Math.PI],
    });
  }
  return b.build('gutter');
}

/** Door: reveal frame, panel, vision glazing, lever handle and threshold. */
export function createDoor({
  width = 1.0,
  height = 2.1,
  frameMaterial = mats().steelDark,
  panelColor = 0x37474f,
  glazed = true,
}) {
  const b = new MeshBuilder();
  const panel = painted(panelColor, 0.4, 0.25);

  // frame
  b.flat(width + 0.12, 0.08, 0.14, frameMaterial, { pos: [0, height + 0.04, 0] });
  for (const s of [-1, 1]) {
    b.flat(0.06, height + 0.08, 0.14, frameMaterial, { pos: [(s * (width + 0.06)) / 2, height / 2, 0] });
  }
  // leaf, set back into the reveal
  b.box(width, height, 0.055, panel, { pos: [0, height / 2, -0.03], radius: 0.008 });
  // kick plate
  b.flat(width * 0.92, 0.24, 0.012, mats().steel, { pos: [0, 0.2, -0.005] });
  // lever handle + escutcheon
  b.cyl(0.035, 0.035, 0.02, mats().steel, {
    pos: [width / 2 - 0.13, height * 0.47, -0.01],
    rot: [Math.PI / 2, 0, 0],
    segments: 12,
  });
  b.cyl(0.016, 0.016, 0.13, mats().steel, {
    pos: [width / 2 - 0.19, height * 0.47, 0.01],
    rot: [0, 0, Math.PI / 2],
    segments: 8,
  });
  // threshold
  b.flat(width + 0.1, 0.03, 0.16, mats().steel, { pos: [0, 0.015, 0] });

  const group = new THREE.Group();
  group.add(b.build('door'));

  if (glazed) {
    const vision = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.62, height * 0.3),
      mats().glass
    );
    vision.position.set(0, height * 0.72, 0.004);
    group.add(vision);
  }
  return group;
}

/** Tilted photovoltaic array on a support frame, with cable trays. */
export function createSolarArray({ rows = 2, cols = 3, panelW = 1.0, panelH = 0.62, tilt = 0.42, gap = 0.06 }) {
  const b = new MeshBuilder();
  const frame = mats().steel;
  const totalW = cols * (panelW + gap) - gap;
  const totalD = rows * (panelH * Math.cos(tilt) + 0.35);

  for (let r = 0; r < rows; r++) {
    const z = -totalD / 2 + r * (panelH * Math.cos(tilt) + 0.35) + panelH * 0.5;
    // support rails front/back
    const frontH = 0.16;
    const backH = frontH + panelH * Math.sin(tilt);
    for (let c = 0; c < cols; c++) {
      const x = -totalW / 2 + c * (panelW + gap) + panelW / 2;

      // panel laminate + aluminium frame
      b.flat(panelW, 0.03, panelH, mats().solarPanel, {
        pos: [x, (frontH + backH) / 2 + 0.02, z],
        rot: [-tilt, 0, 0],
      });
      b.flat(panelW + 0.03, 0.045, panelH + 0.03, frame, {
        pos: [x, (frontH + backH) / 2 + 0.004, z],
        rot: [-tilt, 0, 0],
      });

      // legs
      b.cyl(0.018, 0.018, frontH, frame, { pos: [x - panelW / 2 + 0.08, frontH / 2, z + panelH * 0.42], segments: 6 });
      b.cyl(0.018, 0.018, frontH, frame, { pos: [x + panelW / 2 - 0.08, frontH / 2, z + panelH * 0.42], segments: 6 });
      b.cyl(0.018, 0.018, backH, frame, { pos: [x - panelW / 2 + 0.08, backH / 2, z - panelH * 0.42], segments: 6 });
      b.cyl(0.018, 0.018, backH, frame, { pos: [x + panelW / 2 - 0.08, backH / 2, z - panelH * 0.42], segments: 6 });
    }
    // continuous mounting rail
    b.flat(totalW + 0.1, 0.035, 0.05, frame, { pos: [0, frontH, z + panelH * 0.42] });
    b.flat(totalW + 0.1, 0.035, 0.05, frame, { pos: [0, backH, z - panelH * 0.42] });
  }

  // cable tray running along the back
  b.flat(totalW, 0.05, 0.09, mats().steelDark, { pos: [0, 0.08, -totalD / 2 - 0.05] });
  const g = b.build('solar-array');
  g.userData.footprint = { width: totalW, depth: totalD };
  return g;
}

/** Vertical service ladder with cage hoops — reads instantly as industrial. */
export function createLadder({ height = 3, width = 0.4, cage = false, material = mats().steel }) {
  const b = new MeshBuilder();
  for (const s of [-1, 1]) {
    b.cyl(0.018, 0.018, height, material, { pos: [(s * width) / 2, height / 2, 0], segments: 8 });
  }
  const rungs = Math.floor(height / 0.3);
  for (let i = 1; i < rungs; i++) {
    b.cyl(0.013, 0.013, width, material, {
      pos: [0, i * 0.3, 0],
      rot: [0, 0, Math.PI / 2],
      segments: 6,
    });
  }
  if (cage) {
    const hoops = Math.floor(height / 0.55);
    for (let i = 2; i < hoops; i++) {
      b.add(new THREE.TorusGeometry(0.34, 0.014, 6, 18, Math.PI * 1.15), material, {
        pos: [0, i * 0.55, 0.1],
        rot: [0, 0, -Math.PI * 0.075],
      });
    }
  }
  return b.build('ladder');
}

/** Roof-mounted vent stack with a weather cowl. */
export function createVentStack({ height = 0.8, radius = 0.09, material = mats().steel }) {
  const b = new MeshBuilder();
  b.cyl(radius, radius, height, material, { pos: [0, height / 2, 0], segments: 14 });
  b.add(new THREE.ConeGeometry(radius * 2.0, radius * 1.3, 14), material, {
    pos: [0, height + radius * 0.5, 0],
  });
  b.cyl(radius * 1.35, radius * 1.35, 0.03, material, { pos: [0, height - 0.06, 0], segments: 14 });
  // flashing collar at the roof penetration
  b.cyl(radius * 2.4, radius * 2.8, 0.05, mats().steelDark, { pos: [0, 0.025, 0], segments: 16 });
  return b.build('vent');
}

/** Planter box with soil, edge trim and drainage weep holes. */
export function createPlanter({ width, depth, height = 0.42, material = mats().concreteDark }) {
  const b = new MeshBuilder();
  const t = 0.07;
  b.box(width, height, t, material, { pos: [0, height / 2, depth / 2 - t / 2], radius: 0.015 });
  b.box(width, height, t, material, { pos: [0, height / 2, -depth / 2 + t / 2], radius: 0.015 });
  b.box(t, height, depth - t * 2, material, { pos: [width / 2 - t / 2, height / 2, 0], radius: 0.015 });
  b.box(t, height, depth - t * 2, material, { pos: [-width / 2 + t / 2, height / 2, 0], radius: 0.015 });
  b.flat(width - t * 2, 0.04, depth - t * 2, mats().soil, { pos: [0, height - 0.1, 0] });
  // weep holes along the front face
  const holes = Math.max(2, Math.floor(width / 0.5));
  for (let i = 0; i < holes; i++) {
    const x = -width / 2 + (width * (i + 0.5)) / holes;
    b.cyl(0.018, 0.018, t * 1.4, mats().steelDark, {
      pos: [x, 0.09, depth / 2 - t / 2],
      rot: [Math.PI / 2, 0, 0],
      segments: 6,
    });
  }
  return b.build('planter');
}

/** Structural I-beam column, correct flange/web profile, with base plate. */
export function createColumn({ height, material = mats().steel, flange = 0.22, web = 0.05, basePlate = true }) {
  const b = new MeshBuilder();
  b.flat(flange, height, web, material, { pos: [0, height / 2, 0] });                  // web
  b.flat(flange, 0.035, flange * 0.75, material, { pos: [0, height - 0.02, 0] });      // top flange
  b.flat(flange, 0.035, flange * 0.75, material, { pos: [0, 0.02, 0] });               // bottom flange
  if (basePlate) {
    b.flat(flange + 0.12, 0.03, flange + 0.12, mats().steelDark, { pos: [0, 0.015, 0] });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.cyl(0.016, 0.016, 0.045, mats().steelDark, {
          pos: [sx * (flange / 2 + 0.03), 0.04, sz * (flange / 2 + 0.03)],
          segments: 6,
        });
      }
    }
  }
  return b.build('column');
}
