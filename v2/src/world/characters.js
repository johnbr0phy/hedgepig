import * as THREE from 'three';
import { cel, flat } from '../core/toon.js';
import { clamp, damp, rngKit, shadowify, TAU, wrapAng } from '../core/util.js';
import { positionAt, basisAt } from './planet.js';
import { heightAt } from './terrain.js';
import { CENTRE, WOOD, offsetFrom, distance, bearing, towards } from './plan.js';

/* ------------------------------------------------------------------ *
 * The four who live in the wood.
 *
 * Everything in `critters.js` is *fauna* — it flees, it flaps, it plops off
 * a bank and is gone.  None of it knows he is there in any way that survives
 * him walking away.  These four are the other thing a wood has in it:
 * residents, at fixed addresses, who have opinions.
 *
 * They are built the way the squirrel and the owl are built — low-poly
 * masses, one `seat` through the tangent frame, flat authoring coordinates
 * throughout — with three rules taken from that file whole:
 *
 *  - **Built after the bake, seated every frame.**  Bending a rig's geometry
 *    bends its pivots with it, and everything here has a head that turns.
 *  - **Ranged off him, never off the camera.**  A character that noticed the
 *    camera would notice you in the orbit view, from the far side of a
 *    planet.
 *  - **Culled by distance off him**, like the grass chunks.  The horizon from
 *    his eye is eleven metres; past fifteen there is nothing to draw.
 *
 * **How often will you be standing near one?**  HANDOVER asks that of
 * anything new, because "built" and "reachable" have come apart twice here —
 * butterflies pinned to one place on a 300 m lap, and nobody ever saw one.
 * The honest answer: these are pinned to one place out of ten, *deliberately*,
 * because unlike a butterfly a resident is a **destination** — the value is
 * in going back to the same toad and finding she has something else to say.
 * The four sit inside a 16 m span across the wood, which is one crossing of
 * it; the burrow is three places along the ring, so the wood comes up on
 * roughly one leg in three; and the robin closes the last few metres itself.
 * If you are in the wood at all you are within earshot of two of them.
 *
 * **Scale.**  He is 0.26 m long.  A badger is 0.75 m and nearly three times
 * him, which is the whole reason the badger works: he is the only thing in
 * this world that is *bigger* than the hedgepig and not a building.  The
 * robin is 0.14, the toad 0.10, the wood mouse 0.09 without its tail.  Scale
 * is the most common fault in this codebase's history and none of these
 * numbers were guessed.
 * ------------------------------------------------------------------ */

/** Past this he cannot see them, so there is nothing to spend on them. */
const SEE = 15;

/* ------------------------------- the voice ------------------------------- *
 *
 * A line is `{ line, when(state, hog) }`.  `when` is handed whatever the
 * caller calls state — the climate's, the game's, or the two merged — and
 * **every predicate reads defensively**, so a field that is not there means
 * the line does not fire rather than the frame throwing.  That matters more
 * than it looks: `world.update` is inside `frame()`, and this project has
 * already lost a whole game to one exception in a per-frame path.
 *
 * `only: true` marks a line as conditional.  The unmarked ones rotate; the
 * marked ones interrupt when their moment comes and then go quiet again, so
 * that a rainy night does not turn a character into a weather report.
 */
const ALWAYS = () => true;

const isNight = (s) => (s?.night ?? 0) > 0.55;
const isRain = (s) => (s?.wet ?? 0) > 0.35;
const isWinter = (s) => (s?.w?.[3] ?? 0) > 0.45;
const isSnow = (s) => (s?.snow ?? 0) > 0.35;
/** His last heart.  The game's state carries `hearts`; the climate's does not. */
const isHurt = (s, h) => (s?.hearts ?? h?.hearts ?? 9) <= 1;
/** `hog.carry` is seconds left carrying his leaf. */
const isCarrying = (s, h) => (h?.carry ?? 0) > 0;
const hasFound = (s) => (s?.found ?? 0) > 0;

/** A line said only under some condition. */
const on = (when, line) => ({ line, when, only: true });
/** A line from the rotation. */
const any = (line) => ({ line, when: ALWAYS, only: false });

/**
 * A speaker: rotate the general lines, and let a conditional one cut in when
 * it fits and has not been used lately.
 *
 * Two rules learned from the interactables, which have had rotating lines
 * since the first build:
 *
 *  - **Never the same kind twice running.**  A conditional line landing on
 *    the back of another conditional line reads as a character who can only
 *    talk about the weather.
 *  - **A spent line comes back, but not soon.**  When every fitting
 *    conditional has been used the set clears — and the *next* thing said is
 *    still a general line, so the repeat is at least a turn away.
 */
function speaker(lines) {
  const general = lines.filter((l) => !l.only);
  const special = lines.filter((l) => l.only);
  const spent = new Set();
  let i = 0;
  let since = 1;
  return function say(state, hog) {
    const fits = special.filter((l) => l.when(state, hog));
    const fresh = fits.filter((l) => !spent.has(l));
    if (fresh.length && since >= 1) {
      const l = fresh[i % fresh.length];
      spent.add(l);
      since = 0;
      return l.line;
    }
    if (fits.length && !fresh.length) spent.clear();
    since++;
    return general.length ? general[i++ % general.length].line : '';
  };
}

