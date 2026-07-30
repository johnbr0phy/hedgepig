import * as THREE from 'three';
import { buildHog, HOG_LEN } from './model.js';
import { basisAt, positionAt, R } from '../world/planet.js';
import { heightAt, slopeAt, walkableAt } from '../world/terrain.js';
import { BAND, wrapDelta, CIRC } from '../world/plan.js';
import { clamp, lerp, damp, wrapAng, TAU } from '../core/util.js';

/* ------------------------------------------------------------------ *
 * The hedgepig, walking.
 *
 * The loop is v1's, unchanged, because it is the whole game: **tap and he
 * walks to that spot, in any direction, and stops there.**  With nobody
 * calling him he stands still and snuffles about indefinitely.  He is never
 * on rails.
 *
 * The four things v1 learned the hard way, all still load-bearing:
 *
 *  - **There is only ever one live target.**  A new call replaces the old
 *    one outright rather than queueing behind it.
 *  - **No forward clamp on his heading.**  He can turn round and walk back
 *    the way he came, and turning goes the short way round via `wrapAng` —
 *    without which he takes the long way to anything behind him.
 *  - **The gait eases in and out**, so he leans into a start and settles out
 *    of a stop, and the step is clamped to the distance remaining or the
 *    easing overshoots and he jitters on the spot.
 *  - **Anything that ranges off the camera is asking the wrong question.**
 *    In v1, hazards gathered from the visible band made him invincible the
 *    moment you scrolled away from him.  Everything here ranges off *him*.
 *
 * He lives in flat authoring coordinates like the rest of the world, and is
 * seated onto the planet every frame — he is built after the bake, so he
 * never goes through it.
 * ------------------------------------------------------------------ */

/** v1's HOG_SPD0, converted off its 220 px/m meter: 1.36 m/s. */
export const HOG_SPD = 1.36;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _rot = new THREE.Matrix4();
const _slope = { nx: 0, nz: 0 };

export class Hog {
  constructor(scene, world) {
    this.world = world;
    const parts = buildHog();
    this.parts = parts;
    this.root = parts.root;
    this.root.matrixAutoUpdate = false;
    scene.add(this.root);

    /* flat coordinates — x along the walk, z across the field */
    this.x = 3;
    this.z = 0;
    this.y = heightAt(this.x, this.z);
    this.hd = 0;                 // full-circle heading; 0 faces +x
    this.gait = 0;               // 0 standing, 1 walking
    this.speed = HOG_SPD;
    this.legSpeed = 1;

    /** The one live target, or null.  v1 called this the crumb. */
    this.target = null;
    this.arrived = true;

    this.stride = 0;
    this.bob = 0;
    this.lean = 0;
    this.roll = 0;
    this.curl = 0;               // 0 walking, 1 curled up after a hit
    this.hurt = 0;
    this.repel = 0;
    this.repelHd = 0;
    this.shiver = 0;
    this.afloat = null;          // set by the boat while he is aboard
    this.under = false;          // in the culvert: immune, and not drawn
    this.lookYaw = 0;
    this.lookYawTarget = 0;
    this.lookLock = 0;
    this.snuffle = 0;
    this.walked = 0;             // metres, for the HUD
    this.blocked = 0;            // how long he has been unable to move

    this._idleTimer = 2;
  }

  /** World position of his feet. */
  worldPos(out = new THREE.Vector3()) {
    return positionAt(this.x, this.y, this.z, out);
  }

  /** Where his eyes are, for the camera to look at. */
  eyePos(out = new THREE.Vector3()) {
    return positionAt(this.x, this.y + 0.12, this.z, out);
  }

  /**
   * Call him.  This is the whole interface: a place, and he goes there.
   * Replaces any previous call outright — one live target, always.
   */
  callTo(x, z) {
    this.target = { x, z };
    this.arrived = false;
    this.lookLock = 0;
  }

  stop() {
    this.target = null;
    this.arrived = true;
  }

