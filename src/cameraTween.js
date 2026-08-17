// Small camera "fly-to" tween used by both the 3D building clicks and the
// top-left UI buttons. Disables OrbitControls while a tween is in flight
// so user drag input doesn't fight the animation.
import { easeInOutCubic } from './utils.js';

export function createCameraTween(camera, controls) {
  let tween = null;

  function flyTo(position, target, duration = 1.5) {
    tween = {
      startPos: camera.position.clone(),
      startTarget: controls.target.clone(),
      endPos: position.clone(),
      endTarget: target.clone(),
      t: 0,
      duration,
    };
    controls.enabled = false;
  }

  function update(dt) {
    if (!tween) return;
    tween.t += dt;
    const p = Math.min(tween.t / tween.duration, 1);
    const e = easeInOutCubic(p);
    camera.position.lerpVectors(tween.startPos, tween.endPos, e);
    controls.target.lerpVectors(tween.startTarget, tween.endTarget, e);
    controls.update();
    if (p >= 1) {
      tween = null;
      controls.enabled = true;
    }
  }

  function isActive() {
    return !!tween;
  }

  return { flyTo, update, isActive };
}
