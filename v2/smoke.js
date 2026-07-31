/**
 * Headless smoke harness for v2.  `node smoke.js <scenario>`, or `all`.
 *
 * Same idea as v1's, and the same reason for existing: **six bugs got into
 * this build and five of them were invisible in the console.**  Two would
 * have been one line of assertion here — a summer with no grass in it
 * (`InstancedMesh.count` past the end of its buffer draws nothing, not 6 %
 * more), and a sun that ran backwards against its own clock.
 *
 * The difference from v1's harness is that it does not need to fake a
 * renderer.  three.js runs perfectly well in Node as long as nobody asks it
 * for a WebGL context, so this drives the **real** modules: the real terrain,
 * the real planet projection, the real world build, the real hedgehog, the
 * real hazards.  The only mock is a canvas that does nothing, because
 * `CanvasTexture` wants an object with a width and a height.
 *
 * Scenarios
 *   plan terrain planet clock      pure geometry and arithmetic, no world
 *   open                           there is no edge to the world
 *   gait roll face                 how he walks, how he rolls, and his face
 *   walk idle back water boat      the loop: he goes, he stops, he refuses
 *   road roadmiss abandon          the hazards, and v1's invincibility bug
 *   burrow grass nan               progression, the meadow, and finite maths
 *   all                            every one of them
 */

/* ------------------------------ the one mock ------------------------------ */
const noop = () => {};
const ctx2d = new Proxy({}, {
  get: (_, k) => {
    if (k === 'canvas') return { width: 1, height: 1 };
    if (k === 'measureText') return () => ({ width: 8 });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return () => ({ addColorStop: noop });
    }
    return noop;
  },
  set: () => true,
});
globalThis.document = {
  createElement: () => ({ width: 1, height: 1, getContext: () => ctx2d, style: {} }),
  createElementNS: () => ({ width: 1, height: 1, getContext: () => ctx2d, style: {} }),
  getElementById: () => null,
  addEventListener: noop,
};
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  addEventListener: noop, removeEventListener: noop,
};
globalThis.self = globalThis.window;

const THREE = await import('three');
const plan = await import('./src/world/plan.js');
const terrain = await import('./src/world/terrain.js');
const planet = await import('./src/world/planet.js');
const season = await import('./src/world/season.js');
const { buildWorld } = await import('./src/world/index.js');
const { buildPlaces } = await import('./src/world/places/index.js');
const { buildGrass } = await import('./src/world/grass.js');
const { Hog, HOG_SPD } = await import('./src/hog/hog.js');
const { wrapAng } = await import('./src/core/util.js');
const { buildHog, HOG_BODY } = await import('./src/hog/model.js');
const { createAnimator, STRIDE, STANCE } = await import('./src/hog/anim.js');
const { BALL_R } = await import('./src/hog/hog.js');
const { createGame } = await import('./src/game/game.js');
const { CULVERT_Z } = await import('./src/world/places/road.js');
const { cel, applyPalette } = await import('./src/core/toon.js');
const { createCritters } = await import('./src/world/critters.js');

/* ------------------------------- reporting ------------------------------- */
let checks = 0;
let failed = 0;

/** v1's convention: indented findings, `!!` on anything that is wrong. */
function ok(cond, what, detail = '') {
  checks++;
  if (cond) {
    console.log(`  ${what}${detail ? '  ' + detail : ''}`);
  } else {
    failed++;
    process.exitCode = 1;
    console.log(`  !! ${what}${detail ? '  ' + detail : ''}`);
  }
  return !!cond;
}

const f = (v, n = 2) => (typeof v === 'number' ? v.toFixed(n) : String(v));

/* --------------------------- the world, on demand -------------------------- */
let cached = null;
function makeWorld({ grass = false } = {}) {
  if (cached && cached.grass === grass) return cached;
  const scene = new THREE.Scene();
  const t0 = Date.now();
  const world = buildWorld(scene, { places: buildPlaces, grass });
  const hog = new Hog(world, { model: false });
  const hud = {
    msgs: [], flash(m) { this.msgs.push(m); },
    setHearts: noop, setPlace: noop, setStatus: noop, update: noop, begin: noop,
  };
  const climate = {
    DAY: season.DAY, YEAR: season.YEAR,
    state: {
      season: 'summer', hour: 'noon', night: 0, snow: 0, snowFall: 0,
      leafFall: 0, wet: 0, wind: 0.1, w: [0, 1, 0, 0],
      sunDir: new THREE.Vector3(0, 1, 0), dayPhase: 0, yearPhase: 0.3, lit: 0,
    },
  };
  const game = createGame({ world, hog, hud, climate });
  const step = (n, dt = 1 / 60, each = null) => {
    for (let i = 0; i < n; i++) {
      each?.(i);
      hog.update(dt, i * dt);
      game.update(dt);
      world.update(dt, hog, climate.state);
    }
  };
  const put = (x, z) => {
    hog.x = x; hog.z = z; hog.y = terrain.heightAt(x, z);
    hog.hurt = 0; hog.curl = 0; hog.under = false; hog.afloat = null;
    hog.target = null; hog.gait = 0; hog.walked = 0;
  };
  const centre = (kind) => plan.CENTRE[kind];
  cached = { grass, scene, world, hog, game, hud, climate, step, put, centre, ms: Date.now() - t0 };
  return cached;
}

/* ================================ scenarios =============================== */

function sPlan() {
  const { CIRC, COUNT, ORDER, CENTRE, CENTRES, R, arcBetween, LAKE, ROAD, TOWN } = plan;
  ok(CENTRES.length === COUNT, 'ten places, one per vertex of the antiprism', `${COUNT}`);

  /* The whole point of the layout: every place is exactly as far from its
   * neighbours as every other, so no place is a backwater and there is no
   * seam.  **Four** neighbours, not five — an icosahedron's ring vertex has
   * five, but one of those is a pole, and the poles are the two vertices
   * this layout leaves out. */
  const spacing = [];
  for (const a of CENTRES) {
    const ds = CENTRES.filter((b) => b !== a)
      .map((b) => arcBetween(a.dir, b.dir)).sort((p, q) => p - q);
    spacing.push(...ds.slice(0, 4));
  }
  const lo = Math.min(...spacing), hi = Math.max(...spacing);
  ok(hi - lo < 1e-6, 'every place is the same distance from all four neighbours',
    `${f(lo, 2)} m apart, to a millimetre`);

  /* v1's ordering rule: consecutive places must actually be adjacent, or the
   * walk stops being a walk. */
  let worstStep = 0;
  for (let i = 0; i < COUNT; i++) {
    const a = CENTRE[ORDER[i]], b = CENTRE[ORDER[(i + 1) % COUNT]];
    worstStep = Math.max(worstStep, arcBetween(a.dir, b.dir));
  }
  ok(Math.abs(worstStep - lo) < 1e-6,
    "and v1's order steps between neighbours the whole way round, and closes",
    `every step ${f(worstStep, 2)} m`);

  // the crossfade must always account for exactly one place's worth
  let worstSum = 1;
  for (let i = 0; i < 4000; i++) {
    const z = R * Math.asin(-1 + (2 * i) / 4000);
    const x = (i * 137.5) % CIRC;
    let sum = 0;
    for (const kind of ORDER) sum += plan.placeAmt(x, z, kind);
    if (Math.abs(sum - 1) > Math.abs(worstSum - 1)) worstSum = sum;
  }
  ok(Math.abs(worstSum - 1) < 1e-9, 'the place blend always sums to one',
    `worst ${f(worstSum, 6)} over 4 000 samples`);

  /* Every square metre belongs to somewhere.  In the banded world this was
   * trivially true along the equator and meaningless everywhere else. */
  let unclaimed = 0;
  for (let i = 0; i < 3000; i++) {
    const z = R * Math.asin(-1 + (2 * i) / 3000);
    const x = (i * 61.8) % CIRC;
    const m = plan.placeAt(x, z);
    if (m.a === undefined || m.arcA > 60) unclaimed++;
  }
  ok(unclaimed === 0, 'and every point on the planet belongs to a place');

  // the two hard surfaces stay where they belong
  const [lc, tc] = [CENTRE[LAKE], CENTRE[TOWN]];
  ok(plan.lakeAt(lc.x, lc.z) > 0.99 && plan.lakeAt(0, 0) === 0,
    'the lake is a disc round its own centre');
  ok(Math.abs(plan.roadOffset(CENTRE[ROAD].x, CENTRE[ROAD].z)) < 1e-6 &&
     Math.abs(plan.roadOffset(tc.x, tc.z)) < 1e-6,
    'and the road runs through the roadside and the town, as a great circle');

  const d = plan.wrapDelta(1, CIRC - 1);
  ok(Math.abs(d - 2) < 1e-9, 'longitudes wrap the short way across the seam', `Δ = ${f(d, 6)} m`);
}

