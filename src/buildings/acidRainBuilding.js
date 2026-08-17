// ===========================================================================
// BUILDING 3 — ACID-RAIN-RESISTANT BUILDING
// ===========================================================================
// A compact block finished in a corrosion-resistant coating, with a single
// steep mono-pitch roof that sheds every drop toward one collection point.
// The resilience story is told by the water path: rain lands, runs down the
// pitch, is caught by the eaves gutter, drops through the downpipe and ends
// up in the tank. It never sits on the structure, and every opening is
// gasket-sealed against ingress.
//
// GEOMETRY TWEAK POINTS
//   ROOF_HIGH_Y / ROOF_LOW_Y — roof pitch (steeper = faster shedding)
//   RAIN_COUNT               — density of the storm
//   roofSurfaceY(x)          — the single source of truth for the roof plane;
//                              the rain animation samples it directly
// ===========================================================================
import * as THREE from 'three';
import { MeshBuilder, createWindowWall, createDoor, createWaterTank, createGutter,
         createPipeRun, createPlanter, createVentStack, createLadder } from '../parts.js';
import { mats, painted, emissive, plastic } from '../materials.js';
import { createLabelPanel, setLabelVisible } from '../utils.js';

const WIDTH = 6.8;
const DEPTH = 5.8;
const WALL_H = 4.1;
const PLINTH_H = 0.35;

// Mono-pitch roof: high on -X, low on +X where the gutter and tank sit.
const ROOF_HIGH_Y = PLINTH_H + WALL_H + 1.25;
const ROOF_LOW_Y = PLINTH_H + WALL_H + 0.1;
const ROOF_X_HIGH = -WIDTH / 2 - 0.45;
const ROOF_X_LOW = WIDTH / 2 + 0.55;

const RAIN_COUNT = 300;
const RUNOFF_COUNT = 48;
const SPLASH_COUNT = 60;

/** Height of the roof plane at a given local X. The rain follows this exactly. */
function roofSurfaceY(x) {
  const t = THREE.MathUtils.clamp((x - ROOF_X_HIGH) / (ROOF_X_LOW - ROOF_X_HIGH), 0, 1);
  return THREE.MathUtils.lerp(ROOF_HIGH_Y, ROOF_LOW_Y, t);
}

