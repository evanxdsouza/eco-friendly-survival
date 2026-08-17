// ===========================================================================
// BUILDING 2 — FLOOD-RESILIENT HOUSE
// ===========================================================================
// A dwelling lifted clear of the design flood level on concrete piers, sitting
// directly over the water channel. Every flood-resilience move is modelled so
// it can be pointed at: the piers, the open undercroft that lets floodwater
// pass straight through, the debris screen on the upstream side, the elevated
// plant platform, and a graduated flood gauge that the rising water reads
// against.
//
// GEOMETRY TWEAK POINTS
//   DECK_H     — the flood clearance (deck soffit above normal water level)
//   PIER_GRID  — pier layout under the deck
//   ROOF_PITCH — gable pitch
//
// ANIMATION
//   setFloodLevel(0..1) drives the shared pond surface up and outward, wets
//   the piers to the waterline, and floats debris. The house never gets wet:
//   that's the whole demonstration.
// ===========================================================================
import * as THREE from 'three';
import { MeshBuilder, createWindowWall, createRailing, createStairs, createDoor,
         createWaterTank, createGutter, createPipeRun, createLadder } from '../parts.js';
import { mats, painted, emissive, plastic } from '../materials.js';
import { createLabelPanel, setLabelVisible, easeInOutCubic } from '../utils.js';

const WIDTH = 6.4;
const DEPTH = 5.4;
const DECK_H = 3.35;          // deck level above site datum — the flood clearance
const WALL_H = 2.75;
const ROOF_PITCH = 0.46;      // radians
const PIER_R = 0.26;
const WATER_BASE = -0.25;     // matches terrain POND surface
const FLOOD_MAX = 2.15;       // how high "Simulate Flood" takes the water

const PIER_GRID = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 1], [0, 1], [1, 1],
];