function sTerrain() {
  const { CIRC, R } = plan;
  const { heightAt } = terrain;

  /* The relief is a function of the surface direction now, so being smooth
   * everywhere is a property of the *form* rather than something to be
   * tuned.  Both bugs the harness found in the banded version — a seam ridge
   * at one lap, and relief left sitting on a pole — cannot be expressed. */
  let seam = 0;
  for (let i = 0; i < 400; i++) {
    const z = R * Math.asin(-1 + (2 * i) / 400);
    seam = Math.max(seam, Math.abs(heightAt(0.0, z) - heightAt(CIRC, z)));
  }
  ok(seam < 1e-9, 'the ground closes on itself at one lap', `worst ${f(seam, 9)} m`);

  const spreadAt = (z) => {
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < CIRC; x += 2.3) {
      const h = heightAt(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  const POLE = R * Math.PI / 2;
  ok(spreadAt(POLE) < 1e-6, 'every longitude agrees on the height of the pole',
    `spread ${f(spreadAt(POLE), 9)} m`);

  /* No cliffs anywhere he can stand.  Stepped in metres of *ground*, which
   * means dividing the longitude step by cos(latitude) — the same correction
   * his own walk makes. */
  let steep = 0, at = null;
  for (let i = 0; i < 20000; i++) {
    const z = R * Math.asin(-1 + (2 * i) / 20000);
    const x = (i * 13.7) % CIRC;
    if (!terrain.walkableAt(x, z)) continue;
    const e = 0.4 / Math.max(0.08, Math.cos(z / R));
    if (!terrain.walkableAt(x + e, z)) continue;
    const d = Math.abs(heightAt(x + e, z) - heightAt(x, z));
    if (d > steep) { steep = d; at = [x, z]; }
  }
  ok(steep < 0.22, 'no cliffs anywhere he can stand',
    `worst rise ${f(steep, 3)} m per 0.4 m at ${at && at.map((v) => f(v, 1)).join(', ')}`);

  const lc = plan.CENTRE[plan.LAKE];
  ok(terrain.waterDepthAt(lc.x, lc.z) > 0.8, 'the lake has water in it',
    `${f(terrain.waterDepthAt(lc.x, lc.z))} m deep at the middle`);
  ok(!terrain.walkableAt(lc.x, lc.z), 'he cannot walk into the lake');

  const sh = terrain.lakeShore(0.7);
  ok(sh.d > 6 && sh.d < plan.LAKE_R + 1 && terrain.waterDepthAt(sh.x, sh.z) < 0.03,
    'and its shoreline is found where the bed crosses the water',
    `${f(sh.d)} m out from the middle`);
}

function sPlanet() {
  const { positionAt, flatAt, basisAt, R, CENTER } = planet;
  const v = new THREE.Vector3();
  const out = { x: 0, z: 0, y: 0 };

  let worst = 0;
  for (const [x, y, z] of [[0, 0, 0], [37, 0.4, -9], [-140, 2, 12], [299.5, 0, 30], [10, 0, 74]]) {
    positionAt(x, y, z, v);
    flatAt(v, out);
    worst = Math.max(worst, Math.abs(plan.wrapDelta(out.x, x)), Math.abs(out.z - z), Math.abs(out.y - y));
  }
  ok(worst < 1e-6, 'flat → sphere → flat comes back to the same place',
    `worst ${f(worst, 9)} m`);

  // the walk is a great circle: every point on it is exactly R from the centre
  let dev = 0;
  for (let x = 0; x < plan.CIRC; x += 3.1) {
    positionAt(x, 0, 0, v);
    dev = Math.max(dev, Math.abs(v.distanceTo(CENTER) - R));
  }
  ok(dev < 1e-9, 'the walk lies on an exact great circle', `worst ${f(dev, 9)} m`);

  // the tangent frame has to be orthonormal or everything seated on it shears
  let orth = 0;
  for (const [x, z] of [[0, 0], [80, -11], [-200, 40], [150, 70]]) {
    const b = basisAt(x, z);
    orth = Math.max(orth,
      Math.abs(b.up.dot(b.east)), Math.abs(b.up.dot(b.north)), Math.abs(b.east.dot(b.north)),
      Math.abs(b.up.length() - 1), Math.abs(b.east.length() - 1), Math.abs(b.north.length() - 1));
  }
  ok(orth < 1e-9, 'the tangent frame is orthonormal everywhere', `worst ${f(orth, 9)}`);

  /* Subdivide-then-bend: a long box must come back as short triangles, or it
   * chords straight through the planet. */
  const box = new THREE.BoxGeometry(40, 0.2, 0.2);
  box.translate(20, 0, 0);
  const bent = planet.wrapGeometry(box, 2.2);
  const pos = bent.attributes.position;
  let longest = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      a.fromBufferAttribute(pos, t + e);
      b.fromBufferAttribute(pos, t + ((e + 1) % 3));
      longest = Math.max(longest, a.distanceTo(b));
    }
  }
  ok(longest < 2.2 * 1.5, 'a 40 m box comes back as short triangles, not a chord',
    `longest edge ${f(longest, 3)} m`);
}