  /** A thorn or a car. Curls him up, knocks him back, and sets him veering. */
  hit(fromX, fromZ) {
    if (this.curl > 0.2 || this.under) return false;
    this.curl = 1;
    this.hurt = 1.2;
    this.stop();
    const dx = wrapDelta(this.x, fromX);
    const dz = this.z - fromZ;
    const away = Math.atan2(dz, dx);
    this.repelHd = away;
    this.repel = 1.3;
    // a shove backwards, so the hit reads as contact and not as a state change
    this.x += Math.cos(away) * 0.10;
    this.z += Math.sin(away) * 0.10;
    return true;
  }

  /** Aim his features at a point on screen — a damped yaw, since he has no neck. */
  lookAtScreen(dxNorm) {
    // his neck stops at 1.35 rad; his eyes do not
    this.lookYawTarget = clamp(dxNorm * 1.6, -1.35, 1.35);
    this.lookLock = 1.4;
  }

  /* ------------------------------- the walk ------------------------------- */

  update(dt, now) {
    const p = this.parts;

    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt);
    if (this.repel > 0) this.repel = Math.max(0, this.repel - dt);
    this.curl = damp(this.curl, this.hurt > 0 ? 1 : 0, this.hurt > 0 ? 18 : 6, dt);

    let want = 0;              // desired gait this frame

