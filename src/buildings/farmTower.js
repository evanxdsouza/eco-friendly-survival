// ===========================================================================
// BUILDING 4 — VERTICAL FARM TOWER
// ===========================================================================
// A six-storey growing tower: every floor carries a planter ledge of crops on
// the sunny facades, the roof is a photovoltaic array, a wind turbine stands
// alongside, and a gravity-fed irrigation main runs the full height with a
// drip line branching into each ledge.
//
// GEOMETRY TWEAK POINTS
//   FLOORS / FLOOR_H          — tower massing
//   PLANTS_PER_LEDGE          — crop density (drives the InstancedMesh size)
//   TURBINE_*                 — turbine scale and speed
//
// ANIMATION
//   The turbine spins continuously (with the blades pitched and the nacelle
//   yawing gently). triggerGrowth() runs a time-lapse: crops scale, deepen in
//   colour and the drip emitters pulse.
// ===========================================================================
import * as THREE from 'three';
import { MeshBuilder, createWindowWall, createSolarArray, createPlanter, createRailing,
         createPipeRun, createLadder, createDoor, createWaterTank, createParapet } from '../parts.js';
import { mats, painted, emissive, plastic } from '../materials.js';
import { createLabelPanel, setLabelVisible, easeInOutCubic } from '../utils.js';

const FLOORS = 6;
const FLOOR_H = 3.1;
const WIDTH = 6.0;
const DEPTH = 5.4;
const TOTAL_H = FLOORS * FLOOR_H;
const LEDGE_DEPTH = 0.78;
const PLANTS_PER_LEDGE = 9;

const TURBINE_TOWER_H = TOTAL_H * 0.92;
const TURBINE_BLADE_LEN = 2.9;
const TURBINE_SPEED = 1.65; // radians/sec at rest state

