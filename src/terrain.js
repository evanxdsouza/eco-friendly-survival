// ---------------------------------------------------------------------------
// TERRAIN, ROADS AND WATER
// ---------------------------------------------------------------------------
// The site: a gently undulating landform (a perfectly flat plane is one of the
// clearest "CG" tells), a cross of cambered asphalt with real road markings,
// kerbs and footways, and a genuinely reflective pond built on three's Water,
// which renders the scene into a reflection buffer each frame.
//
// Tweak points:
//  - PLOT_HALF / ROAD_HALF_WIDTH / WALK_WIDTH set the whole layout
//  - POND describes the flood quadrant's water body (its outline is also
//    carved into the terrain so the banks slope into the water)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mats, painted } from './materials.js';
import { getTextures } from './textures.js';
import { MeshBuilder } from './parts.js';

export const PLOT_HALF = 20;
export const ROAD_HALF_WIDTH = 3.0;
export const WALK_WIDTH = 1.7;
export const KERB_HEIGHT = 0.14;
export const QUAD = 11; // quadrant centre offset

// Extends well past the plot so the ground edge never enters frame — the
// terrain fades into fog long before it runs out.
const GROUND_HALF = 58;

// Pond in the flood-resilient quadrant (-X, +Z).
export const POND = {
  cx: -QUAD - 0.4,
  cz: QUAD - 1.2,
  baseR: 6.1,
  depth: 1.35,
};

/** Wobbly radius so the pond reads as a natural water body, not a disc. */
function pondRadius(angle) {
  return (
    POND.baseR *
    (1 + 0.17 * Math.sin(angle * 3 + 0.6) + 0.1 * Math.sin(angle * 5 - 1.1) + 0.06 * Math.sin(angle * 8))
  );
}

