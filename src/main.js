// ===========================================================================
// ECO FRIENDLY SURVIVAL — entry point
// ===========================================================================
// Boot order matters: textures must exist before materials, materials before
// any geometry, and the sky before the environment map can be baked onto
// those materials. Each stage yields to the browser so the loading screen
// can actually paint its progress.
// ===========================================================================
import * as THREE from 'three';

import { initStage, addSignage } from './scene.js';
import { initTextureLibrary } from './textures.js';
import { initMaterials, mats } from './materials.js';
import { createSkySystem } from './sky.js';
import { createTerrain, PLOT_HALF, ROAD_HALF_WIDTH, WALK_WIDTH, QUAD, groundHeight } from './terrain.js';
import { createComposer } from './postprocessing.js';
import { createForest, createGrassField, createStreetLamp, createBench, createBin,
         createCar, createFence, createHedge, createBollard, windUniforms } from './props.js';
import { createEarthquakeBuilding } from './buildings/earthquakeBuilding.js';
import { createFloodBuilding } from './buildings/floodBuilding.js';
import { createAcidRainBuilding } from './buildings/acidRainBuilding.js';
import { createFarmTower } from './buildings/farmTower.js';
import { createCameraTween } from './cameraTween.js';
import { buildUI, showToast, setLoadingProgress, hideLoading } from './ui.js';
import { scatterPositions } from './utils.js';

// Pulled back far enough to frame all four towers plus the road cross.
const DEFAULT_CAM = new THREE.Vector3(47, 33, 52);
const DEFAULT_TARGET = new THREE.Vector3(0, 6, 0);

const BUILDING_LABELS = {
  earthquake: 'Earthquake-Resistant Building',
  flood: 'Flood-Resilient House',
  acidRain: 'Acid-Rain-Resistant Building',
  farm: 'Vertical Farm Tower',
};

// Quality is picked once at boot (it drives texture sizes and shadow maps);
// the UI switch adjusts everything that can change at runtime.
let quality = detectQuality();

function detectQuality() {
  // explicit override, e.g. ?quality=low — handy on weak GPUs and for testing
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced && ['low', 'medium', 'high'].includes(forced)) return forced;

  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 16));