function sClock() {
  const { nightAt, sunAltAt, HOURS } = season;
  ok(nightAt(0) === 0 && sunAltAt(0) > 0.99, 'phase 0 is noon in both of them',
    `night ${f(nightAt(0))}, sun ${f(sunAltAt(0))}`);
  ok(nightAt(0.5) === 1 && sunAltAt(0.5) < -0.99, 'phase 0.5 is the middle of the night in both',
    `night ${f(nightAt(0.5))}, sun ${f(sunAltAt(0.5))}`);

  /* The regression, stated as the relation that actually holds: the dark is
   * a function of the sun's height, and of nothing else.  Stated instead as
   * "the sun is never below the horizon in daylight" this failed honestly —
   * `nightAt` carries a deliberate -0.22 offset so that dusk *lags* sunset,
   * which is twilight and is the whole reason the number is there.  What
   * must never happen again is the two running on opposite signs. */
  let worst = 0, at = 0;
  for (let dp = 0; dp < 1; dp += 1 / 720) {
    const want = Math.min(1, Math.max(0, (-sunAltAt(dp) - 0.22) / 0.78));
    const d = Math.abs(nightAt(dp) - want);
    if (d > worst) { worst = d; at = dp; }
  }
  ok(worst < 1e-12, 'the dark is derived from the sun\'s height and nothing else',
    `worst disagreement ${f(worst, 12)} at phase ${f(at, 3)}`);

  ok(HOURS[0] === 'noon' && HOURS[4] === 'deep night',
    'the hour names line up with the phase they are indexed by');

  /* The year was 1.36 days long, so a season was less than half a day and the
   * palette never once settled.  What "funky weather" turned out to be. */
  ok(season.YEAR / season.DAY > 4,
    'a season is longer than a day, so weather can settle',
    `${f(season.YEAR / season.DAY / 4, 2)} days per season`);

  /* The warp: monotone, so time never runs backwards, and it must return
   * exactly half the clock to daylight or the year drifts against itself. */
  const { solarPhase } = season;
  let mono = true, worstBack = 0;
  for (let i = 1; i <= 2000; i++) {
    const a = solarPhase((i - 1) / 2000), b = solarPhase(i / 2000);
    if (b <= a) { mono = false; worstBack = Math.max(worstBack, a - b); }
  }
  ok(mono, 'the warped clock never runs backwards', `worst ${f(worstBack, 6)}`);
  let up = 0;
  for (let i = 0; i < 4000; i++) if (sunAltAt(i / 4000) > 0) up++;
  ok(Math.abs(up / 4000 - 0.5) < 0.002, 'and the sun is up exactly half the day',
    `${f((up / 4000) * 100, 1)} %`);

  /* And what the warp is *for*: the light near the horizon is where a cel
   * ramp earns its keep, and the plain cosine spent the least time there. */
  let low = 0;
  for (let i = 0; i < 4000; i++) if (Math.abs(sunAltAt(i / 4000)) < 0.25) low++;
  const plain = (2 * Math.asin(0.25)) / Math.PI;      // the same count, unwarped
  ok(low / 4000 > plain * 1.75, 'and the low sun lasts nearly twice as long as a plain cosine gives',
    `${f((low / 4000) * 100, 1)} % of the day against ${f(plain * 100, 1)} %`);

  /* The sun sets.  It never did: the key light was clamped to 0.22 elevation
   * and above, so it swung round in azimuth and bobbed but never touched the
   * skyline — which also meant the sky's "is the sun down" test never fired
   * and the moon was the sun in a colder colour, in the sun's own place. */
  const d = new THREE.Vector3();
  let lowest = 1, highest = -1;
  for (let i = 0; i < 400; i++) {
    season.sunDirAt(i / 400, d);
    lowest = Math.min(lowest, d.y); highest = Math.max(highest, d.y);
  }
  ok(lowest < -0.7 && highest > 0.7, 'the sun rises and sets, rather than bobbing overhead',
    `altitude ${f(lowest, 2)} to ${f(highest, 2)}`);

  /* The moon's phase *is* its place in the sky, which is the astronomy and
   * costs nothing: full is opposite the sun and up all night, new is beside
   * it and not there at all. */
  const sd = new THREE.Vector3(), md = new THREE.Vector3();
  season.sunDirAt(0.5, sd); season.moonDirAt(0.5, 0.5, md);
  ok(sd.dot(md) < -0.999, 'a full moon stands opposite the sun', `dot ${f(sd.dot(md), 3)}`);
  season.moonDirAt(0.5, 0, md);
  ok(sd.dot(md) > 0.999, 'and a new moon stands with it, which is why you cannot see one');
  season.sunDirAt(0.5, sd); season.moonDirAt(0.5, 0.5, md);
  ok(md.y > 0.7, 'so the full moon is high at midnight', `altitude ${f(md.y, 2)}`);
}

function sOpen() {
  const { R, CIRC } = plan;
  /* **There is no edge to the world.**  The banded version had 26 m of
   * walkable field and hillside you could not enter on either side of it;
   * the only thing that may stop him now is water. */
  let blocked = 0, wet = 0, n = 0;
  for (let i = 0; i < 6000; i++) {
    const z = R * Math.asin(-1 + (2 * i) / 6000);
    const x = (i * 47.3) % CIRC;
    n++;
    if (terrain.walkableAt(x, z)) continue;
    if (terrain.waterDepthAt(x, z) > 0.06) wet++; else blocked++;
  }
  ok(blocked === 0, 'nothing but water can stop him, anywhere on the planet',
    `${n} samples, ${wet} of them in the lake`);

  /* And he can prove it: walked in one direction for a full lap and a half,
   * he should come back to where he started having never been stopped. */
  const { hog, game, step, put } = makeWorld();
  put(0, 0);
  hog.hd = 0.9;                       // a diagonal, so it crosses latitudes
  hog.speed = 4;                      // a brisk hedgehog, for the test's sake
  let travelled = 0;
  let overPole = false;
  let px = hog.x, pz = hog.z;
  for (let i = 0; i < 4200; i++) {
    hog.target = null;
    hog.tryStep(4 / 60, 1 / 60);
    hog.y = terrain.heightAt(hog.x, hog.z);
    travelled += plan.distance(px, pz, hog.x, hog.z);
    if (Math.abs(hog.z) > plan.R * Math.PI / 2 - 3) overPole = true;
    px = hog.x; pz = hog.z;
  }
  ok(travelled > 150, 'and one bearing held for 280 m of intent gets him most of the way',
    `${f(travelled, 0)} m walked; the rest is the lake in the way`);
  ok(Math.abs(hog.z) <= plan.R * Math.PI / 2 + 1e-9,
    'and his coordinates survive going over the top of the world',
    `${overPole ? 'he crossed a pole; ' : ''}ended ${f(hog.z, 1)} m from the equator`);
}

function sGait() {
  const parts = buildHog();
  const anim = createAnimator(parts, 1);
  const s = { gait: 1, speed: HOG_SPD, curl: 0, shiver: 0, lookYaw: 0 };

  /* **A planted foot does not slide.**  Track one foot's position in the
   * world — how far he has travelled, plus how far forward the foot is of
   * his hip — and while that foot is in stance the number must not change.
   * Any drift at all is skate, and skate is the one cue that says puppet. */
  const L = anim.legs[0];
  let travelled = 0;
  let drift = 0, samples = 0;
  let prevWorld = null;
  for (let i = 0; i < 1200; i++) {
    const dt = 1 / 240;
    anim.update(s, dt, i * dt);
    travelled += s.speed * dt;
    const world = travelled + L.fore;
    if (L.stance && prevWorld !== null) {
      drift = Math.max(drift, Math.abs(world - prevWorld));
      samples++;
    }
    prevWorld = L.stance ? world : null;
  }
  ok(drift < 1e-4, 'a planted foot stays planted while he walks over it',
    `worst slip ${(drift * 1000).toFixed(3)} mm per frame over ${samples} stance frames`);

  /* The cycle is driven by ground covered, not by the clock: walked the same
   * distance at two speeds, it must end in the same place. */
  const runTo = (speed, metres) => {
    const a = createAnimator(buildHog(), 1);
    const st = { gait: 1, speed, curl: 0, shiver: 0, lookYaw: 0 };
    const dt = 1 / 240;
    const n = Math.round(metres / (speed * dt));
    for (let i = 0; i < n; i++) a.update(st, dt, i * dt);
    return a.state.cycle;
  };
  const slow = runTo(0.4, 3);
  const fast = runTo(1.6, 3);
  ok(Math.abs(slow - fast) < 1e-6, 'and the cycle is driven by ground, not by the clock',
    `three metres at 0.4 and at 1.6 m/s both end at phase ${f(slow, 4)}`);

  /* Cadence: fast enough to be a scurry, slow enough that you can see it. */
  const hz = HOG_SPD / STRIDE;
  ok(hz > 4 && hz < 8, 'and his cadence is one you can actually see',
    `${f(hz, 1)} strides a second at ${f(HOG_SPD)} m/s`);

  // both couplets down at once never happens; at least two feet always are
  let worstDown = 4;
  for (let i = 0; i < 400; i++) {
    anim.update(s, 1 / 240, i / 240);
    worstDown = Math.min(worstDown, anim.legs.filter((l) => l.stance).length);
  }
  ok(worstDown >= 2, 'and he always has at least two feet on the ground',
    `worst ${worstDown} — a hedgehog has no suspension phase`);

  /* Turning on the spot is still stepping.  With the legs keyed to gait
   * alone he pivoted like a statue on a turntable, and every turn — called
   * or idle glance — read as weird. */
  const pv = createAnimator(buildHog(), 2);
  const pivot = { gait: 0, speed: HOG_SPD, curl: 0, shiver: 0, lookYaw: 0, turning: 3 };
  const c0 = pv.state.cycle;
  let lifted = false;
  for (let i = 0; i < 120; i++) {
    pv.update(pivot, 1 / 60, i / 60);
    if (pv.legs.some((l) => l.lift > 0.005)) lifted = true;
  }
  ok(pv.state.cycle !== c0 && lifted, 'and turning on the spot steps the feet round',
    'a pivot is a shuffle, not a turntable');
}

