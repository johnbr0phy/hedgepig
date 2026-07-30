import * as THREE from 'three';
import { basisAt, positionAt, flatAt } from '../world/planet.js';
import { clamp, damp, lerp, TAU } from './util.js';

/* ------------------------------------------------------------------ *
 * The camera, and the tap that calls him.
 *
 * v1's camera was entirely yours and never followed him — scroll away and
 * he walked off the bottom of the screen, with a chevron on the edge to
 * find him again.  That was right for a field you looked *across*.  In three
 * dimensions on a planet 47 metres across it is not: lose him behind the
 * horizon and there is no chevron that will get him back.
 *
 * So the camera follows, but everything else about the relationship is
 * kept: it is an orbit *you* control, it lags rather than tracks, and it
 * never turns him.  Dragging moves the camera and nothing else.  A tap that
 * did not drag is a call.
 *
 * The one thing that is genuinely harder here: **"up" is a different
 * direction everywhere**.  The orbit is built in the tangent frame at his
 * feet, so walking round the planet quietly rotates the whole rig with him
 * and the horizon stays where the eye expects it.
 * ------------------------------------------------------------------ */

const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _want = new THREE.Vector3();
const _target = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _flat = { x: 0, z: 0, y: 0 };

export class Chase {
  constructor(camera, canvas, hog, world) {
    this.camera = camera;
    this.canvas = canvas;
    this.hog = hog;
    this.world = world;

    this.yaw = -Math.PI / 2;     // behind him to start, looking along the walk
    /* Pitched down more than feels natural, and further back than feels
     * natural, and both for the same reason: at his eye height the meadow
     * is a wall of stems.  v1 solved this by looking *across* a flat field
     * from inside the grass; in three dimensions the only way to keep him
     * visible is to sit above the canopy and look down into it. */
    this.pitch = 0.62;
    this.dist = 1.95;
    this.height = 0.19;

    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this._seeded = false;

    this.raycaster = new THREE.Raycaster();
    this.onCall = null;          // set by main: (x, z, hit) => void

    this._drag = null;
    this._pointers = new Map();
    this._pinch = 0;

    this.bind();
  }

  bind() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 1) {
        this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
      } else if (this._pointers.size === 2) {
        this._pinch = this.pinchDistance();
        this._drag = null;         // two fingers is a zoom, never a call
      }
    });

    c.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }

      if (this._pointers.size === 2 && this._pinch) {
        const d = this.pinchDistance();
        this.dist = clamp(this.dist * (this._pinch / (d || 1)), 0.55, 7);
        this._pinch = d;
        return;
      }

      if (this._drag && this._drag.id === e.pointerId) {
        const dx = e.clientX - this._drag.x;
        const dy = e.clientY - this._drag.y;
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
        this._drag.moved += Math.abs(dx) + Math.abs(dy);
        this.yaw -= dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.004, 0.06, 1.32);
      }

      // his eyes follow the pointer wherever it is — that is not a drag
      this.aimHog(e.clientX, e.clientY);
    });

    const end = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = 0;
      if (this._drag && this._drag.id === e.pointerId) {
        const quick = performance.now() - this._drag.t < 700;
        /* A tap is a call; a drag is not.  The threshold is generous because
         * a finger never holds still, and calling him somewhere you did not
         * mean is worse than missing a call. */
        if (this._drag.moved < 9 && quick) this.callAt(this._drag.x, this._drag.y);
        this._drag = null;
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', end);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.12), 0.55, 7);
    }, { passive: false });

    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pinchDistance() {
    const [a, b] = [...this._pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  ndcFrom(clientX, clientY, out = _ndc) {
    const r = this.canvas.getBoundingClientRect();
    out.x = ((clientX - r.left) / r.width) * 2 - 1;
    out.y = -((clientY - r.top) / r.height) * 2 + 1;
    return out;
  }

  /** Where on the ground is that pixel?  Returns flat (x, z) or null. */
  pick(clientX, clientY) {
    const targets = this.world?.pickables;
    if (!targets || !targets.length) return null;
    this.raycaster.setFromCamera(this.ndcFrom(clientX, clientY), this.camera);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    flatAt(hits[0].point, _flat);
    return { x: _flat.x, z: _flat.z, point: hits[0].point, object: hits[0].object };
  }

  callAt(clientX, clientY) {
    const spot = this.pick(clientX, clientY);
    if (!spot) return;
    this.onCall?.(spot.x, spot.z, spot);
  }

  /** Turn his features toward the pointer, in screen space, as v1 did. */
  aimHog(clientX, clientY) {
    const hog = this.hog;
    if (!hog) return;
    hog.eyePos(_tmp).project(this.camera);
    const n = this.ndcFrom(clientX, clientY);
    hog.lookAtScreen(clamp((n.x - _tmp.x) * 1.8, -1, 1));
  }

  /* -------------------------------- the rig -------------------------------- */

  update(dt) {
    const hog = this.hog;
    const b = basisAt(hog.x, hog.z, _up, _east, _north);

    // where he is, a little above his feet: the camera looks at his shoulders
    positionAt(hog.x, hog.y + this.height, hog.z, _target);

    // the orbit, built in his own tangent frame
    _fwd.set(0, 0, 0)
      .addScaledVector(_east, Math.cos(this.yaw))
      .addScaledVector(_north, Math.sin(this.yaw));

    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    _want.copy(_target)
      .addScaledVector(_fwd, -this.dist * cp)
      .addScaledVector(_up, this.dist * sp + 0.06);

    if (!this._seeded) {
      this.pos.copy(_want);
      this.look.copy(_target);
      this._seeded = true;
    } else {
      /* Lag, but not much, and faster in than out: a camera that catches up
       * slowly after a fast turn reads as drift, and drift on a curved
       * horizon reads as seasickness. */
      this.pos.copy(this.pos).lerp(_want, 1 - Math.exp(-9 * dt));
      this.look.lerp(_target, 1 - Math.exp(-13 * dt));
    }

    /* Never let the ground come between the camera and him.  On a planet
     * this small the surface curves up behind you fast, and a camera pushed
     * out to 3 m is already half buried. */
    flatAt(this.pos, _flat);
    const floor = this.world?.heightAt?.(_flat.x, _flat.z) ?? 0;
    if (_flat.y < floor + 0.18) {
      positionAt(_flat.x, floor + 0.18, _flat.z, this.pos);
    }

    this.camera.position.copy(this.pos);
    this.camera.up.copy(_up);
    this.camera.lookAt(this.look);
  }
}