/** Signed "insideness" of the pond at a point: >0 inside, 0 at the bank. */
function pondField(x, z) {
  const dx = x - POND.cx;
  const dz = z - POND.cz;
  const d = Math.hypot(dx, dz);
  const r = pondRadius(Math.atan2(dz, dx));
  return (r - d) / r; // 1 at centre, 0 at edge, negative outside
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Low-amplitude terrain relief. Kept out of the road corridor. */
function groundHeight(x, z) {
  const roll =
    Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.16 +
    Math.sin(x * 0.05 + 1.7) * 0.1 +
    Math.cos(z * 0.07 - 0.4) * 0.09;

  // flatten toward the road cross so the carriageway stays level
  const roadProximity = Math.min(
    smoothstep(ROAD_HALF_WIDTH + WALK_WIDTH, ROAD_HALF_WIDTH + WALK_WIDTH + 3.5, Math.abs(x)),
    smoothstep(ROAD_HALF_WIDTH + WALK_WIDTH, ROAD_HALF_WIDTH + WALK_WIDTH + 3.5, Math.abs(z))
  );
  let h = roll * roadProximity;

  // carve the pond basin, with banks easing down into the water
  const field = pondField(x, z);
  if (field > -0.25) {
    const t = smoothstep(-0.25, 0.55, field);
    h -= t * POND.depth;
  }
  return h;
}

export { groundHeight };

/** Builds the ground mesh with per-vertex displacement. */
function createGround() {
  const segments = 190;
  const geo = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mats().grass);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/** Muddy pond bed, sitting just under the water surface. */
function createPondBed() {
  const segments = 64;
  const geo = new THREE.PlaneGeometry(POND.baseR * 3, POND.baseR * 3, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + POND.cx;
    const z = pos.getZ(i) + POND.cz;
    pos.setY(i, groundHeight(x, z) + 0.02);
  }
  geo.computeVertexNormals();

  const bedMat = new THREE.MeshStandardMaterial({
    ...getTextures().soil,
    color: 0x6d6a52,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geo, bedMat);
  mesh.position.set(POND.cx, 0, POND.cz);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Road surface with a slight camber (crown) so it sheds water — visible in
 * the specular response and a detail real roads always have.
 */
function createRoadSurface() {
  const group = new THREE.Group();
  const len = GROUND_HALF * 2;
  const w = ROAD_HALF_WIDTH * 2;

  const build = (along) => {
    const segsAcross = 12;
    const geo = new THREE.PlaneGeometry(w, len, segsAcross, 80);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const across = pos.getX(i);
      const camber = (1 - Math.pow(across / ROAD_HALF_WIDTH, 2)) * 0.055;
      pos.setY(i, 0.018 + camber);
    }
    geo.computeVertexNormals();
    if (along === 'x') geo.rotateY(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mats().asphalt);
    mesh.receiveShadow = true;
    return mesh;
  };

  group.add(build('z'));
  group.add(build('x'));
  return group;
}

/** White/yellow thermoplastic road markings, all instanced. */
function createRoadMarkings() {
  const group = new THREE.Group();
  const paintWhite = painted(0xe8e6de, 0.62, 0);
  const paintYellow = painted(0xd9b23a, 0.62, 0);
  paintWhite.polygonOffset = paintYellow.polygonOffset = true;
  paintWhite.polygonOffsetFactor = paintYellow.polygonOffsetFactor = -2;
  paintWhite.polygonOffsetUnits = paintYellow.polygonOffsetUnits = -2;

  const Y = 0.082; // just above the road crown
  const dummy = new THREE.Object3D();
  const junction = ROAD_HALF_WIDTH + 2.2; // keep markings clear of the crossing

  // --- dashed centre lines (both carriageways) ---
  const dashGeo = new THREE.BoxGeometry(0.16, 0.012, 2.0);
  const dashPositions = [];
  for (let d = junction + 1; d < GROUND_HALF; d += 4.0) {
    dashPositions.push([0, d, 0], [0, -d, 0]);       // along Z
    dashPositions.push([d, 0, Math.PI / 2], [-d, 0, Math.PI / 2]); // along X
  }
  const dashes = new THREE.InstancedMesh(dashGeo, paintYellow, dashPositions.length);
  dashPositions.forEach(([x, z, ry], i) => {
    dummy.position.set(x, Y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  });
  dashes.instanceMatrix.needsUpdate = true;
  dashes.receiveShadow = true;
  group.add(dashes);

  // --- solid edge lines ---
  const edgeLen = GROUND_HALF - junction;
  const edgeGeo = new THREE.BoxGeometry(0.12, 0.012, edgeLen);
  const edges = [];
  for (const side of [-1, 1]) {
    const off = ROAD_HALF_WIDTH - 0.35;
    edges.push([side * off, junction + edgeLen / 2, 0]);
    edges.push([side * off, -(junction + edgeLen / 2), 0]);
    edges.push([junction + edgeLen / 2, side * off, Math.PI / 2]);
    edges.push([-(junction + edgeLen / 2), side * off, Math.PI / 2]);
  }
  const edgeMesh = new THREE.InstancedMesh(edgeGeo, paintWhite, edges.length);
  edges.forEach(([x, z, ry], i) => {
    dummy.position.set(x, Y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    edgeMesh.setMatrixAt(i, dummy.matrix);
  });
  edgeMesh.instanceMatrix.needsUpdate = true;
  group.add(edgeMesh);

  // --- zebra crossings on all four approaches ---
  const stripeGeo = new THREE.BoxGeometry(0.45, 0.012, ROAD_HALF_WIDTH * 2 - 0.7);
  const stripes = [];
  const stripeCount = 7;
  for (const sign of [1, -1]) {
    for (let i = 0; i < stripeCount; i++) {
      const off = ROAD_HALF_WIDTH + 0.75 + i * 0.72;
      stripes.push([0, sign * off, Math.PI / 2]);  // crossing the Z road
      stripes.push([sign * off, 0, 0]);            // crossing the X road
    }
  }
  const zebra = new THREE.InstancedMesh(stripeGeo, paintWhite, stripes.length);
  stripes.forEach(([x, z, ry], i) => {
    dummy.position.set(x, Y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    zebra.setMatrixAt(i, dummy.matrix);
  });
  zebra.instanceMatrix.needsUpdate = true;
  group.add(zebra);

  // --- stop bars just outside each crossing ---
  const stopGeo = new THREE.BoxGeometry(ROAD_HALF_WIDTH - 0.45, 0.014, 0.3);
  const stops = [];
  for (const sign of [1, -1]) {
    stops.push([sign * (ROAD_HALF_WIDTH / 2 - 0.1), sign * (ROAD_HALF_WIDTH + 6.0), 0]);
    stops.push([sign * (ROAD_HALF_WIDTH + 6.0), -sign * (ROAD_HALF_WIDTH / 2 - 0.1), Math.PI / 2]);
  }
  const stopMesh = new THREE.InstancedMesh(stopGeo, paintWhite, stops.length);
  stops.forEach(([x, z, ry], i) => {
    dummy.position.set(x, Y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    stopMesh.setMatrixAt(i, dummy.matrix);
  });
  stopMesh.instanceMatrix.needsUpdate = true;
  group.add(stopMesh);

  return group;
}

/** Kerbs plus the footway behind them, running the length of each road edge. */
function createKerbsAndFootways() {
  const group = new THREE.Group();
  const b = new MeshBuilder();
  const half = GROUND_HALF;
  const junction = ROAD_HALF_WIDTH + WALK_WIDTH;

  // Each road has two edges; each edge gets a kerb line and a paving strip,
  // split either side of the junction so the crossing stays open.
  const runs = [];
  for (const side of [-1, 1]) {
    const x = side * ROAD_HALF_WIDTH;
    for (const dir of [1, -1]) {
      const start = dir * junction;
      const end = dir * half;
      runs.push({ axis: 'z', at: x, from: start, to: end, side });
    }
  }
  for (const side of [-1, 1]) {
    const z = side * ROAD_HALF_WIDTH;
    for (const dir of [1, -1]) {
      runs.push({ axis: 'x', at: z, from: dir * junction, to: dir * half, side });
    }
  }

  for (const run of runs) {
    const length = Math.abs(run.to - run.from);
    const mid = (run.to + run.from) / 2;
    const outward = run.side; // direction away from the road centre

    if (run.axis === 'z') {
      // kerb stone
      b.box(0.22, KERB_HEIGHT + 0.14, length, mats().kerb, {
        pos: [run.at + outward * 0.11, KERB_HEIGHT / 2 - 0.04, mid],
        radius: 0.025,
      });
      // footway slab
      b.flat(WALK_WIDTH, 0.1, length, mats().paving, {
        pos: [run.at + outward * (WALK_WIDTH / 2 + 0.22), KERB_HEIGHT - 0.04, mid],
      });
    } else {
      b.box(length, KERB_HEIGHT + 0.14, 0.22, mats().kerb, {
        pos: [mid, KERB_HEIGHT / 2 - 0.04, run.at + outward * 0.11],
        radius: 0.025,
      });
      b.flat(length, 0.1, WALK_WIDTH, mats().paving, {
        pos: [mid, KERB_HEIGHT - 0.04, run.at + outward * (WALK_WIDTH / 2 + 0.22)],
      });
    }
  }

  // Corner footway pads at the junction so the pavement turns the corner.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.flat(WALK_WIDTH + 0.22, 0.1, WALK_WIDTH + 0.22, mats().paving, {
        pos: [
          sx * (ROAD_HALF_WIDTH + WALK_WIDTH / 2 + 0.11),
          KERB_HEIGHT - 0.04,
          sz * (ROAD_HALF_WIDTH + WALK_WIDTH / 2 + 0.11),
        ],
      });
    }
  }

  group.add(b.build('kerbs-footways'));
  return group;
}

/** Manhole covers and gully gratings — small, but very "read as real". */
function createDrainage() {
  const b = new MeshBuilder();
  const coverMat = mats().steelDark;

  const manholes = [
    [ROAD_HALF_WIDTH - 1.1, 7.5],
    [-(ROAD_HALF_WIDTH - 1.1), -9.2],
    [8.4, ROAD_HALF_WIDTH - 1.2],
    [-12.6, -(ROAD_HALF_WIDTH - 1.2)],
  ];
  for (const [x, z] of manholes) {
    b.cyl(0.36, 0.36, 0.03, coverMat, { pos: [x, 0.085, z], segments: 24 });
    b.add(new THREE.TorusGeometry(0.36, 0.022, 6, 26), mats().kerb, { pos: [x, 0.075, z], rot: [Math.PI / 2, 0, 0] });
    // raised diamond pattern
    for (let i = 0; i < 5; i++) {
      b.flat(0.6, 0.012, 0.035, coverMat, { pos: [x, 0.1, z - 0.2 + i * 0.1] });
    }
  }

  // kerbside gullies with grating bars
  const gullies = [
    [ROAD_HALF_WIDTH - 0.32, 4.2],
    [ROAD_HALF_WIDTH - 0.32, -6.4],
    [-(ROAD_HALF_WIDTH - 0.32), 9.8],
    [-(ROAD_HALF_WIDTH - 0.32), -3.1],
  ];
  for (const [x, z] of gullies) {
    b.flat(0.42, 0.03, 0.62, mats().kerb, { pos: [x, 0.06, z] });
    for (let i = 0; i < 6; i++) {
      b.flat(0.36, 0.02, 0.03, coverMat, { pos: [x, 0.08, z - 0.24 + i * 0.095] });
    }
  }
  return b.build('drainage');
}

/**
 * The pond, as a reflective Water surface with an organic outline.
 * On low quality this degrades to a cheap physical material so the extra
 * reflection render pass can be skipped entirely.
 */
function createWater(scene, sunLight, quality) {
  // organic outline
  const shape = new THREE.Shape();
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = pondRadius(a);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ShapeGeometry(shape, 12);
  geo.rotateX(-Math.PI / 2);

  const waterNormals = getTextures().waterNormals;
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

  let mesh;
  let isReal = false;

  if (quality === 'low') {
    mesh = new THREE.Mesh(
      geo,
      new THREE.MeshPhysicalMaterial({
        color: 0x2b5a6b,
        roughness: 0.12,
        metalness: 0,
        transparent: true,
        opacity: 0.86,
        envMapIntensity: 1.6,
      })
    );
  } else {
    mesh = new Water(geo, {
      textureWidth: quality === 'high' ? 1024 : 512,
      textureHeight: quality === 'high' ? 1024 : 512,
      waterNormals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: 0x22525f,
      distortionScale: 2.6,
      fog: !!scene.fog,
      alpha: 0.94,
    });
    isReal = true;

    // The reflection re-renders the WHOLE scene into a 1024² target from the
    // mirrored camera. Two guards, neither of them visible:
    //
    //  1. GTAOPass runs a normals prepass via scene.overrideMaterial and calls
    //     renderer.render(scene, camera) again. That fires onBeforeRender a
    //     second time, so the reflection was being rendered twice per frame —
    //     and the second one was immediately thrown away, because the override
    //     material had replaced every surface with its normals. Skip it.
    //
    //  2. Refresh the reflection on alternate frames, but ONLY while the
    //     mirror plane is stationary. Ripples are fine to hold for a frame —
    //     they are slow and normal-map distorted — but the reflection is
    //     computed from the plane's position, so a stale one is wrong the
    //     moment the plane moves. The flood raises and spreads the surface
    //     every frame, and reflecting last frame's water height makes the
    //     reflected image strobe. Track the transform and go frame-by-frame
    //     whenever it changes; that is only during a flood, so the idle case
    //     keeps the saving.
    const renderReflection = mesh.onBeforeRender;
    let reflectTick = 0;
    let reflectedY = null;
    let reflectedSpread = null;
    mesh.onBeforeRender = function (renderer, renderScene, camera, ...rest) {
      if (renderScene.overrideMaterial) return;
      const moving = mesh.position.y !== reflectedY || mesh.scale.x !== reflectedSpread;
      if (!moving && reflectTick++ % 2 !== 0) return;
      reflectedY = mesh.position.y;
      reflectedSpread = mesh.scale.x;
      renderReflection.call(this, renderer, renderScene, camera, ...rest);
    };
  }

  mesh.position.set(POND.cx, -0.25, POND.cz);
  mesh.receiveShadow = false;
  mesh.name = 'water';

  return {
    mesh,
    isReal,
    /** Sets the water surface height in world units. */
    setLevel(y) {
      mesh.position.y = y;
    },
    baseLevel: -0.25,
    update(dt) {
      if (isReal) {
        mesh.material.uniforms.time.value += dt * 0.55;
        if (sunLight) {
          mesh.material.uniforms.sunDirection.value.copy(sunLight.position).normalize();
        }
      }
    },
  };
}

/**
 * Assembles the whole site. Returns the water controller plus a sampler used
 * to scatter grass only where grass belongs.
 */
export function createTerrain(scene, sunLight, quality = 'high') {
  const group = new THREE.Group();
  group.name = 'terrain';

  group.add(createGround());
  group.add(createPondBed());
  group.add(createRoadSurface());
  group.add(createRoadMarkings());
  group.add(createKerbsAndFootways());
  group.add(createDrainage());

  const water = createWater(scene, sunLight, quality);
  group.add(water.mesh);

  scene.add(group);

  /**
   * Rejection sampler for grass: stays off the roads/footways, out of the
   * pond, and clear of building footprints.
   */
  const makeGrassSampler = (exclusions) => (rng) => {
    const x = (rng() - 0.5) * (PLOT_HALF * 2 + 6);
    const z = (rng() - 0.5) * (PLOT_HALF * 2 + 6);
    const corridor = ROAD_HALF_WIDTH + WALK_WIDTH + 0.35;
    if (Math.abs(x) < corridor || Math.abs(z) < corridor) return null;
    if (pondField(x, z) > -0.12) return null;
    for (const e of exclusions) {
      if (Math.hypot(x - e.x, z - e.z) < e.r) return null;
    }
    return [x, z];
  };

  return { group, water, makeGrassSampler, pondField };
}