function sRoll() {
  const { hog, game, step, put } = makeWorld();
  const c = plan.CENTRE[plan.MEADOW];
  const to = plan.offsetFrom(c, 9, 0);

  /** Frames taken to cover the same ground, called the two different ways. */
  const timeTo = (roll) => {
    put(c.x, c.z);
    hog.hd = plan.bearing(c.x, c.z, to.x, to.z).angle;
    hog.speed = HOG_SPD;
    game.call(to.x, to.z, roll);
    let n = 0;
    for (; n < 2000; n++) {
      hog.update(1 / 60, n / 60);
      game.update(1 / 60);
      if (plan.distance(hog.x, hog.z, to.x, to.z) < 0.12) break;
    }
    return n;
  };

  const walked = timeTo(false);
  const rolled = timeTo(true);
  const ratio = walked / rolled;
  ok(ratio > 1.6 && ratio < 2.1, 'a double tap gets him there about twice as fast',
    `${walked} frames walking against ${rolled} rolling — ${f(ratio)}×`);

  /* **The ball does not skid.**  Its turning, times its radius, must equal
   * the ground it actually covered — measured off his real positions, not
   * off the same counter that drives the spin, or the test proves nothing.
   * Same rule as the feet, and just as visible when it is wrong. */
  put(c.x, c.z);
  hog.hd = plan.bearing(c.x, c.z, to.x, to.z).angle;
  hog.speed = HOG_SPD;
  game.call(to.x, to.z, true);
  step(40);                        // let the tuck finish easing in
  const spin0 = hog.spin;
  let px = hog.x, pz = hog.z, ground = 0;
  for (let i = 0; i < 200; i++) {
    hog.update(1 / 60, i / 60);
    game.update(1 / 60);
    ground += plan.distance(px, pz, hog.x, hog.z);
    px = hog.x; pz = hog.z;
  }
  const rolledBy = (hog.spin - spin0) * BALL_R;
  ok(Math.abs(rolledBy - ground) < 0.01, 'and it rolls exactly as far as it travels',
    `${f(rolledBy, 3)} m of turning against ${f(ground, 3)} m of ground`);

  ok(hog.ball > 0.9, 'he is properly tucked while he does it', `ball ${f(hog.ball)}`);

  /* It has to cost something, or the double tap is just a faster walk.
   * Measured: how far round has he turned, a third of a second after being
   * called through ninety degrees? */
  /* Driven straight at the hedgehog, with no game loop around him.  Run
   * through `game.update` this measured nothing at all: a bramble happened
   * to be near the meadow's centre, he was bitten in both cases, and a
   * hedgehog who has just been hurt does not steer — so both answers came
   * back as the same idle glance. */
  const turnIn = (roll) => {
    const h = new Hog(makeWorld().world, { model: false });
    h.x = c.x; h.z = c.z; h.y = terrain.heightAt(c.x, c.z);
    h.speed = HOG_SPD;
    const side = plan.offsetFrom(c, 0, 9);
    h.hd = plan.bearing(c.x, c.z, side.x, side.z).angle + Math.PI / 2;
    const from = h.hd;
    h.callTo(side.x, side.z, roll);
    for (let i = 0; i < 20; i++) h.update(1 / 60, i / 60);
    return Math.abs(wrapAng(h.hd - from));
  };
  const turnWalk = turnIn(false);
  const turnRoll = turnIn(true);
  ok(turnRoll < turnWalk * 0.75, 'and rolling costs him a good part of his steering',
    `${f(turnRoll, 2)} rad against ${f(turnWalk, 2)} in the same third of a second`);

  /* ---- the three faults that made the roll flicker, locked down ---- */
  {
    const parts = buildHog();
    const a = createAnimator(parts, 7);
    const st = { gait: 1, speed: HOG_SPD, curl: 0, ball: 1, shiver: 0, lookYaw: 0 };
    for (let i = 0; i < 30; i++) a.update(st, 1 / 60, i / 60);

    /* **The shadow is not his.**  It was a child of his root, so the spin
     * rolled it too: a flat disc turning edge-on through the ground, fighting
     * the surface for depth on every frame.  That was the flicker. */
    let underRoot = false;
    parts.root.traverse((o) => { if (o === parts.shadow) underRoot = true; });
    ok(!underRoot, 'his shadow is not parented to him, so the spin cannot roll it');

    /* **The coat cannot part from the body, structurally.**  Kept as
     * siblings in root space and matched by arithmetic, they disagreed by a
     * millimetre — the mantle's whole clearance over the skin — and the body
     * flashed cream through its own coat twice a stride; and the mantle,
     * animated by nobody, stood off the ball as a rigid ellipsoid while he
     * rolled.  Now everything that shows his surface is a child of the one
     * trunk, so the bob, the sway and the tuck land on all of it at once. */
    const surface = [parts.body, parts.mantle, ...parts.coats, parts.coatTuck, ...parts.ears];
    ok(surface.every((o) => o.parent === parts.trunk),
      'and his body, mantle, coat and ears all ride the one trunk',
      `${surface.length} pieces, one transform`);

    /* And the ball is coated all over: the bare cream front that is right on
     * his feet is a third of the ball's surface, and unpatched it rolled as
     * an egg with a mohawk.  The reserve coat must be out when he is tucked
     * and gone when he is not. */
    ok(parts.coatTuck.visible && parts.coatTuck.scale.x > 0.95,
      'and the reserve coat is grown out over his front while he is tucked',
      `scale ${f(parts.coatTuck.scale.x)}`);
    const walkerParts = buildHog();
    const walker = createAnimator(walkerParts, 7);
    walker.update({ gait: 1, speed: HOG_SPD, curl: 0, shiver: 0, lookYaw: 0 }, 1 / 60, 0);
    ok(!walkerParts.coatTuck.visible,
      'and put away again the moment he is on his feet');

    /* **Nothing walks inside the ball.**  A ball that is also bobbing and
     * swaying is a ball with something loose in it. */
    const still = Math.abs(a.state.bob) + Math.abs(a.state.roll) +
      Math.abs(a.state.pitch) + Math.abs(a.state.sway);
    ok(still < 1e-9, 'and the walk stops entirely once he is tucked',
      `bob+roll+pitch+sway = ${still.toExponential(1)}`);

    /* And he is a sphere, not an egg — measured off the trunk, which is
     * where the tuck lives now. */
    const { A, B, C } = HOG_BODY;
    const r = [A * parts.trunk.scale.x, B * parts.trunk.scale.y, C * parts.trunk.scale.z];
    ok(Math.max(...r) - Math.min(...r) < 1e-9, 'and he is a sphere while he rolls',
      `${r.map((v) => f(v, 4)).join(' × ')} m`);
  }

  // arriving puts him back on his feet
  put(c.x, c.z);
  game.call(plan.offsetFrom(c, 1.2, 0).x, plan.offsetFrom(c, 1.2, 0).z, true);
  step(400);
  ok(!hog.rolling && hog.ball < 0.1, 'and he uncurls when he gets there',
    `ball ${f(hog.ball)}`);

  /* **And uncurling does not unwind.**  The applied roll used to be
   * `spin × ball`, so easing out of the tuck swept the angle back through
   * every accumulated turn — a six-metre roll replayed backwards as ten
   * revolutions in the half second of standing up.  Now the spin itself
   * settles to the nearest whole turn: half a revolution of motion at most,
   * and he ends the right way up. */
  put(c.x, c.z);
  hog.hd = plan.bearing(c.x, c.z, to.x, to.z).angle;
  game.call(to.x, to.z, true);
  let n2 = 0;
  while (hog.target && n2 < 2000) { hog.update(1 / 60, n2 / 60); game.update(1 / 60); n2++; }
  const spinAtArrival = hog.spin;
  step(180);
  const settled = Math.abs(hog.spin - spinAtArrival);
  ok(settled < Math.PI + 0.01, 'and standing up costs half a revolution at most',
    `${f(settled, 2)} rad of settling, against ${f(spinAtArrival, 0)} rad rolled`);
  ok(Math.abs(wrapAng(hog.spin)) < 0.05, 'and he ends a roll the right way up',
    `${f(wrapAng(hog.spin), 3)} rad from upright`);
}

