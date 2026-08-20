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

/**
 * Slides scattered points out of the corridor between a camera and the thing
 * it is pointed at. A tree that grows dead in front of a building hides the
 * one thing the user asked to look at, and the scatter is random enough that
 * this happens on some seeds. `lines` are { from: [x, z], to: [x, z] } pairs
 * in ground space; points already clear of every corridor are untouched.
 *
 * `inBounds` keeps a nudge from shoving a point somewhere it cannot live (off
 * the plot, say) — when the near side of the corridor fails it, the point is
 * sent round the far side instead rather than dropped.
 */
export function clearSightlines(points, lines, clearance, inBounds = () => true) {
  return points.map((p) => {
    let [x, z] = p;
    // A push away from one corridor can slide the point into another, so
    // relax a few times; positions settle well before the cap in practice.
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const { from, to } of lines) {
        const vx = to[0] - from[0];
        const vz = to[1] - from[1];
        const len2 = vx * vx + vz * vz;
        if (len2 < 1e-6) continue;
        const t = ((x - from[0]) * vx + (z - from[1]) * vz) / len2;
        // only the stretch that is actually in shot: not beside the camera,
        // not behind the subject
        if (t <= 0.02 || t >= 0.98) continue;
        const cx = from[0] + vx * t;
        const cz = from[1] + vz * t;
        let dx = x - cx;
        let dz = z - cz;
        let d = Math.hypot(dx, dz);
        if (d >= clearance) continue;
        if (d < 1e-3) {
          // dead centre — step off along the corridor normal
          d = Math.hypot(vx, vz);
          dx = -vz / d;
          dz = vx / d;
        } else {
          dx /= d;
          dz /= d;
        }
        const near = [cx + dx * clearance, cz + dz * clearance];
        const far = [cx - dx * clearance, cz - dz * clearance];
        const pick = inBounds(near) || !inBounds(far) ? near : far;
        [x, z] = pick;
        moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  });
}
