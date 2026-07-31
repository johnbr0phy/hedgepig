import * as THREE from 'three';
import { buildHog } from '../hog/model.js';
import { createAnimator } from '../hog/anim.js';
import { basisAt, positionAt } from '../world/planet.js';
import { heightAt, walkableAt } from '../world/terrain.js';
import { R, distance, bearing } from '../world/plan.js';
import { clamp, damp, wrapAng } from '../core/util.js';

/* ------------------------------------------------------------------ *
 * The hoglet.
 *
 * From the third leg on, a small one finds him and follows.  It changes
 * nothing about the game — it cannot be hurt, it sows nothing, it simply
 * will not be left behind — and it is the warmest thing an open planet can
 * offer for keeping going: company.
 *
 * It is **its own walker**, not a delayed recording of him.  A recording
 * ends every stop by walking to exactly where he stands — two hedgehogs in
 * one spot — and drifts through water he detoured round.  A follower with
 * v1's own rules (one target, eased gait, `wrapAng` turns) stops a
 * respectful half-metre back, which happens to be the whole of what
 * "following" looks like.
 * ------------------------------------------------------------------ */

const SCALE = 0.55;
const KEEP = 0.5;              // how far behind it settles

export function createHoglet(scene, { seed = 909, phase = 41.7 } = {}) {
  const parts = buildHog();
  parts.root.matrixAutoUpdate = false;
  parts.root.visible = false;
  scene.add(parts.root);
  if (parts.shadow) {
    parts.shadow.visible = false;
    scene.add(parts.shadow);
  }
  const anim = createAnimator(parts, seed);

  const h = {
    live: false, announced: false,
    x: 0, z: 0, y: 0, hd: 0, gait: 0, turning: 0, cele: 0,
  };

  const _m = new THREE.Matrix4();
  const _r = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3(SCALE, SCALE, SCALE);

  function seat() {
    const b = basisAt(h.x, h.z);
    _m.makeBasis(b.east, b.up, b.north);
    _m.setPosition(positionAt(h.x, h.y, h.z, _v));
    _r.makeRotationY(-h.hd);
    _m.multiply(_r);
    _r.makeScale(SCALE, SCALE, SCALE);
    _m.multiply(_r);
    parts.root.matrix.copy(_m);
    parts.root.matrixWorldNeedsUpdate = true;

    const sh = parts.shadow;
    if (sh) {
      const bb = basisAt(h.x, h.z);
      _m.makeBasis(bb.east, bb.up, bb.north);
      _m.setPosition(positionAt(h.x, h.y + 0.006, h.z, _v));
      _r.makeRotationY(-h.hd);
      _m.multiply(_r);
      _r.makeScale(SCALE, SCALE, SCALE);
      _m.multiply(_r);
      sh.matrix.copy(_m);
      sh.matrixWorldNeedsUpdate = true;
    }
  }

  /**
   * @param on   whether the hoglet has found him yet (leg three and after)
   * @returns 'arrived' once, the first frame it turns up, for the HUD
   */
  function update(dt, hog, on, now) {
    let event = null;
    if (on && !h.live) {
      h.live = true;
      // it turns up from just behind him, not out of thin air in his face
      const back = hog.hd + Math.PI;
      const cs = Math.max(0.08, Math.cos(hog.z / R));
      h.x = hog.x + (Math.cos(back) * 1.6) / cs;
      h.z = hog.z + Math.sin(back) * 1.6;
      h.hd = hog.hd;
      h.cele = 1.1;              // it is VERY pleased to have found him
      if (!h.announced) { h.announced = true; event = 'arrived'; }
    }
    if (!h.live) return event;
    if (h.cele > 0) h.cele = Math.max(0, h.cele - dt);

    const d = distance(h.x, h.z, hog.x, hog.z);
    /* Left too far behind (the boat, the culvert, a long roll), it simply
     * turns up again — a lost hoglet is a sad mechanic, not a fun one. */
    if (d > 14) {
      const back = hog.hd + Math.PI;
      const cs = Math.max(0.08, Math.cos(hog.z / R));
      h.x = hog.x + (Math.cos(back) * 1.4) / cs;
      h.z = hog.z + Math.sin(back) * 1.4;
    }

    const want = d > KEEP + 0.15 ? 1 : 0;
    if (want) {
      const aim = bearing(h.x, h.z, hog.x, hog.z).angle;
      const turn = wrapAng(aim - h.hd);
      const tStep = clamp(turn, -5 * dt, 5 * dt);
      h.hd = wrapAng(h.hd + tStep);
      h.turning = damp(h.turning, tStep / Math.max(dt, 1e-6), 10, dt);
      const facing = clamp(1 - Math.abs(turn) / 1.9, 0.2, 1);
      h.gait = damp(h.gait, facing, 4, dt);
      // a touch faster than him, or it loses ground on every straight
      const step = Math.min(hog.speed * 1.12 * h.gait * dt, Math.max(0, d - KEEP));
      const cs = Math.max(0.08, Math.cos(h.z / R));
      const nx = h.x + (Math.cos(h.hd) * step) / cs;
      const nz = h.z + Math.sin(h.hd) * step;
      if (walkableAt(nx, nz)) { h.x = nx; h.z = nz; }
      else if (walkableAt(nx, h.z)) { h.x = nx; }
      else if (walkableAt(h.x, nz)) { h.z = nz; }
    } else {
      h.gait = damp(h.gait, 0, 5, dt);
      h.turning = damp(h.turning, 0, 10, dt);
    }
    h.y = heightAt(h.x, h.z);

    anim.update({
      gait: h.gait, speed: (hog.speed || 0.85) * 1.12, curl: 0, ball: 0,
      shiver: hog.shiver || 0, lookYaw: 0, turning: h.turning, night: hog.night || 0,
      wet: hog.wet || 0, celebrate: h.cele,
    }, dt, now + phase);         // its own phase: not a mirror of his blinks
    parts.root.visible = true;
    if (parts.shadow) parts.shadow.visible = true;
    seat();
    return event;
  }

  return { update, state: h, parts };
}
