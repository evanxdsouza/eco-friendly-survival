// Shared helpers: floating HTML label panels and easing curves.
// (Vegetation scattering now lives in props.js / terrain.js.)
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** Ease-in-out cubic — camera tweens and most building animations. */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Exponentially damped oscillation, used for the seismic response. */
export function dampedOscillation(t, freq, damping) {
  return Math.sin(t * freq) * Math.exp(-t * damping);
}

/**
 * Floating feature-list panel anchored above a building. Shared by all four
 * so the panels stay visually consistent.
 */
export function createLabelPanel(title, items, localPosition = [0, 0, 0]) {
  const el = document.createElement('div');
  el.className = 'label-panel';

  const heading = document.createElement('h4');
  heading.textContent = title;
  el.appendChild(heading);

  const list = document.createElement('ul');
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  el.appendChild(list);

  const object = new CSS2DObject(el);
  object.position.set(...localPosition);
  return { object, el };
}

export function setLabelVisible(label, visible) {
  label.el.classList.toggle('visible', visible);
}

/** Scatters points in an annulus, skipping exclusion circles. */
export function scatterPositions(cx, cz, count, minR, maxR, exclude = [], rng = Math.random) {
  const pts = [];
  let attempts = 0;
  while (pts.length < count && attempts < count * 30) {
    attempts++;
    const ang = rng() * Math.PI * 2;
    const r = minR + rng() * (maxR - minR);
    const x = cx + Math.cos(ang) * r;
    const z = cz + Math.sin(ang) * r;
    if (exclude.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
    pts.push([x, z]);
  }
  return pts;
}

/** Marks every mesh under an object as a shadow caster/receiver. */
export function enableShadows(object, cast = true, receive = true) {
  object.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return object;
}

/** Tags every descendant so raycast hits can be traced back to a building. */
export function tagBuilding(object, key) {
  object.userData.buildingKey = key;
  return object;
}
