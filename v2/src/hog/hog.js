import * as THREE from 'three';
import { buildHog, HOG_LEN } from './model.js';
import { createAnimator } from './anim.js';
import { basisAt, positionAt } from '../world/planet.js';
import { heightAt, slopeAt, walkableAt } from '../world/terrain.js';
import { R, distance, bearing, dirAt, flatOf } from '../world/plan.js';
import { clamp, lerp, damp, wrapAng, rngKit, TAU } from '../core/util.js';

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

/**
 * How fast he goes.
 *
 * v1's `HOG_SPD0` was 300 px/s, which off its 220 px/m distance meter is
 * 1.36 m/s.  But v1's handover also records that the meter and the *visual*
 * scale of that world disagreed by more than two to one — "the visual scale
 * implied by the grass is closer to 500 px/m... these disagree and it doesn't
 * matter".  Against the scale you could actually see, he was doing 0.6 m/s.
 *
 * It matters here, because a real gait has a cadence: at 1.36 m/s a 26 cm
 * animal with a 13 cm stride takes ten and a half strides a second, which is
 * five frames a cycle and reads as a strobe however correct it is.  0.85 m/s
 * is six and a half — a brisk scurry you can actually see the legs in — and
 * it is much closer to what v1 looked like than v1's own number was.
 */
export const HOG_SPD = 0.85;

/**
 * The radius of the ball he curls into — his own half-width, because that is
 * what a hedgehog curls to.  Everything about the roll is derived from it.
 */
export const BALL_R = 0.088;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _rot = new THREE.Matrix4();
const _slope = { nx: 0, nz: 0 };
const _pole = new THREE.Vector3();
const _sm = new THREE.Matrix4();
const _srot = new THREE.Matrix4();

