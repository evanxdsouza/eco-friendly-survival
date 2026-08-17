// ===========================================================================
// BUILDING 1 — EARTHQUAKE-RESISTANT TOWER
// ===========================================================================
// A 5-storey reinforced-concrete frame standing on lead-rubber base isolators.
// The whole point of the model is legibility of the *mechanism*: you can see
// the isolators, the seismic moat around the slab, the X-bracing and the solid
// shear-wall cores, so the shake animation reads as an explanation rather
// than just motion.
//
// GEOMETRY TWEAK POINTS
//   FLOORS / FLOOR_H / WIDTH / DEPTH  — overall massing
//   ISOLATOR_GRID                     — isolator layout under the transfer slab
//   SEISMIC_GAP                       — width of the moat around the building
//
// ANIMATION
//   triggerShake() runs a two-body response: the ground slab jolts at high
//   frequency while the superstructure above the isolators sways slowly and
//   out of phase, decaying to rest. That phase difference *is* base isolation.
// ===========================================================================
import * as THREE from 'three';
import { MeshBuilder, createWindowWall, createHVAC, createParapet, createLadder,
         createVentStack, createDoor, createRailing, createPipeRun } from '../parts.js';
import { mats, painted, emissive } from '../materials.js';
import { createLabelPanel, setLabelVisible, dampedOscillation } from '../utils.js';

const FLOORS = 5;
const FLOOR_H = 3.05;
const WIDTH = 7.2;
const DEPTH = 6.2;
const COLUMN = 0.42;          // square column dimension
const SLAB_T = 0.32;          // floor slab thickness
const ISOLATOR_H = 0.62;      // bearing height
const ISOLATOR_R = 0.34;
const PAD_H = 0.45;           // pile-cap plinth height
const SEISMIC_GAP = 0.55;
const TOTAL_H = FLOORS * FLOOR_H;