/* ------------------------------------------------------------------ *
 * The cast, as plain data.
 *
 * Positions are metres east and north of `CENTRE[WOOD]`, chosen against what
 * `buildWood` already put there rather than by eye:
 *
 *  - the **glade** at (7.6, -6.4) with a radius of 4.1 refuses trees, stumps
 *    inside 2.3 and bracken inside 3.3, so its rim is the only ground in the
 *    wood you can be *sure* is standing room.  The badger and the toad are
 *    both on it.
 *  - the **corridor**, |v| < 2, is the way through and keeps most trees off.
 *    The robin starts there because that is where you will walk.
 *  - the **birch stand** at (-9.0, 5.2) is the far side of the wood, and the
 *    mouse is under it, so that meeting all four is a crossing rather than a
 *    stroll round one clearing.
 *
 * The toad's spot is the one that had to be worked out: the three fallen
 * trunks carry blockers of their own radius plus 0.1 along their axes, and
 * (4.1, -4.5) is the pocket between two of them with 0.26 m of clearance —
 * close enough to be *under* the deadfall, far enough that he can get to her.
 * ------------------------------------------------------------------ */

export const WOOD_CHARACTERS = [
  {
    key: 'badger',
    name: 'the badger',
    at: { u: 6.9, v: -9.4 },
    /* He lies at his own door with the clearing in front of him, because the
     * one thing an old badger does above ground in daylight is lie at his
     * own door with the clearing in front of him. */
    face: Math.atan2(3.0, 0.7),
    lines: [
      any('you again. good.'),
      any('sit down. you make me tired standing there.'),
      any('there is more of my house under you than there is wood over you.'),
      any('i knew your mother. quicker than you. no wiser.'),
      any('i have been digging this since before the wall came down.'),
      any('keep off the hard road. i have carried enough friends off it.'),
      any('quiet a moment. i am listening to worms.'),
      any('the wood was bigger. that is all i will say about that.'),
      any('if you are lost, go downhill. everything else does.'),
      any('stay as long as you like. i shall be asleep by then.'),
      any('you are very small. that is not a criticism. it is useful.'),
      any('one eye opens. after a while the other one decides against it.'),
      on(isNight, 'now you see it. after dark this is a different wood, and it is mine.'),
      on(isRain, 'rain. the worms come up. i shall be along shortly.'),
      on(isWinter, 'i do not sleep the whole winter through. i just stop bothering.'),
      on(isSnow, 'snow. everything above ground is somebody else’s problem now.'),
      on(isHurt, 'you are hurt. come in out of it a while. nothing follows anybody down there.'),
      on(isCarrying, 'bedding. sensible. leave it by the door and i shall not ask where it came from.'),
      on(hasFound, 'the gold weed. i have seen four in my life. you will see more. you go further.'),
    ],
  },

  {
    key: 'robin',
    name: 'the robin',
    at: { u: 2.2, v: 0.9 },
    face: 2.6,
    lines: [
      any('you are digging. are you digging. i shall wait.'),
      any('anything you turn over is mine. that is the arrangement. you did not agree to it.'),
      any('go on then. go on. i shall keep up.'),
      any('i have a spot on the third birch. do not tell the other one.'),
      any('the other one sings from the wall. he is louder. he is not better.'),
      any('this is my wood. it is also yours. mostly mine.'),
      any('i knew the badger when he was only very old.'),
      any('you walk like a hedgehog. no offence. i cannot walk at all, really.'),
      any('somebody dug here once and left me things. nobody digs here now. it is a scandal.'),
      any('i am not following you. i am going the same way, quickly, behind you.'),
      any('there. did you hear that. no. nor did i.'),
      any('i sing all winter. nobody else bothers. that is why you know my voice and not theirs.'),
      any('the mouse says you are enormous. the mouse says everything is enormous.'),
      any('a worm went that way. i tell you as a courtesy.'),
      on(isNight, 'i ought to be roosting. i shall be unbearable in the morning.'),
      on(isRain, 'wet through. still here, though. still talking.'),
      on(isWinter, 'you should be asleep. everybody is asleep. it is very dull and i blame all of you.'),
      on(isSnow, 'stand on the snow and everything in the wood can see you. i shall stand on the snow.'),
      on(isHurt, 'you are marked. get under something and be quiet a while. i shall keep watch, badly.'),
      on(isCarrying, 'a leaf. lovely. what is it for. is it for me.'),
      on(hasFound, 'i saw where the gold one grew. i say nothing about it. i say it constantly.'),
    ],
  },

  {
    key: 'toad',
    name: 'the toad under the deadfall',
    at: { u: 4.1, v: -4.5 },
    face: -0.5,
    lines: [
      any('do not hurry. nothing you are hurrying to is going anywhere.'),
      any('i have been here since the trunk came down. it came down in a wind. i have had a long while to be sure of that.'),
      any('i am the same age as this wood. the wood does not remember it either.'),
      any('i am not hiding. this is simply where i am.'),
      any('i moved once. i did not care for it.'),
      any('you are warm. i can tell from here. it must be exhausting.'),
      any('everything comes past this log eventually. i wait. it is not a plan. it is only true.'),
      any('the badger and i do not speak. we have said it all.'),
      any('sit still long enough and the wood forgets you are not part of it. i recommend it.'),
      any('there was a pond here. before the log. before you. i still go and look at the place.'),
      any('i am not asleep. my eyes are simply where they are.'),
      any('small things pass. i am a small thing passing. it only takes me longer.'),
      on(isRain, 'ah. rain. this is my hour. i shall be out in it until it stops, and for a while after.'),
      on(isNight, 'at night the ground breathes out. stand still and you will feel it come up through your feet.'),
      on(isWinter, 'in a week or two i shall go down under the roots and stop. do not knock. i shall not answer until the ground is soft.'),
      on(isHurt, 'you are torn. lie down on the cold ground. it takes the ache out of a thing, if you let it long enough.'),
      on(isCarrying, 'a leaf, carried all that way. that is a very hedgehog sort of errand. i approve of it entirely.'),
      on(hasFound, 'the gold one. things grow where you have been now. that is a heavy thing to be. carry it slowly.'),
    ],
  },

  {
    key: 'mouse',
    name: 'the wood mouse',
    at: { u: -6.8, v: 3.4 },
    face: 1.9,
    lines: [
      any('quick quick. do not stand there. nothing stands there.'),
      any('there is an owl. there is always an owl. i am telling everyone.'),
      any('you are very slow. how are you not eaten. how.'),
      any('i have four ways out of here. i have used all four. today.'),
      any('beech mast. under the third tree. i have said too much.'),
      any('i am not frightened. i am ready. it looks the same from outside.'),
      any('do not follow me. i am going nowhere and i am going fast.'),
      any('somebody moved a stick. i felt it. through the ground.'),
      any('you can hide inside yourself. i think about that a great deal.'),
      any('i do not sleep. i sleep in pieces. eight or nine a day.'),
      any('the toad has been here longer than the log. do not ask her. she will tell you.'),
      any('the robin follows you because you turn things over. i follow the robin.'),
      any('i had a nest in the wall. the wall is a heap now. i do not go past it.'),
      on(isNight, 'this is my time. it is also the owl’s time. we share it very badly.'),
      on(isRain, 'wet fur. wet everything. i shall be under a leaf. not that leaf. another one.'),
      on(isWinter, 'i am awake all winter. everybody else gets to stop. it is not fair and i say so constantly.'),
      on(isSnow, 'tracks. tracks everywhere. mine. yours. something else’s. i am not going out.'),
      on(isHurt, 'you are bleeding. no. do not show me. go home. go home now. go.'),
      on(isCarrying, 'a leaf. good. good. put it over you and then nothing can see you at all.'),
      on(hasFound, 'the gold one. i watched you take it. i tell everyone. everyone knows about you now.'),
    ],
  },
];