export function createAcidRainBuilding() {
  const group = new THREE.Group();
  group.name = 'acidRainBuilding';

  const concreteDark = mats().concreteDark;
  const steel = mats().steel;
  const steelDark = mats().steelDark;

  // Corrosion-resistant coating: a deep green epoxy finish.
  const shellMat = painted(0x2c5248, 0.5, 0.15);
  const trimMat = painted(0x1d3a34, 0.42, 0.3);

  // A dedicated roof material instance so it can visibly WET during the storm
  // (wet surfaces are smoother and far more reflective).
  const roofMat = mats().roofMetal.clone();
  roofMat.color = new THREE.Color(0x3a5a52);

  // =========================================================================
  // 1. PLINTH AND SHELL
  // =========================================================================
  const shell = new MeshBuilder();

  // raised plinth keeps the wall base out of splash-back
  shell.box(WIDTH + 0.5, PLINTH_H, DEPTH + 0.5, concreteDark, { pos: [0, PLINTH_H / 2, 0], radius: 0.03 });
  shell.flat(WIDTH + 0.62, 0.06, DEPTH + 0.62, trimMat, { pos: [0, PLINTH_H - 0.03, 0] });

  // main volume
  shell.box(WIDTH, WALL_H, DEPTH, shellMat, { pos: [0, PLINTH_H + WALL_H / 2, 0], radius: 0.04 });

  // Vertical rainscreen joints — the coated-panel expression.
  const panels = 7;
  for (let i = 1; i < panels; i++) {
    const x = -WIDTH / 2 + (WIDTH * i) / panels;
    for (const s of [-1, 1]) {
      shell.flat(0.05, WALL_H - 0.1, 0.04, trimMat, {
        pos: [x, PLINTH_H + WALL_H / 2, s * (DEPTH / 2 + 0.01)],
      });
    }
  }
  const panelsD = 6;
  for (let i = 1; i < panelsD; i++) {
    const z = -DEPTH / 2 + (DEPTH * i) / panelsD;
    for (const s of [-1, 1]) {
      shell.flat(0.04, WALL_H - 0.1, 0.05, trimMat, {
        pos: [s * (WIDTH / 2 + 0.01), PLINTH_H + WALL_H / 2, z],
      });
    }
  }

  // horizontal capping band at the wall head
  shell.box(WIDTH + 0.12, 0.14, DEPTH + 0.12, trimMat, { pos: [0, PLINTH_H + WALL_H - 0.07, 0], radius: 0.02 });
  group.add(shell.build('shell'));

  // =========================================================================
  // 2. SLOPED ROOF — the runoff surface
  // =========================================================================
  const roofBuild = new MeshBuilder();
  const roofRun = ROOF_X_LOW - ROOF_X_HIGH;
  const roofRise = ROOF_HIGH_Y - ROOF_LOW_Y;
  const roofLen = Math.hypot(roofRun, roofRise);
  const slopeAngle = Math.atan2(roofRise, roofRun);

  // roofing deck
  roofBuild.flat(roofLen, 0.16, DEPTH + 0.9, roofMat, {
    pos: [(ROOF_X_HIGH + ROOF_X_LOW) / 2, (ROOF_HIGH_Y + ROOF_LOW_Y) / 2, 0],
    rot: [0, 0, -slopeAngle],
  });

  // upstand along the high edge and the two rakes, so water can only leave
  // over the low eaves
  roofBuild.box(0.16, 0.34, DEPTH + 0.9, trimMat, {
    pos: [ROOF_X_HIGH + 0.05, ROOF_HIGH_Y + 0.16, 0],
    radius: 0.02,
  });
  for (const s of [-1, 1]) {
    roofBuild.flat(roofLen, 0.3, 0.14, trimMat, {
      pos: [(ROOF_X_HIGH + ROOF_X_LOW) / 2, (ROOF_HIGH_Y + ROOF_LOW_Y) / 2 + 0.14, s * (DEPTH / 2 + 0.42)],
      rot: [0, 0, -slopeAngle],
    });
  }

  // soffit / fascia at the low eaves
  roofBuild.box(0.18, 0.26, DEPTH + 0.9, trimMat, { pos: [ROOF_X_LOW - 0.02, ROOF_LOW_Y - 0.1, 0], radius: 0.02 });

  // exposed rafters under the overhang, a nice legible structural detail
  for (let i = 0; i < 7; i++) {
    const z = -DEPTH / 2 + (DEPTH * i) / 6;
    roofBuild.flat(0.9, 0.1, 0.08, steelDark, {
      pos: [ROOF_X_LOW - 0.5, roofSurfaceY(ROOF_X_LOW - 0.5) - 0.16, z],
      rot: [0, 0, -slopeAngle],
    });
  }
  group.add(roofBuild.build('roof'));

  // eaves gutter on the low side — the collection point
  const gutter = createGutter({ length: DEPTH + 0.85, radius: 0.1 });
  gutter.rotation.y = Math.PI / 2;
  gutter.position.set(ROOF_X_LOW + 0.06, ROOF_LOW_Y - 0.08, 0);
  group.add(gutter);

  // roof plant + access
  const vent = createVentStack({ height: 0.75, radius: 0.08 });
  vent.position.set(-1.5, roofSurfaceY(-1.5), 1.4);
  group.add(vent);

  const ladder = createLadder({ height: ROOF_HIGH_Y - 0.4, cage: true });
  ladder.position.set(ROOF_X_HIGH + 0.35, 0.2, -DEPTH / 2 + 1.2);
  ladder.rotation.y = -Math.PI / 2;
  group.add(ladder);

  // =========================================================================
  // 3. SEALED OPENINGS — heavy gaskets and coated glazing
  // =========================================================================
  // A thicker, darker frame surround reads as a compression gasket.
  const openings = new MeshBuilder();

  const winW = 1.5;
  const winH = 1.45;
  const winPositions = [
    [-2.1, 1.35], [0, 1.35], [2.1, 1.35],
    [-2.1, 3.15], [0, 3.15], [2.1, 3.15],
  ];
  for (const [x, y] of winPositions) {
    // gasket surround, proud of the facade
    openings.box(winW + 0.24, winH + 0.24, 0.14, trimMat, {
      pos: [x, y, DEPTH / 2 + 0.05],
      radius: 0.03,
    });
    // fixing screws around the frame
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      openings.cyl(0.018, 0.018, 0.03, steel, {
        pos: [x + Math.cos(a) * (winW / 2 + 0.08), y + Math.sin(a) * (winH / 2 + 0.08), DEPTH / 2 + 0.12],
        rot: [Math.PI / 2, 0, 0],
        segments: 6,
      });
    }
  }
  group.add(openings.build('gaskets'));

  // the glazing itself, in the visibly glossier "coated" material
  for (const [x, y] of winPositions) {
    const win = createWindowWall({
      width: winW,
      height: winH,
      cols: 2,
      rows: 2,
      mullion: 0.07,
      depth: 0.1,
      sill: false,
      frameMaterial: trimMat,
      glassMaterial: mats().glassCoated,
    });
    win.position.set(x, y, DEPTH / 2 + 0.1);
    group.add(win);
  }

  // side elevation gets a tall sealed strip window
  const sideWin = createWindowWall({
    width: 3.2,
    height: 1.5,
    cols: 3,
    rows: 1,
    mullion: 0.07,
    depth: 0.1,
    frameMaterial: trimMat,
    glassMaterial: mats().glassCoated,
  });
  sideWin.rotation.y = -Math.PI / 2;
  sideWin.position.set(-WIDTH / 2 - 0.02, 2.6, 0.3);
  group.add(sideWin);

  // sealed entrance with a storm porch
  const door = createDoor({ width: 1.15, height: 2.25, panelColor: 0x24473f });
  door.position.set(-1.6, PLINTH_H, DEPTH / 2 + 0.02);
  group.add(door);

  const porch = new MeshBuilder();
  porch.box(2.1, 0.14, 1.15, trimMat, { pos: [-1.6, PLINTH_H + 2.65, DEPTH / 2 + 0.5], radius: 0.03 });
  for (const s of [-1, 1]) {
    porch.cyl(0.05, 0.05, 1.1, steel, {
      pos: [-1.6 + s * 0.85, PLINTH_H + 2.2, DEPTH / 2 + 0.95],
      segments: 8,
    });
  }
  // threshold ramp + drainage channel at the door
  porch.box(2.0, 0.1, 0.7, concreteDark, { pos: [-1.6, PLINTH_H - 0.05, DEPTH / 2 + 0.42], radius: 0.02 });
  for (let i = 0; i < 8; i++) {
    porch.flat(0.16, 0.02, 0.6, steelDark, { pos: [-2.35 + i * 0.22, PLINTH_H + 0.01, DEPTH / 2 + 0.62] });
  }
  group.add(porch.build('porch'));

  // =========================================================================
  // 4. AIR-PURIFYING PLANTS along the base
  // =========================================================================
  const potPositions = [
    [-3.0, DEPTH / 2 + 0.62], [1.0, DEPTH / 2 + 0.62],
    [2.1, DEPTH / 2 + 0.62], [3.1, DEPTH / 2 + 0.62],
    [-WIDTH / 2 - 0.6, 1.6], [-WIDTH / 2 - 0.6, -1.4],
  ];
  const potBuild = new MeshBuilder();
  const foliageA = mats().foliage;
  const foliageB = mats().foliageLight;

  potPositions.forEach(([x, z], idx) => {
    // tapered terracotta pot with a rim and a drip saucer
    potBuild.cyl(0.26, 0.2, 0.42, mats().terracotta, { pos: [x, PLINTH_H + 0.21, z], segments: 18 });
    potBuild.add(new THREE.TorusGeometry(0.265, 0.028, 8, 20), mats().terracotta, {
      pos: [x, PLINTH_H + 0.41, z],
      rot: [Math.PI / 2, 0, 0],
    });
    potBuild.cyl(0.3, 0.3, 0.035, mats().terracotta, { pos: [x, PLINTH_H + 0.018, z], segments: 18 });
    potBuild.flat(0.36, 0.03, 0.36, mats().soil, { pos: [x, PLINTH_H + 0.4, z] });

    // upright strap leaves (snake-plant / spathiphyllum reading)
    const leaves = 7 + (idx % 3);
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + idx;
      const lean = 0.12 + (i % 3) * 0.09;
      const h = 0.5 + ((i * 37) % 10) / 22;
      potBuild.add(
        new THREE.CylinderGeometry(0.012, 0.05, h, 5),
        i % 2 === 0 ? foliageA : foliageB,
        {
          pos: [x + Math.cos(a) * 0.09, PLINTH_H + 0.42 + h / 2, z + Math.sin(a) * 0.09],
          rot: [Math.cos(a) * lean, 0, -Math.sin(a) * lean],
          scale: [1, 1, 0.3],
        }
      );
    }
  });
  group.add(potBuild.build('planting'));

  // a low planter run against the front plinth
  const planter = createPlanter({ width: 2.4, depth: 0.55, height: 0.4 });
  planter.position.set(-0.6, PLINTH_H, DEPTH / 2 + 0.62);
  group.add(planter);

  // =========================================================================
  // 5. COLLECTION TANK — fed by the downpipe from the gutter
  // =========================================================================
  const tankX = ROOF_X_LOW + 1.35;
  const tankZ = -DEPTH / 2 + 1.3;
  const tank = createWaterTank({ radius: 0.68, height: 2.3, accent: 0x3f7a6b, ladder: false });
  tank.position.set(tankX, 0, tankZ);
  group.add(tank);

  // gutter outlet → swan neck → downpipe → tank lid
  const downpipePoints = [
    new THREE.Vector3(ROOF_X_LOW + 0.06, ROOF_LOW_Y - 0.14, -DEPTH / 2 + 0.2),
    new THREE.Vector3(ROOF_X_LOW + 0.06, ROOF_LOW_Y - 0.7, -DEPTH / 2 + 0.2),
    new THREE.Vector3(tankX, ROOF_LOW_Y - 1.0, tankZ),
    new THREE.Vector3(tankX, 2.42, tankZ),
  ];
  group.add(createPipeRun(downpipePoints, { radius: 0.075, material: steel, brackets: true }));

  // A translucent stream that appears inside the downpipe while it's raining.
  const streamMat = new THREE.MeshPhysicalMaterial({
    color: 0x8fd4e8,
    roughness: 0.05,
    transmission: 0.85,
    thickness: 0.3,
    transparent: true,
    opacity: 0.75,
    ior: 1.33,
  });
  const streamHeight = ROOF_LOW_Y - 1.0 - 2.42;
  const stream = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, Math.abs(streamHeight), 10),
    streamMat
  );
  stream.position.set(tankX, 2.42 + Math.abs(streamHeight) / 2, tankZ);
  stream.visible = false;
  group.add(stream);

  // pH monitoring station — sells the "we measure the threat" story
  const monitor = new MeshBuilder();
  monitor.box(0.5, 0.7, 0.22, painted(0xd8d8d2, 0.5, 0.2), { pos: [WIDTH / 2 + 0.35, 1.5, DEPTH / 2 - 0.4], radius: 0.03 });
  monitor.cyl(0.05, 0.05, 1.5, steel, { pos: [WIDTH / 2 + 0.35, 0.75, DEPTH / 2 - 0.4], segments: 8 });
  monitor.flat(0.34, 0.24, 0.02, emissive(0x4de0a0, 1.4), { pos: [WIDTH / 2 + 0.35, 1.62, DEPTH / 2 - 0.29] });
  group.add(monitor.build('ph-monitor'));

  // =========================================================================
  // 6. RAIN SYSTEM
  // Three coupled effects: falling streaks, runoff beads sliding down the
  // pitch, and splash bursts at impact.
  // =========================================================================

  // --- falling streaks (instanced, stretched along Y so they read as rain) ---
  const streakGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4);
  const rainMat = new THREE.MeshBasicMaterial({
    color: 0xa8d8ec,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const rain = new THREE.InstancedMesh(streakGeo, rainMat, RAIN_COUNT);
  rain.frustumCulled = false;
  rain.visible = false;
  group.add(rain);

  const rainState = new Float32Array(RAIN_COUNT * 4); // x, y, z, speed
  const spawnHeight = ROOF_HIGH_Y + 7;
  const areaX = WIDTH + 3.5;
  const areaZ = DEPTH + 3.0;

  function seedDrop(i, randomY) {
    rainState[i * 4] = (Math.random() - 0.5) * areaX;
    rainState[i * 4 + 1] = randomY ? ROOF_LOW_Y + Math.random() * 7 : spawnHeight + Math.random() * 3;
    rainState[i * 4 + 2] = (Math.random() - 0.5) * areaZ;
    rainState[i * 4 + 3] = 9 + Math.random() * 5;
  }
  for (let i = 0; i < RAIN_COUNT; i++) seedDrop(i, true);

  // --- runoff beads travelling down the roof plane ---
  const beadGeo = new THREE.SphereGeometry(0.045, 7, 6);
  const beadMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe8f5,
    roughness: 0.04,
    transmission: 0.7,
    thickness: 0.1,
    transparent: true,
    opacity: 0.8,
  });
  const runoff = new THREE.InstancedMesh(beadGeo, beadMat, RUNOFF_COUNT);
  runoff.frustumCulled = false;
  runoff.visible = false;
  group.add(runoff);
  const runoffState = new Float32Array(RUNOFF_COUNT * 3); // x, z, speed

  function seedBead(i, randomX) {
    runoffState[i * 3] = randomX
      ? ROOF_X_HIGH + Math.random() * (ROOF_X_LOW - ROOF_X_HIGH)
      : ROOF_X_HIGH + Math.random() * 0.8;
    runoffState[i * 3 + 1] = (Math.random() - 0.5) * (DEPTH + 0.6);
    runoffState[i * 3 + 2] = 1.4 + Math.random() * 1.5;
  }
  for (let i = 0; i < RUNOFF_COUNT; i++) seedBead(i, true);

  // --- splash bursts ---
  const splashGeo = new THREE.BufferGeometry();
  const splashPos = new Float32Array(SPLASH_COUNT * 3);
  const splashVel = new Float32Array(SPLASH_COUNT * 3);
  const splashLife = new Float32Array(SPLASH_COUNT);
  splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
  const splash = new THREE.Points(
    splashGeo,
    new THREE.PointsMaterial({
      color: 0xd6f2ff,
      size: 0.05,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    })
  );
  splash.frustumCulled = false;
  splash.visible = false;
  group.add(splash);
  let splashCursor = 0;

  function emitSplash(x, y, z) {
    const i = splashCursor;
    splashCursor = (splashCursor + 1) % SPLASH_COUNT;
    splashPos[i * 3] = x;
    splashPos[i * 3 + 1] = y;
    splashPos[i * 3 + 2] = z;
    splashVel[i * 3] = (Math.random() - 0.5) * 1.1;
    splashVel[i * 3 + 1] = 0.7 + Math.random() * 0.9;
    splashVel[i * 3 + 2] = (Math.random() - 0.5) * 1.1;
    splashLife[i] = 0.35 + Math.random() * 0.25;
  }

  // =========================================================================
  // 7. LABEL + STATE
  // =========================================================================
  const label = createLabelPanel(
    'Acid-Rain-Resistant Design',
    ['Sloped Roof', 'Corrosion-Resistant Materials', 'Sealed Windows/Doors', 'Air-Purifying Plants'],
    [0, ROOF_HIGH_Y + 2.6, 0]
  );
  group.add(label.object);

  const state = { active: false, wetness: 0 };
  const dummy = new THREE.Object3D();

  function toggleAcidRain(force) {
    state.active = typeof force === 'boolean' ? force : !state.active;
    rain.visible = state.active;
    runoff.visible = state.active;
    splash.visible = state.active;
    stream.visible = state.active;
    if (state.active) {
      for (let i = 0; i < RAIN_COUNT; i++) seedDrop(i, true);
    }
  }

  function update(dt, elapsed) {
    // Surfaces darken and gloss up while wet, then dry out slowly afterwards.
    const target = state.active ? 1 : 0;
    state.wetness += (target - state.wetness) * Math.min(1, dt * (state.active ? 1.6 : 0.35));
    roofMat.roughness = 1 - state.wetness * 0.72;
    roofMat.envMapIntensity = 1.1 + state.wetness * 1.5;

    if (!state.active && state.wetness < 0.01) {
      if (splash.visible) splash.visible = false;
      return;
    }

    // --- falling rain ---
    if (rain.visible) {
      for (let i = 0; i < RAIN_COUNT; i++) {
        const b = i * 4;
        rainState[b + 1] -= rainState[b + 3] * dt;

        const x = rainState[b];
        const z = rainState[b + 2];
        const overRoof =
          x > ROOF_X_HIGH && x < ROOF_X_LOW && Math.abs(z) < DEPTH / 2 + 0.45;
        const hitY = overRoof ? roofSurfaceY(x) + 0.08 : 0;

        if (rainState[b + 1] <= hitY) {
          if (Math.random() < 0.5) emitSplash(x, hitY, z);
          seedDrop(i, false);
        }

        dummy.position.set(rainState[b], rainState[b + 1], rainState[b + 2]);
        dummy.rotation.set(0, 0, 0.06); // slight wind lean
        dummy.scale.set(1, 1 + rainState[b + 3] * 0.06, 1);
        dummy.updateMatrix();
        rain.setMatrixAt(i, dummy.matrix);
      }
      rain.instanceMatrix.needsUpdate = true;
    }

    // --- runoff beads sliding down the pitch into the gutter ---
    if (runoff.visible) {
      for (let i = 0; i < RUNOFF_COUNT; i++) {
        const b = i * 3;
        runoffState[b] += runoffState[b + 2] * dt;
        if (runoffState[b] >= ROOF_X_LOW) {
          emitSplash(ROOF_X_LOW + 0.06, ROOF_LOW_Y - 0.1, runoffState[b + 1]);
          seedBead(i, false);
        }
        dummy.position.set(runoffState[b], roofSurfaceY(runoffState[b]) + 0.09, runoffState[b + 1]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.8 + Math.sin(elapsed * 9 + i) * 0.15);
        dummy.updateMatrix();
        runoff.setMatrixAt(i, dummy.matrix);
      }
      runoff.instanceMatrix.needsUpdate = true;
    }

    // --- splashes ---
    for (let i = 0; i < SPLASH_COUNT; i++) {
      if (splashLife[i] <= 0) continue;
      splashLife[i] -= dt;
      splashVel[i * 3 + 1] -= 5.5 * dt;
      splashPos[i * 3] += splashVel[i * 3] * dt;
      splashPos[i * 3 + 1] += splashVel[i * 3 + 1] * dt;
      splashPos[i * 3 + 2] += splashVel[i * 3 + 2] * dt;
    }
    splashGeo.attributes.position.needsUpdate = true;

    // --- downpipe stream pulses while water is actually moving ---
    if (stream.visible) {
      streamMat.opacity = 0.5 + Math.sin(elapsed * 12) * 0.12;
      stream.scale.x = stream.scale.z = 0.9 + Math.sin(elapsed * 7) * 0.12;
    }
  }

  return {
    group,
    label,
    footprint: { x: 0, z: 0, r: 6.6 },
    approxHeight: ROOF_HIGH_Y,
    interact: () => toggleAcidRain(),
    triggerAcidRain: toggleAcidRain,
    isRaining: () => state.active,
    update,
    setLabelVisible: (v) => setLabelVisible(label, v),
  };
}