    if (this.afloat) {
      // the boat has him; it drives his position and heading
      this.gait = damp(this.gait, 0, 8, dt);
    } else if (this.target && this.hurt <= 0) {
      const dx = wrapDelta(this.target.x, this.x);
      const dz = this.target.z - this.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.05) {
        this.arrive();
      } else {
        want = 1;
        let aim = Math.atan2(dz, dx);
        // after a hit he veers off rather than walking straight back into it
        if (this.repel > 0) aim = lerp(aim, this.repelHd, clamp(this.repel / 1.3, 0, 1) * 0.8);

        const turn = wrapAng(aim - this.hd);
        const rate = (3.2 - this.shiver * 1.4) * (0.35 + 0.65 * this.gait);
        this.hd = wrapAng(this.hd + clamp(turn, -rate * dt, rate * dt));

        // he sets off in roughly the right direction before committing to speed
        const facing = clamp(1 - Math.abs(turn) / 1.9, 0.15, 1);
        this.gait = damp(this.gait, want * facing, 3.4, dt);

        /* Clamp the step to what is left, or the easing overshoots the
         * target and he jitters on the spot for as long as you watch him. */
        const step = Math.min(this.speed * this.gait * dt, dist);
        this.tryMove(Math.cos(this.hd) * step, Math.sin(this.hd) * step, dt);
      }
    } else {
      this.gait = damp(this.gait, 0, 5, dt);
      this.idle(dt);
    }

    this.y = heightAt(this.x, this.z);
    this.stride += this.gait * this.speed * dt * 7.2;
    this.walked += this.gait * this.speed * dt;

    this.animate(dt, now);
    this.seat();
  }

  arrive() {
    this.target = null;
    this.arrived = true;
    // he stops, and then he snuffles about where he was called to
    this._idleTimer = 0.6;
  }

  /**
   * Move, or refuse to.  Water, the far edge of the field and anything the
   * game has blocked (the tarmac, until he has found the culvert) all stop
   * him rather than being survived — v1's rule that a full-width hazard has
   * to have a way through it, not a way to die in it.
   */
  tryMove(dx, dz, dt) {
    const nx = this.x + dx;
    const nz = clamp(this.z + dz, -BAND, BAND);
    const ok = this.canStand(nx, nz);
    if (ok) {
      this.x = nx;
      this.z = nz;
      this.blocked = 0;
      return true;
    }
    // slide along whichever axis is still free, so a wall does not trap him
    if (this.canStand(nx, this.z)) { this.x = nx; this.blocked = 0; return true; }
    if (this.canStand(this.x, nz)) { this.z = nz; this.blocked = 0; return true; }
    this.blocked += dt;
    // he gives up on a target he cannot reach rather than pressing into it
    if (this.blocked > 1.1) { this.stop(); this.blocked = 0; }
    return false;
  }

  canStand(x, z) {
    if (this.under) return true;
    if (!walkableAt(x, z)) return false;
    return !this.world?.blockedAt?.(x, z);
  }

  /** Standing still is not standing still: he snuffles, and looks about. */
  idle(dt) {
    this._idleTimer -= dt;
    this.snuffle = damp(this.snuffle, 1, 2, dt);
    if (this._idleTimer <= 0) {
      this._idleTimer = 1.6 + Math.random() * 3.2;
      if (this.lookLock <= 0) {
        // a small glance, never a turn: turning is for being called
        this.hd = wrapAng(this.hd + (Math.random() - 0.5) * 1.1);
      }
    }
  }

  /* ----------------------------- the animation ----------------------------- */

  animate(dt, now) {
    const p = this.parts;
    const g = this.gait;

    if (this.lookLock > 0) this.lookLock -= dt;
    else this.lookYawTarget = damp(this.lookYawTarget, 0, 1.2, dt);
    this.lookYaw = damp(this.lookYaw, this.lookYawTarget, 6, dt);
    p.face.rotation.y = this.lookYaw * (1 - this.curl);

    // a snuffling dip of the whole front while he stands
    const sn = Math.sin(now * 5.2) * 0.5 + Math.sin(now * 2.1) * 0.5;
    p.face.rotation.z = lerp(sn * 0.05 * this.snuffle, Math.sin(this.stride) * 0.03, g);
    p.snout.position.y = -0.012 + Math.sin(now * 9) * 0.0016 * (1 - g * 0.5);

    // bob and roll: two out-of-phase sines, the roll at half the bob's rate
    this.bob = Math.abs(Math.sin(this.stride)) * 0.014 * g;
    this.roll = Math.sin(this.stride * 0.5) * 0.07 * g;
    this.lean = damp(this.lean, g * 0.10, 5, dt);

    for (const leg of p.legs) {
      const ph = this.stride + leg.userData.phase;
      const swing = Math.sin(ph) * 0.55 * g;
      const lift = Math.max(0, Math.sin(ph)) * 0.016 * g;
      leg.rotation.z = swing;
      leg.position.y = leg.userData.y ?? (leg.userData.y = leg.position.y);
      leg.position.y += lift;
      leg.visible = this.curl < 0.6;
    }

    // curling: he tucks his front under and the coat closes over it
    const c = this.curl;
    p.face.visible = c < 0.75;
    p.body.scale.setScalar(1 + c * 0.10);
    p.body.position.y = 0.083 + c * 0.012;
    for (const coat of p.coats) coat.scale.setScalar(1 + c * 0.16);

    // shivering, from `season.js` by way of the world
    if (this.shiver > 0.01) {
      p.body.position.x = Math.sin(now * 34) * 0.0016 * this.shiver;
    }

    p.shadow.scale.setScalar(1 - c * 0.12);
  }

  /**
   * Seat him on the planet.  Everything above works in flat coordinates; this
   * is the only place that knows the ground is round.
   */
  seat() {
    const b = basisAt(this.x, this.z);
    _m.makeBasis(b.east, b.up, b.north);
    _m.setPosition(positionAt(this.x, this.y + this.bob, this.z, _v));

    slopeAt(this.x, this.z, _slope);
    // heading, then the slope under him, then his lean and roll
    _rot.makeRotationY(-this.hd);
    _m.multiply(_rot);
    _rot.makeRotationZ(
      -Math.atan(_slope.nx * Math.cos(this.hd) + _slope.nz * Math.sin(this.hd)) - this.lean * 0.25
    );
    _m.multiply(_rot);
    _rot.makeRotationX(this.roll);
    _m.multiply(_rot);

    this.root.matrix.copy(_m);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.visible = !this.under;
  }
}