/* ------------------------------- the models ------------------------------ *
 *
 * Two masses and a silhouette each, in the house style.  What each animal is
 * recognised by at half a metre is the one thing that gets geometry spent on
 * it: the badger's face, the robin's breast, the toad's eyes, the mouse's
 * ears.  Everything else is a scaled sphere.
 *
 * The eyes of the two small ones get a **catchlight** — 1.5 mm, additive,
 * fog off.  HANDOVER §4 records what a buried catchlight cost on the
 * hedgepig himself: both eyes read as flat black holes and the face died.
 * At this size it is three triangles and it is the difference between an
 * animal and a bead.
 */

const M = (color, tint, bands = 2, flatShade = false) =>
  cel({ color, bands, tint, flat: flatShade, cache: false });

/**
 * A pinpoint of light on an eye.
 *
 * **Placed on the eyeball's own surface, never against a number of its own.**
 * The hedgepig's catchlight sat 10.2 mm from the centre of a 14.5 mm eye and
 * was therefore *inside* it, and both his eyes read as flat black holes for
 * as long as that lasted.  This takes the eye's centre and radius and puts
 * the spark up and forward on the surface, so it cannot be buried whatever
 * the eye is later moved to.
 *
 * Additive, because §5's rule is absolute: anything that represents emitted
 * light must not be able to darken what is behind it.
 */
