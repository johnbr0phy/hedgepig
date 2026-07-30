import * as THREE from 'three';
import { clamp, lerp, damp, mulberry32, TAU } from '../core/util.js';

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
    sniffIn: 2.2,
    earFlick: 0,
    earIn: 3,
  };

  const state = { cycle: 0, bob: 0, roll: 0, pitch: 0, sway: 0 };

  /**
   * @param s  the hedgepig: gait, speed, curl, shiver, lookYaw, walked
   * @param dt seconds
   * @param now seconds since the world began, for things on their own clock
   */
  function update(s, dt, now) {
    const moving = s.gait;

    /* ---------------------------- the cycle ---------------------------- *
     * Advanced by **ground covered**, never by time.  This one line is why
     * the feet do not skate. */
    const ground = s.speed * s.gait * dt;
    state.cycle = (state.cycle + ground / STRIDE) % 1;

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
      L.stance = p < STANCE;

      _dir.set(fore, -(L.hip.y - lift), 0).normalize();
      _q.setFromUnitVectors(_from, _dir);
      L.obj.quaternion.copy(_q);
      L.obj.position.copy(L.rest);
      L.obj.visible = s.curl < 0.6;
    }

    /* ------------------------------ the body ---------------------------- *
     * Twice the stride, because both couplets land in one cycle; the roll is
     * once, because the supporting diagonal swaps once. */
    const beat = state.cycle * TAU;
    state.bob = Math.sin(beat * 2 + Math.PI / 2) * 0.008 * moving;
    state.roll = Math.sin(beat) * 0.085 * moving;
    state.pitch = -Math.sin(beat * 2) * 0.035 * moving - 0.06 * moving;
    state.sway = Math.sin(beat) * 0.010 * moving;

    // he settles a little lower the faster he goes: a scurry is a crouch
    const crouch = 0.006 * moving;

    const p = parts;
    p.body.position.set(
      Math.sin(now * 34) * 0.0016 * s.shiver,
      0.083 + state.bob - crouch + s.curl * 0.014,
      state.sway
    );
    p.body.scale.setScalar(1 + s.curl * 0.10);
    for (const coat of p.coats) coat.scale.setScalar(1 + s.curl * 0.16);

    /* ------------------------------ the face ---------------------------- */
    p.setLook(s.lookYaw * (1 - s.curl));
    p.face.visible = s.curl < 0.75;
    p.face.position.y = 0.083 + state.bob - crouch;
    p.face.position.z = state.sway;

    // he nods into the walk, and dips his nose when he is standing about
    const snuffle = (1 - moving) * (Math.sin(now * 5.2) * 0.5 + Math.sin(now * 2.1) * 0.5);
    p.face.rotation.z = state.pitch * 0.5 + snuffle * 0.05;
    p.face.rotation.x = state.roll * 0.35;

    /* Blinking.  Nothing blinked at all before, and an animal that never
     * blinks is the uncanniest thing in any scene.  Occasionally twice. */
    face.blinkIn -= dt;
    if (face.blinkIn <= 0) {
      face.blink = 1;
      face.blinkIn = 1.4 + rng() * 4.5;
      if (rng() < 0.28) face.blinkIn = 0.22;      // a double blink
    }
    if (face.blink > 0) face.blink = Math.max(0, face.blink - dt / 0.13);
    const lid = Math.sin(clamp(face.blink, 0, 1) * Math.PI);
    for (const e of p.eyes) {
      e.scale.set(1, Math.max(0.06, 1 - lid * 0.94), 1);
      if (e.userData.glint) e.userData.glint.visible = lid < 0.5;
    }

    /* Sniffing: bursts, not a constant twitch.  His nose and his whiskers
     * move together because they are on the same snout. */
    face.sniffIn -= dt;
    if (face.sniffIn <= 0) {
      face.sniff = 0.5 + rng() * 0.5;
      face.sniffIn = 1.2 + rng() * 3.4;
    }
    if (face.sniff > 0) face.sniff = Math.max(0, face.sniff - dt);
    const sniff = face.sniff > 0 ? Math.sin(face.sniff * 46) * 0.5 + 0.5 : 0;
    p.snout.position.y = p.snout.userData.restY + sniff * 0.0035 + Math.sin(now * 9) * 0.0009;
    p.snout.scale.set(1 + sniff * 0.05, 1 - sniff * 0.03, 1);
    p.nose.scale.setScalar(1 + sniff * 0.12);

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
    });

    p.shadow.scale.setScalar((1 - s.curl * 0.12) * (1 + moving * 0.06));
    p.shadow.material.opacity = 0.32 - moving * 0.06;

    return state;
  }

  return { update, state, legs };
}