export class Hog {
  /**
   * `model: false` gives a hedgepig with no geometry — the walk, the gait,
   * the heading and the collision, and nothing to draw.  That is what the
   * smoke harness runs, so the thing under test is this class rather than a
   * copy of its arithmetic living in the test.
   */
  constructor(world, { scene = null, model = true, seed = 8821 } = {}) {
    this.world = world;
    const parts = model ? buildHog() : null;
    this.parts = parts;
    this.root = parts ? parts.root : null;
    if (this.root) {
      this.root.matrixAutoUpdate = false;
      scene?.add(this.root);
      // the shadow belongs to the ground, not to him — see `model.js`
      if (parts.shadow) scene?.add(parts.shadow);
    }

    /* flat coordinates — x along the walk, z across the field */
    this.x = 3;
    this.z = 0;
    this.y = heightAt(this.x, this.z);
    this.hd = 0;                 // full-circle heading; 0 faces +x
    this.gait = 0;               // 0 standing, 1 walking
    this.speed = HOG_SPD;
    this.legSpeed = 1;
    this.turning = 0;            // rad/s of heading actually applied, smoothed

    /** The one live target, or null.  v1 called this the crumb. */
    this.target = null;
    this.arrived = true;

    /* Rolling: tucked into a ball and going twice as fast.  `ball` is how
     * far into the tuck he is, `spin` is how far the ball has turned. */
    this.rolling = false;
    this.ball = 0;
    this.spin = 0;

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
    this.celebrate = 0;          // seconds of arrival wiggle left
    this.balk = 0;               // seconds of water's-edge refusal left
    this.carry = 0;              // seconds left carrying his leaf
    this.shake = 0;              // seconds of shake-off left (rain, the boat)
    this.night = 0;              // fed by the clock, for the doze
    this._aimTurn = 0;           // how much turning is left, for the glance
    this._wasAfloat = false;
    this.walked = 0;             // metres, for the HUD
    this.blocked = 0;            // how long he has been unable to move

    this._idleTimer = 2;
    this._glanceTo = 0;          // where the idle glance is easing his heading
    /* His own seeded stream, not `Math.random`.  Everything else in this
     * world is deterministic on purpose — v1's meadow is the same meadow on
     * every load — and his idle glancing was the one thing that was not,
     * which made the harness flaky in a way that looked like a real bug
     * three runs out of four. */
    this.rng = rngKit(seed);
    this.anim = parts ? createAnimator(parts, seed) : null;
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
  callTo(x, z, roll = false, balkOnArrive = false) {
    this.target = { x, z };
    this.arrived = false;
    this.lookLock = 0;
    this._balkOnArrive = balkOnArrive;
    if (roll) this.rolling = true;
  }

  stop() {
    this.target = null;
    this.arrived = true;
    this.rolling = false;
  }

  /** A thorn or a car. Curls him up, knocks him back, and sends him off it. */
  hit(fromX, fromZ) {
    if (this.curl > 0.2 || this.under) return false;
    this.curl = 1;
    this.hurt = 1.2;
    const away = bearing(fromX, fromZ, this.x, this.z).angle;
    const cs = Math.max(0.08, Math.cos(this.z / R));
    this.repelHd = away;
    this.repel = 1.3;
    // a shove backwards, so the hit reads as contact and not a state change
    this.x += (Math.cos(away) * 0.10) / cs;
    this.z += Math.sin(away) * 0.10;

    /* **He backs off, rather than simply stopping.**  Stopping cancels the
     * call, which is right — being hurt should cost you the errand — but it
     * left him standing *inside* the bramble that had just bitten him, and
     * the next thing that happened was that it bit him again, and again,
     * every time the invulnerability ran out.  Three hearts gone without
     * moving.  v1 never saw this because there, `repel` steered him while he
     * kept walking; here it only steers toward a target, and he had none.
     * So the hit gives him one: a metre, directly away. */
    this.target = {
      x: this.x + Math.cos(away) / cs,
      z: this.z + Math.sin(away),
    };
    this.arrived = false;
    return true;
  }

  /** Aim his features at a point on screen — a damped yaw, since he has no neck. */
  lookAtScreen(dxNorm) {
    /* v1's neck stopped at 1.35 rad, but that was a *head* being aimed, with
     * visibility ramps fading each feature as it turned away.  He has no
     * head and no ramps: what moves is the features sliding across his
     * front, and past about half a radian his nose is on his cheek however
     * correctly it is placed.  A glance, not a turn. */
    this.lookYawTarget = clamp(dxNorm * 0.62, -0.5, 0.5);
    this.lookLock = 1.4;
  }

  /* ------------------------------- the walk ------------------------------- */

  update(dt, now) {
    const p = this.parts;

    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt);
    if (this.repel > 0) this.repel = Math.max(0, this.repel - dt);
    if (this.celebrate > 0) this.celebrate = Math.max(0, this.celebrate - dt);
    if (this.balk > 0) this.balk = Math.max(0, this.balk - dt);
    if (this.carry > 0) this.carry = Math.max(0, this.carry - dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    // stepping off the boat earns a shake, like any wet dog would
    if (this._wasAfloat && !this.afloat) this.shake = Math.max(this.shake, 1.0);
    this._wasAfloat = !!this.afloat;
    this.curl = damp(this.curl, this.hurt > 0 ? 1 : 0, this.hurt > 0 ? 18 : 6, dt);

    let want = 0;              // desired gait this frame

    if (this.afloat) {
      // the boat has him; it drives his position and heading
      this.gait = damp(this.gait, 0, 8, dt);
      this.roll = damp(this.roll, 0, 8, dt);
      this.turning = damp(this.turning, 0, 10, dt);
    } else if (this.target && this.hurt <= 0) {
      /* **Great-circle, not flat.**  With content spread over the whole
       * planet, `hypot(Δx, Δz)` is wrong by a factor of `cos(latitude)` in
       * x — at the top of the world it says he is a hundred metres from
       * something he is standing next to.  Distance and bearing both come
       * off the sphere now. */
      const dist = distance(this.x, this.z, this.target.x, this.target.z);

      if (dist < 0.05) {
        this.arrive();
      } else {
        want = 1;
        let aim = bearing(this.x, this.z, this.target.x, this.target.z).angle;
        // after a hit he veers off rather than walking straight back into it
        if (this.repel > 0) aim = lerp(aim, this.repelHd, clamp(this.repel / 1.3, 0, 1) * 0.8);

        const turn = wrapAng(aim - this.hd);
        /* **Rolling costs him his steering.**  Twice the speed for less than
         * half the turn rate, so the double tap is a decision — commit to a
         * line and take it — rather than a free speed button.  A ball with
         * the agility of a walk would make walking pointless.
         *
         * The standing floor is high: at v1's 3.2 × 0.35 an about-face was
         * two and a half seconds of creeping round on the spot before the
         * walk was allowed to start, which read as him refusing to come. */
        const rate = (4.6 - this.shiver * 1.8) * (0.55 + 0.45 * this.gait)
          * (1 - 0.58 * this.ball);
        const tStep = clamp(turn, -rate * dt, rate * dt);
        this.hd = wrapAng(this.hd + tStep);
        this.turning = damp(this.turning, tStep / Math.max(dt, 1e-6), 10, dt);
        this._glanceTo = this.hd;     // a walk spends any idle glance
        this._aimTurn = turn;         // and his eyes lead his feet round it

        /* He banks into the turn — inside shoulder down, eased both ways.
         * The amount tracks how much turning is left, so it fades to level
         * on its own as he comes round onto his line. */
        this.roll = damp(this.roll, clamp(turn * 0.4, -0.2, 0.2) * this.gait * (1 - this.ball), 5, dt);

        // he sets off in roughly the right direction before committing to speed
        const facing = clamp(1 - Math.abs(turn) / 1.9, 0.15, 1);
        this.gait = damp(this.gait, want * facing, 3.4, dt);

        /* Clamp the step to what is left, or the easing overshoots the
         * target and he jitters on the spot for as long as you watch him.
         * Rain hurries him — a hedgehog in the wet has somewhere to be. */
        const hurry = 1 + (this.rainHurry || 0);
        const step = Math.min(this.speed * hurry * this.rollSpeed() * this.gait * dt, dist);
        this.tryStep(step, dt);
      }
    } else {
      this.gait = damp(this.gait, 0, 5, dt);
      this.roll = damp(this.roll, 0, 5, dt);
      this._aimTurn = damp(this._aimTurn, 0, 6, dt);
      this.idle(dt);
    }

    /* The tuck.  It eases rather than snapping, so you see him gather
     * himself — and it eases back out when he arrives, which is most of what
     * makes the arrival read as a stop rather than a freeze. */
    this.ball = damp(this.ball, this.rolling && this.hurt <= 0 ? 1 : 0, 7, dt);

    const before = { x: this.x, z: this.z };
    this.y = heightAt(this.x, this.z);
    const ground = this.gait * this.speed * (1 + (this.rainHurry || 0)) * this.rollSpeed() * dt;
    this.stride += ground * 7.2 / this.speed;
    this.walked += ground;

    /* **The ball does not skid.**  Its spin is the ground it has covered
     * divided by its own radius, which is the same rule that keeps his feet
     * from sliding when he walks — and it is just as visible when it is
     * wrong: a ball turning at any other rate reads as a beachball being
     * dragged.  Scaled by the tuck, so a half-formed ball is not already
     * tumbling head over heels with his face still out. */
    this.spin += (ground / BALL_R) * this.ball;

    /* **And it does not unwind.**  The applied roll used to be `spin × ball`,
     * so easing out of the tuck swept the angle back through every turn the
     * roll had accumulated — a six-metre roll is ten revolutions, replayed
     * backwards in the half second of standing up, which was the whole of
     * "unfurls really weirdly".  Once he is no longer rolling, the spin
     * settles to the nearest whole turn instead: half a revolution of motion
     * at the very most, and a whole turn is the right way up. */
    if (!this.rolling) {
      this.spin = damp(this.spin, Math.round(this.spin / TAU) * TAU, 12, dt);
    }

    this.animate(dt, now);
    this.seat();
  }

  /** Twice the speed, once he is properly tucked. */
  rollSpeed() { return 1 + this.ball; }

  arrive() {
    this.target = null;
    this.arrived = true;
    this.rolling = false;
    // he stops, and then he snuffles about where he was called to
    this._idleTimer = 0.6;
    /* Getting there is worth a wiggle.  The flower was sown for him; an
     * arrival that looks exactly like running out of road reads as a
     * machine reaching a coordinate.  Unless it is the water's edge and
     * the errand was refused — that gets the balk instead: a head-shake
     * and a paw at the wet, which is a hedgehog saying no. */
    if (this._balkOnArrive) {
      this.balk = 1.4;
      this.onGrumble?.();
      this._balkOnArrive = false;
    } else {
      this.celebrate = 1.1;
      this.onPleased?.();
    }
  }

  /**
   * Take one step along his heading, or refuse to.
   *
   * `step` is metres **of ground**, so the longitude it costs depends on how
   * far north he is: a metre of longitude at 60° is half a metre of walking.
   * Without that division he speeds up as he goes north and crawls at the
   * equator, and on a world with no edges he will visit both.
   *
   * Water and anything the game has blocked stop him rather than being
   * survived — v1's rule that a hazard has to have a way through it, not a
   * way to die in it.
   */
  tryStep(step, dt) {
    const cs = Math.max(0.08, Math.cos(this.z / R));
    const dx = (Math.cos(this.hd) * step) / cs;
    const dz = Math.sin(this.hd) * step;
    let nx = this.x + dx;
    let nz = this.z + dz;

    /* **Over the top.**  Integrated in flat coordinates, a walk due north
     * runs `z` straight past the pole at 75 m and into numbers that no
     * longer mean anything — the harness caught him 122 m from the equator
     * on a planet whose poles are at 75.  Pushing the step back through the
     * sphere puts him where he actually is, and crossing a pole flips his
     * heading by π because east and north have both reversed under him. */
    if (Math.abs(nz) > R * Math.PI / 2) {
      const f = flatOf(dirAt(nx, nz, _pole));
      nx = f.x; nz = f.z;
      this.hd = wrapAng(this.hd + Math.PI);
    }

    if (this.canStand(nx, nz)) { this.x = nx; this.z = nz; this.blocked = 0; return true; }
    // slide along whichever axis is still free, so a wall does not trap him
    if (this.canStand(nx, this.z)) { this.x = nx; this.blocked = 0; return true; }
    if (this.canStand(this.x, nz)) { this.z = nz; this.blocked = 0; return true; }
    this.blocked += dt;
    // he gives up on a target he cannot reach rather than pressing into it
    // giving up on somewhere he cannot reach is worth a small complaint
    if (this.blocked > 1.1) { this.stop(); this.blocked = 0; this.onGrumble?.(); }
    return false;
  }

  canStand(x, z) {
    if (this.under) return true;
    if (!walkableAt(x, z)) return false;
    // where he is going, *from where he is* — see `world.blockedAt`
    return !this.world?.blockedAt?.(x, z, this.x, this.z);
  }

  /** Standing still is not standing still: he snuffles, and looks about. */
  idle(dt) {
    this._idleTimer -= dt;
    this.snuffle = damp(this.snuffle, 1, 2, dt);
    if (this._idleTimer <= 0) {
      this._idleTimer = this.rng.range(1.6, 4.8);
      if (this.lookLock <= 0) {
        // a small glance, never a turn: turning is for being called
        this._glanceTo = wrapAng(this.hd + this.rng.range(-0.55, 0.55));
      }
    }
    /* **Eased, never snapped.**  Assigned directly, the glance teleported
     * his whole heading in one frame — a quarter-turn flick with nothing in
     * between, which read as a glitch every few seconds for as long as you
     * watched him stand there.  The feet report the turn so they shuffle
     * round with it, rather than the statue rotating under a still animal. */
    const t = wrapAng(this._glanceTo - this.hd);
    const step = clamp(t, -1.4 * dt, 1.4 * dt);
    this.hd = wrapAng(this.hd + step);
    this.turning = damp(this.turning, step / Math.max(dt, 1e-6), 10, dt);
  }

  /* ----------------------------- the animation ----------------------------- */

  /**
   * Everything about *how he looks while doing it* lives in `anim.js`.  What
   * stays here is the one piece that is behaviour rather than animation: how
   * far his features have swung toward whatever he is looking at.
   */
  animate(dt, now) {
    if (this.lookLock > 0) this.lookLock -= dt;
    else {
      /* His eyes lead his feet: walking, the features swing toward where
       * the turn is going, which is what any animal's face does through a
       * corner.  A player's drag (lookLock) still outranks it. */
      const lead = clamp(this._aimTurn * 0.55, -0.5, 0.5) * this.gait;
      this.lookYawTarget = damp(this.lookYawTarget, lead, 3, dt);
    }
    this.lookYaw = damp(this.lookYaw, this.lookYawTarget, 6, dt);

    this.anim?.update(this, dt, now);
  }

  /**
   * Seat him on the planet.  Everything above works in flat coordinates; this
   * is the only place that knows the ground is round.
   */
  seat() {
    if (!this.root) return;               // headless: nothing to seat
    const b = basisAt(this.x, this.z);
    _m.makeBasis(b.east, b.up, b.north);
    _m.setPosition(positionAt(this.x, this.y + this.bob, this.z, _v));

    slopeAt(this.x, this.z, _slope);
    // heading, then the slope under him, then his lean and roll
    _rot.makeRotationY(-this.hd);
    _m.multiply(_rot);

    /* Rolling turns him about the middle of the ball, not about his feet —
     * hence the lift up to the centre, the spin, and the drop back.  Rotating
     * about the origin would swing him round his own toes like a hammer. */
    if (this.ball > 0.001) {
      _rot.makeTranslation(0, BALL_R * this.ball, 0);
      _m.multiply(_rot);
      _rot.makeRotationZ(-this.spin);
      _m.multiply(_rot);
      _rot.makeTranslation(0, -BALL_R * this.ball, 0);
      _m.multiply(_rot);
    }
    _rot.makeRotationZ(
      -Math.atan(_slope.nx * Math.cos(this.hd) + _slope.nz * Math.sin(this.hd)) - this.lean * 0.25
    );
    _m.multiply(_rot);
    _rot.makeRotationX(this.roll);
    _m.multiply(_rot);

    this.root.matrix.copy(_m);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.visible = !this.under;

    /* The shadow, seated on its own: the tangent frame and his heading, and
     * none of the spin, lean or roll.  It stays lying on the ground however
     * he is tumbling above it. */
    const sh = this.parts.shadow;
    if (sh) {
      _sm.makeBasis(b.east, b.up, b.north);
      _sm.setPosition(positionAt(this.x, this.y + 0.006, this.z, _v));
      _srot.makeRotationY(-this.hd);
      _sm.multiply(_srot);
      sh.matrix.copy(_sm);
      sh.matrixWorldNeedsUpdate = true;
      sh.visible = !this.under;
    }
  }
}