const _sp = new THREE.Vector3();
function catchlight(eye, er, s, r) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 5, 4),
    new THREE.MeshBasicMaterial({
      color: 0xfff6e2, fog: false, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  // up and forward, and a little outboard, which is where a low sun puts it
  _sp.set(0.75, 0.55, 0.35 * s).normalize().multiplyScalar(er);
  m.position.copy(eye.position).add(_sp);
  m.userData.noOutline = true;
  return m;
}

/** Remember a mesh's finished scale, so the breath can ride on top of it
 *  rather than replacing it.  Scaling the *group* instead walks every part
 *  away from the body it is supposed to be attached to — and this is called
 *  **after** the scale is authored, or it records a unit body and the breath
 *  quietly flattens the animal on its first frame. */
function breathing(mesh) {
  mesh.userData.base = mesh.scale.clone();
  return mesh;
}

/**
 * The badger: 0.75 m nose to rump, 0.30 m at the shoulder, lying at his door.
 *
 * The face is the animal.  A badger with a grey body and no stripes is a
 * large guinea pig, and the stripes have to run *along* the wedge from the
 * nose over each eye — a pair of dots either side reads as a panda, which is
 * the same mistake in the other direction.
 */
function badgerModel() {
  const g = new THREE.Group();
  const fur = M(0x8b867c, 0x6a6690, 2, false);
  const dark = M(0x322e37, 0x5a5480, 2, false);
  const pale = M(0xe6e0d2, 0x6f6894, 3, false);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 9), fur);
  body.scale.set(2.15, 0.92, 1.12);          // 0.69 long, 0.29 high, 0.36 wide
  body.position.y = 0.135;
  g.add(breathing(body));

  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), fur);
  rump.scale.set(1.05, 0.95, 1.12);
  rump.position.set(-0.20, 0.13, 0);
  g.add(rump);

  /* Front paws only.  He is lying down; a full set of legs on a badger who
   * never stands up is four things that have to be animated and are never
   * once seen to move. */
  for (const s of [-1, 1]) {
    const paw = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.10, 6), dark);
    paw.rotation.z = Math.PI / 2;
    paw.position.set(0.24, 0.028, s * 0.085);
    g.add(paw);
  }

  /* The head is its own group so it can turn without the body moving: an old
   * badger at his sett turns his head and nothing else. */
  const head = new THREE.Group();
  head.position.set(0.20, 0.145, 0);
  g.add(head);

  const wedge = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.25, 7), pale);
  wedge.rotation.z = -Math.PI / 2;           // Rz(-90) sends +y to +x: the muzzle leads
  wedge.scale.set(1, 1, 0.88);
  wedge.position.set(0.105, -0.012, 0);
  head.add(wedge);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), pale);
  skull.scale.set(1.1, 0.92, 1.0);
  skull.position.set(0.005, 0.005, 0);
  head.add(skull);

  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.030, 0.034), dark);
    stripe.position.set(0.10, 0.022, s * 0.037);
    stripe.rotation.z = -0.06;               // the stripe follows the taper down to the nose
    head.add(stripe);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.019, 7, 6), dark);
  nose.scale.set(0.9, 0.8, 1);
  nose.position.set(0.225, -0.012, 0);
  head.add(nose);

  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 6, 5), dark);
    e.position.set(0.062, 0.028, s * 0.041);
    head.add(e);
    eyes.push(e);
  }

  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(-0.030, 0.052, s * 0.056);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.026, 7, 6), fur);
    shell.scale.set(0.34, 0.9, 1.0);
    ear.add(shell);
    const rim = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), pale);
    rim.scale.set(0.2, 0.8, 0.9);
    rim.position.set(0.008, 0.006, 0);
    ear.add(rim);
    ear.userData.side = s;
    head.add(ear);
    ears.push(ear);
  }

  shadowify(g);
  return { obj: g, parts: { body, head, eyes, ears } };
}

/**
 * The sett mouth: a hole and the heap that came out of it.
 *
 * Not a character and not scenery either — it is the badger's *address*, and
 * without it he is an enormous animal sitting in a clearing for no reason.
 * A hole is drawn as an absence: a dark ellipse on the ground with the spoil
 * banked behind it, which is what one looks like from 12 cm up.
 */
function settMouth(seed = 91) {
  const rng = rngKit(seed);
  const g = new THREE.Group();
  const soil = M(0x584634, 0x62568a, 3, true);
  const dark = flat({ color: 0x1d1a20, cache: false });

  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.23, 14), dark);
  hole.rotation.x = -Math.PI / 2;
  hole.scale.set(1.25, 1, 0.85);
  hole.position.y = 0.006;
  hole.userData.noOutline = true;            // ink round a hole draws a lid on it
  hole.receiveShadow = false;
  g.add(hole);

  // the spoil, thrown out backwards and downhill, as it is
  for (let i = 0; i < 7; i++) {
    const a = rng.range(2.1, 4.2);
    const d = rng.range(0.28, 0.52);
    const r = rng.range(0.06, 0.13);
    const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), soil);
    lump.position.set(Math.cos(a) * d, r * 0.28, Math.sin(a) * d);
    lump.scale.set(1.3, 0.5, 1.2);
    lump.rotation.y = rng.range(0, TAU);
    g.add(lump);
  }
  // and the lip either side of the door, worn smooth by a large animal
  for (const s of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), soil);
    lip.scale.set(1.0, 0.28, 0.6);
    lip.position.set(0.06, 0.012, s * 0.26);
    g.add(lip);
  }

  return shadowify(g, true, true);
}

/**
 * The robin: 0.14 m long, and 90 % of it is the breast.
 *
 * The orange runs up over the face — a robin whose colour stops at the neck
 * is a wren with a bib on.  The cap and the back stay brown so there is
 * still a bird behind the breast.
 */
function robinModel() {
  const g = new THREE.Group();
  const back = M(0x8a7a58, 0x6a5e7e, 2, false);
  const breast = M(0xd0662f, 0x7a5a72, 2, false);
  const dark = flat({ color: 0x2b2530, cache: false });
  const leg = M(0xb59a7c, 0x6a5e7e, 2, false);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), back);
  body.scale.set(1.15, 1.2, 1.0);
  body.position.y = 0.058;
  g.add(breathing(body));

  const front = new THREE.Mesh(new THREE.SphereGeometry(0.030, 9, 7), breast);
  front.scale.set(0.9, 1.08, 0.95);
  front.position.set(0.030, 0.055, 0);
  g.add(front);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.062, 4), back);
  tail.rotation.z = Math.PI / 2;             // Rz(+90) sends +y to -x: the tail trails
  tail.scale.set(1, 1, 0.45);
  tail.position.set(-0.058, 0.072, 0);
  g.add(tail);

  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.032, 4), leg);
    l.position.set(0.008, 0.017, s * 0.014);
    g.add(l);
  }

  const head = new THREE.Group();
  head.position.set(0.030, 0.098, 0);
  g.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.029, 9, 7), breast);
  head.add(face);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), back);
  cap.scale.set(1.0, 0.72, 1.0);
  cap.position.set(-0.006, 0.012, 0);
  head.add(cap);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.022, 4), dark);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.036, -0.002, 0);
  head.add(beak);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0058, 6, 5), dark);
    e.position.set(0.019, 0.008, s * 0.017);
    head.add(e);
    head.add(catchlight(e, 0.0058, s, 0.0016));
  }

  shadowify(g);
  return { obj: g, parts: { body, head, tail } };
}