function sFace() {
  const parts = buildHog();
  const { A, B, C } = HOG_BODY;
  /* How far out on the body a point is: 1.0 is exactly on the surface.  The
   * whole invariant is that **looking about must not change this for any
   * feature** — that is what "on his face" means. */
  const depth = (p) => Math.hypot(p.x / A, p.y / B, p.z / C);
  const rest = parts.lookParts.map((p) => depth(p.rest));

  let worst = 0;
  for (let yaw = -0.5; yaw <= 0.5001; yaw += 0.02) {
    parts.setLook(yaw);
    parts.lookParts.forEach((p, i) => {
      worst = Math.max(worst, Math.abs(depth(p.obj.position) - rest[i]));
    });
  }
  parts.setLook(0);
  ok(worst < 1e-9, 'his features stay on his surface at every angle he looks',
    `worst drift ${worst.toExponential(1)} of a body radius, over ${parts.lookParts.length} features`);

  /* The failure this replaces, measured: a plain rotation about Y holds each
   * feature at a fixed distance from the axis, and his side is a great deal
   * closer in than his nose is far out. */
  const nose = parts.lookParts.find((p) => p.obj === parts.nose);
  /* Measured at 1.35 rad, which is what the build actually shipped: v1's
   * neck limit, taken across to a face that has no head to turn. */
  const yaw = 1.35;
  const naive = {
    x: nose.rest.x * Math.cos(yaw) + nose.rest.z * Math.sin(yaw),
    y: nose.rest.y,
    z: -nose.rest.x * Math.sin(yaw) + nose.rest.z * Math.cos(yaw),
  };
  const flew = (depth(naive) - depth(nose.rest)) * C;
  ok(flew > 0.03, 'and a plain Y rotation would not — which is the bug this locks down',
    `his nose would hang ${(flew * 1000).toFixed(0)} mm clear of him at the old 1.35 rad`);

  const hog = new Hog(makeWorld().world, { model: false });
  hog.lookAtScreen(1);
  ok(Math.abs(hog.lookYawTarget) <= 0.5 + 1e-9, 'and the glance is a glance, not a turn',
    `${f(hog.lookYawTarget, 2)} rad at full deflection`);

  /* His eyes crowd in against the snout — that closeness is most of the
   * charm of a hedgehog's face, and at A*0.56 they sat halfway up the front
   * of him like a face printed on a balloon. */
  const gap = parts.eyes[0].position.distanceTo(parts.nose.position);
  ok(gap < 0.095, 'his eyes sit close in against his nose', `${(gap * 1000).toFixed(0)} mm apart`);

  /* And the nose is a working nose: standing about, he is sniffing at
   * something most of the time — read off the nostril flare, which is the
   * animation's own output rather than its internals. */
  const p2 = buildHog();
  const a2 = createAnimator(p2, 3);
  const st = { gait: 0, speed: 0, curl: 0, shiver: 0, lookYaw: 0 };
  let sniffing = 0;
  const N = 1200;
  for (let i = 0; i < N; i++) {
    a2.update(st, 1 / 60, i / 60);
    if (p2.nose.scale.x > 1.02) sniffing++;
  }
  ok(sniffing / N > 0.35, 'and standing about, he sniffs nearly all the time',
    `nose working ${Math.round((100 * sniffing) / N)}% of twenty seconds`);

  /* Deep night stands him down: left alone in the dark he dozes off, and a
   * dozing animal's eyes are shut.  They reopen the moment he moves. */
  const p3 = buildHog();
  const a3 = createAnimator(p3, 5);
  const nightSt = { gait: 0, speed: 0, curl: 0, shiver: 0, lookYaw: 0, night: 1 };
  for (let i = 0; i < 60 * 12; i++) a3.update(nightSt, 1 / 60, i / 60);
  ok(p3.eyes[0].scale.y < 0.15, 'deep night stands him down: he dozes, eyes shut',
    `lid at ${f(p3.eyes[0].scale.y, 2)} after twelve dark seconds`);
  nightSt.gait = 1; nightSt.speed = HOG_SPD;
  for (let i = 0; i < 40; i++) a3.update(nightSt, 1 / 60, 12 + i / 60);
  ok(p3.eyes[0].scale.y > 0.8, 'and wakes the moment he is called',
    `lid back to ${f(p3.eyes[0].scale.y, 2)}`);
}

function sWalk() {
  const { hog, game, step, put } = makeWorld();
  const c = plan.CENTRE[plan.MEADOW];
  put(c.x, c.z);
  hog.hd = 0;
  hog.speed = HOG_SPD;
  const to = plan.offsetFrom(c, 5, 4);
  game.call(to.x, to.z);
  step(700);
  const d = plan.distance(hog.x, hog.z, to.x, to.z);
  ok(d < 0.12, 'called six metres off, he arrives', `${f(d, 3)} m short`);
  ok(hog.target === null, 'and the call is spent when he gets there');
  ok(hog.gait < 0.05, 'and he stops', `gait ${f(hog.gait)}`);
  ok(hog.walked > 6 && hog.walked < 9.5, 'by roughly the direct route',
    `${f(hog.walked, 1)} m walked for a 6.4 m call`);
}

function sIdle() {
  const { hog, step, put } = makeWorld();
  const c = plan.CENTRE[plan.MEADOW];
  put(c.x, c.z);
  step(60);                       // let the arrival settle
  const x0 = hog.x, z0 = hog.z;
  step(1800);                     // thirty seconds of nobody calling him
  const moved = Math.hypot(plan.wrapDelta(hog.x, x0), hog.z - z0);
  /* v1's rule, and the whole point of point-to-point: with nobody calling
   * him he stands still and snuffles about indefinitely.  An auto-runner
   * would fail this outright. */
  ok(moved < 0.02, 'with nobody calling him he does not move', `${f(moved, 4)} m in 30 s`);
}