export function createFarmTower() {
  const group = new THREE.Group();
  group.name = 'farmTower';

  const concrete = mats().concrete;
  const concreteDark = mats().concreteDark;
  const steel = mats().steel;
  const steelDark = mats().steelDark;

  // =========================================================================
  // 1. TOWER STRUCTURE
  // =========================================================================
  const structure = new MeshBuilder();

  // foundation raft + entrance apron
  structure.box(WIDTH + 1.6, 0.3, DEPTH + 1.6, concreteDark, { pos: [0, 0.15, 0], radius: 0.03 });
  structure.flat(WIDTH + 2.6, 0.12, 2.2, mats().paving, { pos: [0, 0.06, DEPTH / 2 + 1.6] });

  // corner columns running the full height
  const colX = WIDTH / 2 - 0.26;
  const colZ = DEPTH / 2 - 0.26;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      structure.box(0.5, TOTAL_H, 0.5, concrete, { pos: [sx * colX, 0.3 + TOTAL_H / 2, sz * colZ], radius: 0.035 });
    }
  }

  // service core on the -X side (stairs/lift shaft) — gives the tower a spine
  structure.box(1.5, TOTAL_H + 1.4, DEPTH - 1.2, concreteDark, {
    pos: [-WIDTH / 2 - 0.4, 0.3 + (TOTAL_H + 1.4) / 2, 0],
    radius: 0.03,
  });
  // core expressed with recessed shadow joints per floor
  for (let f = 1; f <= FLOORS; f++) {
    structure.flat(1.56, 0.05, DEPTH - 1.14, painted(0x8e9490, 0.7), {
      pos: [-WIDTH / 2 - 0.4, 0.3 + f * FLOOR_H, 0],
    });
  }

  // floor slabs
  for (let f = 1; f <= FLOORS; f++) {
    const y = 0.3 + f * FLOOR_H;
    structure.box(WIDTH + 0.3, 0.3, DEPTH + 0.3, concreteDark, { pos: [0, y - 0.15, 0], radius: 0.02 });
  }

  // rear and side infill panels
  for (let f = 0; f < FLOORS; f++) {
    const y = 0.3 + f * FLOOR_H + FLOOR_H / 2;
    structure.box(WIDTH - 1.0, FLOOR_H - 0.35, 0.24, concrete, { pos: [0, y, -DEPTH / 2 + 0.12], radius: 0.02 });
    structure.box(0.24, FLOOR_H - 0.35, DEPTH - 1.4, concrete, { pos: [WIDTH / 2 - 0.12, y, 0], radius: 0.02 });
  }
  group.add(structure.build('structure'));

  // =========================================================================
  // 2. GLAZED GROWING FLOORS — with grow-lights visible inside
  // =========================================================================
  const growLights = [];
  for (let f = 0; f < FLOORS; f++) {
    const y = 0.3 + f * FLOOR_H;

    // full-height glazing on the +Z (front) facade
    const glazing = createWindowWall({
      width: WIDTH - 1.1,
      height: FLOOR_H - 0.75,
      cols: 4,
      rows: 2,
      mullion: 0.07,
      depth: 0.14,
      sill: false,
    });
    glazing.position.set(0, y + 0.34, DEPTH / 2 + 0.02);
    group.add(glazing);

    // magenta/violet horticultural lighting behind the glass
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(WIDTH - 1.5, 0.09, 0.09),
      emissive(0xd66bff, 0.9)
    );
    light.position.set(0, y + FLOOR_H - 0.85, DEPTH / 2 - 0.55);
    group.add(light);
    growLights.push(light);
  }

  // =========================================================================
  // 3. PLANTER LEDGES + CROPS
  // Ledges are real planter boxes; crops are a single InstancedMesh across
  // the whole tower so the time-lapse costs one matrix update per frame.
  // =========================================================================
  const ledgeY = [];
  for (let f = 0; f < FLOORS; f++) {
    const y = 0.3 + f * FLOOR_H + 0.32;
    ledgeY.push(y);

    const planter = createPlanter({ width: WIDTH - 0.6, depth: LEDGE_DEPTH, height: 0.44 });
    planter.position.set(0, y, DEPTH / 2 + LEDGE_DEPTH / 2 + 0.06);
    group.add(planter);

    // support brackets under each ledge
    const brackets = new MeshBuilder();
    for (let i = 0; i < 4; i++) {
      const x = -WIDTH / 2 + 0.9 + i * ((WIDTH - 1.8) / 3);
      brackets.flat(0.08, 0.5, 0.6, steelDark, {
        pos: [x, y - 0.2, DEPTH / 2 + 0.35],
        rot: [-0.6, 0, 0],
      });
    }
    group.add(brackets.build('ledge-brackets'));

    // safety rail along the outer edge of the ledge
    const rail = createRailing({
      length: WIDTH - 0.6,
      height: 0.55,
      balusters: false,
      postSpacing: 1.4,
    });
    rail.position.set(0, y + 0.44, DEPTH / 2 + LEDGE_DEPTH + 0.02);
    group.add(rail);
  }

  // --- crops: leafy heads on short stems, instanced ---
  const cropCount = FLOORS * PLANTS_PER_LEDGE;
  const cropBuilder = new MeshBuilder();
  // one plant: a stem plus a rosette of leaves
  cropBuilder.cyl(0.012, 0.02, 0.16, mats().crop, { pos: [0, 0.08, 0], segments: 5 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cropBuilder.add(new THREE.SphereGeometry(0.085, 7, 5), mats().crop, {
      pos: [Math.cos(a) * 0.075, 0.19, Math.sin(a) * 0.075],
      rot: [Math.cos(a) * 0.5, a, Math.sin(a) * 0.5],
      scale: [1, 0.5, 1.35],
    });
  }
  cropBuilder.add(new THREE.SphereGeometry(0.075, 7, 6), mats().crop, { pos: [0, 0.24, 0], scale: [1, 0.8, 1] });

  const cropProto = cropBuilder.build('crop').children[0];
  const cropMat = cropProto.material.clone();
  const crops = new THREE.InstancedMesh(cropProto.geometry, cropMat, cropCount);
  crops.castShadow = true;
  crops.receiveShadow = true;
  crops.frustumCulled = false;
  group.add(crops);

  // fixed layout for every plant; only scale changes during growth
  const cropSlots = [];
  for (let f = 0; f < FLOORS; f++) {
    for (let p = 0; p < PLANTS_PER_LEDGE; p++) {
      const x = -WIDTH / 2 + 0.65 + p * ((WIDTH - 1.3) / (PLANTS_PER_LEDGE - 1));
      cropSlots.push({
        x,
        y: ledgeY[f] + 0.36,
        z: DEPTH / 2 + LEDGE_DEPTH / 2 + 0.06 + (p % 2 === 0 ? -0.12 : 0.12),
        jitter: 0.85 + ((p * 53 + f * 17) % 30) / 100,
        spin: ((p * 71 + f * 29) % 100) / 100 * Math.PI * 2,
      });
    }
  }

  const dummy = new THREE.Object3D();
  function applyGrowth(g) {
    // g: 0 = seedling, 1 = harvest-ready
    cropSlots.forEach((slot, i) => {
      const s = slot.jitter * THREE.MathUtils.lerp(0.42, 1.25, g);
      dummy.position.set(slot.x, slot.y, slot.z);
      dummy.rotation.set(0, slot.spin, 0);
      dummy.scale.set(s, s * THREE.MathUtils.lerp(0.7, 1.15, g), s);
      dummy.updateMatrix();
      crops.setMatrixAt(i, dummy.matrix);
    });
    crops.instanceMatrix.needsUpdate = true;
    // young growth is yellow-green, mature growth is deep green
    cropMat.color.setHSL(0.26, 0.55, THREE.MathUtils.lerp(0.46, 0.3, g));
  }

  // =========================================================================
  // 4. ROOF — solar array, irrigation tank, parapet, plant
  // =========================================================================
  const roofY = 0.3 + TOTAL_H;
  const roof = new THREE.Group();
  roof.position.y = roofY;
  group.add(roof);

  roof.add(createParapet({ width: WIDTH + 0.3, depth: DEPTH + 0.3, height: 0.55, thickness: 0.16 }));

  const solar = createSolarArray({ rows: 2, cols: 4, panelW: 1.15, panelH: 0.7, tilt: 0.4 });
  solar.position.set(0, 0.08, -0.3);
  roof.add(solar);

  // header tank feeding the irrigation main by gravity
  const tank = createWaterTank({ radius: 0.62, height: 1.5, accent: 0x3f7f9e, ladder: false });
  tank.position.set(WIDTH / 2 - 1.0, 0.05, DEPTH / 2 - 1.0);
  roof.add(tank);

  const roofDetail = new MeshBuilder();
  roofDetail.box(1.2, 0.5, 1.0, painted(0xb0b6ba, 0.5, 0.35), { pos: [-WIDTH / 2 + 1.1, 0.25, DEPTH / 2 - 1.2], radius: 0.03 });
  roofDetail.cyl(0.05, 0.05, 1.6, steel, { pos: [-WIDTH / 2 + 0.5, 0.8, -DEPTH / 2 + 0.8], segments: 8 });
  roofDetail.flat(0.5, 0.03, 0.35, emissive(0xff4444, 0.8), { pos: [-WIDTH / 2 + 0.5, 1.62, -DEPTH / 2 + 0.8] });
  roof.add(roofDetail.build('roof-plant'));

  // =========================================================================
  // 5. SMART IRRIGATION — main riser, branch lines and drip emitters
  // =========================================================================
  const riserX = WIDTH / 2 + 0.18;
  const riserZ = DEPTH / 2 - 0.1;

  group.add(
    createPipeRun(
      [
        new THREE.Vector3(WIDTH / 2 - 1.0, roofY + 0.6, DEPTH / 2 - 1.0),
        new THREE.Vector3(riserX, roofY + 0.35, riserZ),
        new THREE.Vector3(riserX, 0.4, riserZ),
      ],
      { radius: 0.06, material: painted(0x2f7f9e, 0.4, 0.4), brackets: true }
    )
  );

  // branch into each ledge, ending in a drip line along the planter
  const dripEmitters = [];
  for (let f = 0; f < FLOORS; f++) {
    const y = ledgeY[f] + 0.5;
    group.add(
      createPipeRun(
        [
          new THREE.Vector3(riserX, y, riserZ),
          new THREE.Vector3(riserX, y, DEPTH / 2 + LEDGE_DEPTH * 0.6),
          new THREE.Vector3(-WIDTH / 2 + 0.5, y, DEPTH / 2 + LEDGE_DEPTH * 0.6),
        ],
        { radius: 0.028, material: painted(0x2f7f9e, 0.4, 0.4) }
      )
    );

    // isolation valve at each floor
    const valve = new MeshBuilder();
    valve.cyl(0.06, 0.06, 0.1, steel, { pos: [riserX, y + 0.16, riserZ], segments: 10 });
    valve.add(new THREE.TorusGeometry(0.075, 0.014, 6, 14), painted(0xd0342c, 0.5), {
      pos: [riserX, y + 0.23, riserZ],
      rot: [Math.PI / 2, 0, 0],
    });
    group.add(valve.build('valve'));

    // drip emitter droplets, animated during growth
    for (let d = 0; d < 4; d++) {
      const x = -WIDTH / 2 + 1.1 + d * ((WIDTH - 2.2) / 3);
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 6, 5),
        new THREE.MeshPhysicalMaterial({
          color: 0xa8e0f0,
          roughness: 0.05,
          transmission: 0.8,
          thickness: 0.1,
          transparent: true,
          opacity: 0.85,
        })
      );
      drop.position.set(x, y - 0.08, DEPTH / 2 + LEDGE_DEPTH * 0.6);
      drop.userData = { baseY: y - 0.08, phase: Math.random() * Math.PI * 2 };
      drop.visible = false;
      group.add(drop);
      dripEmitters.push(drop);
    }
  }

  // =========================================================================
  // 6. WIND TURBINE
  // =========================================================================
  const turbine = new THREE.Group();
  turbine.position.set(WIDTH / 2 + 4.4, 0, -DEPTH / 2 - 1.0);
  group.add(turbine);

  const towerBuild = new MeshBuilder();
  towerBuild.cyl(0.55, 0.8, 0.5, concreteDark, { pos: [0, 0.25, 0], segments: 20 });
  // tapered tubular tower, built in three cans so the taper is visible
  const canH = TURBINE_TOWER_H / 3;
  towerBuild.cyl(0.3, 0.38, canH, painted(0xe8eae7, 0.35, 0.5), { pos: [0, 0.5 + canH / 2, 0], segments: 20 });
  towerBuild.cyl(0.24, 0.3, canH, painted(0xe8eae7, 0.35, 0.5), { pos: [0, 0.5 + canH * 1.5, 0], segments: 20 });
  towerBuild.cyl(0.19, 0.24, canH, painted(0xe8eae7, 0.35, 0.5), { pos: [0, 0.5 + canH * 2.5, 0], segments: 20 });
  // flange joints
  for (let i = 1; i < 3; i++) {
    towerBuild.add(new THREE.TorusGeometry(0.3 - i * 0.055, 0.026, 8, 24), steel, {
      pos: [0, 0.5 + canH * i, 0],
      rot: [Math.PI / 2, 0, 0],
    });
  }
  // access door at the base
  towerBuild.flat(0.36, 0.7, 0.04, steelDark, { pos: [0, 0.9, 0.37] });
  turbine.add(towerBuild.build('turbine-tower'));

  // yaw assembly + nacelle
  const yaw = new THREE.Group();
  yaw.position.y = 0.5 + TURBINE_TOWER_H;
  turbine.add(yaw);

  const nacelleBuild = new MeshBuilder();
  const nacelleMat = painted(0xf0f2ef, 0.32, 0.45);
  nacelleBuild.box(1.5, 0.52, 0.56, nacelleMat, { pos: [-0.15, 0, 0], radius: 0.16 });
  // tail cone
  nacelleBuild.add(new THREE.ConeGeometry(0.26, 0.6, 16), nacelleMat, {
    pos: [-1.0, 0, 0],
    rot: [0, 0, Math.PI / 2],
  });
  // anemometer mast on top
  nacelleBuild.cyl(0.018, 0.018, 0.3, steelDark, { pos: [-0.7, 0.4, 0], segments: 6 });
  nacelleBuild.add(new THREE.SphereGeometry(0.04, 8, 6), steelDark, { pos: [-0.7, 0.56, 0] });
  yaw.add(nacelleBuild.build('nacelle'));

  // rotor: hub, spinner and three twisted blades
  const rotor = new THREE.Group();
  rotor.position.set(0.72, 0, 0);
  yaw.add(rotor);

  const rotorBuild = new MeshBuilder();
  rotorBuild.add(new THREE.SphereGeometry(0.26, 18, 14), nacelleMat, { pos: [0, 0, 0] });
  rotorBuild.add(new THREE.ConeGeometry(0.24, 0.42, 18), nacelleMat, {
    pos: [0.22, 0, 0],
    rot: [0, 0, -Math.PI / 2],
  });

  // Blades are tapered and twisted along their span — a straight box blade is
  // one of the most obvious "quick 3D" tells on a turbine.
  for (let i = 0; i < 3; i++) {
    const rot = (i / 3) * Math.PI * 2;
    const segs = 7;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const r0 = 0.26 + t0 * TURBINE_BLADE_LEN;
      const chord = THREE.MathUtils.lerp(0.42, 0.13, t0);
      const thick = THREE.MathUtils.lerp(0.11, 0.03, t0);
      const twist = THREE.MathUtils.lerp(0.42, 0.05, t0);
      const segLen = (t1 - t0) * TURBINE_BLADE_LEN;

      rotorBuild.add(
        new THREE.BoxGeometry(thick, segLen, chord),
        nacelleMat,
        {
          pos: [
            -0.02,
            Math.cos(rot) * (r0 + segLen / 2),
            Math.sin(rot) * (r0 + segLen / 2),
          ],
          rot: [rot, twist, 0],
        }
      );
    }
  }
  rotor.add(rotorBuild.build('rotor'));

  // =========================================================================
  // 7. GROUND LEVEL — entrance and equipment
  // =========================================================================
  const entrance = createDoor({ width: 1.2, height: 2.3, panelColor: 0x2f4f45 });
  entrance.position.set(0.4, 0.3, DEPTH / 2 + 0.02);
  group.add(entrance);

  const groundKit = new MeshBuilder();
  // inverter / battery cabinets fed by the solar array
  groundKit.box(1.1, 1.5, 0.55, painted(0xb6bcbe, 0.45, 0.35), { pos: [-WIDTH / 2 + 0.6, 1.05, DEPTH / 2 + 1.1], radius: 0.03 });
  groundKit.box(0.9, 1.3, 0.5, painted(0x99a0a3, 0.45, 0.35), { pos: [-WIDTH / 2 + 1.8, 0.95, DEPTH / 2 + 1.1], radius: 0.03 });
  groundKit.flat(0.3, 0.16, 0.02, emissive(0x4de0a0, 1.2), { pos: [-WIDTH / 2 + 0.6, 1.5, DEPTH / 2 + 1.38] });
  group.add(groundKit.build('ground-equipment'));

  const ladder = createLadder({ height: 3.0, cage: true });
  ladder.position.set(-WIDTH / 2 - 1.2, roofY - 3.0, 0);
  ladder.rotation.y = -Math.PI / 2;
  group.add(ladder);

  // =========================================================================
  // 8. LABEL + ANIMATION STATE
  // =========================================================================
  const label = createLabelPanel(
    'Vertical Farm Tower',
    ['Vertical Farming', 'Solar Panels', 'Wind Turbine', 'Smart Irrigation', 'Low Water Consumption'],
    [0, roofY + 3.4, 0]
  );
  group.add(label.object);

  const growth = { value: 0.25, from: 0.25, to: 0.25, t: 0, duration: 3.2, animating: false, grown: false };
  applyGrowth(growth.value);

  function triggerGrowth() {
    growth.grown = !growth.grown;
    growth.from = growth.value;
    growth.to = growth.grown ? 1 : 0.25;
    growth.t = 0;
    growth.animating = true;
    dripEmitters.forEach((d) => (d.visible = true));
  }

  let rotorAngle = 0;

  function update(dt, elapsed) {
    // --- turbine always turns; nacelle yaws slowly to track the wind ---
    rotorAngle += dt * TURBINE_SPEED * (1 + Math.sin(elapsed * 0.23) * 0.18);
    rotor.rotation.x = rotorAngle;
    yaw.rotation.y = Math.sin(elapsed * 0.11) * 0.22;

    // --- grow-lights breathe subtly ---
    growLights.forEach((l, i) => {
      l.material.emissiveIntensity = 0.75 + Math.sin(elapsed * 0.9 + i * 0.7) * 0.18;
    });

    // --- time-lapse growth ---
    if (growth.animating) {
      growth.t += dt;
      const p = Math.min(growth.t / growth.duration, 1);
      growth.value = THREE.MathUtils.lerp(growth.from, growth.to, easeInOutCubic(p));
      applyGrowth(growth.value);
      if (p >= 1) {
        growth.animating = false;
        // irrigation runs during growth, then stops
        setTimeout(() => dripEmitters.forEach((d) => (d.visible = false)), 1200);
      }
    }

    // --- drip emitters: droplets swell and fall ---
    if (dripEmitters[0]?.visible) {
      dripEmitters.forEach((d) => {
        const cycle = (elapsed * 1.4 + d.userData.phase) % 1;
        d.position.y = d.userData.baseY - cycle * 0.34;
        const s = 0.55 + (1 - cycle) * 0.75;
        d.scale.setScalar(s);
      });
    }
  }

  return {
    group,
    label,
    footprint: { x: 0, z: 0, r: 7.8 },
    approxHeight: roofY + 1.0,
    interact: triggerGrowth,
    triggerGrowth,
    getGrowth: () => growth.value,
    update,
    setLabelVisible: (v) => setLabelVisible(label, v),
  };
}