/**
 * The toad: 0.10 m, wide, low, and entirely still.
 *
 * The eyes are the whole character — gold, standing proud of the skull, with
 * a **horizontal** pupil.  A round pupil makes a frog; a toad's is a slot,
 * and it is the difference between damp philosophy and a cartoon.
 */
function toadModel() {
  const g = new THREE.Group();
  const skin = M(0x7d6a4a, 0x62568a, 2, false);
  const wart = M(0x5b4c39, 0x62568a, 2, true);
  const pale = M(0xa89a78, 0x6a6690, 2, false);
  const gold = M(0xd8a53c, 0x7a6a5e, 2, false);
  const slit = flat({ color: 0x241f1c, cache: false });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), skin);
  body.scale.set(1.55, 0.80, 1.20);          // 0.099 long, 0.051 high
  body.position.y = 0.024;
  g.add(breathing(body));

  const brow = new THREE.Mesh(new THREE.SphereGeometry(0.024, 9, 7), skin);
  brow.scale.set(1.0, 0.85, 1.05);
  brow.position.set(0.034, 0.024, 0);
  g.add(brow);

  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), pale);
  throat.scale.set(1.0, 0.70, 1.10);
  throat.position.set(0.036, 0.012, 0);
  g.add(breathing(throat));

  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0090, 7, 6), gold);
    e.position.set(0.044, 0.040, s * 0.017);
    g.add(e);
    eyes.push(e);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 6, 5), slit);
    pupil.scale.set(1, 0.34, 1);
    pupil.position.set(0.0495, 0.0405, s * 0.0175);
    pupil.userData.noOutline = true;
    g.add(pupil);
  }

  // warts, because a toad without them is a frog with a bad posture
  const wrng = rngKit(3307);
  for (let i = 0; i < 7; i++) {
    const a = wrng.range(0, TAU);
    const d = wrng.range(0.006, 0.030);
    const r = wrng.range(0.0035, 0.0062);
    const w = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), wart);
    w.position.set(-0.012 + Math.cos(a) * d * 1.6, 0.044 - d * 0.3, Math.sin(a) * d);
    g.add(w);
  }

  // four feet, splayed, barely clear of the body: a toad sits on its hands
  for (const sx of [1, -1]) {
    for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 6, 5), skin);
      f.scale.set(1.5, 0.45, 1.0);
      f.position.set(sx * 0.030, 0.006, sz * 0.030);
      f.rotation.y = sx * sz * 0.5;
      g.add(f);
    }
  }

  shadowify(g);
  return { obj: g, parts: { body, throat, eyes } };
}

/**
 * The wood mouse: 0.09 m of body, 0.075 m of tail, and the ears.
 *
 * The ears are drawn nearly flat and large on purpose — that pair of discs is
 * the whole recognition at any distance you will ever see it from, and a
 * mouse with small ears is a vole, which is a different and duller animal.
 */
function mouseModel() {
  const g = new THREE.Group();
  const fur = M(0x9a7f5c, 0x6a5e7e, 2, false);
  const belly = M(0xdcd2ba, 0x6f6894, 2, false);
  const pink = M(0xc99a90, 0x7a6a82, 2, false);
  const dark = flat({ color: 0x241f26, cache: false });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.021, 9, 7), fur);
  body.scale.set(1.9, 1.0, 1.05);
  body.position.y = 0.021;
  g.add(breathing(body));

  const under = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), belly);
  under.scale.set(1.9, 0.55, 0.95);
  under.position.set(0.002, 0.013, 0);
  g.add(under);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0011, 0.075, 4), pink);
  tail.rotation.z = Math.PI / 2;
  tail.rotation.y = 0.35;                    // never straight: a straight tail is a wire
  tail.position.set(-0.056, 0.016, 0.010);
  g.add(tail);

  const head = new THREE.Group();
  head.position.set(0.030, 0.022, 0);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.040, 7), fur);
  snout.rotation.z = -Math.PI / 2;
  snout.scale.set(1, 1, 0.92);
  snout.position.set(0.016, -0.002, 0);
  head.add(snout);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), fur);
  head.add(skull);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 5, 4), pink);
  tip.position.set(0.037, -0.003, 0);
  head.add(tip);

  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(-0.004, 0.018, s * 0.013);
    ear.rotation.x = s * 0.35;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), fur);
    shell.scale.set(0.9, 0.95, 0.22);
    ear.add(shell);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.010, 7, 5), pink);
    inner.scale.set(0.85, 0.9, 0.16);
    inner.position.set(0.001, 0.001, s * 0.004);
    ear.add(inner);
    ear.userData.side = s;
    ear.userData.rest = ear.rotation.x;
    head.add(ear);
    ears.push(ear);
  }

  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 6, 5), dark);
    e.position.set(0.012, 0.005, s * 0.013);
    head.add(e);
    head.add(catchlight(e, 0.0062, s, 0.0017));
  }

  shadowify(g);
  return { obj: g, parts: { body, head, ears, tail } };
}