function sBack() {
  const { hog, game, step, put } = makeWorld();
  const c = plan.CENTRE[plan.MEADOW];
  put(c.x, c.z);
  const back = plan.offsetFrom(c, -6, 0);

  /* Pointed 149° away from where he is about to be called, so the short way
   * round is unambiguous.  v1's rule: **no forward clamp on his heading** —
   * he can be sent anywhere — and turning uses `wrapAng`, without which he
   * takes the long way to anything behind him. */
  const aim = plan.bearing(hog.x, hog.z, back.x, back.z).angle;
  hog.hd = wrapAng(aim + 2.6);
  game.call(back.x, back.z);

  let turned = 0;
  let prev = hog.hd;
  let walkingHd = hog.hd;
  step(700, 1 / 60, () => {
    turned += wrapAng(hog.hd - prev);
    prev = hog.hd;
    if (hog.gait > 0.8) walkingHd = hog.hd;
  });

  const d = plan.distance(hog.x, hog.z, back.x, back.z);
  ok(d < 0.2, 'he turns round and walks to a target behind him',
    `${f(plan.distance(hog.x, hog.z, c.x, c.z), 2)} m from where he started`);
  ok(Math.abs(turned) < Math.PI, 'and turns the short way round, not the long way',
    `${f(turned, 2)} rad of turning for a ${f(wrapAng(aim - (aim + 2.6)), 2)} rad correction`);
  ok(Math.abs(wrapAng(walkingHd - aim)) < 0.25, 'and walks it pointing at the target',
    `${f(wrapAng(walkingHd - aim), 3)} rad off`);
}

function sWater() {
  const { hog, game, step, put } = makeWorld();
  const lake = plan.CENTRE[plan.LAKE];
  /* Approached across the boat's line, so he is not simply ferried — that is
   * `boat` below, and it is correct, and it is not what this asks. */
  const start = plan.offsetFrom(lake, 0, plan.LAKE_R + 6);
  put(start.x, start.z);
  game.call(lake.x, lake.z);      // dead centre of the water
  let wettest = 0;
  step(900, 1 / 60, () => {
    wettest = Math.max(wettest, terrain.waterDepthAt(hog.x, hog.z));
  });
  /* 60 mm is the tolerance in `walkableAt` — it exists so a shore that is a
   * hair wet does not become an invisible wall.  Deeper than that is wading,
   * and he does not wade. */
  ok(wettest <= 0.06, 'called into the lake, he never wades in',
    `deepest water under him ${f(wettest, 4)} m`);
  ok(hog.afloat === null, 'and he does not find a boat that is not there');
  /* "At the shore" means within a stride of the waterline on the dry side —
   * `walkableAt` tolerates 60 mm of water so that a shore which is a hair wet
   * does not become an invisible wall, so he legitimately stands a hand's
   * breadth past the contour. */
  const out = plan.arcTo(lake, hog.x, hog.z);
  const shore = terrain.lakeShore(Math.PI / 2).d;
  ok(out > shore - 0.4 && out < shore + 3, 'he waits at the shore instead',
    `${f(out - shore, 2)} m from the waterline`);
}

function sBoat() {
  const { hog, game, step, put, world } = makeWorld();
  const boat = world.out.boat;
  const lake = plan.CENTRE[plan.LAKE];
  const start = plan.offsetFrom(lake, terrain.lakeShore(0).d + 2.5, 0);
  put(start.x, start.z);
  game.call(boat.moorA.x, boat.moorA.z);     // walk to the mooring
  let boarded = false;
  let wettest = 0;
  step(1400, 1 / 60, () => {
    if (hog.afloat) boarded = true;
    if (!hog.afloat) wettest = Math.max(wettest, terrain.waterDepthAt(hog.x, hog.z));
  });
  ok(boarded, 'he gets into the boat when he reaches the mooring');
  /* Set down on the far side of the lake, on dry land: the diameter of the
   * water away from where he got in. */
  const across = plan.distance(hog.x, hog.z, start.x, start.z);
  ok(across > plan.LAKE_R && terrain.waterDepthAt(hog.x, hog.z) === 0,
    'and it puts him down on dry land on the far side',
    `${f(across, 1)} m across, against a ${f(plan.LAKE_R, 1)} m lake radius`);
  ok(hog.afloat === null && wettest === 0,
    'ashore at both ends, and never in the water on his own feet');
}

/** Cross the road, one way or the other, and report whether it cost a heart. */
function crossing({ atCulvert, runs = 12 }) {
  const w = makeWorld();
  const { hog, game, step, put, world } = w;
  const cv = world.out.culvert;
  // in the road's own frame: `along` the ring, `across` it
  const along = atCulvert ? cv.along : cv.along + 9;
  let bitten = 0;
  let wentUnder = 0;
  for (let r = 0; r < runs; r++) {
    game.state.hearts = 3;
    const from = plan.roadPoint(along, -(cv.half + 0.3));
    const to = plan.roadPoint(along, cv.half + 1.4);
    put(from.x, from.z);
    hog.hd = plan.bearing(from.x, from.z, to.x, to.z).angle;
    step(90);                       // let the traffic get going
    game.call(to.x, to.z);
    let under = false;
    step(1200, 1 / 60, () => { if (hog.under) under = true; });
    if (under) wentUnder++;
    if (game.state.hearts < 3) bitten++;
  }
  return { bitten, wentUnder, runs };
}

function sRoad() {
  const r = crossing({ atCulvert: true });
  ok(r.wentUnder === r.runs, 'at the mouth he takes the tunnel every time',
    `${r.wentUnder}/${r.runs}`);
  /* v1's balance, and the reason the tunnel exists: the culvert is safe six
   * times in six.  A road you can stroll across makes it pointless, and a
   * tunnel that is not safe makes it a decoration. */
  ok(r.bitten === 0, 'and the tunnel is safe every time', `${r.bitten}/${r.runs} hit`);
}

function sRoadmiss() {
  const r = crossing({ atCulvert: false });
  ok(r.wentUnder === 0, 'away from the mouth he cannot get into the tunnel');
  /* v1's tuning target: about five crossings in six cost a heart.  Twelve
   * runs rather than six because the traffic is random by design and six was
   * noisy enough to pass alone and fail inside `all`, which is the worst
   * kind of test. */
  ok(r.bitten / r.runs >= 0.6, 'and the open tarmac is genuinely dangerous',
    `${r.bitten}/${r.runs} crossings cost a heart`);
}

function sAbandon() {
  /* v1's scenario, kept by name.  There, hazards were gathered from the
   * camera's band and scrolling away from him made him **invincible**; the
   * fix was to range everything off him instead.  There is no camera in this
   * harness at all, so if anything ever starts asking where the camera is,
   * this is the test that will not run. */
  const { hog, game, step, put, world } = makeWorld();
  const t = world.out.thorns.find((x) => x.live);
  game.state.hearts = 3;
  put(t.x - 0.45, t.z);
  hog.hd = 0;
  game.call(t.x + 0.5, t.z);
  let peakCurl = 0;
  step(400, 1 / 60, () => { peakCurl = Math.max(peakCurl, hog.curl); });
  ok(game.state.hearts === 2, 'with no camera anywhere, the brambles bite exactly once',
    `hearts ${game.state.hearts}`);
  ok(peakCurl > 0.9, 'and he curls up when they do', `peak curl ${f(peakCurl)}`);
  /* The rest of that bug: stopping left him standing in the bush, and it bit
   * him again every time the invulnerability lapsed. */
  const away = Math.hypot(plan.wrapDelta(hog.x, t.x), hog.z - t.z);
  ok(away > t.r, 'and he backs out of the bramble rather than sitting in it',
    `${f(away)} m from a ${f(t.r)} m bush`);
}

