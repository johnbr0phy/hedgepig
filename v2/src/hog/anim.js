import * as THREE from 'three';
import { clamp, lerp, damp, mulberry32, TAU } from '../core/util.js';
import { BALL_R } from './hog.js';
import { HOG_BODY } from './model.js';
import { PAL } from '../core/palette.js';

/* ------------------------------------------------------------------ *
 * How he moves.
 *
 * The first version swung four cylinders on a sine and bobbed the body, and
 * it read as a loaf sliding along with something happening underneath it.
 * Three things were wrong with it and only one of them was the amplitudes:
 *
 *  1. **The feet skated.**  The cycle ran on a timer, so the ground went by
 *     at one speed and the feet went by at another.  Nothing else you do to
 *     a walk matters while that is true — it is the single cue that says
 *     "this is a puppet".  The cycle is driven by **distance travelled**
 *     now, and during stance a foot is *pinned*: it moves backward relative
 *     to him at exactly the speed he is going forward, which is what a foot
 *     on the ground does.
 *  2. **There was no gait.**  Four legs in two sines is not a walk.  He runs
 *     a **diagonal couplet** — front-left with hind-right, front-right with
 *     hind-left — which is what a small mammal in a hurry actually does, and
 *     it gives the body a natural roll for free because the support diagonal
 *     swaps under him.
 *  3. **The body did not answer the legs.**  A body bob at the same
 *     frequency as the stride is a bounce; at *twice* the stride it is a
 *     footfall, because both couplets land in one cycle.
 *
 * He is 26 cm long and does 1.36 m/s, which is five body lengths a second —
 * a real hedgehog at that speed is a scurry with the legs a blur, and the
 * honest thing is to let it be one.  What sells it is the body: the roll,
 * the dip, and the way it settles when he stops.
 * ------------------------------------------------------------------ */

/** Metres of ground per complete cycle. Two footfalls per cycle. */
const STRIDE = 0.13;
/** The fraction of the cycle a foot spends on the ground. */
const STANCE = 0.62;
/**
 * How far a foot travels fore-and-aft — **derived, not chosen**.
 *
 * A planted foot goes backwards relative to him at exactly the speed he goes
 * forwards, so over a stance phase it must travel `STRIDE × STANCE` and not
 * one millimetre else.  Pick the reach independently and the difference is
 * skate, which is the single cue that says "puppet" and which no amount of
 * tuning the amplitudes will hide.
 */
const REACH = STRIDE * STANCE;
/** How high a foot lifts in swing. */
const LIFT = 0.022;

const _dir = new THREE.Vector3();
const _from = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _skinCream = new THREE.Color(PAL.hogCream);
const _skinQuill = new THREE.Color(PAL.hogQuill);

export { STRIDE, STANCE, REACH };

