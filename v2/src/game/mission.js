import * as THREE from 'three';
import { flat } from '../core/toon.js';
import { clamp, lerp, sstep, rngKit, TAU } from '../core/util.js';
import { R, CENTER, positionAt, basisAt } from '../world/planet.js';
import { PAD, PAD_U, PAD_V, CENTRE, MIRE, offsetFrom, dirAt } from '../world/plan.js';
import { heightAt } from '../world/terrain.js';

/* ------------------------------------------------------------------ *
 * The flight to Mars.
 *
 * He finds the Starship, he climbs into it, and he goes.  This module owns
 * the whole of that: the countdown, the ascent, hot-stage separation, the
 * coast, the turn, entry, the belly-flop flip, the landing burn, and the
 * hedgehog getting out onto another planet.
 *
 * ------------------------- the one big decision -------------------------
 *
 * **Mars is this planet, re-dressed while you are not looking at it.**
 *
 * The alternative was a second body with a second radius, a second
 * `heightAt`, a second tangent frame — and `planet.js` exports `R`, `CENTER`
 * and `positionAt` as module constants that the ground, the grass, every
 * prop, his feet, the camera and the weather all read directly.  Making
 * those switchable is a rewrite of everything, to arrive at a Mars that
 * behaves exactly like the sphere we already have.
 *
 * So the ship really does leave: it climbs off the mount, the meadow really
 * does shrink underneath it, and the stars really do come out.  Five
 * kilometres up, with the planet thirty pixels wide and the camera facing
 * the other way, the world's palette ramps to Mars over two seconds and
 * everything that grows on it is switched off.  Then the ship turns round
 * and comes down onto a red planet.
 *
 * Every frame of that is real geometry with real depth — nothing is a
 * backdrop and nothing is a cut.  And it buys the thing that matters most:
 * **walking on Mars is free**, because it is the same sphere, so his feet,
 * the horizon, the camera and the footprints all work the day they arrive
 * rather than being a second implementation of each.
 *
 * The one cost is that you must never see the swap.  `TURN` is what pays
 * for it: the camera is looking forward, into the dark, at the point where
 * the ground behind changes colour.
 *
 * ---------------------------- how it is driven ---------------------------
 *
 * One clock, a table of phases, and **position is a function of time** —
 * not an integration.  A cutscene that integrates velocity drifts if a frame
 * is long, and this one has to put a rocket on a specific patch of ground
 * forty seconds later.  `dt` is clamped by `tick()` but a tab that is
 * restored after a minute would still land it in the sea.
 * ------------------------------------------------------------------ */

/** Seconds each. Read straight through and it is the flight. */
const SEQ = [
  ['board', 2.2],       // he goes up the tower and in
  ['ignition', 2.8],    // the mount floods, the engines light, it is held down
  ['liftoff', 5.5],     // it lets go, slowly, the way they actually do
  ['ascent', 5.2],      // and then not slowly at all; the meadow curves away
  ['stage', 2.6],       // hot-stage: the booster lets go and falls back
  ['coast', 6.5],       // out of the sky and into the dark
  ['turn', 3.0],        // the world behind becomes another one
  ['entry', 4.6],       // in belly-first, on the far side
  ['flip', 2.4],        // the flip, which is the whole reason to watch
  ['land', 4.4],        // the burn, and the dust
  ['down', 2.6],        // settle, and the door
];

const TOTAL = SEQ.reduce((a, p) => a + p[1], 0);

/**
 * Metres from the ground to the **bottom of the vehicle** at the end of each
 * phase.  The shape of the flight, and the one number the whole thing is
 * driven from.
 *
 * It starts at 20 rather than 0 because that is the mount's deck: the rocket
 * is standing on a table, not on the mire.  Getting this wrong is not subtle
 * — the first version measured from the stack's own origin, which is the
 * deck, so the landed Starship stood a hundred and thirteen metres above
 * Mars on nothing at all.
 */
const ALT = {
  board: 20, ignition: 20, liftoff: 150, ascent: 1100, stage: 1900,
  coast: 5200, turn: 5200, entry: 900, flip: 380, land: 0, down: 0,
};

/** The launch mount's deck, and so the vehicle's own zero before it flies. */
const DECK = 20;