function sBurrow() {
  const { hog, game, step, put, world } = makeWorld();

  /* Every burrow it will ever dig has to be somewhere he could stand, or a
   * leg becomes unfinishable and the only symptom is a player walking in
   * circles. */
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    game.placeBurrow();
    const b = game.state.burrow;
    if (!terrain.walkableAt(b.x, b.z) || world.blockedAt(b.x, b.z) || plan.hardAt(b.x) > 0.2) bad++;
  }
  ok(bad === 0, 'every burrow is dug somewhere he can actually reach', `${bad}/200 bad`);

  const leg0 = game.state.leg;
  const b = game.state.burrow;
  put(b.x - 0.5, b.z);
  hog.speed = HOG_SPD;
  game.call(b.x, b.z);
  step(400);
  ok(game.state.leg === leg0 + 1, 'reaching it ends the leg', `leg ${game.state.leg}`);
  ok(Math.abs(hog.speed - HOG_SPD * (1 + 0.08 * (game.state.leg - 1))) < 1e-9,
    'and the next one is faster', `${f(hog.speed, 3)} m/s`);
  const want = Math.min(0.88, 0.18 + game.state.leg * 0.11);
  ok(Math.abs(game.state.thornDensity - want) < 1e-9, 'and thornier',
    `density ${f(game.state.thornDensity, 3)}`);

  // v1's cap, so a late leg is hard rather than impassable
  game.state.leg = 40;
  game.state.thornDensity = Math.min(0.88, 0.18 + 40 * 0.11);
  ok(game.state.thornDensity === 0.88, 'the bramble density is capped', '0.88');
}

function sGrass() {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const t0 = Date.now();
  const grass = buildGrass(root);
  const built = Date.now() - t0;

  const c = plan.CENTRE[plan.MEADOW];
  grass.prime(c.x, c.z);
  ok(grass.liveCells > 20 && grass.blades > 8000,
    'the meadow streams in around him',
    `${grass.liveCells} cells, ${grass.blades} tufts, ${built + 0} ms to build the pool`);

  /* The pool has to be big enough for everything in view, or patches flicker
   * in and out at the rim as he turns. */
  ok(grass.liveCells <= grass.cells.POOL, 'and the pool covers the whole view',
    `${grass.liveCells} of ${grass.cells.POOL}`);

  /* Walked a long way, it must still be full — a leak in the recycling shows
   * up as a meadow that thins out the further you go. */
  let x = c.x, z = c.z;
  for (let i = 0; i < 900; i++) {
    x += 0.06 / Math.max(0.1, Math.cos(z / plan.R));
    z += 0.03;
    grass.update(1 / 60, x, z, 0);
  }
  grass.prime(x, z);
  ok(grass.liveCells > 20 && grass.blades > 8000,
    'and it is still full after eighty metres of walking',
    `${grass.liveCells} cells, ${grass.blades} tufts`);

  /* The bug this exists for: `SEA_DEN` for summer is 1.06, which in v1
   * multiplied a spawn count.  Here it trims a draw count, and a count past
   * the end of the buffer draws **nothing at all**. */
  let over = 0, empty = 0;
  for (const [len, den] of [[0.86, 0.94], [1.10, 1.06], [1.00, 0.96], [0.58, 0.55]]) {
    grass.setSeason(len, den);
    for (const im of grass.chunks) {
      if (im.count > im.userData.full) over++;
      if (im.userData.full > 0 && im.count < 1) empty++;
    }
  }
  ok(over === 0 && empty === 0, 'no season asks for more blades than were allocated',
    `${over} over, ${empty} empty`);
}

function sSolid() {
  /* What you sow is the thing he walks to, and two of the things you can sow
   * are taller than he is.  Nothing registered them as obstacles, so he
   * walked into a snowman and settled into an idle inside it.  Three
   * properties, and the third is the one that makes the other two safe. */
  const { world, hog, game, step, put, climate, centre } = makeWorld();
  const snow = climate.state.snow;
  climate.state.snow = 0.9;                 // sowing gives snowmen
  try {
    const m = centre(plan.MEADOW);
    put(m.x, m.z);

    /* 1. Tapped on his own feet — the case that produced the report. */
    game.call(hog.x, hog.z);
    const last = game.sown[game.sown.length - 1];
    ok(last.kind === 'snowman', 'in deep snow, a tap raises a snowman');
    const born = plan.distance(hog.x, hog.z, last.x, last.z);
    ok(born > 0.2, 'sown clear of him, not around him', `${f(born, 3)} m away`);
    step(600);
    const settled = plan.distance(hog.x, hog.z, last.x, last.z);
    ok(settled > 0.13, 'and he comes to rest beside it, not inside it',
      `${f(settled, 3)} m from its centre`);
    ok(world.blockedAt(last.x, last.z), 'it is a no-go while it stands');

    /* 2. Called across it: the target is behind the snowman, and he must not
     *    end up standing in the middle of one to get there. */
    put(m.x, m.z);
    let deepest = 0;
    const far = plan.towards(m.x, m.z, m.x + 6, m.z, 4);
    game.call(far.x, far.z);
    const solid = game.sown[game.sown.length - 1];
    step(900, 1 / 60, () => {
      const d = plan.distance(hog.x, hog.z, solid.x, solid.z);
      deepest = Math.max(deepest, 0.135 - d);
    });
    ok(deepest <= 0.02, 'walking to one, he never gets inside it',
      `deepest penetration ${f(Math.max(0, deepest), 3)} m`);

    /* 3. The escape rule.  A blocker put on top of him by any route at all
     *    must not be a cage — if this fails he is frozen for good, which is
     *    a far worse bug than the one being fixed. */
    let clear = null;
    for (let i = 0; i < 64 && !clear; i++) {
      const a = (i / 64) * Math.PI * 2;
      const p = plan.offsetFrom(m, Math.cos(a) * 5, Math.sin(a) * 5);
      if (!terrain.walkableAt(p.x, p.z)) continue;
      if (world.blockers.some((b) => plan.distance(p.x, p.z, b.x, b.z) < 2.5)) continue;
      clear = p; clear.a = a;
    }
    ok(!!clear, 'the meadow has open ground to test an escape in');
    put(clear.x, clear.z);
    const cage = world.addBlocker(hog.x, hog.z, 0.4);
    const out = plan.offsetFrom(m, Math.cos(clear.a) * 8, Math.sin(clear.a) * 8);
    hog.callTo(out.x, out.z);              // no sowing: this is about the cage alone
    step(600);
    const escaped = plan.distance(hog.x, hog.z, clear.x, clear.z);
    world.removeBlocker(cage);
    ok(escaped > 0.4, 'and a blocker sprung on top of him is never a cage',
      `he walked ${f(escaped, 2)} m out of a 0.4 m one`);
  } finally {
    climate.state.snow = snow;
  }
}

function sPersist() {
  /* The save: a browser thing, shimmed here.  What must hold is the round
   * trip — one game writes its numbers, a second game built over the same
   * store wakes up with them, at the right speed for its leg. */
  const mem = {};
  globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
  try {
    const { world, hog, hud, climate, put, centre } = makeWorld();
    put(centre(plan.MEADOW).x, centre(plan.MEADOW).z);
    const g1 = createGame({ world, hog, hud, climate });
    g1.state.leg = 4;
    hog.walked = 33;
    g1.note('owl');
    for (let i = 0; i < 60 * 7; i++) g1.update(1 / 60);   // past one periodic save
    ok(!!mem['hedgepig.save'], 'seven quiet seconds write a save');

    const g2 = createGame({ world, hog, hud, climate });
    ok(g2.state.leg === 4 && g2.state.flags.owl === true,
      'and a second game wakes up where the first left off',
      `leg ${g2.state.leg}, ${Object.keys(g2.state.flags).length} first(s) remembered`);
    ok(Math.abs(hog.speed - HOG_SPD * (1 + 0.08 * 3)) < 1e-9,
      'at the pace leg four had earned', `${f(hog.speed, 3)} m/s`);
  } finally {
    delete globalThis.localStorage;
  }
}