export function createFloodBuilding({ water } = {}) {
  const group = new THREE.Group();
  group.name = 'floodBuilding';

  const concrete = mats().concrete;
  const concreteDark = mats().concreteDark;
  const steel = mats().steel;
  const steelDark = mats().steelDark;
  const wood = mats().wood;

  // =========================================================================
  // 1. PIERS — reinforced concrete columns founded below the water line
  // =========================================================================
  const piers = new MeshBuilder();
  const wetBands = [];
  const pierBaseY = -1.5; // down into the pond bed

  for (const [gx, gz] of PIER_GRID) {
    const x = gx * (WIDTH / 2 - 0.55);
    const z = gz * (DEPTH / 2 - 0.5);

    // pile cap
    piers.box(0.95, 0.4, 0.95, concreteDark, { pos: [x, pierBaseY + 0.2, z], radius: 0.03 });
    // column, tapering very slightly toward the top as cast piers do
    piers.cyl(PIER_R, PIER_R * 1.12, DECK_H - pierBaseY, concrete, {
      pos: [x, pierBaseY + (DECK_H - pierBaseY) / 2, z],
      segments: 20,
    });
    // collar where the pier meets the deck
    piers.cyl(PIER_R * 1.35, PIER_R * 1.35, 0.16, concreteDark, { pos: [x, DECK_H - 0.24, z], segments: 20 });

    // Wet band: a darker sleeve that grows with the water level, so the piers
    // visibly stain to the high-water mark.
    const wet = new THREE.Mesh(
      new THREE.CylinderGeometry(PIER_R * 1.06, PIER_R * 1.16, 1, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x3d4a44,
        roughness: 0.18,
        metalness: 0,
        transparent: true,
        opacity: 0.85,
        envMapIntensity: 1.4,
      })
    );
    wet.position.set(x, 0, z);
    wet.visible = false;
    group.add(wet);
    wetBands.push(wet);
  }

  // Cross-bracing between piers — open, so floodwater and debris pass through.
  for (const gz of [-1, 1]) {
    const z = gz * (DEPTH / 2 - 0.5);
    for (const pair of [[-1, 0], [0, 1]]) {
      const x1 = pair[0] * (WIDTH / 2 - 0.55);
      const x2 = pair[1] * (WIDTH / 2 - 0.55);
      const span = Math.abs(x2 - x1);
      const midX = (x1 + x2) / 2;
      const len = Math.hypot(span, 1.6);
      const ang = Math.atan2(1.6, span);
      for (const dir of [1, -1]) {
        piers.flat(len, 0.13, 0.09, steelDark, { pos: [midX, 1.1, z], rot: [0, 0, dir * ang] });
      }
    }
  }
  group.add(piers.build('piers'));

  // =========================================================================
  // 2. DEBRIS SCREEN — angled grille on the upstream face
  // =========================================================================
  const screen = new MeshBuilder();
  const screenZ = DEPTH / 2 + 0.3;
  screen.flat(WIDTH + 0.4, 0.1, 0.12, steelDark, { pos: [0, 2.05, screenZ - 0.35], rot: [0.42, 0, 0] });
  screen.flat(WIDTH + 0.4, 0.1, 0.12, steelDark, { pos: [0, 0.35, screenZ + 0.42], rot: [0.42, 0, 0] });
  const bars = 15;
  for (let i = 0; i < bars; i++) {
    const x = -WIDTH / 2 + (WIDTH * i) / (bars - 1);
    screen.flat(0.055, 1.95, 0.055, steel, { pos: [x, 1.2, screenZ + 0.04], rot: [0.42, 0, 0] });
  }
  group.add(screen.build('debris-screen'));

  // =========================================================================
  // 3. DECK — structural slab, timber decking, edge beam, railings
  // =========================================================================
  const deck = new MeshBuilder();
  deck.box(WIDTH + 1.7, 0.26, DEPTH + 1.5, concreteDark, { pos: [0, DECK_H - 0.13, 0], radius: 0.02 });
  // downstand edge beams
  deck.box(WIDTH + 1.7, 0.3, 0.2, concrete, { pos: [0, DECK_H - 0.4, (DEPTH + 1.5) / 2 - 0.1], radius: 0.02 });
  deck.box(WIDTH + 1.7, 0.3, 0.2, concrete, { pos: [0, DECK_H - 0.4, -(DEPTH + 1.5) / 2 + 0.1], radius: 0.02 });

  // timber decking on the open terrace (the strip in front of the house)
  const planks = 14;
  for (let i = 0; i < planks; i++) {
    const z = DEPTH / 2 + 0.06 + i * 0.11;
    if (z > (DEPTH + 1.5) / 2 - 0.08) break;
    deck.box(WIDTH + 1.5, 0.035, 0.095, wood, { pos: [0, DECK_H + 0.018, z], radius: 0.008 });
  }
  group.add(deck.build('deck'));

  // deck railings on three sides, leaving the stair approach open
  const railFront = createRailing({ length: WIDTH + 1.5, height: 1.05 });
  railFront.position.set(0, DECK_H, (DEPTH + 1.5) / 2 - 0.08);
  group.add(railFront);

  for (const s of [-1, 1]) {
    const rail = createRailing({ length: DEPTH + 1.3, height: 1.05 });
    rail.rotation.y = Math.PI / 2;
    rail.position.set((s * (WIDTH + 1.7)) / 2 - s * 0.08, DECK_H, 0);
    group.add(rail);
  }

  // =========================================================================
  // 4. HOUSE — walls, gable roof, glazing, entrance
  // =========================================================================
  const house = new THREE.Group();
  house.position.y = DECK_H + 0.02;
  group.add(house);

  const shell = new MeshBuilder();
  const wallMat = painted(0xd8d3c6, 0.62, 0.05);

  // walls as four panels, so window openings can be cut between them
  shell.box(WIDTH, WALL_H, 0.22, wallMat, { pos: [0, WALL_H / 2, -DEPTH / 2 + 0.11], radius: 0.02 });
  shell.box(0.22, WALL_H, DEPTH, wallMat, { pos: [-WIDTH / 2 + 0.11, WALL_H / 2, 0], radius: 0.02 });
  shell.box(0.22, WALL_H, DEPTH, wallMat, { pos: [WIDTH / 2 - 0.11, WALL_H / 2, 0], radius: 0.02 });
  // front wall split around the door and window
  shell.box(1.9, WALL_H, 0.22, wallMat, { pos: [-WIDTH / 2 + 0.95, WALL_H / 2, DEPTH / 2 - 0.11], radius: 0.02 });
  shell.box(1.5, WALL_H, 0.22, wallMat, { pos: [WIDTH / 2 - 0.75, WALL_H / 2, DEPTH / 2 - 0.11], radius: 0.02 });
  shell.box(WIDTH - 3.4, 0.55, 0.22, wallMat, { pos: [0.2, WALL_H - 0.28, DEPTH / 2 - 0.11], radius: 0.02 });

  // gable end infill triangles
  const gableH = (DEPTH / 2) * Math.tan(ROOF_PITCH);
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-DEPTH / 2, 0);
    shape.lineTo(DEPTH / 2, 0);
    shape.lineTo(0, gableH);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    shell.addGeometry(
      geo,
      wallMat,
      new THREE.Matrix4().makeTranslation(s * (WIDTH / 2 - 0.11) - (s > 0 ? 0 : 0.22) + (s > 0 ? 0.11 : 0.11), WALL_H, 0)
    );
  }

  // floor plate + skirting
  shell.box(WIDTH, 0.14, DEPTH, concreteDark, { pos: [0, 0.07, 0], radius: 0.01 });
  house.add(shell.build('house-shell'));

  // --- roof: two pitched planes with battens, ridge cap and fascia ---
  const roof = new MeshBuilder();
  const slopeLen = DEPTH / 2 / Math.cos(ROOF_PITCH) + 0.42;
  const roofY = WALL_H + gableH / 2;

  for (const s of [-1, 1]) {
    // roofing plane
    roof.flat(WIDTH + 0.9, 0.1, slopeLen, mats().roofMetal, {
      pos: [0, roofY - 0.02, s * (slopeLen / 2) * Math.cos(ROOF_PITCH) * 0.92],
      rot: [-s * ROOF_PITCH, 0, 0],
    });
    // fascia board at the eaves
    roof.box(WIDTH + 0.95, 0.2, 0.06, painted(0x54636b, 0.5), {
      pos: [
        0,
        WALL_H - 0.06,
        s * (DEPTH / 2 + 0.42),
      ],
      radius: 0.012,
    });
  }
  // ridge capping
  roof.box(WIDTH + 0.95, 0.12, 0.3, mats().roofMetal, { pos: [0, WALL_H + gableH + 0.03, 0], radius: 0.04 });
  house.add(roof.build('roof'));

  // gutters along both eaves, feeding a single downpipe
  for (const s of [-1, 1]) {
    const gutter = createGutter({ length: WIDTH + 0.95 });
    gutter.position.set(0, WALL_H - 0.02, s * (DEPTH / 2 + 0.46));
    house.add(gutter);
  }

  // --- glazing and door ---
  const bigWindow = createWindowWall({
    width: WIDTH - 3.5,
    height: WALL_H - 1.15,
    cols: 3,
    rows: 1,
    mullion: 0.06,
    depth: 0.14,
  });
  bigWindow.position.set(0.2, 0.95, DEPTH / 2 + 0.01);
  house.add(bigWindow);

  for (const s of [-1, 1]) {
    const side = createWindowWall({
      width: 2.2,
      height: 1.3,
      cols: 2,
      rows: 1,
      mullion: 0.06,
      depth: 0.14,
    });
    side.rotation.y = s * (Math.PI / 2);
    side.position.set(s * (WIDTH / 2 + 0.01), 1.55, -0.4);
    house.add(side);
  }

  const door = createDoor({ width: 1.05, height: 2.15, panelColor: 0x33505c });
  door.position.set(-WIDTH / 2 + 2.25, 0.14, DEPTH / 2 + 0.01);
  house.add(door);

  // porch light beside the door
  const porchLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 10),
    emissive(0xffd9a0, 1.5)
  );
  porchLight.position.set(-WIDTH / 2 + 1.35, 2.15, DEPTH / 2 + 0.14);
  house.add(porchLight);

  // =========================================================================
  // 5. RAINWATER HARVESTING — tank on a plinth ABOVE the flood level
  // =========================================================================
  const tankPlatformY = 1.9;
  const tankBase = new MeshBuilder();
  tankBase.box(1.9, tankPlatformY, 1.9, concreteDark, {
    pos: [-(WIDTH / 2 + 1.9), tankPlatformY / 2, -DEPTH / 2 + 0.6],
    radius: 0.03,
  });
  // flood-flow openings through the plinth so it doesn't dam the current
  for (const s of [-1, 1]) {
    tankBase.cyl(0.3, 0.3, 2.0, mats().concreteDark, {
      pos: [-(WIDTH / 2 + 1.9), 0.65, -DEPTH / 2 + 0.6 + s * 0.55],
      rot: [0, 0, Math.PI / 2],
      segments: 14,
    });
  }
  group.add(tankBase.build('tank-plinth'));

  const tank = createWaterTank({ radius: 0.62, height: 2.0, accent: 0x2f6f8e, ladder: true });
  tank.position.set(-(WIDTH / 2 + 1.9), tankPlatformY, -DEPTH / 2 + 0.6);
  group.add(tank);

  // downpipe from the eaves gutter into the tank lid
  const downpipe = createPipeRun(
    [
      new THREE.Vector3(-WIDTH / 2 - 0.3, DECK_H + WALL_H - 0.05, -DEPTH / 2 - 0.4),
      new THREE.Vector3(-WIDTH / 2 - 0.3, DECK_H + 0.4, -DEPTH / 2 - 0.4),
      new THREE.Vector3(-(WIDTH / 2 + 1.9), DECK_H + 0.4, -DEPTH / 2 + 0.6),
      new THREE.Vector3(-(WIDTH / 2 + 1.9), tankPlatformY + 2.05, -DEPTH / 2 + 0.6),
    ],
    { radius: 0.06, material: steel, brackets: true }
  );
  group.add(downpipe);

  // =========================================================================
  // 6. ACCESS STAIR from the bank up to the deck
  // =========================================================================
  const stairSteps = 16;
  const stairs = createStairs({
    steps: stairSteps,
    rise: DECK_H / stairSteps,
    run: 0.3,
    width: 1.4,
    treadMaterial: concreteDark,
    structureMaterial: steelDark,
    railings: true,
  });
  stairs.position.set(WIDTH / 2 + 1.35, 0, DEPTH / 2 + 1.4);
  stairs.rotation.y = -Math.PI / 2;
  group.add(stairs);

  // landing pad where the stair meets the ground
  const landing = new MeshBuilder();
  landing.box(1.8, 0.16, 1.6, mats().paving, {
    pos: [WIDTH / 2 + 1.35 + stairs.userData.totalRun * 0 + 2.6, 0.08, DEPTH / 2 + 1.4],
    radius: 0.02,
  });
  group.add(landing.build('landing'));

  // =========================================================================
  // 7. FLOOD GAUGE — graduated post the rising water reads against
  // =========================================================================
  const gauge = new MeshBuilder();
  const gaugeX = WIDTH / 2 + 0.6;
  const gaugeZ = -DEPTH / 2 - 1.1;
  const gaugeH = 3.6;
  gauge.box(0.16, gaugeH, 0.16, painted(0xf2f2ee, 0.6), { pos: [gaugeX, gaugeH / 2 - 0.6, gaugeZ], radius: 0.015 });
  // alternating graduation bands every 250mm
  for (let i = 0; i < 13; i++) {
    if (i % 2 === 0) continue;
    gauge.flat(0.175, 0.25, 0.175, painted(0xd0342c, 0.6), {
      pos: [gaugeX, -0.6 + i * 0.25 + 0.125, gaugeZ],
    });
  }
  // "design flood level" marker plate
  gauge.flat(0.5, 0.1, 0.03, painted(0x1f6fb2, 0.5), { pos: [gaugeX + 0.2, WATER_BASE + FLOOD_MAX, gaugeZ] });
  group.add(gauge.build('flood-gauge'));

  // =========================================================================
  // 8. FLOATING DEBRIS — drifts on the surface while the flood runs
  // =========================================================================
  const debrisGroup = new THREE.Group();
  const debrisItems = [];
  for (let i = 0; i < 7; i++) {
    const b = new MeshBuilder();
    const len = 0.5 + Math.random() * 1.1;
    b.cyl(0.055, 0.045, len, wood, { pos: [0, 0, 0], rot: [0, 0, Math.PI / 2], segments: 7 });
    if (Math.random() > 0.5) {
      b.cyl(0.04, 0.035, len * 0.5, wood, { pos: [len * 0.2, 0.04, 0.09], rot: [0, 0.6, Math.PI / 2], segments: 6 });
    }
    const mesh = b.build('debris');
    const angle = Math.random() * Math.PI * 2;
    const radius = 3.2 + Math.random() * 3.4;
    mesh.userData.orbit = angle;
    mesh.userData.radius = radius;
    mesh.userData.speed = 0.06 + Math.random() * 0.09;
    mesh.userData.bob = Math.random() * Math.PI * 2;
    mesh.visible = false;
    debrisGroup.add(mesh);
    debrisItems.push(mesh);
  }
  group.add(debrisGroup);

  // =========================================================================
  // 9. LABEL + FLOOD STATE
  // =========================================================================
  const totalHeight = DECK_H + WALL_H + gableH;
  const label = createLabelPanel(
    'Flood-Resilient Design',
    ['Elevated on Columns', 'Waterproof Materials', 'Rainwater Harvesting', 'Flood-Flow Design'],
    [0, totalHeight + 3.0, 0]
  );
  group.add(label.object);

  const flood = { level: 0, auto: false, t: 0, duration: 16 };

  function applyLevel(level01) {
    flood.level = THREE.MathUtils.clamp(level01, 0, 1);
    const surfaceY = WATER_BASE + FLOOD_MAX * flood.level;

    if (water) {
      water.setLevel(surfaceY);
      // the pond spreads outward as it rises, rather than staying a fixed disc
      const spread = 1 + flood.level * 0.55;
      water.mesh.scale.set(spread, 1, spread);
    }

    // wet the piers up to the waterline
    wetBands.forEach((band, i) => {
      const [gx, gz] = PIER_GRID[i];
      const baseY = -1.5;
      const h = Math.max(0.001, surfaceY - baseY);
      band.visible = flood.level > 0.005;
      band.scale.y = h;
      band.position.y = baseY + h / 2;
    });

    // debris only appears once there's meaningful depth
    const showDebris = flood.level > 0.25;
    debrisItems.forEach((d) => {
      d.visible = showDebris;
    });
  }

  function setFloodLevel(level01) {
    flood.auto = false;
    applyLevel(level01);
  }

  function triggerFlood() {
    flood.auto = true;
    flood.t = 0;
  }

  function update(dt, elapsed) {
    // debris drift
    if (debrisItems[0]?.visible) {
      const surfaceY = WATER_BASE + FLOOD_MAX * flood.level;
      debrisItems.forEach((d) => {
        d.userData.orbit += d.userData.speed * dt;
        const r = d.userData.radius;
        d.position.set(
          Math.cos(d.userData.orbit) * r,
          surfaceY + 0.04 + Math.sin(elapsed * 1.6 + d.userData.bob) * 0.035,
          Math.sin(d.userData.orbit) * r * 0.8
        );
        d.rotation.y = d.userData.orbit * 1.3;
        d.rotation.z = Math.sin(elapsed * 1.1 + d.userData.bob) * 0.12;
      });
    }

    if (!flood.auto) return;
    flood.t += dt;
    const p = flood.t / flood.duration;

    // A full flood event: rise, peak and hold, then recede.
    let level;
    if (p < 0.35) level = easeInOutCubic(p / 0.35);
    else if (p < 0.62) level = 1;
    else if (p < 1) level = 1 - easeInOutCubic((p - 0.62) / 0.38);
    else {
      level = 0;
      flood.auto = false;
    }
    applyLevel(level);
  }

  return {
    group,
    label,
    footprint: { x: 0, z: 0, r: 7.5 },
    approxHeight: totalHeight,
    interact: triggerFlood,
    triggerFlood,
    setFloodLevel,
    getFloodLevel: () => flood.level,
    isAuto: () => flood.auto,
    update,
    setLabelVisible: (v) => setLabelVisible(label, v),
  };
}
