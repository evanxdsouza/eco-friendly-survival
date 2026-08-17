// ---------------------------------------------------------------------------
// RENDERER / CAMERA BOOTSTRAP
// ---------------------------------------------------------------------------
// Owns the "stage": WebGL renderer configured for physically-based rendering,
// the camera and orbit controls, the CSS2D layer used by the floating label
// panels, and the site signage.
//
// Lighting, sky and terrain live in their own modules — this file deliberately
// does not know about them.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MeshBuilder } from './parts.js';
import { mats, painted } from './materials.js';

export function initStage(container, quality = 'high') {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.25, 900);
  camera.position.set(47, 33, 52);

  const renderer = new THREE.WebGLRenderer({
    antialias: quality === 'low',   // composer handles AA at higher settings
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.5));

  // Physically-based output: ACES filmic tone mapping is what stops bright
  // skies from clipping to flat white and gives highlights a filmic roll-off.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  // CSS2D layer for the floating feature panels
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labelRenderer.domElement.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    pointerEvents: 'none',
  });
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 6;
  controls.maxDistance = 150;
  controls.maxPolarAngle = Math.PI / 2 - 0.035; // never drop below the ground
  controls.update();

  return { scene, camera, renderer, labelRenderer, controls };
}

/**
 * Site signboard rendered as real geometry with a canvas texture — far more
 * convincing than floating HTML, and it takes light and shadow like
 * everything else on the site.
 */
function createSignPanel(title, subtitle, width = 6.4, height = 1.5) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');

  // brushed dark panel with a subtle vertical gradient
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, '#12241d');
  bg.addColorStop(1, '#0a1712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // accent rule
  ctx.fillStyle = '#5be49b';
  ctx.fillRect(48, 168, 300, 5);

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2fff8';
  ctx.font = 'bold 76px "Segoe UI", Roboto, sans-serif';
  ctx.fillText(title, 48, 78);

  ctx.fillStyle = '#a9d9c0';
  ctx.font = '38px "Segoe UI", Roboto, sans-serif';
  ctx.fillText(subtitle, 48, 205);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const panelMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.42,
    metalness: 0.25,
    envMapIntensity: 0.9,
  });

  const group = new THREE.Group();
  const b = new MeshBuilder();
  const frame = painted(0x3c4a44, 0.4, 0.5);

  // posts
  for (const s of [-1, 1]) {
    b.cyl(0.09, 0.11, 2.6, frame, { pos: [(s * width) / 2 - s * 0.4, 1.3, 0], segments: 14 });
    b.cyl(0.2, 0.24, 0.16, mats().concreteDark, { pos: [(s * width) / 2 - s * 0.4, 0.08, 0], segments: 14 });
  }
  // panel backing + frame
  b.box(width, height, 0.1, frame, { pos: [0, 2.0, 0], radius: 0.03 });
  group.add(b.build('sign-structure'));

  const face = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.16, height - 0.16), panelMat);
  face.position.set(0, 2.0, 0.055);
  group.add(face);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/** Adds the floating title and the ground-level signboard. */
export function addSignage(scene) {
  const group = new THREE.Group();
  group.name = 'signage';

  // Floating project title above the whole site.
  const titleEl = document.createElement('div');
  titleEl.className = 'banner-3d title';
  titleEl.textContent = 'Eco Friendly Survival';
  const titleObj = new CSS2DObject(titleEl);
  titleObj.position.set(0, 26, 0);
  group.add(titleObj);

  // Real signboard at the site entrance.
  const sign = createSignPanel('Eco Friendly Survival', 'Stronger Infrastructure, Safer Tomorrow');
  sign.position.set(0, 0, 22.5);
  group.add(sign);

  scene.add(group);
  return group;
}