export function createAnimator(parts, seed = 4242) {
  const rng = mulberry32(seed);

  /* Diagonal couplets: front-left and hind-right share a phase, front-right
   * and hind-left share the other.  `parts.legs` came out of the model in
   * (front/back × left/right) order; each one knows its own hip. */
  const legs = parts.legs.map((leg) => {
    const front = leg.position.x > 0;
    const left = leg.position.z > 0;
    return {
      obj: leg,
      hip: leg.position.clone(),
      shin: leg.children[0],
      // the couplet: same phase on opposite corners
      phase: (front === left) ? 0 : 0.5,
      rest: leg.position.clone(),
    };
  });

  const face = {
    blink: 0,
    blinkIn: 1.6,
    sniff: 0,
    sniffIn: 0.8,
    earFlick: 0,
    earIn: 3,
    nuzzle: 0,        // seconds left with his nose down in the grass
    nuzzleIn: 2.0,
    nuzzleAmt: 0,     // eased, so the dip is a movement and not a state
    doze: 0,          // eased sleepiness, deep night only
    yawn: 0,
    yawnIn: 24,
    scratch: 0,
    scratchIn: 16,
    prevCele: 0,
  };

  const state = { cycle: 0, bob: 0, roll: 0, pitch: 0, sway: 0 };

  /**
   * @param s  the hedgepig: gait, speed, curl, shiver, lookYaw, walked
   * @param dt seconds
   * @param now seconds since the world began, for things on their own clock
   */
  function update(s, dt, now) {
    /* "Moving" is gait OR turning: a hedgehog turning on the spot is still
     * *stepping* round, and with the legs keyed to gait alone he pivoted
     * like a statue on a turntable — which is most of what made turning
     * read as weird.  Capped below a full stride so a pivot stays a shuffle. */
    const moving = Math.max(s.gait, Math.min(0.6, Math.abs(s.turning || 0) * 0.5));
    /* Curled is curled: being hurt and being rolled use the same tuck, so
     * nothing has to decide between them.  `ball` is voluntary, `curl` is
     * not, and the visuals do not care which. */
    const ball = Math.max(s.curl || 0, s.ball || 0);

    /* The tuck, computed once and used by everything below.  He is 26 cm
     * long and 17.6 cm wide, so curling has to squash his length and swell
     * his height until he is a sphere of `BALL_R` — an ellipsoid rolling end
     * over end is funny exactly once. */
    const { A, B, C, BODY_Y } = HOG_BODY;
    /* Squash-and-stretch on the tuck's doorstep: gathering himself to roll
     * he crouches long and low, and coming out of the ball he pops a hair
     * tall before settling — the two cheapest frames of anticipation and
     * follow-through there are.  Both live in the transition band and are
     * exactly zero at its ends, so the ball tests never see them. */
    const trans = Math.sin(clamp(ball / 0.3, 0, 1) * Math.PI) * (ball < 0.3 ? 1 : 0);
    const gather = (s.rolling ? 0.05 : -0.06) * trans;
    const bx = lerp(1, BALL_R / A, ball) * (1 + gather);
    const by = lerp(1, BALL_R / B, ball) * (1 - gather * 1.4);
    const bz = lerp(1, BALL_R / C, ball);
    const lift = ball * (BALL_R - BODY_Y);
    /* Everything that is not the ball **shrinks into it** rather than
     * blinking out.  A `visible = false` at a threshold is a pop, and a pop
     * mid-roll reads as a glitch however brief it is. */
    const tuck = Math.max(0.0001, 1 - ball * 1.25);

    /* ---------------------------- the cycle ---------------------------- *
     * Advanced by **ground covered**, never by time.  This one line is why
     * the feet do not skate.  Turning covers ground too: a foot out on the
     * track width sweeps `rate × half-track` metres through a pivot, and
     * feeding that in is what turns the turntable into an animal stepping
     * itself round. */
    const ground = (s.speed * s.gait + Math.abs(s.turning || 0) * 0.055) * dt * (1 - ball);
    state.cycle = (state.cycle + ground / STRIDE) % 1;

    /* ------------------------- the small occasions ----------------------- *
     * Arrival wiggle, the shake-off, the doze, the yawn and the scratch.
     * Each is an envelope in [0,1]; everything below just reads them. */
    const cele = clamp(s.celebrate || 0, 0, 1);
    if ((s.celebrate || 0) > face.prevCele + 0.4) {
      // the moment of arrival: nose straight down to what was sown
      face.sniff = 1;
      face.sniffIn = 0;
      face.earFlick = 1;
      face.nuzzle = Math.max(face.nuzzle, 0.9);
      face.nuzzleIn = 0.4;
    }
    face.prevCele = s.celebrate || 0;
    const shake = Math.sin(clamp(s.shake || 0, 0, 1) * Math.PI);

    /* Sleep comes slowly, deep at night, standing still — and goes at once. */
    const still = moving < 0.05 && ball < 0.1;
    face.doze = still && (s.night || 0) > 0.85
      ? Math.min(1, face.doze + dt / 6)
      : Math.max(0, face.doze - dt * 2.5);
    const doze = face.doze;

    /* A yawn: on the slide into sleep, and now and then just standing about. */
    face.yawnIn -= dt * (doze > 0.2 ? 3 : 1);
    if (face.yawnIn <= 0 && still && face.yawn <= 0) {
      face.yawn = 1;
      face.yawnIn = 24 + rng() * 36;
    }
    if (face.yawn > 0) face.yawn = Math.max(0, face.yawn - dt / 1.3);
    const yawn = Math.sin(clamp(face.yawn, 0, 1) * Math.PI);

    /* And the scratch: hind leg up behind the ear, strictly an idle habit —
     * and never mid-nuzzle, because a nose in the grass and a foot at the
     * ear is two idle animations wearing one hedgehog. */
    face.scratchIn -= dt;
    if (face.scratchIn <= 0 && still && doze < 0.3 && face.scratch <= 0 && face.nuzzleAmt < 0.2) {
      face.scratch = 1;
      face.scratchIn = 18 + rng() * 26;
      face.nuzzleIn = Math.max(face.nuzzleIn, 1.6);   // and hold the nose off it
    }
    if (face.scratch > 0) face.scratch = Math.max(0, face.scratch - dt / 1.2);
    const scratch = Math.sin(clamp(face.scratch, 0, 1) * Math.PI);

    /* ------------------------------ the legs ---------------------------- */
    for (const L of legs) {
      const p = (state.cycle + L.phase) % 1;

      /* Stance for the first 62 % of the cycle, swing for the rest.  With
       * two couplets a beat apart, that overlap is what keeps at least two
       * feet down at all times — a hedgehog does not have a suspension
       * phase, and giving him one makes him a deer. */
      let fore, lift;
      if (p < STANCE) {
        const t = p / STANCE;
        fore = lerp(REACH / 2, -REACH / 2, t);   // pinned: sliding back under him
        lift = 0;
      } else {
        const t = (p - STANCE) / (1 - STANCE);
        fore = lerp(-REACH / 2, REACH / 2, t * t * (3 - 2 * t));
        lift = Math.sin(t * Math.PI) * LIFT;
      }
      fore *= moving;
      lift *= moving;

      /* Aim the leg at where its foot should be.  The hip stays put and the
       * limb points at the target, which is all the articulation a 6 cm leg
       * needs and is stable in a way two-bone IK is not at this scale. */
      L.fore = fore;
      L.lift = lift;
      const down = p < STANCE;
      /* The frame a foot plants is reported outward — that is what a
       * footstep *is*, and the audio runs off this edge rather than any
       * timer that could drift against the legs. */
      if (down && !L.wasDown && moving > 0.25 && ball < 0.5) s.onFootfall?.();
      L.wasDown = down;
      L.stance = down;

      _dir.set(fore, -(L.hip.y - lift), 0).normalize();
      _q.setFromUnitVectors(_from, _dir);
      L.obj.quaternion.copy(_q);
      L.obj.position.copy(L.rest);
      L.obj.position.y = L.rest.y + lift * 0.6;
      L.obj.scale.setScalar(tuck);
      L.obj.visible = tuck > 0.02;
    }

    /* The scratch takes over one hind leg after the walk has posed it: up,
     * out, and working fast behind his ear, while the body tips away. */
    if (scratch > 0.01) {
      const L = legs[2];                       // hind-left
      _dir.set(0.35, -0.25, 0.85 + Math.sin(now * 30) * 0.30).normalize();
      _q.setFromUnitVectors(_from, _dir);
      L.obj.quaternion.copy(_q);
      L.obj.position.y = L.rest.y + 0.012 * scratch;
    }

    /* ------------------------------ the body ---------------------------- *
     * Twice the stride, because both couplets land in one cycle; the roll is
     * once, because the supporting diagonal swaps once. */
    /* **Damped away as he tucks.**  A ball that is also bobbing, rolling and
     * swaying is a ball with something loose inside it, and that jitter was
     * most of what "goes super weird" meant.  A rolling hedgehog has exactly
     * one motion, and `seat` owns it. */
    const walkish = moving * (1 - ball);
    const beat = state.cycle * TAU;
    state.bob = Math.sin(beat * 2 + Math.PI / 2) * 0.006 * walkish;
    state.roll = Math.sin(beat) * 0.085 * walkish;
    state.pitch = -Math.sin(beat * 2) * 0.035 * walkish - 0.06 * walkish;
    state.sway = Math.sin(beat) * 0.010 * walkish;

    // he settles a little lower the faster he goes: a scurry is a crouch
    const crouch = 0.004 * walkish;

    const p = parts;
    const shiverX = Math.sin(now * 34) * 0.0016 * s.shiver;

    /* **One transform for everything that is his body.**  The cream mass,
     * the mantle, the quills and the ears are children of `trunk`, centred
     * on his middle, so the bob, the sway, the roll, the pitch and the tuck
     * land on all of them at once.  Split across four objects and kept in
     * agreement by arithmetic, they disagreed by a millimetre — which was
     * exactly the mantle's clearance over the skin, and so the body flashed
     * cream through its own coat twice a stride.
     *
     * Curling makes him **round**, which an ellipsoid is not: the squash is
     * on the trunk too, about the same centre, so the mantle finally curls
     * with him instead of standing off the ball like a shed roof. */
    const breath = Math.sin(now * 2.1) * 0.0035 * doze;
    const wiggle = Math.sin(now * 22) * 0.10 * Math.sin(cele * Math.PI) * (1 - ball);
    const shakeRoll = Math.sin(now * 42) * 0.22 * shake;

    p.trunk.position.set(shiverX, BODY_Y + state.bob - crouch + lift + breath, state.sway);
    p.trunk.scale.set(bx, by, bz);
    p.trunk.rotation.z = (state.pitch - scratch * 0.05) * (1 - ball);
    p.trunk.rotation.x = (state.roll + shakeRoll + scratch * 0.10) * (1 - ball);
    p.trunk.rotation.y = wiggle;

    p.ears.forEach((ear) => {
      ear.scale.setScalar(tuck);
      ear.visible = tuck > 0.02;
    });

    /* The reserve coat grows out over the cream as he curls.  Scaled toward
     * his centre, the roots sit under the skin until the tuck is nearly
     * done, so the quills surface *through* the skin in the last moment of
     * curling — and are gone again before the front is anything but a ball. */
    const emerge = ball * ball;
    p.coatTuck.scale.setScalar(Math.max(0.0001, emerge));
    p.coatTuck.visible = ball > 0.3;
    // and the skin between them goes coat-brown, so the gaps read as the
    // shadow between needles rather than as bald cream — on emerge², so the
    // dye is gone from his front before his face is anything but a ball
    p.body.material.color.lerpColors(_skinCream, _skinQuill, emerge * emerge);

    /* ------------------------------ the face ---------------------------- */
    p.setLook(s.lookYaw * (1 - ball));
    p.face.scale.setScalar(tuck);
    p.face.visible = tuck > 0.02;

    /* Nose-down in the grass: the thing he does most.  Standing about, every
     * few seconds he puts his snout to the ground and works it — and while it
     * is down there the sniffing runs continuously, because that is what the
     * nose is down there *for*.  Eased in and out, so it is a movement. */
    face.nuzzleIn -= dt;
    if (face.nuzzle > 0) face.nuzzle = Math.max(0, face.nuzzle - dt);
    if (face.nuzzleIn <= 0 && moving < 0.3) {
      face.nuzzle = 1.2 + rng() * 1.6;
      face.nuzzleIn = 2.0 + rng() * 3.5;
    }
    const nuzzling = face.nuzzle > 0 && moving < 0.5 && ball < 0.3 && doze < 0.4 && face.scratch <= 0;
    face.nuzzleAmt = damp(face.nuzzleAmt, nuzzling ? 1 : 0, 5, dt);

    /* The face rides the SAME frame as the trunk — same bob, same roll, same
     * pitch, about the same centre — plus its own snuffle on top.  At half
     * the trunk's roll it slid across the body it was drawn on, and the
     * blush and eyes swam against the cheeks. */
    p.face.position.set(
      shiverX,
      BODY_Y + state.bob - crouch + lift + breath - face.nuzzleAmt * 0.008,
      state.sway
    );
    const snuffle = (1 - moving) * (Math.sin(now * 5.2) * 0.5 + Math.sin(now * 2.1) * 0.5);
    p.face.rotation.z = state.pitch * (1 - ball) + snuffle * 0.05 * (1 - doze)
      - face.nuzzleAmt * 0.42 - doze * 0.20 + yawn * 0.24;
    p.face.rotation.x = (state.roll + shakeRoll + scratch * 0.10) * (1 - ball);
    p.face.rotation.y = wiggle;

    /* Blinking.  Nothing blinked at all before, and an animal that never
     * blinks is the uncanniest thing in any scene.  Occasionally twice. */
    face.blinkIn -= dt;
    if (face.blinkIn <= 0) {
      face.blink = 1;
      face.blinkIn = 1.4 + rng() * 4.5;
      if (rng() < 0.28) face.blinkIn = 0.22;      // a double blink
    }
    if (face.blink > 0) face.blink = Math.max(0, face.blink - dt / 0.13);
    /* The lids close for a blink, squeeze for a yawn, and settle shut as he
     * dozes — one number, whichever wants them most. */
    const lid = Math.max(Math.sin(clamp(face.blink, 0, 1) * Math.PI), yawn * 0.9, doze * 0.96);
    for (const e of p.eyes) {
      e.scale.set(1, Math.max(0.06, 1 - lid * 0.94), 1);
      if (e.userData.glint) e.userData.glint.visible = lid < 0.5;
    }

    /* Sniffing: bursts with barely a rest between them.  A hedgehog is a
     * nose with legs on — he sniffs on the move, he sniffs standing still,
     * and with his snout in the grass he does not stop at all.  His nose and
     * his whiskers move together because they are on the same snout. */
    face.sniffIn -= dt;
    if (face.sniffIn <= 0) {
      face.sniffIn = 0.5 + rng() * 1.4;
      if (doze < 0.5) {                       // a sleeping nose rests too
        face.sniff = 0.55 + rng() * 0.5;
        s.onSniff?.();
      }
    }
    // nose down means nose working: the next burst starts almost at once
    if (nuzzling && face.sniff <= 0) face.sniffIn = Math.min(face.sniffIn, 0.12);
    if (face.sniff > 0) face.sniff = Math.max(0, face.sniff - dt);
    const sniff = face.sniff > 0 ? Math.sin(face.sniff * 46) * 0.5 + 0.5 : 0;
    p.snout.position.y = p.snout.userData.restY + sniff * 0.0035 + Math.sin(now * 9) * 0.0009;
    // the yawn stretches the snout wide open; the sniff only flares it
    p.snout.scale.set(1 + sniff * 0.05 + yawn * 0.10, 1 - sniff * 0.03 + yawn * 0.42, 1 + yawn * 0.06);
    p.nose.scale.setScalar(1 + sniff * 0.12);
    for (const w of p.whiskers) {
      w.rotation.z = w.userData.restZ + sniff * Math.sin(now * 52 + w.userData.ph) * 0.11;
    }

    /* An ear flick, one at a time — the cheapest possible sign of an animal
     * that is listening to something you cannot hear. */
    face.earIn -= dt;
    if (face.earIn <= 0) {
      face.earFlick = 1;
      face.earIn = 2.5 + rng() * 6;
    }
    if (face.earFlick > 0) face.earFlick = Math.max(0, face.earFlick - dt / 0.3);
    const flick = Math.sin(clamp(face.earFlick, 0, 1) * Math.PI * 2) * 0.5;
    p.ears.forEach((ear, i) => {
      ear.rotation.x = (i === 0 ? flick : flick * 0.25) * 0.9;
      // the scratched ear (his left) waggles under the foot working at it
      if (i === 1) ear.rotation.x += Math.sin(now * 30) * 0.35 * scratch;
    });

    p.shadow.scale.setScalar((1 - ball * 0.22) * (1 + moving * 0.06));
    p.shadow.material.opacity = 0.32 - moving * 0.06;

    return state;
  }

  return { update, state, legs };
}