const MODELS = { badger: badgerModel, robin: robinModel, toad: toadModel, mouse: mouseModel };

/**
 * Per-character idle temperament.  All four do the same four things —
 * breathe, twitch, look about, look at him — and the whole of what makes
 * them different animals is in these numbers.
 *
 *  `notice`  how far off he has to be before they turn to him, in metres
 *  `neck`    how far the head may turn before the body would have to
 *  `turn`    how fast the look eases, in fractions per second
 *  `sweep`   how far off its resting bearing an idle glance goes
 *  `glance`  seconds between idle glances
 *  `breath`  radians per second, and the fraction of height it moves
 *  `talk`    how close he has to be before it will say anything, in metres
 *
 * **`talk` is per animal and it has to be**, because one of the four keeps
 * its own distance.  An interactable is a fixed thing you walk up to, so
 * `world.nearest` can use one radius for all of them; the robin *comes to
 * you* and stands 1.15 m off, and it re-hops only once it has drifted 0.22
 * from that — so on the interactables' 0.8 m the one character in the wood
 * that seeks you out would have been the one you could never speak to.
 */
const TEMPER = {
  badger: { notice: 3.4, neck: 0.95, turn: 1.6, sweep: 0.55, glance: [5, 14], breath: [1.9, 0.055], talk: 1.05 },
  robin:  { notice: 6.5, neck: 1.25, turn: 9.0, sweep: 2.40, glance: [0.6, 2.0], breath: [11.0, 0.030], talk: 1.60 },
  toad:   { notice: 1.4, neck: 0.00, turn: 0.5, sweep: 0.25, glance: [12, 30], breath: [1.1, 0.028], talk: 0.80 },
  mouse:  { notice: 4.0, neck: 1.10, turn: 12.0, sweep: 2.80, glance: [0.35, 1.4], breath: [16.0, 0.045], talk: 0.85 },
};