function sPalette() {
  /* The role registry: season.js recolours materials by role, and the
   * backlog notes it had no coverage at all. */
  const m1 = cel({ color: 0x123456, role: 'leaf', cache: false });
  const m2 = cel({ color: 0x445566, role: 'stem', cache: false });
  applyPalette({ leaf: 0xff0000 });
  ok(m1.color.getHex() === 0xff0000, 'a role material takes the palette that names it');
  ok(m2.color.getHex() === 0x445566, 'and a role the palette does not name is left alone');
  applyPalette({ stem: 0x00ff00 });
  ok(m2.color.getHex() === 0x00ff00, 'stems answer to their own role, not to leaf',
    '— the pumpkin-stem bug, locked out');
}

function sWeather() {
  /* The whole climate, driven for a year, with the light rig stubbed.  What
   * this is guarding is that weather is *weather*: it arrives, it sits, it
   * clears, and none of that is a fixed point on the calendar. */
  const scene = new THREE.Scene();
  const light = () => ({ color: new THREE.Color(), intensity: 1, groundColor: new THREE.Color() });
  const climate = season.createClimate({
    scene,
    sun: light(), fill: light(), bounce: light(), hemi: light(),
    sky: { setColors() {} },
    grass: { setSeason() {}, setWind() {} },
    pipeline: {
      ink: { mat: { uniforms: { uInk: { value: new THREE.Color() } } } },
      grade: {
        mat: {
          uniforms: {
            uShadowTint: { value: new THREE.Color() }, uLightTint: { value: new THREE.Color() },
            uSaturation: { value: 1 }, uWarmth: { value: 0 }, uVignette: { value: 0 },
          },
        },
      },
    },
  });

  const dt = 1 / 12;
  const log = [];
  for (let i = 0; i < (season.YEAR * 2) / dt; i++) {
    const s = climate.update(dt);
    log.push({ t: s.t, wet: s.wet, snow: s.snow, snowFall: s.snowFall, w: s.w.slice(), season: s.season });
  }

  /* 1. It rains, and it stops raining.  As a pure function of the season it
   *    did both, but at exactly one moment of the year each. */
  const spells = [];
  let inSpell = false;
  for (const r of log) {
    if (!inSpell && r.wet > 0.35) { inSpell = true; spells.push(1); }
    else if (inSpell && r.wet < 0.08) inSpell = false;
  }
  ok(spells.length >= 3, 'a couple of years bring several separate spells of rain',
    `${spells.length} in two years`);
  const dry = log.filter((r) => r.wet < 0.05).length / log.length;
  ok(dry > 0.15 && dry < 0.85, 'and it is neither always raining nor never',
    `dry ${f(dry * 100, 0)} % of the time`);

  /* 2. The season biases it without dictating it: there is rain in summer and
   *    dry weather in autumn, but autumn is much the wetter. */
  const wetIn = (k) => {
    const rows = log.filter((r) => r.w[k] > 0.75);
    return rows.reduce((a, r) => a + r.wet, 0) / Math.max(1, rows.length);
  };
  ok(wetIn(2) > wetIn(1) * 1.8, 'autumn is far wetter than summer, without either being fixed',
    `summer ${f(wetIn(1), 2)}, autumn ${f(wetIn(2), 2)}`);

  /* 3. Snow lies and melts.  It was a direct function of the winter weight,
   *    so you could stand in a blizzard on bare grass and in bright sun on
   *    deep snow — the ground and the sky disagreed all winter. */
  const snowy = log.filter((r) => r.snow > 0.25);
  ok(snowy.length > 20, 'snow lies for a good stretch of winter', `${snowy.length} samples`);
  let roseWithoutFalling = 0;
  for (let i = 1; i < log.length; i++) {
    if (log[i].snow > log[i - 1].snow + 1e-9 && log[i].snowFall <= 0) roseWithoutFalling++;
  }
  ok(roseWithoutFalling === 0, 'and it never deepens except while it is falling');
  const lag = log.filter((r) => r.snow > 0.2 && r.snowFall < 0.02).length;
  ok(lag > 5, 'it also outlasts the storm that made it, which is what snow does',
    `${lag} samples of lying snow under a clear sky`);
}

function sCritters() {
  const scene = new THREE.Scene();
  const c = createCritters(scene);
  const hogLike = { x: plan.CENTRE[plan.BGARD].x, z: plan.CENTRE[plan.BGARD].z, gait: 0, ball: 0 };
  const st = { night: 0, wet: 0, snow: 0, snowFall: 0, w: [0, 1, 0, 0], t: 0, dayPhase: 0.8 };
  for (let i = 0; i < 240; i++) {
    st.t += 1 / 60;
    c.update(1 / 60, hogLike, st);
  }
  let bad = 0, seated = 0;
  scene.traverse((o) => {
    if (!o.matrix) return;
    seated++;
    for (const v of o.matrix.elements) {
      if (!Number.isFinite(v)) { bad++; break; }
    }
  });
  ok(bad === 0, 'four summer seconds of critters leave no non-finite matrix',
    `${seated} objects checked`);
  ok(c.bflies.every((b) => plan.distance(b.x, b.z, b.home.x, b.home.z) < 12),
    'and the butterflies stay by their garden');
  st.night = 1;
  for (let i = 0; i < 120; i++) { st.t += 1 / 60; c.update(1 / 60, hogLike, st); }
  ok(c.owl.obj.visible, 'and the owl is out once it is dark');
}

function sNan() {
  /* v1's harness flagged any non-finite coordinate reaching the canvas, and
   * it is still the cheapest bug-per-line in either build.  The equivalent
   * here is a sweep of everything the bake produced. */
  const { world, scene } = makeWorld({ grass: true });
  let badGeo = 0, badInst = 0, meshes = 0, verts = 0;
  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    meshes++;
    const p = o.geometry?.attributes?.position;
    if (p) {
      verts += p.count;
      const a = p.array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { badGeo++; break; }
    }
    if (o.isInstancedMesh) {
      const a = o.instanceMatrix.array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { badInst++; break; }
    }
  });
  ok(badGeo === 0 && badInst === 0, 'nothing in the baked world is non-finite',
    `${meshes} meshes, ${(verts / 1000).toFixed(0)}k vertices`);

  let badH = 0;
  for (let x = 0; x < plan.CIRC; x += 1.7) {
    for (let z = -74; z <= 74; z += 3.3) {
      if (!Number.isFinite(terrain.heightAt(x, z))) badH++;
    }
  }
  ok(badH === 0, 'and the ground has a finite height everywhere on the planet');

  ok(world.stats.wrapped + world.stats.rigid > 500, 'the bake seated the world',
    `${world.stats.rigid} props seated rigidly, ${world.stats.wrapped} meshes bent, ` +
    `${(world.stats.instanced / 1000).toFixed(0)}k instances`);
}

/* ================================== run =================================== */
const SCENARIOS = {
  plan: sPlan, terrain: sTerrain, planet: sPlanet, clock: sClock,
  open: sOpen, gait: sGait, roll: sRoll, face: sFace, walk: sWalk, idle: sIdle, back: sBack, water: sWater, boat: sBoat,
  road: sRoad, roadmiss: sRoadmiss, abandon: sAbandon,
  burrow: sBurrow, grass: sGrass, solid: sSolid, persist: sPersist, palette: sPalette, weather: sWeather, critters: sCritters, nan: sNan,
};

const arg = process.argv[2] || 'all';
const names = arg === 'all' ? Object.keys(SCENARIOS) : [arg];
if (!names.every((n) => SCENARIOS[n])) {
  console.log(`unknown scenario: ${arg}\nknown: ${Object.keys(SCENARIOS).join(' ')} all`);
  process.exit(2);
}

const t0 = Date.now();
for (const n of names) {
  console.log(`scenario: ${n}`);
  SCENARIOS[n]();
}
console.log(`\n${checks - failed}/${checks} checks passed in ${Date.now() - t0} ms` +
  (failed ? `  —  ${failed} FAILED` : ''));