// Isolator positions (x, z) under the transfer slab — corners plus mid-spans.
const ISOLATOR_GRID = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export function createEarthquakeBuilding() {
  const group = new THREE.Group();
  group.name = 'earthquakeBuilding';

  const concrete = mats().concrete;
  const concreteDark = mats().concreteDark;
  const steelDark = mats().steelDark;
  const steel = mats().steel;

  // =========================================================================
  // 1. FOUNDATION — pile caps, seismic moat, and the isolator base plates
  // =========================================================================
  const foundation = new MeshBuilder();

  // Ground-level apron with the moat cut around the building footprint.
  const apronW = WIDTH + SEISMIC_GAP * 2 + 1.8;
  const apronD = DEPTH + SEISMIC_GAP * 2 + 1.8;
  const moatW = WIDTH + SEISMIC_GAP * 2;
  const moatD = DEPTH + SEISMIC_GAP * 2;
  const ringW = (apronW - moatW) / 2;
  const ringD = (apronD - moatD) / 2;

  foundation.box(apronW, 0.22, ringD, mats().paving, { pos: [0, 0.11, (moatD + ringD) / 2], radius: 0.02 });
  foundation.box(apronW, 0.22, ringD, mats().paving, { pos: [0, 0.11, -(moatD + ringD) / 2], radius: 0.02 });
  foundation.box(ringW, 0.22, moatD, mats().paving, { pos: [(moatW + ringW) / 2, 0.11, 0], radius: 0.02 });
  foundation.box(ringW, 0.22, moatD, mats().paving, { pos: [-(moatW + ringW) / 2, 0.11, 0], radius: 0.02 });

  // Moat floor — the void the building is free to move within.
  foundation.flat(moatW, 0.08, moatD, concreteDark, { pos: [0, -0.28, 0] });

  // Pile caps under each isolator.
  for (const [gx, gz] of ISOLATOR_GRID) {
    const x = gx * (WIDTH / 2 - 0.85);
    const z = gz * (DEPTH / 2 - 0.85);
    foundation.box(1.0, PAD_H, 1.0, concreteDark, { pos: [x, -0.24 + PAD_H / 2, z], radius: 0.03 });
    // anchor plate + bolt ring
    foundation.flat(0.86, 0.05, 0.86, steelDark, { pos: [x, -0.24 + PAD_H + 0.02, z] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      foundation.cyl(0.03, 0.03, 0.07, steelDark, {
        pos: [x + Math.cos(a) * 0.36, -0.24 + PAD_H + 0.06, z + Math.sin(a) * 0.36],
        segments: 6,
      });
    }
  }
  group.add(foundation.build('foundation'));

  // =========================================================================
  // 2. BASE ISOLATORS — laminated lead-rubber bearings
  // Each is its own mesh so it can visibly SHEAR during the earthquake.
  // =========================================================================
  const isolators = [];
  const isolatorBaseY = -0.24 + PAD_H + 0.05;

  for (const [gx, gz] of ISOLATOR_GRID) {
    const x = gx * (WIDTH / 2 - 0.85);
    const z = gz * (DEPTH / 2 - 0.85);

    const b = new MeshBuilder();
    // laminated rubber body (the rubber texture bands read as steel shims)
    b.cyl(ISOLATOR_R, ISOLATOR_R, ISOLATOR_H, mats().rubber, {
      pos: [0, ISOLATOR_H / 2, 0],
      segments: 24,
    });
    // lead core visible as a capped centre plug
    b.cyl(ISOLATOR_R * 0.3, ISOLATOR_R * 0.3, ISOLATOR_H + 0.02, painted(0x6b6f75, 0.35, 0.8), {
      pos: [0, ISOLATOR_H / 2, 0],
      segments: 14,
    });
    // top and bottom mounting flanges
    b.cyl(ISOLATOR_R * 1.22, ISOLATOR_R * 1.22, 0.06, steel, { pos: [0, 0.03, 0], segments: 24 });
    b.cyl(ISOLATOR_R * 1.22, ISOLATOR_R * 1.22, 0.06, steel, { pos: [0, ISOLATOR_H - 0.03, 0], segments: 24 });

    const mesh = b.build('isolator');
    mesh.position.set(x, isolatorBaseY, z);
    group.add(mesh);
    isolators.push(mesh);
  }

  // =========================================================================
  // 3. SUPERSTRUCTURE — everything above the isolators moves as one body
  // =========================================================================
  const superstructure = new THREE.Group();
  superstructure.position.y = isolatorBaseY + ISOLATOR_H;
  group.add(superstructure);

  const frame = new MeshBuilder();

  // --- transfer slab tying the isolator heads together ---
  frame.box(WIDTH + 0.3, 0.42, DEPTH + 0.3, concreteDark, { pos: [0, 0.21, 0], radius: 0.03 });

  // --- columns: 3 bays wide, 2 bays deep ---
  const colXs = [-1, 0, 1].map((f) => f * (WIDTH / 2 - COLUMN / 2));
  const colZs = [-1, 1].map((f) => f * (DEPTH / 2 - COLUMN / 2));
  for (const x of colXs) {
    for (const z of colZs) {
      frame.box(COLUMN, TOTAL_H, COLUMN, concrete, { pos: [x, 0.42 + TOTAL_H / 2, z], radius: 0.03 });
    }
  }

  // --- floor slabs with a projecting edge band at every level ---
  for (let f = 1; f <= FLOORS; f++) {
    const y = 0.42 + f * FLOOR_H;
    frame.box(WIDTH + 0.34, SLAB_T, DEPTH + 0.34, concreteDark, { pos: [0, y - SLAB_T / 2, 0], radius: 0.02 });
    // drip band under the slab edge
    frame.flat(WIDTH + 0.4, 0.06, DEPTH + 0.4, concrete, { pos: [0, y - SLAB_T - 0.03, 0] });
  }

  // --- SHEAR WALLS: solid cores on both short (±X) facades ---
  // Rendered in a darker, denser concrete so they read as structure, not cladding.
  for (const side of [-1, 1]) {
    frame.box(0.34, TOTAL_H, DEPTH - COLUMN * 2 - 0.2, concreteDark, {
      pos: [side * (WIDTH / 2 - 0.17), 0.42 + TOTAL_H / 2, 0],
      radius: 0.02,
    });
    // form-tie holes, in the regular grid a real cast wall shows
    for (let r = 0; r < FLOORS * 2; r++) {
      for (let c = -1; c <= 1; c++) {
        frame.cyl(0.035, 0.035, 0.06, concrete, {
          pos: [side * (WIDTH / 2 - 0.01), 0.9 + r * 1.5, c * 1.5],
          rot: [0, 0, Math.PI / 2],
          segments: 6,
        });
      }
    }
  }

  // --- rear (-Z) facade: solid infill panels with a recessed joint grid ---
  for (let f = 0; f < FLOORS; f++) {
    const y = 0.42 + f * FLOOR_H + FLOOR_H / 2;
    frame.box(WIDTH - COLUMN * 2, FLOOR_H - SLAB_T, 0.22, concrete, {
      pos: [0, y, -(DEPTH / 2 - 0.11)],
      radius: 0.02,
    });
    frame.flat(WIDTH - COLUMN * 2, 0.04, 0.03, concreteDark, {
      pos: [0, y + FLOOR_H / 2 - SLAB_T / 2 - 0.1, -(DEPTH / 2 + 0.02)],
    });
  }

  // --- spandrel panels beneath the front glazing ---
  for (let f = 0; f < FLOORS; f++) {
    const y = 0.42 + f * FLOOR_H;
    frame.box(WIDTH - COLUMN * 2, 0.85, 0.2, concrete, {
      pos: [0, y + 0.42, DEPTH / 2 - 0.1],
      radius: 0.02,
    });
  }
  superstructure.add(frame.build('frame'));

  // --- glazing on the front (+Z) facade, one band per floor ---
  for (let f = 0; f < FLOORS; f++) {
    const wall = createWindowWall({
      width: WIDTH - COLUMN * 2 - 0.1,
      height: FLOOR_H - 1.35,
      cols: 4,
      rows: 1,
      mullion: 0.07,
      depth: 0.14,
      sill: true,
    });
    wall.position.set(0, 0.42 + f * FLOOR_H + 1.35, DEPTH / 2 - 0.02);
    superstructure.add(wall);
  }

  // --- side glazing strips on the -Z corners, so the block isn't dead ---
  for (const side of [-1, 1]) {
    for (let f = 1; f < FLOORS; f++) {
      const wall = createWindowWall({
        width: 1.5,
        height: FLOOR_H - 1.6,
        cols: 1,
        rows: 1,
        mullion: 0.06,
        depth: 0.12,
        sill: false,
      });
      wall.rotation.y = side * (Math.PI / 2);
      wall.position.set(side * (WIDTH / 2 + 0.02), 0.42 + f * FLOOR_H + 1.5, -DEPTH / 4);
      superstructure.add(wall);
    }
  }

  // =========================================================================
  // 4. CROSS-BRACING — steel X-braces with gusset plates on the front facade
  // =========================================================================
  const bracing = new MeshBuilder();
  const braceBayW = WIDTH - COLUMN * 2 - 0.3;
  const braceBayH = FLOOR_H * 2;
  const braceLen = Math.hypot(braceBayW, braceBayH);
  const braceAngle = Math.atan2(braceBayH, braceBayW);
  const braceZ = DEPTH / 2 + 0.16;

  for (let pair = 0; pair < 2; pair++) {
    const yCentre = 0.42 + pair * braceBayH + braceBayH / 2;

    for (const dir of [1, -1]) {
      // the brace itself: a flat structural section, not a round rod
      bracing.flat(braceLen, 0.2, 0.11, steelDark, {
        pos: [0, yCentre, braceZ],
        rot: [0, 0, dir * braceAngle],
      });
      // stiffener ribs along the brace
      for (let i = -2; i <= 2; i++) {
        bracing.flat(0.1, 0.26, 0.13, steel, {
          pos: [
            Math.cos(dir * braceAngle) * i * (braceLen / 6),
            yCentre + Math.sin(dir * braceAngle) * i * (braceLen / 6),
            braceZ,
          ],
          rot: [0, 0, dir * braceAngle],
        });
      }
    }

    // gusset plates + bolt clusters at the four corners of the bay
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const gx = sx * (braceBayW / 2);
        const gy = yCentre + sy * (braceBayH / 2);
        bracing.flat(0.5, 0.5, 0.05, steel, { pos: [gx, gy, braceZ + 0.02] });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          bracing.cyl(0.028, 0.028, 0.09, steelDark, {
            pos: [gx + Math.cos(a) * 0.15, gy + Math.sin(a) * 0.15, braceZ + 0.05],
            rot: [Math.PI / 2, 0, 0],
            segments: 6,
          });
        }
      }
    }
    // central splice plate where the two braces cross
    bracing.flat(0.46, 0.46, 0.07, steel, { pos: [0, yCentre, braceZ + 0.04] });
  }
  superstructure.add(bracing.build('bracing'));

  // =========================================================================
  // 5. ROOF — parapet, plant, access
  // =========================================================================
  const roofY = 0.42 + TOTAL_H;
  const roof = new THREE.Group();
  roof.position.y = roofY;
  superstructure.add(roof);

  const roofDeck = new MeshBuilder();
  roofDeck.box(WIDTH + 0.34, 0.18, DEPTH + 0.34, concreteDark, { pos: [0, -0.09, 0], radius: 0.02 });
  // slight fall toward a central drain
  roofDeck.cyl(0.16, 0.16, 0.05, steelDark, { pos: [0.8, 0.03, 0], segments: 14 });
  // roof hatch
  roofDeck.box(0.9, 0.14, 0.9, painted(0x9aa2a8, 0.5, 0.4), { pos: [-WIDTH / 2 + 1.2, 0.07, DEPTH / 2 - 1.1], radius: 0.02 });
  roof.add(roofDeck.build('roof-deck'));

  const parapet = createParapet({ width: WIDTH + 0.34, depth: DEPTH + 0.34, height: 0.62, thickness: 0.18 });
  roof.add(parapet);

  const hvacA = createHVAC({ width: 1.7, height: 0.85, depth: 1.15 });
  hvacA.position.set(-1.3, 0, -1.0);
  roof.add(hvacA);

  const hvacB = createHVAC({ width: 1.2, height: 0.65, depth: 0.95 });
  hvacB.position.set(1.6, 0, -1.3);
  hvacB.rotation.y = 0.4;
  roof.add(hvacB);

  const vent = createVentStack({ height: 0.9 });
  vent.position.set(2.2, 0, 1.2);
  roof.add(vent);

  const vent2 = createVentStack({ height: 0.65, radius: 0.07 });
  vent2.position.set(2.6, 0, 0.6);
  roof.add(vent2);

  // roof-edge safety rail on the plant side
  const roofRail = createRailing({ length: WIDTH - 1, height: 0.9, balusters: false });
  roofRail.position.set(0, 0, -DEPTH / 2 + 0.6);
  roof.add(roofRail);

  // =========================================================================
  // 6. GROUND FLOOR — entrance, canopy, steps across the seismic gap
  // =========================================================================
  const entrance = new THREE.Group();
  superstructure.add(entrance);

  const door = createDoor({ width: 1.3, height: 2.3, panelColor: 0x2f3d46 });
  door.position.set(0, 0.42, DEPTH / 2 + 0.01);
  entrance.add(door);

  const canopy = new MeshBuilder();
  canopy.box(3.0, 0.14, 1.5, concreteDark, { pos: [0, 3.15, DEPTH / 2 + 0.6], radius: 0.03 });
  // tension rods back to the facade
  for (const s of [-1, 1]) {
    canopy.cyl(0.025, 0.025, 1.9, steel, {
      pos: [s * 1.2, 3.7, DEPTH / 2 + 0.35],
      rot: [0.72, 0, 0],
      segments: 8,
    });
  }
  canopy.flat(2.6, 0.04, 0.1, emissive(0xfff0d2, 0.8), { pos: [0, 3.06, DEPTH / 2 + 0.6] });
  entrance.add(canopy.build('canopy'));

  // The access bridge deliberately spans the moat — it has to, because the
  // building moves relative to the ground.
  const bridge = new MeshBuilder();
  bridge.box(2.2, 0.12, SEISMIC_GAP + 0.9, mats().paving, {
    pos: [0, 0.36, DEPTH / 2 + SEISMIC_GAP / 2 + 0.45],
    radius: 0.02,
  });
  bridge.flat(2.3, 0.03, 0.16, steel, { pos: [0, 0.43, DEPTH / 2 + SEISMIC_GAP + 0.85] });
  entrance.add(bridge.build('access-bridge'));

  // rainwater downpipes at both front corners
  for (const s of [-1, 1]) {
    const pipe = createPipeRun(
      [
        new THREE.Vector3(s * (WIDTH / 2 - 0.1), TOTAL_H + 0.3, DEPTH / 2 + 0.1),
        new THREE.Vector3(s * (WIDTH / 2 - 0.1), 0.6, DEPTH / 2 + 0.1),
        new THREE.Vector3(s * (WIDTH / 2 - 0.45), 0.45, DEPTH / 2 + 0.1),
      ],
      { radius: 0.055, material: steel, brackets: true }
    );
    superstructure.add(pipe);
  }

  const ladder = createLadder({ height: 2.4, cage: false });
  ladder.position.set(-WIDTH / 2 - 0.32, roofY - 2.4, -DEPTH / 4);
  ladder.rotation.y = Math.PI / 2;
  superstructure.add(ladder);

  // =========================================================================
  // 7. SEISMIC DUST — puffs at the moat edge when the ground jolts
  // =========================================================================
  const DUST = 90;
  const dustPos = new Float32Array(DUST * 3);
  const dustVel = new Float32Array(DUST * 3);
  const dustLife = new Float32Array(DUST);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xa89880,
    size: 0.16,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.visible = false;
  group.add(dust);

  function spawnDust() {
    for (let i = 0; i < DUST; i++) {
      const edge = Math.floor(Math.random() * 4);
      const t = (Math.random() - 0.5) * 2;
      const hw = moatW / 2;
      const hd = moatD / 2;
      const p =
        edge === 0 ? [t * hw, 0, hd] :
        edge === 1 ? [t * hw, 0, -hd] :
        edge === 2 ? [hw, 0, t * hd] : [-hw, 0, t * hd];
      dustPos[i * 3] = p[0];
      dustPos[i * 3 + 1] = 0;
      dustPos[i * 3 + 2] = p[2];
      dustVel[i * 3] = (Math.random() - 0.5) * 0.5;
      dustVel[i * 3 + 1] = 0.35 + Math.random() * 0.7;
      dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      dustLife[i] = 0.6 + Math.random() * 1.1;
    }
    dust.visible = true;
    dustGeo.attributes.position.needsUpdate = true;
  }

  // =========================================================================
  // 8. LABEL + ANIMATION
  // =========================================================================
  const label = createLabelPanel(
    'Earthquake-Resistant Design',
    ['Reinforced Frame', 'Shear Walls', 'Base Isolators', 'Lightweight Roof'],
    [0, roofY + 3.2, 0]
  );
  superstructure.add(label.object);

  const shake = { active: false, t: 0, duration: 6.0, magnitude: 0 };
  const groundParts = group.children[0]; // the merged foundation mesh

  function triggerShake() {
    shake.active = true;
    shake.t = 0;
    shake.magnitude = 1;
    spawnDust();
  }

  function update(dt) {
    // dust always settles, even after the quake stops
    if (dust.visible) {
      let alive = false;
      for (let i = 0; i < DUST; i++) {
        if (dustLife[i] <= 0) continue;
        alive = true;
        dustLife[i] -= dt;
        dustVel[i * 3 + 1] -= 1.4 * dt;    // gravity
        dustPos[i * 3] += dustVel[i * 3] * dt;
        dustPos[i * 3 + 1] = Math.max(0, dustPos[i * 3 + 1] + dustVel[i * 3 + 1] * dt);
        dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.opacity = Math.max(0, dustMat.opacity - dt * 0.22);
      if (!alive) {
        dust.visible = false;
        dustMat.opacity = 0.5;
      }
    }

    if (!shake.active) return;
    shake.t += dt;
    const t = shake.t;
    const decay = Math.max(0, 1 - t / shake.duration);

    // GROUND: high-frequency, sharp, low-amplitude — the raw seismic input.
    const gx = dampedOscillation(t, 22, 0.55) * 0.13 + dampedOscillation(t, 34.5, 0.7) * 0.06;
    const gz = dampedOscillation(t, 27, 0.6) * 0.09;
    groundParts.position.set(gx * decay, 0, gz * decay);
    groundParts.rotation.y = gx * decay * 0.05;

    // SUPERSTRUCTURE: long-period, larger, and lagging behind the ground.
    // The isolators are trading displacement for acceleration — the building
    // sways further but far more gently, and stays upright.
    const sx = dampedOscillation(t - 0.12, 4.2, 0.42) * 0.34;
    const sz = dampedOscillation(t - 0.12, 3.6, 0.45) * 0.2;
    superstructure.position.x = sx * decay;
    superstructure.position.z = sz * decay;
    superstructure.rotation.z = -sx * decay * 0.012;
    superstructure.rotation.x = sz * decay * 0.012;

    // ISOLATORS: shear between the fixed base and the moving structure.
    isolators.forEach((iso, i) => {
      const relX = (sx - gx) * decay;
      const relZ = (sz - gz) * decay;
      iso.position.x = iso.userData.baseX ?? (iso.userData.baseX = iso.position.x);
      iso.position.z = iso.userData.baseZ ?? (iso.userData.baseZ = iso.position.z);
      iso.position.x = iso.userData.baseX + relX * 0.5;
      iso.position.z = iso.userData.baseZ + relZ * 0.5;
      // lean the bearing so the rubber visibly distorts
      iso.rotation.z = -relX * 0.55;
      iso.rotation.x = relZ * 0.55;
    });

    if (t >= shake.duration) {
      shake.active = false;
      groundParts.position.set(0, 0, 0);
      groundParts.rotation.set(0, 0, 0);
      superstructure.position.set(0, isolatorBaseY + ISOLATOR_H, 0);
      superstructure.rotation.set(0, 0, 0);
      isolators.forEach((iso) => {
        iso.position.x = iso.userData.baseX;
        iso.position.z = iso.userData.baseZ;
        iso.rotation.set(0, 0, 0);
      });
    }
  }

  return {
    group,
    label,
    footprint: { x: 0, z: 0, r: 6.4 },
    approxHeight: roofY + 0.6,
    interact: triggerShake,
    triggerShake,
    update,
    setLabelVisible: (v) => setLabelVisible(label, v),
    /** Camera shake amount (0–1) so main.js can rattle the view too. */
    getShakeIntensity: () =>
      shake.active ? Math.max(0, 1 - shake.t / shake.duration) * Math.abs(Math.sin(shake.t * 22)) : 0,
  };
}