async function boot() {
  const app = document.getElementById('app');

  // ---- 1. renderer / camera -------------------------------------------
  setLoadingProgress('Starting renderer…', 0.05);
  const { scene, camera, renderer, labelRenderer, controls } = initStage(app, quality);
  await yieldToBrowser();

  // ---- 2. procedural textures (the slow step) --------------------------
  setLoadingProgress('Generating surface textures…', 0.15);
  await yieldToBrowser();
  initTextureLibrary(renderer, quality);
  initMaterials();
  await yieldToBrowser();

  // ---- 3. sky + image-based lighting -----------------------------------
  setLoadingProgress('Building sky and lighting…', 0.42);
  await yieldToBrowser();
  const sky = createSkySystem(scene, renderer, quality);
  await yieldToBrowser();

  // ---- 4. terrain, roads, water ----------------------------------------
  setLoadingProgress('Laying out terrain and roads…', 0.55);
  await yieldToBrowser();
  const terrain = createTerrain(scene, sky.sun, quality);
  await yieldToBrowser();

  // ---- 5. buildings -----------------------------------------------------
  setLoadingProgress('Constructing buildings…', 0.68);
  await yieldToBrowser();

  const registry = {
    earthquake: { api: createEarthquakeBuilding(), centre: new THREE.Vector3(QUAD + 0.5, 0, QUAD - 0.5) },
    flood: { api: createFloodBuilding({ water: terrain.water }), centre: new THREE.Vector3(-QUAD - 0.4, 0, QUAD - 1.2) },
    acidRain: { api: createAcidRainBuilding(), centre: new THREE.Vector3(-QUAD - 0.5, 0, -QUAD - 0.5) },
    farm: { api: createFarmTower(), centre: new THREE.Vector3(QUAD - 0.5, 0, -QUAD) },
  };

  const exclusions = [];
  for (const [key, entry] of Object.entries(registry)) {
    entry.api.group.position.copy(entry.centre);
    entry.api.group.userData.buildingKey = key;
    entry.api.group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(entry.api.group);
    exclusions.push({ x: entry.centre.x, z: entry.centre.z, r: entry.api.footprint.r + 0.6 });
  }
  await yieldToBrowser();

  // ---- 6. vegetation and street furniture ------------------------------
  setLoadingProgress('Planting trees and street furniture…', 0.8);
  await yieldToBrowser();
  addSceneProps(scene, exclusions, terrain, sky, quality);
  await yieldToBrowser();

  // ---- 7. signage + post-processing ------------------------------------
  setLoadingProgress('Finishing render pipeline…', 0.92);
  await yieldToBrowser();
  addSignage(scene);
  let post = createComposer(renderer, scene, camera, quality);
  await yieldToBrowser();

  // =======================================================================
  // Interaction wiring
  // =======================================================================
  const tween = createCameraTween(camera, controls);
  let focusedKey = null;
  let hoveredKey = null;

  function refreshLabels() {
    for (const [key, entry] of Object.entries(registry)) {
      entry.api.setLabelVisible(key === focusedKey || key === hoveredKey);
    }
  }

  function focusBuilding(key) {
    const entry = registry[key];
    if (!entry) return;
    focusedKey = key;
    refreshLabels();
    ui.setActiveBuilding(key);

    const h = entry.api.approxHeight || 10;
    const dir = new THREE.Vector3(entry.centre.x, 0, entry.centre.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 1);
    dir.normalize();

    // Frame the whole building with a little headroom, from slightly above
    // mid-height — a natural architectural viewpoint.
    const dist = 11 + h * 1.05;
    tween.flyTo(
      new THREE.Vector3(
        entry.centre.x + dir.x * dist,
        h * 0.62 + 3.5,
        entry.centre.z + dir.z * dist
      ),
      new THREE.Vector3(entry.centre.x, h * 0.45, entry.centre.z),
      1.7
    );
  }

  function triggerBuilding(key) {
    const entry = registry[key];
    if (!entry) return;
    entry.api.interact();

    if (key === 'acidRain') {
      const on = entry.api.isRaining();
      ui.setTriggerLabel('acidRain', on ? 'Stop Acid Rain' : 'Simulate Acid Rain');
      showToast(on ? 'Acid rain: runoff shedding to the collection tank' : 'Acid rain stopped');
    } else if (key === 'farm') {
      showToast('Vertical farm: time-lapse growth cycle running');
    } else if (key === 'flood') {
      showToast('Flood event: water rising — the house stays above the line');
    } else {
      showToast('Seismic event: isolators absorbing the ground motion');
    }
  }

  function resetView() {
    focusedKey = null;
    refreshLabels();
    ui.setActiveBuilding(null);
    tween.flyTo(DEFAULT_CAM, DEFAULT_TARGET, 1.7);
  }

  const ui = buildUI(document.getElementById('ui-overlay'), {
    onFocus: focusBuilding,
    onTrigger: triggerBuilding,
    onReset: resetView,
    onFloodSlider: (v) => registry.flood.api.setFloodLevel(v),
    onTimeChange: (hour) => sky.setTimeOfDay(hour),
    onQualityChange: (q) => {
      quality = q;
      post.setQuality(q);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.5));
      showToast(`Render quality: ${q}`);
    },
  });
  ui.setQualityActive(quality);

  // street lamps react to the time-of-day slider
  sky.onChange((state) => {
    scene.traverse((o) => {
      if (o.userData.setNight) o.userData.setNight(state.nightFactor);
    });
  });

  // ---- raycasting -------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const buildingGroups = Object.values(registry).map((e) => e.api.group);

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(buildingGroups, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.buildingKey) obj = obj.parent;
    return obj ? obj.userData.buildingKey : null;
  }

  let pointerDownAt = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    hoveredKey = pick(e);
    renderer.domElement.style.cursor = hoveredKey ? 'pointer' : 'grab';
    refreshLabels();
  });
  renderer.domElement.addEventListener('pointerdown', () => {
    pointerDownAt = performance.now();
  });
  renderer.domElement.addEventListener('click', (e) => {
    // ignore clicks that were really orbit drags
    if (performance.now() - pointerDownAt > 300) return;
    const key = pick(e);
    if (!key) return;
    focusBuilding(key);
    triggerBuilding(key);
  });

  // ---- resize -----------------------------------------------------------
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    post.setSize(w, h);
  });

  // =======================================================================
  // Frame loop
  // =======================================================================
  const timer = new THREE.Timer();
  const shakeOffset = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const elapsed = timer.getElapsed();

    windUniforms.uTime.value = elapsed;

    tween.update(dt);
    if (!tween.isActive()) controls.update();

    for (const entry of Object.values(registry)) {
      entry.api.update(dt, elapsed);
    }
    terrain.water.update(dt);

    // keep the flood slider in step with the automatic flood cycle
    ui.syncFloodSlider(registry.flood.api.getFloodLevel());

    // camera shake during the earthquake, applied after controls so it reads
    // as the *view* being rattled rather than the target moving
    const shake = registry.earthquake.api.getShakeIntensity();
    if (shake > 0.001) {
      shakeOffset.set(
        (Math.random() - 0.5) * shake * 0.22,
        (Math.random() - 0.5) * shake * 0.16,
        (Math.random() - 0.5) * shake * 0.22
      );
      camera.position.add(shakeOffset);
    }

    post.render(dt);
    labelRenderer.render(scene, camera);
  }

  setLoadingProgress('Ready', 1);
  hideLoading();
  animate();
}

/**
 * Trees, grass, hedges, lamps, benches, bins, cars, fences and bollards.
 * Placement is deterministic so the composition is stable between reloads.
 */