/** Where on the planet Mars's landing site is, in the mire's own frame. */
const SITE_U = PAD_U - 26, SITE_V = PAD_V + 18;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
/** Not quite black: a dead-black sky reads as a hole rather than as space. */
const SPACE = new THREE.Color(0x05060e);
const _sp = new THREE.Color();

export function createMission({
  scene, camera, chase, hog, world, hud, climate, sky, audio, game, puffs,
  renderer = null,
}) {
  const pad = world.out.pad;

  /* --------------------------- where it is going --------------------------- */
  const site = offsetFrom(CENTRE[MIRE], SITE_U, SITE_V);
  const siteH = heightAt(site.x, site.z);
  const padH = heightAt(PAD.x, PAD.z);
  const padDir = dirAt(PAD.x, PAD.z, new THREE.Vector3());
  const siteDir = dirAt(site.x, site.z, new THREE.Vector3());

  /* ------------------------------- the plume ------------------------------- *
   * Unlit and additive, because it is emitted light and §5's rule is that
   * emitted light may never darken what is behind it.  Two cones: a white
   * core and a wider orange envelope, which is what a Raptor actually looks
   * like from outside a flame trench. */
  const plumeGeo = new THREE.ConeGeometry(1, 1, 14, 1, true);
  plumeGeo.translate(0, -0.5, 0);          // hangs down from its own origin
  const plumeMat = flat({
    color: 0xffd9a0, transparent: true, opacity: 0.85, fog: false,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const coreMat = flat({
    color: 0xfff6e0, transparent: true, opacity: 0.95, fog: false,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const plume = new THREE.Mesh(plumeGeo, plumeMat);
  const core = new THREE.Mesh(plumeGeo, coreMat);
  plume.renderOrder = 8; core.renderOrder = 9;
  plume.frustumCulled = false; core.frustumCulled = false;
  plume.visible = false; core.visible = false;
  scene.add(plume, core);

  /* ------------------------------ the stars -------------------------------- *
   * The sky dome's own stars stop at its radius and go out with the daylight.
   * These are for space, so they are on a shell far outside anything else and
   * they do not care what hour it is. */
  const starGeo = new THREE.BufferGeometry();
  {
    const rng = rngKit(4242);
    const n = 1400;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const z = rng.range(-1, 1);
      const a = rng.range(0, TAU);
      const r = Math.sqrt(1 - z * z);
      const d = 9000;
      p[i * 3] = Math.cos(a) * r * d;
      p[i * 3 + 1] = Math.sin(a) * r * d;
      p[i * 3 + 2] = z * d;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 26, sizeAttenuation: true,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -20;
  stars.visible = false;
  scene.add(stars);

  /* ------------------------------ state ------------------------------------ */
  const st = {
    live: false,
    phase: null,
    t: 0,                 // seconds into the whole flight
    alt: 0,
    staged: false,
    landed: false,
    onMars: false,
    thrust: 0,
  };

  /* What was true of the world before we took it apart, so nothing is guessed
   * at when it is put back. */
  let savedFog = null;
  let savedFar = 0;
  let savedFov = 0;
  let savedClear = null;
  let booster = null;
  let boosterHome = null;

  /* He is inside the ship for the whole flight, which means not drawn — and
   * his ground shadow is a separate object that would otherwise stay behind
   * on the pad, a hedgehog-shaped smudge on an empty launch site. */
  const setHogSeen = (on) => {
    if (hog.root) hog.root.visible = on;
    if (hog.parts?.shadow) hog.parts.shadow.visible = on;
  };

  const camEye = new THREE.Vector3();
  const camAim = new THREE.Vector3();
  let camSeeded = false;

  /** Phase-local 0..1, and which phase we are in. */
  function phaseAt(t) {
    let acc = 0;
    for (const [name, dur] of SEQ) {
      if (t < acc + dur || name === SEQ[SEQ.length - 1][0]) {
        return { name, u: clamp((t - acc) / dur, 0, 1), start: acc, dur };
      }
      acc += dur;
    }
    return { name: 'down', u: 1, start: acc, dur: 1 };
  }

  /** Altitude at time `t`, eased across the phase table above. */
  function altAt(t) {
    let acc = 0;
    /* It starts ON the mount, not on the mire.  Seeded at zero, the first
     * phase ramped the vehicle up from the ground to the deck — a rocket
     * that spends its countdown rising out of the bog to meet its own
     * launch mount. */
    let prev = DECK;
    for (const [name, dur] of SEQ) {
      const to = ALT[name];
      if (t < acc + dur) {
        const u = clamp((t - acc) / dur, 0, 1);
        /* Up is squared and down is the mirror of it: a rocket leaves slowly
         * and arrives slowly, and a linear ramp reads as a lift. */
        const e = to > prev ? u * u : 1 - (1 - u) * (1 - u);
        return lerp(prev, to, e);
      }
      acc += dur;
      prev = to;
    }
    return 0;
  }

  /** 0 over the pad, 1 over the landing site. The transfer, done while high. */
  function crossAt(t) {
    const p = phaseAt(t);
    if (p.name === 'coast') return sstep(0, 1, p.u) * 0.55;
    if (p.name === 'turn') return 0.55 + sstep(0, 1, p.u) * 0.45;
    if (['entry', 'flip', 'land', 'down'].includes(p.name)) return 1;
    return 0;
  }

  /** Where the ship is at time `t`, in world space. */
  function shipAt(t, out = new THREE.Vector3()) {
    const k = crossAt(t);
    _a.copy(padDir).lerp(siteDir, k).normalize();
    return out.copy(_a).multiplyScalar(R + lerp(padH, siteH, k) + altAt(t)).add(CENTER);
  }

  /**
   * Which way the nose points.
   *
   * Straight up on the way off the pad; leaning into the transfer as it goes;
   * **belly-first** through entry, which is the pose the vehicle is famous
   * for and the reason the flip exists; and vertical again for the burn.
   */
  function noseAt(t, out = new THREE.Vector3()) {
    const p = phaseAt(t);
    const k = crossAt(t);
    _b.copy(padDir).lerp(siteDir, k).normalize();          // local up
    // the way it is travelling across the planet, in the tangent plane
    _c.copy(siteDir).sub(_b.clone().multiplyScalar(siteDir.dot(_b)));
    if (_c.lengthSq() < 1e-9) _c.copy(padDir).cross(_b);
    _c.normalize();

    let tilt = 0;                                          // radians off vertical
    if (p.name === 'liftoff') tilt = p.u * 0.06;
    else if (p.name === 'ascent') tilt = lerp(0.06, 0.55, sstep(0, 1, p.u));
    else if (p.name === 'stage') tilt = 0.62;
    else if (p.name === 'coast') tilt = lerp(0.62, 1.35, sstep(0, 1, p.u));
    else if (p.name === 'turn') tilt = 1.35;
    /* Entry is belly-down: past a right angle, so the underside faces the way
     * it is going and the whole vehicle is the airbrake. */
    else if (p.name === 'entry') tilt = lerp(1.35, 1.62, sstep(0, 1, p.u));
    else if (p.name === 'flip') tilt = lerp(1.62, 0, sstep(0, 1, p.u));
    else tilt = 0;

    return out.copy(_b).multiplyScalar(Math.cos(tilt))
      .addScaledVector(_c, Math.sin(tilt)).normalize();
  }

  /** How hard the engines are burning, 0..1 — plume, dust, sound and shake. */
  function thrustAt(t) {
    const p = phaseAt(t);
    switch (p.name) {
      case 'ignition': return sstep(0.45, 0.98, p.u) * 0.9;
      case 'liftoff': return 1;
      case 'ascent': return 1;
      case 'stage': return p.u < 0.35 ? 0 : 0.55;      // the gap you can hear
      case 'coast': return p.u < 0.25 ? 0.55 : 0;
      case 'entry': return 0;
      case 'flip': return p.u > 0.6 ? 0.5 : 0;
      case 'land': return p.u < 0.9 ? 1 : sstep(1, 0.9, p.u);
      default: return 0;
    }
  }

  /* ------------------------------ the camera ------------------------------- *
   *
   * Two rules, both learned the hard way elsewhere in this project.
   *
   * **It is placed, not flown.**  Every shot below is an explicit eye and an
   * explicit thing to look at, derived from where the ship is *now*.  A
   * camera integrated from a velocity drifts, and forty seconds is a long
   * time to drift.
   *
   * **And it eases.**  The eye damps toward its target rather than snapping,
   * so the joins between shots read as one moving camera rather than eleven
   * cuts — except the first frame, which is seeded so that the opening shot
   * does not come flying in from wherever the chase camera was.
   */
  /**
   * The side the camera works from, as a real place on the planet rather
   * than a cross product.
   *
   * It has to be **away from the tower**, which stands `TOWER_OUT` along +u
   * from the pad: derived off the world axes it landed on the tower's side
   * and the first launch was shot through a lattice, with the rocket a white
   * sliver behind a girder.  A viewpoint the builder chose is a viewpoint
   * that cannot drift when something else moves.
   */
  const view = offsetFrom(CENTRE[MIRE], PAD_U - 6, PAD_V + 40);
  const viewDir = dirAt(view.x, view.z, new THREE.Vector3());

  function frameShot(t, ship, nose) {
    const p = phaseAt(t);
    const up = _b.copy(padDir).lerp(siteDir, crossAt(t)).normalize();
    // the camera's side, squared to the local up so it stays a horizontal offset
    _d.copy(viewDir).addScaledVector(up, -viewDir.dot(up));
    if (_d.lengthSq() < 1e-9) _d.set(1, 0, 0);
    _d.normalize();

    switch (p.name) {
      case 'board':
      case 'ignition': {
        /* Close in at the foot of it, looking up the stack past the mount.
         * The engines are the thing at this point in a launch, and they are
         * the one part of it you can be near enough to see whole. */
        camera.fov = 40;
        camera.updateProjectionMatrix();
        camEye.copy(positionAt(view.x, heightAt(view.x, view.z) + 12, view.z, _c.clone()));
        camAim.copy(ship).addScaledVector(up, 26);
        return;
      }
      case 'liftoff': {
        /* **And then the camera has to leave the ground.**
         *
         * You cannot stand back far enough to see this thing.  The horizon
         * from a metre up on a 47.75 m planet is eleven metres, and to hold
         * 123 m of rocket in a 34-degree frame you need to be two hundred
         * out — by which point the pad is a long way under the curve, because
         * a viewpoint at ground distance `d` needs to be `d²/2R` up just to
         * see the pad at all, and that is four hundred metres at 200.
         *
         * So the shot climbs with it: from twelve metres up at the fence to
         * three hundred and fifty as it goes, which is the only way to get
         * the whole vehicle and the world it is leaving into one frame.  It
         * is not a cheat; it is what this planet costs.
         */
        const k = sstep(0, 1, p.u);
        camera.fov = lerp(40, 32, k);
        camera.updateProjectionMatrix();
        _c.copy(positionAt(view.x, heightAt(view.x, view.z), view.z, new THREE.Vector3()));
        camEye.copy(_c)
          .addScaledVector(up, lerp(12, 300, k * k))
          .addScaledVector(_d, lerp(0, 120, k));
        camAim.copy(ship).addScaledVector(up, lerp(26, 66, k));
        return;
      }
      case 'ascent': {
        /* **Above it and looking down past it**, so the meadow is in the
         * frame behind the rocket and you can see it shrinking.  Below it,
         * which is where this camera was first put, all you get is sky. */
        /* Out to the side and only a little above, so the vehicle is in
         * profile with the world under it.  High and behind — which is where
         * this was first put — gives you a view down the engine bells and a
         * plume coming at the lens, and the rocket itself off the top of the
         * frame. */
        camera.fov = lerp(34, 44, sstep(0, 1, p.u));
        camera.updateProjectionMatrix();
        const back = lerp(140, 420, sstep(0, 1, p.u));
        camEye.copy(ship)
          .addScaledVector(_d, back)
          .addScaledVector(up, back * 0.16);
        camAim.copy(ship).addScaledVector(up, lerp(50, 20, sstep(0, 1, p.u)));
        return;
      }
      case 'stage': {
        // side-on and close: the separation is the thing worth being near
        camera.fov = 42; camera.updateProjectionMatrix();
        camEye.copy(ship).addScaledVector(_d, 150).addScaledVector(up, 30);
        camAim.copy(ship).addScaledVector(up, 30);
        return;
      }
      case 'coast': {
        /* Beside it and looking forward past the nose into the dark.  This is
         * the shot that pays for the swap: from here the planet is behind
         * you and off frame, which is the only reason a whole world may
         * change colour while you watch. */
        const k = sstep(0, 1, p.u);
        camera.fov = 46; camera.updateProjectionMatrix();
        camEye.copy(ship).addScaledVector(_d, lerp(150, 90, k)).addScaledVector(up, 40);
        camAim.copy(ship).addScaledVector(nose, lerp(120, 1400, k));
        return;
      }
      case 'turn': {
        camEye.copy(ship).addScaledVector(_d, 90).addScaledVector(up, 40);
        camAim.copy(ship).addScaledVector(nose, 1400);
        return;
      }
      case 'entry': {
        // level with it and out to the side, so Mars fills the frame beyond
        camera.fov = 46; camera.updateProjectionMatrix();
        camEye.copy(ship).addScaledVector(_d, 130).addScaledVector(up, 34);
        camAim.copy(ship);
        return;
      }
      case 'flip': {
        // in tight for the flip, which is the whole reason to watch a landing
        camera.fov = lerp(46, 40, p.u); camera.updateProjectionMatrix();
        camEye.copy(ship).addScaledVector(_d, 110).addScaledVector(up, 26);
        camAim.copy(ship).addScaledVector(up, 26);
        return;
      }
      case 'land': {
        const k = sstep(0, 1, p.u);
        camera.fov = 40; camera.updateProjectionMatrix();
        camEye.copy(ship).addScaledVector(_d, lerp(110, 96, k)).addScaledVector(up, lerp(40, 26, k));
        camAim.copy(ship).addScaledVector(up, lerp(40, 24, k));
        return;
      }
      default: {
        /* Settling to something a chase camera could plausibly take over
         * from — but not so close that the ship he arrived in is out of
         * frame.  Fifty-two metres of Starship standing on Mars is the shot
         * the whole flight was for. */
        const k = sstep(0, 1, p.u);
        camera.fov = lerp(40, 45, k); camera.updateProjectionMatrix();
        camEye.copy(ship).addScaledVector(_d, lerp(96, 62, k)).addScaledVector(up, lerp(26, 14, k));
        camAim.copy(ship).addScaledVector(up, lerp(24, 16, k));
      }
    }
  }

  /* ---------------------------- becoming Mars ------------------------------ */

  /**
   * Everything that grows, flies, or belongs to the meadow — and everything
   * he left standing on the launch pad.
   *
   * **The landing site is thirty-one metres from the pad**, which is nothing
   * on a planet 300 m round, so the tower, the mount and the tank farm were
   * all still there in frame when he touched down: a Mars with a Starbase
   * already on it, which is a funnier picture than it is a correct one.  He
   * took the rocket and left the ground works, and that is what has to be
   * true of what is drawn.
   */
  function greenThings() {
    const out = [];
    if (world.grass?.group) out.push(world.grass.group);
    if (world.water?.group) out.push(world.water.group);
    world.root.traverse((o) => {
      if (o === world.root) return;
      if (o.name && (o.name.startsWith('place:') || o.name === 'brambles')) out.push(o);
    });
    /* The pad's own works, by name rather than by traversal: they are rigid
     * groups sitting directly in the world root and share it with the ship,
     * which must NOT be hidden — he is arriving in it. */
    for (const k of ['mount', 'tower', 'apron']) if (pad?.[k]) out.push(pad[k]);
    for (const t of pad?.tanks || []) out.push(t);
    /* And the wildlife.  Nothing that flew, hopped or lived in the wood
     * belongs on Mars, and every one of them is ranged off *him* — so they
     * would have followed him there and gone on being a robin. */
    for (const g of extras) if (g) out.push(g);
    /* And everything the game itself put down: the burrow, the thistle, and
     * every flower, snowman and mushroom ever sown.  They all live in one
     * group for exactly this. */
    const sown = world.root.parent?.getObjectByName?.('sown');
    if (sown) out.push(sown);
    return out;
  }

  /* Set by `main.js`: the groups that are neither world nor pad and would
   * otherwise come along. */
  const extras = [];

  /* ------------------------------ the surface ------------------------------ *
   *
   * A planet with nothing on it is a ball, not a place.  Mars gets boulders,
   * the drifts of dust that pile up behind them, and craters — laid out
   * around the landing site rather than over the whole globe, because he
   * arrives in one spot and the horizon from his eye is eleven metres.
   *
   * A crater is drawn rather than dug.  Cutting one into `heightAt` would
   * mean a second source of ground for the one thing in this world that has
   * exactly one (§5), and every prop, blade and footfall reads that function
   * — so a rim you could walk up would also be a rim the whole planet had to
   * agree about.  These are rings laid ON the surface, which is what the
   * mire's standing pools are and for the same reason.
   */
  const marsGround = new THREE.Group();
  marsGround.name = 'mars';
  marsGround.visible = false;
  scene.add(marsGround);
  {
    const rng = rngKit(9081);
    const rockMat = flat({ color: 0x6b4230, fog: true });
    const rimMat = flat({ color: 0x9c6b47, fog: true });
    const floorMat = flat({ color: 0x7a4c34, fog: true });
    const put = (obj, u, v, yaw = 0, lift = 0) => {
      const p = offsetFrom(CENTRE[MIRE], SITE_U + u, SITE_V + v);
      const b = basisAt(p.x, p.z);
      _m.makeBasis(b.east, b.up, b.north);
      _m.setPosition(positionAt(p.x, heightAt(p.x, p.z) + lift, p.z, _c));
      obj.matrix.copy(_m);
      if (yaw) obj.rotateY(yaw);
      obj.matrixAutoUpdate = false;
      obj.matrixWorldNeedsUpdate = true;
      marsGround.add(obj);
    };
    /* Boulders — and **twice as many close in as a plain scatter gives you**.
     * `sqrt` over a disc spreads by area, which is right for a field seen
     * from above and wrong for one walked through by something 26 cm tall:
     * the first pass put its nearest rock twenty-two metres away and he
     * landed on a billiard table.  Half of them are dealt into the first
     * twelve metres, where he can actually see them. */
    for (let i = 0; i < 260; i++) {
      const a = rng.range(0, TAU);
      const near = i % 2 === 0;
      const d = near ? 1.6 + Math.sqrt(rng.next()) * 11 : 8 + Math.sqrt(rng.next()) * 44;
      const r = rng.range(0.05, near ? 0.26 : 0.52) * (d > 22 ? 1.8 : 1);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rockMat);
      m.scale.set(1, rng.range(0.35, 0.7), rng.range(0.8, 1.2));
      m.castShadow = true; m.receiveShadow = true;
      put(m, Math.cos(a) * d, Math.sin(a) * d, rng.range(0, TAU), -r * 0.25);
    }
    /* Craters: a pale raised rim and a darker floor, both flat rings on the
     * ground.  Two rings and no geometry in between is enough — what names a
     * crater at this size is the *ring*, not the bowl. */
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, TAU);
      const d = 6 + Math.sqrt(rng.next()) * 44;
      const r = rng.range(1.2, 6.5);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(r, 22).rotateX(-Math.PI / 2), floorMat);
      floor.receiveShadow = true;
      put(floor, Math.cos(a) * d, Math.sin(a) * d, 0, 0.012);
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(r, r * 1.16, 24).rotateX(-Math.PI / 2), rimMat
      );
      put(rim, Math.cos(a) * d, Math.sin(a) * d, 0, 0.02);
    }
  }

  let hidden = null;
  function dressMars(on) {
    if (on && !hidden) {
      hidden = greenThings();
      /* And the weather.  Mars has clouds, but they are thin high water-ice
       * and nothing whatever like the fat cumulus this sky makes — a
       * butterscotch sky with cauliflower clouds in it reads as a filter
       * over the meadow rather than as another planet. */
      if (sky?.clouds?.group) hidden.push(sky.clouds.group);
      for (const o of hidden) o.visible = false;
      marsGround.visible = true;
      st.onMars = true;
    } else if (!on && hidden) {
      for (const o of hidden) o.visible = true;
      marsGround.visible = false;
      hidden = null;
      st.onMars = false;
    }
  }

  /* ------------------------------ the flight ------------------------------- */

  function begin() {
    if (st.live || st.onMars) return false;
    st.live = true;
    st.t = 0;
    st.staged = false;
    st.landed = false;
    camSeeded = false;

    savedFog = scene.fog;
    savedFar = camera.far;
    savedFov = camera.fov;
    scene.fog = null;
    camera.far = 24000;
    camera.updateProjectionMatrix();

    /* **The stack's origin becomes the bottom of the vehicle.**  It is built
     * standing on the mount, so its children sit `DECK` metres up from it;
     * flying it means measuring from its feet instead, and `ALT` starts at
     * `DECK` so nothing moves at the moment of the change. */
    if (pad?.booster) pad.booster.position.y -= DECK;
    if (pad?.ship) pad.ship.position.y -= DECK;

    hog.stop?.();
    setHogSeen(false);
    hud.clearFlash?.();
    hud.flash('up the tower, and in. he has never been this high.');
    audio?.home?.();
    return true;
  }

  function finish() {
    st.live = false;
    st.landed = true;
    scene.fog = savedFog;
    camera.far = savedFar;
    camera.fov = savedFov || camera.fov;
    camera.updateProjectionMatrix();
    if (renderer && savedClear) renderer.setClearColor(savedClear, 1);
    if (sky?.group) sky.group.visible = true;
    stars.visible = false;
    plume.visible = false;
    core.visible = false;
    setHogSeen(true);
    /* Out of the ship and onto the ground beside it, facing away from it,
     * because the first thing anybody does is turn round and look. */
    const p = offsetFrom(CENTRE[MIRE], SITE_U + 0.9, SITE_V);
    hog.x = p.x; hog.z = p.z; hog.y = heightAt(p.x, p.z);
    hog.hd = 0;
    hog.target = null;
    chase._seeded = false;
    hud.flash('Mars. he is the first hedgehog to stand on it.');
    game?.note?.('mars');
  }

  function update(dt) {
    if (!st.live) return false;
    st.t = Math.min(st.t + dt, TOTAL);
    const p = phaseAt(st.t);
    st.phase = p.name;
    st.alt = altAt(st.t);
    st.thrust = thrustAt(st.t);

    const ship = shipAt(st.t, _a.clone());
    const nose = noseAt(st.t, new THREE.Vector3());

    /* --- the vehicle --- */
    if (pad?.stack) {
      pad.stack.position.copy(ship);
      /* Its own +y is the nose.  One `makeBasis` and no Euler angles: a
       * rocket that rolls because two rotations were composed in the wrong
       * order is the classic way to get this wrong. */
      _c.set(0, 1, 0).crossVectors(nose, padDir);
      if (_c.lengthSq() < 1e-8) _c.crossVectors(nose, siteDir);
      _c.normalize();
      _d.crossVectors(_c, nose).normalize();
      _m.makeBasis(_c, nose, _d);
      pad.stack.quaternion.setFromRotationMatrix(_m);
      pad.stack.matrixWorldNeedsUpdate = true;
    }

    /* --- hot staging --- */
    if (!st.staged && p.name === 'stage' && p.u > 0.3) {
      st.staged = true;
      /* What flies on from here is the ship alone, so IT becomes the bottom
       * of the vehicle — otherwise the thing that lands on Mars is a ship
       * held seventy-three metres up by a booster that is not there. */
      if (pad?.ship) pad.ship.position.y = 0;
      if (pad?.booster) {
        booster = pad.booster;
        boosterHome = booster.parent;
        booster.getWorldPosition(_b);
        booster.getWorldQuaternion(_q);
        scene.add(booster);
        booster.position.copy(_b);
        booster.quaternion.copy(_q);
        booster.userData.dropT = 0;
        booster.userData.dropFrom = _b.clone();
        booster.userData.dropDir = nose.clone();
      }
      audio?.thunder?.();
      hud.flash('the booster lets go, and falls back the way it came');
    }
    if (booster) {
      /* It falls back toward the planet and tumbles doing it, which is what
       * an empty seventy-metre tube does when nothing is holding it. */
      const d = (booster.userData.dropT += dt);
      booster.position.copy(booster.userData.dropFrom)
        .addScaledVector(booster.userData.dropDir, 40 * d)
        .addScaledVector(padDir, -0.5 * 22 * d * d);
      booster.rotateX(dt * 0.55);
      booster.rotateZ(dt * 0.22);
      if (d > 9) { booster.visible = false; }
    }

    /* --- the plume --- */
    const th = st.thrust;
    plume.visible = core.visible = th > 0.02;
    if (plume.visible) {
      const len = lerp(22, 110, th) * (p.name === 'land' ? 0.45 : 1);
      /* Hung off the tail, and pointing the right way — which took two goes.
       * The cone's geometry occupies local **-y**, so mapping local +y onto
       * `nose` puts the flame behind the vehicle; mapping it onto `-nose`,
       * which is what "the flame goes backwards" sounds like, sends it out
       * through the nose instead.  It flew the whole way to Mars with a
       * hundred-metre torch coming out of its own front. */
      _b.copy(ship).addScaledVector(nose, -1.5);
      for (const [mesh, w, l] of [[plume, 8.5, 1], [core, 3.8, 0.52]]) {
        mesh.position.copy(_b);
        mesh.quaternion.setFromUnitVectors(_d.set(0, 1, 0), nose);
        mesh.scale.set(w * lerp(0.5, 1, th), len * l, w * lerp(0.5, 1, th));
        mesh.material.opacity = (mesh === core ? 0.95 : 0.8) * th;
      }
    }

    /* --- the pad, on the way out --- */
    if ((p.name === 'ignition' || p.name === 'liftoff') && Math.random() < 0.6) {
      const q = positionAt(PAD.x, padH + 1, PAD.z, _c.clone());
      puffs?.burst?.(PAD.x, padH + 0.4, PAD.z, {
        n: 5, up: 0.5, spread: 6.5, px: 90, color: 0xd8cbb4,
      });
    }
    /* --- and the dust it throws up arriving --- */
    if (p.name === 'land' && p.u > 0.55 && Math.random() < 0.7) {
      puffs?.burst?.(site.x, siteH + 0.3, site.z, {
        n: 5, up: 0.4, spread: 5.5, px: 80, color: 0xc08a5e,
      });
    }

    /* --- space --- *
     *
     * Hiding the sky dome is only half of it.  What is behind the dome is the
     * renderer's **clear colour**, and that is the fog colour — so switching
     * the sky off at four kilometres up left the ship hanging in a flat pale
     * green, and the stars, which are white, were invisible against it.  The
     * clear colour has to go to black at the same rate the sky goes away. */
    const high = sstep(140, 1400, st.alt);
    stars.visible = high > 0.01;
    starMat.opacity = high * 0.95;
    stars.position.copy(camera.position);
    if (sky?.group) sky.group.visible = high < 0.995;
    if (renderer) {
      if (!savedClear) savedClear = renderer.getClearColor(new THREE.Color()).clone();
      renderer.setClearColor(_sp.copy(savedClear).lerp(SPACE, high), 1);
    }

    /* --- and Mars --- */
    if (p.name === 'turn') climate.setMars?.(sstep(0.08, 0.72, p.u));
    else if (['entry', 'flip', 'land', 'down'].includes(p.name)) climate.setMars?.(1);
    if (p.name === 'entry' && !hidden) dressMars(true);

    /* --- the camera --- */
    frameShot(st.t, ship, nose);
    if (!camSeeded) { camera.position.copy(camEye); camSeeded = true; }
    else camera.position.lerp(camEye, clamp(dt * 3.4, 0, 1));
    /* Up is the planet's up wherever we are over it, so the horizon stays
     * level and the frame does not roll on its way round the world. */
    _b.copy(camera.position).sub(CENTER).normalize();
    camera.up.copy(_b);
    camera.lookAt(camAim);

    if (st.t >= TOTAL) finish();
    return true;
  }

  return {
    state: st,
    begin,
    update,
    /** Where he must get to before there is anything to climb into. */
    site,
    /** Register a group that must not come to Mars. Called by `main.js`. */
    leaveBehind(...objs) { for (const o of objs) if (o) extras.push(o); },
    get active() { return st.live; },
    get onMars() { return st.onMars; },
    /** Seconds the whole thing takes, so the harness can run it out. */
    TOTAL,
    SEQ,
    phaseAt,
    altAt,
    shipAt,
    dressMars,
  };
}