export function createCharacters(scene) {
  const rng = rngKit(5721);
  const group = new THREE.Group();
  group.name = 'characters';
  /* Nothing here may be folded into the static merge: they all animate in
   * place, and a merged mesh has no pivots left to animate. */
  group.userData.noMerge = true;
  scene.add(group);

  const _b = new THREE.Matrix4();
  const _r = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  /* Two, not one: the robin asks `towards` for a goal and then asks it again
   * for a step toward that goal, and one shared out object would have the
   * second call quietly overwrite the target of the first. */
  const _goal = { x: 0, z: 0 };
  const _step = { x: 0, z: 0 };

  /** Seat a character at flat (x, y, z) facing the bearing `yaw`. */
  function seat(obj, x, y, z, yaw, s = 1) {
    const b = basisAt(x, z);
    _b.makeBasis(b.east, b.up, b.north);
    _b.setPosition(positionAt(x, y, z, _p));
    /* `rotation.y = -bearing` is the same convention `lay` uses in green.js
     * and `seat` uses in critters.js: makeBasis sends local +x to east, so a
     * model built nose-along-+x faces `yaw` when turned by minus it. */
    _r.makeRotationY(-yaw);
    _b.multiply(_r);
    if (s !== 1) {
      _r.makeScale(s, s, s);
      _b.multiply(_r);
    }
    obj.matrix.copy(_b);
    obj.matrixWorldNeedsUpdate = true;
  }

  const all = [];
  for (const spec of WOOD_CHARACTERS) {
    const { obj, parts } = MODELS[spec.key]();
    obj.matrixAutoUpdate = false;
    group.add(obj);

    const p = offsetFrom(CENTRE[WOOD], spec.at.u, spec.at.v);
    const t = TEMPER[spec.key];
    const c = {
      ...spec,
      obj, parts,
      ...t,
      home: { x: p.x, z: p.z },
      x: p.x, z: p.z,
      yaw: spec.face,
      look: spec.face,
      wander: spec.face,
      lift: 0,
      t: rng.range(0, 40),                   // so four hearts do not beat together
      glanceIn: rng.range(0, 3),
      blink: 0,
      blinkIn: rng.range(1, 5),
      twitch: 0,
      twitchIn: rng.range(2, 7),
      /* the robin's own */
      hop: 0, pause: rng.range(0, 1), fx: p.x, fz: p.z, tx: p.x, tz: p.z, flick: 0, cock: 0, cockIn: 2,
      /* the mouse's own */
      dart: 0, dartIn: rng.range(1, 4), gx: p.x, gz: p.z,
      /* the badger's own */
      wake: 0,
      say: speaker(spec.lines),
    };
    seat(obj, c.x, heightAt(c.x, c.z), c.z, c.yaw);
    all.push(c);
  }

  /* The badger's front door, seated once and left: it is ground, not an
   * animal, and nothing about it moves.  A little in front of him and to the
   * side, so he is lying *beside* his hole rather than plugged into it. */
  {
    const badger = all.find((c) => c.key === 'badger');
    const at = offsetFrom(CENTRE[WOOD], badger.at.u - 0.55, badger.at.v - 0.42);
    const sett = settMouth();
    sett.matrixAutoUpdate = false;
    group.add(sett);
    seat(sett, at.x, heightAt(at.x, at.z), at.z, badger.face + 1.1);
  }

  /** The shared idle: breath, a glance about, and his face when he is near. */
  function idle(c, dt, hog, near) {
    c.t += dt;

    c.glanceIn -= dt;
    if (c.glanceIn <= 0) {
      c.glanceIn = rng.range(c.glance[0], c.glance[1]);
      c.wander = wrapAng(c.face + rng.range(-1, 1) * c.sweep);
    }
    /* Looking at him is the whole of what makes a resident different from a
     * prop, and it is one bearing.  Off *him*, not the camera. */
    const want = near < c.notice ? bearing(c.x, c.z, hog.x, hog.z).angle : c.wander;
    c.look = wrapAng(c.look + damp(0, wrapAng(want - c.look), c.turn, dt));

    if (c.parts.head) {
      c.parts.head.rotation.y = -clamp(wrapAng(c.look - c.yaw), -c.neck, c.neck);
    }

    const b = c.parts.body;
    const k = 1 + Math.sin(c.t * c.breath[0]) * c.breath[1];
    b.scale.set(b.userData.base.x, b.userData.base.y * k, b.userData.base.z * (2 - k));
  }

  /* ------------------------------ the badger ------------------------------ *
   * He does not move.  What he does is wake up — and only as far as he has
   * to.  The near-side eye opens first and the other one lags a full second
   * behind it, which is the single detail this whole animal is for. */
  function badger(c, dt, hog, state, near) {
    const dozy = 0.12 + 0.55 * (state?.night ?? 0);      // his default eye, by the clock
    c.wake = damp(c.wake, near < 3.0 ? 1 : dozy, near < 3.0 ? 1.1 : 0.35, dt);

    c.blinkIn -= dt;
    if (c.blinkIn <= 0) { c.blink = 0.2; c.blinkIn = rng.range(3, 9); }
    if (c.blink > 0) c.blink -= dt;
    const shut = c.blink > 0 ? 0.08 : 1;
    c.parts.eyes[0].scale.set(1, Math.max(0.05, c.wake * shut), 1);
    c.parts.eyes[1].scale.set(1, Math.max(0.05, clamp(c.wake * 1.7 - 0.7, 0, 1) * shut), 1);

    // one ear, occasionally, which is the only part of him with any hurry in it
    c.twitchIn -= dt;
    if (c.twitchIn <= 0) { c.twitch = 0.28; c.twitchIn = rng.range(3, 11); }
    if (c.twitch > 0) c.twitch -= dt;
    const flick = c.twitch > 0 ? Math.sin((0.28 - c.twitch) / 0.28 * Math.PI * 3) * 0.35 : 0;
    c.parts.ears[0].rotation.x = flick;
    c.parts.ears[1].rotation.x = flick * 0.2;
  }

  /* ------------------------------- the robin ------------------------------ *
   * The one that comes to you.  A robin does not walk: it stands, decides,
   * and arrives somewhere else — so the movement is a chain of little arcs
   * with the pauses left in, and the pauses are most of what reads as a
   * robin.  It keeps a metre or so between you, follows you about the wood,
   * and goes back to its own spot when you leave it. */
  const HOP_T = 0.24, HOP_D = 0.15, LEASH = 8;
  function robin(c, dt, hog, state, near) {
    // the head cock: a sharp tilt, held, and let go. Never eased into.
    c.cockIn -= dt;
    if (c.cockIn <= 0) {
      c.cockIn = rng.range(1.4, 4.5);
      c.cock = rng.range(0.35, 0.65) * rng.sign();
    }
    c.cock = damp(c.cock, 0, 1.4, dt);
    c.parts.head.rotation.x = c.cock;

    if (c.flick > 0) {
      c.flick -= dt;
      c.parts.tail.rotation.z = Math.PI / 2 + Math.sin(c.flick / 0.3 * Math.PI * 2) * 0.28;
    }

    if (c.hop > 0) {
      c.hop -= dt;
      const k = clamp(1 - Math.max(0, c.hop) / HOP_T, 0, 1);
      c.x = c.fx + (c.tx - c.fx) * k;
      c.z = c.fz + (c.tz - c.fz) * k;
      c.lift = Math.sin(k * Math.PI) * 0.045;
      if (c.hop <= 0) { c.flick = 0.3; c.pause = rng.range(0.16, 0.7); }
      return;
    }
    c.lift = 0;
    c.pause -= dt;
    if (c.pause > 0) return;

    /* Where it would rather be: a bird's length and a bit off him while he is
     * about, its own spot when he is not.  `towards` is a true slerp, so the
     * standoff is a real distance and not a flat approximation that would put
     * it inside him at this latitude. */
    let goal;
    if (near < 7 && !hog.under) {
      goal = towards(hog.x, hog.z, c.x, c.z, 1.15, _goal);
      if (distance(goal.x, goal.z, c.home.x, c.home.z) > LEASH) goal = c.home;
    } else {
      goal = c.home;
    }

    const away = distance(c.x, c.z, goal.x, goal.z);
    if (away < 0.22) { c.pause = rng.range(0.5, 2.2); return; }

    // it turns to where it is going before it goes: a robin never hops sideways
    c.yaw = bearing(c.x, c.z, goal.x, goal.z).angle;
    const step = towards(c.x, c.z, goal.x, goal.z, Math.min(HOP_D, away), _step);
    c.fx = c.x; c.fz = c.z;
    c.tx = step.x; c.tz = step.z;
    c.hop = HOP_T;
  }

  /* -------------------------------- the toad ------------------------------ *
   * Nothing moves but her throat, and she blinks about once a minute.  That
   * is the character: the only animal in the wood you could mistake for a
   * stone, told entirely by two things that are alive. */
  function toad(c, dt, hog, state, near) {
    const th = c.parts.throat;
    const pulse = 1 + Math.max(0, Math.sin(c.t * 3.1)) * 0.22;
    th.scale.set(th.userData.base.x * pulse, th.userData.base.y * pulse, th.userData.base.z * pulse);

    c.blinkIn -= dt;
    if (c.blinkIn <= 0) { c.blink = 0.3; c.blinkIn = rng.range(20, 60); }
    if (c.blink > 0) c.blink -= dt;
    /* A toad blinks by pulling its eyes down into its head, which is the
     * strangest thing about her and worth the three lines it costs. */
    const sink = c.blink > 0 ? Math.sin((0.3 - c.blink) / 0.3 * Math.PI) : 0;
    for (const e of c.parts.eyes) e.position.y = 0.040 - sink * 0.009;

    // she turns her whole self, because she has no neck to turn instead
    c.yaw = wrapAng(c.yaw + damp(0, wrapAng(c.look - c.yaw), 0.35, dt));
  }

  /* ----------------------------- the wood mouse --------------------------- *
   * She will not stay still.  There is a constant micro-tremble under
   * everything, a dart to somewhere else every few seconds, and a freeze the
   * instant he comes close — which is the true behaviour and also the funny
   * one: the fastest animal in the wood deals with danger by becoming a
   * pebble. */
  function mouse(c, dt, hog, state, near) {
    // ears, never in step with one another
    c.parts.ears[0].rotation.x = c.parts.ears[0].userData.rest + Math.sin(c.t * 7.3) * 0.16;
    c.parts.ears[1].rotation.x = c.parts.ears[1].userData.rest + Math.sin(c.t * 5.9 + 1.1) * 0.16;
    c.parts.tail.rotation.y = 0.35 + Math.sin(c.t * 3.7) * 0.5;

    const frozen = near < 1.3;
    if (frozen) {
      /* Frozen, and the tremble goes *up*: she is not calm, she is holding
       * still, and those are different animals. */
      c.lift = Math.abs(Math.sin(c.t * 22)) * 0.0018;
      c.dart = 0;
      c.dartIn = rng.range(0.6, 1.8);
      return;
    }
    c.lift = Math.abs(Math.sin(c.t * 14)) * 0.0012;

    if (c.dart > 0) {
      c.dart -= dt;
      const step = towards(c.x, c.z, c.gx, c.gz, 0.95 * dt, _step);
      c.x = step.x; c.z = step.z;
      if (distance(c.x, c.z, c.gx, c.gz) < 0.03) c.dart = 0;
      return;
    }

    c.dartIn -= dt;
    if (c.dartIn > 0) return;
    c.dartIn = rng.range(1.1, 3.6);
    const a = rng.range(0, TAU);
    const d = rng.range(0.15, 0.55);
    // her whole world is half a metre of leaf litter, and she knows all of it
    const spot = offsetFrom(CENTRE[WOOD], c.at.u + Math.cos(a) * d, c.at.v + Math.sin(a) * d);
    c.gx = spot.x; c.gz = spot.z;
    c.dart = 1.2;
    c.yaw = bearing(c.x, c.z, c.gx, c.gz).angle;
  }

  const ACT = { badger, robin, toad, mouse };

  function update(dt, hog, state) {
    for (const c of all) {
      const near = distance(hog.x, hog.z, c.x, c.z);

      /* Culled off *him*, like the grass chunks and the butterflies. Past
       * fifteen metres the horizon has already taken them. */
      const seen = near < SEE && !(c.key === 'toad' && (state?.snow ?? 0) > 0.5);
      if (c.obj.visible !== seen) c.obj.visible = seen;
      if (!seen) {
        // the robin goes back to its own spot while nobody is looking
        if (c.key === 'robin') { c.x = c.home.x; c.z = c.home.z; c.hop = 0; }
        continue;
      }

      idle(c, dt, hog, near);
      ACT[c.key](c, dt, hog, state, near);
      seat(c.obj, c.x, heightAt(c.x, c.z) + c.lift, c.z, c.yaw);
    }
  }

  /**
   * The nearest character within reach of him, or null — the same shape as
   * `world.nearest`, so the caller can treat a resident and an interactable
   * alike.  Only ones he can actually see: being spoken to by something that
   * is not drawn is worse than silence.
   *
   * Each one carries its own reach (see `TEMPER.talk`); `reach` overrides
   * the lot of them, which is what a test wants and nothing else does.  The
   * pick is still by plain distance, so standing at the badger's door while
   * the robin hops about you gets you the badger — the one you walked to.
   */
  function nearest(x, z, reach = 0) {
    let best = null;
    let bd = Infinity;
    for (const c of all) {
      if (!c.obj.visible) continue;
      const d = distance(x, z, c.x, c.z);
      if (d < (reach || c.talk) && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  return { group, all, update, nearest };
}