function addSceneProps(scene, exclusions, terrain, sky, quality) {
  const rng = mulberry32(20260817);

  // --- trees, clustered in each quadrant ---------------------------------
  const treeSpots = [];
  const quadrants = [
    [QUAD + 0.5, QUAD - 0.5],
    [-QUAD - 0.4, QUAD - 1.2],
    [-QUAD - 0.5, -QUAD - 0.5],
    [QUAD - 0.5, -QUAD],
  ];
  const corridor = ROAD_HALF_WIDTH + WALK_WIDTH + 1.2;

  quadrants.forEach(([cx, cz]) => {
    const pts = scatterPositions(cx, cz, 9, 6.8, 9.6, exclusions, rng);
    pts.forEach((p) => {
      // keep clear of the carriageway and out of the pond
      if (Math.abs(p[0]) < corridor || Math.abs(p[1]) < corridor) return;
      if (terrain.pondField(p[0], p[1]) > -0.15) return;
      if (Math.abs(p[0]) > PLOT_HALF - 1 || Math.abs(p[1]) > PLOT_HALF - 1) return;
      treeSpots.push(p);
    });
  });

  // a loose line of street trees just behind the footway
  for (let i = 0; i < 10; i++) {
    const along = 7 + i * 2.9;
    if (along > PLOT_HALF - 2) break;
    treeSpots.push([corridor + 1.1, along], [-corridor - 1.1, -along]);
  }
  scene.add(createForest(treeSpots, quality));

  // --- grass -------------------------------------------------------------
  const grassCount = quality === 'high' ? 16000 : quality === 'medium' ? 7000 : 0;
  if (grassCount) {
    const sampler = terrain.makeGrassSampler(exclusions.map((e) => ({ ...e, r: e.r * 0.85 })));
    const grass = createGrassField(sampler, grassCount, quality);
    scene.add(grass);
  }

  // --- hedges lining the footway edge ------------------------------------
  const hedgeSpots = [
    { x: corridor + 0.9, z: -12, w: 0.8, d: 7 },
    { x: -corridor - 0.9, z: 13.5, w: 0.8, d: 6 },
    { x: 13, z: corridor + 0.9, w: 7, d: 0.8 },
  ];
  hedgeSpots.forEach((h) => {
    const hedge = createHedge({ width: h.w, depth: h.d, height: 0.9 });
    hedge.position.set(h.x, 0, h.z);
    scene.add(hedge);
  });

  // --- street lamps along both roads -------------------------------------
  const lampPositions = [];
  for (let i = 0; i < 5; i++) {
    const d = 6.5 + i * 6.4;
    if (d > PLOT_HALF + 4) break;
    lampPositions.push([ROAD_HALF_WIDTH + 0.85, d, 0]);
    lampPositions.push([-(ROAD_HALF_WIDTH + 0.85), -d, Math.PI]);
    lampPositions.push([d, -(ROAD_HALF_WIDTH + 0.85), -Math.PI / 2]);
    lampPositions.push([-d, ROAD_HALF_WIDTH + 0.85, Math.PI / 2]);
  }
  lampPositions.forEach(([x, z, ry]) => {
    const lamp = createStreetLamp({ height: 4.6 });
    lamp.position.set(x, 0.1, z);
    lamp.rotation.y = ry;
    lamp.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(lamp);
  });

  // --- benches, bins, bollards -------------------------------------------
  const benchSpots = [
    [ROAD_HALF_WIDTH + 1.5, 9.5, -Math.PI / 2],
    [-(ROAD_HALF_WIDTH + 1.5), -13.5, Math.PI / 2],
    [11.5, -(ROAD_HALF_WIDTH + 1.5), Math.PI],
  ];
  benchSpots.forEach(([x, z, ry]) => {
    const bench = createBench();
    bench.position.set(x, 0.1, z);
    bench.rotation.y = ry;
    scene.add(bench);
  });

  [[ROAD_HALF_WIDTH + 1.4, 12.4], [-(ROAD_HALF_WIDTH + 1.4), -8.2]].forEach(([x, z]) => {
    const bin = createBin();
    bin.position.set(x, 0.1, z);
    scene.add(bin);
  });

  for (let i = 0; i < 6; i++) {
    const bollard = createBollard();
    bollard.position.set(ROAD_HALF_WIDTH + WALK_WIDTH + 0.4, 0.1, -6 - i * 1.6);
    scene.add(bollard);
  }

  // --- parked cars --------------------------------------------------------
  const carColors = [0x9fb0be, 0x2f3f4a, 0xa8483c];
  const carSpots = [
    [ROAD_HALF_WIDTH - 1.5, 11.5, 0],
    [-(ROAD_HALF_WIDTH - 1.5), -7.5, Math.PI],
    [-13.5, ROAD_HALF_WIDTH - 1.5, Math.PI / 2],
  ];
  carSpots.forEach(([x, z, ry], i) => {
    const car = createCar(carColors[i % carColors.length]);
    car.position.set(x, 0.02, z);
    car.rotation.y = ry;
    scene.add(car);
  });

  // --- fence along the farm tower's plot ---------------------------------
  const fence = createFence({ length: 9 });
  fence.position.set(QUAD - 0.5, 0, -QUAD + 8.4);
  scene.add(fence);
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

boot().catch((err) => {
  console.error(err);
  const msg = document.getElementById('loading-msg');
  if (msg) msg.textContent = `Failed to start: ${err.message}`;
});
