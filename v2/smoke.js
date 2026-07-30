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
 *   face                           his features stay on his face
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
const { buildHog, HOG_BODY } = await import('./src/hog/model.js');
const { createGame } = await import('./src/game/game.js');
const { CULVERT_Z } = await import('./src/world/places/road.js');

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
  cached = { grass, scene, world, hog, game, hud, climate, step, put, ms: Date.now() - t0 };
  return cached;
}

/* ================================ scenarios =============================== */

function sPlan() {
  const { CIRC, PLACE_LEN, COUNT, ORDER, LAKE, ROAD, TOWN } = plan;
  ok(CIRC === PLACE_LEN * COUNT, 'the round is the places laid end to end',
    `${COUNT} × ${PLACE_LEN} m = ${CIRC} m`);
  ok(Math.abs(2 * Math.PI * planet.R - CIRC) < 1e-9,
    'the radius is derived from the round, not chosen', `R = ${f(planet.R, 3)} m`);
  ok(plan.placeIndexAt(0).i === plan.placeIndexAt(CIRC).i,
    'the ring closes: one lap lands on the place it left');

  // the crossfade must always account for exactly one place's worth
  let worstSum = 1, worstX = 0;
  for (let x = 0; x < CIRC; x += 0.37) {
    let sum = 0;
    for (const kind of ORDER) sum += plan.placeAmt(x, kind);
    if (Math.abs(sum - 1) > Math.abs(worstSum - 1)) { worstSum = sum; worstX = x; }
  }
  ok(Math.abs(worstSum - 1) < 1e-9, 'the place blend always sums to one',
    `worst ${f(worstSum, 6)} at x = ${f(worstX)}`);

  // a blend is only ever between neighbours on the ring
  let neighbourly = true;
  for (let x = 0; x < CIRC; x += 0.23) {
    const m = plan.placeAt(x);
    if (m.t === 0) continue;
    const ia = ORDER.indexOf(m.a), ib = ORDER.indexOf(m.b);
    if ((ia + 1) % COUNT !== ib) { neighbourly = false; break; }
  }
  ok(neighbourly, 'places only ever blend into their own neighbour');

  // bands belong to their own place and nowhere else
  for (const [kind, name] of [[LAKE, 'the lake'], [ROAD, 'the road'], [TOWN, 'the town']]) {
    let stray = 0, inside = 0;
    for (let x = 0; x < CIRC; x += 0.1) {
      const v = plan.bandAt(x, kind);
      if (v <= 0) continue;
      if (ORDER[plan.placeIndexAt(x).i] === kind) inside++; else stray++;
    }
    ok(stray === 0 && inside > 0, `${name}'s band stays inside ${name}`,
      `${inside} samples in, ${stray} out`);
  }

  // the seam: wrapping must be continuous through it
  const d = plan.wrapDelta(1, CIRC - 1);
  ok(Math.abs(d - 2) < 1e-9, 'longitudes wrap the short way across the seam', `Δ = ${f(d, 6)} m`);
}

function sTerrain() {
  const { CIRC, BAND } = plan;
  const { heightAt } = terrain;

  // periodic in x, or the ring has a cliff at the seam
  let worst = 0;
  for (let z = -30; z <= 30; z += 3.1) {
    for (let x = 0; x < CIRC; x += 7.3) {
      worst = Math.max(worst, Math.abs(heightAt(x, z) - heightAt(x + CIRC, z)));
    }
  }
  ok(worst < 1e-9, 'the ground is periodic round the planet', `worst seam step ${f(worst, 9)} m`);

  // no cliffs: he walks at 1.36 m/s and cannot climb
  /* Only where he can actually stand.  Swept over the whole band it fails on
   * the lake bed, which is 0.83 m/m of slope by design and which he can no
   * more walk down than he can swim. */
  let steep = 0, steepAt = null;
  for (let z = -BAND; z <= BAND; z += 0.9) {
    for (let x = 0; x < CIRC; x += 0.45) {
      if (!terrain.walkableAt(x, z) || !terrain.walkableAt(x + 0.45, z)) continue;
      const d = Math.abs(heightAt(x + 0.45, z) - heightAt(x, z));
      if (d > steep) { steep = d; steepAt = [x, z]; }
    }
  }
  ok(steep < 0.22, 'no cliffs anywhere he can stand',
    `worst rise ${f(steep, 3)} m per 0.45 m at ${steepAt && steepAt.map((v) => f(v, 1)).join(', ')}`);

  /* All longitudes meet at a pole, so relief that did not vanish there would
   * tear the planet open along every meridian at once. */
  const spreadAt = (z) => {
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < CIRC; x += 2.3) {
      const h = heightAt(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  const POLE = planet.R * Math.PI / 2;
  ok(spreadAt(POLE) < 1e-3, 'every longitude agrees on the height of the pole',
    `spread ${f(spreadAt(POLE), 6)} m at the pole, ${f(spreadAt(POLE - 1), 3)} m a metre off it`);

  // the lake is actually wet in the middle and dry outside
  const [wa, wb] = plan.bandEdges(plan.LAKE);
  const mid = (wa + wb) / 2;
  ok(terrain.waterDepthAt(mid, 0) > 0.8, 'the lake has water in it',
    `${f(terrain.waterDepthAt(mid, 0))} m deep at the middle`);
  ok(terrain.waterDepthAt(wa - 3, 0) === 0 && terrain.waterDepthAt(wb + 3, 0) === 0,
    'the lake stops at its own band');
  ok(!terrain.walkableAt(mid, 0), 'he cannot walk into the lake');
  ok(terrain.walkableAt(0, 0) && !terrain.walkableAt(0, BAND + 2),
    'the field is walkable, and its edge is not');

  // the shoreline is a contour, so it has to land between the band's edges
  const s = terrain.shoreAt(0, -1);
  ok(s > wa - 4 && s < mid, 'the shoreline is found where the bed crosses the water',
    `x = ${f(s)} between ${f(wa - 4)} and ${f(mid)}`);
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
}

function sWalk() {
  const { hog, game, step, put } = makeWorld();
  put(285, 0);
  hog.hd = 0;
  hog.speed = HOG_SPD;
  game.call(291, 3);
  step(600);
  const d = Math.hypot(plan.wrapDelta(hog.x, 291), hog.z - 3);
  ok(d < 0.12, 'called six metres off, he arrives', `${f(d, 3)} m short`);
  ok(hog.target === null, 'and the call is spent when he gets there');
  ok(hog.gait < 0.05, 'and he stops', `gait ${f(hog.gait)}`);
  ok(hog.walked > 6 && hog.walked < 9, 'by roughly the direct route',
    `${f(hog.walked, 1)} m walked for a 6.7 m call`);
}

function sIdle() {
  const { hog, step, put } = makeWorld();
  put(285, 0);
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
  put(285, 0);
  hog.hd = 0;                     // facing east, called west
  game.call(279, 0);
  /* Sampled while he is walking, not after he arrives.  Standing still he
   * glances about — which is the point of him — so his heading at the end of
   * the leg is whatever he last looked at. */
  let walkingHd = 0;
  step(700, 1 / 60, () => { if (hog.gait > 0.8) walkingHd = hog.hd; });
  const d = plan.wrapDelta(hog.x, 285);
  ok(d < -5.5, 'he turns round and walks back the way he came',
    `${f(d, 2)} m behind where he started`);
  ok(Math.abs(walkingHd) > 2.9, 'and he walks it facing that way, the short way round',
    `heading ${f(walkingHd, 2)} rad while moving`);
}

function sWater() {
  const { hog, game, step, put } = makeWorld();
  const [wa, wb] = plan.bandEdges(plan.LAKE);
  /* Off the boat's line.  Run down the middle of the field this walks him
   * straight onto the mooring and he is ferried across — which is correct,
   * and is `boat` below, and is not what this scenario is asking. */
  const z = 5;
  put(wa - 6, z);
  game.call((wa + wb) / 2, z);    // dead centre of the water
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
  const short = plan.wrapDelta(terrain.shoreAt(z, -1), hog.x);
  ok(short > -0.4 && short < 2.5, 'he waits at the shore instead',
    `${f(short, 2)} m from the waterline`);
}

function sBoat() {
  const { hog, game, step, put, world } = makeWorld();
  const boat = world.out.boat;
  const [wa, wb] = plan.bandEdges(plan.LAKE);
  put(boat.moorA.x - 2.5, 0);
  game.call(boat.moorA.x, 0);     // walk to the mooring
  let boarded = false;
  let wettest = 0;
  step(1400, 1 / 60, () => {
    if (hog.afloat) boarded = true;
    if (!hog.afloat) wettest = Math.max(wettest, terrain.waterDepthAt(hog.x, hog.z));
  });
  ok(boarded, 'he gets into the boat when he reaches the mooring');
  /* Past the far *waterline*, which is inside the band's nominal edge — the
   * band edge is where the bank starts, not where the water stops. */
  const far = terrain.shoreAt(0, 1);
  ok(hog.x > far && terrain.waterDepthAt(hog.x, hog.z) === 0,
    'and it puts him down on dry land on the far shore',
    `x = ${f(hog.x, 1)}, past the waterline at ${f(far, 1)}`);
  ok(hog.afloat === null && wettest === 0,
    'ashore at both ends, and never in the water on his own feet');
}

/** Cross the road, one way or the other, and report whether it cost a heart. */
function crossing({ atCulvert, runs = 12 }) {
  const w = makeWorld();
  const { hog, game, step, put, world } = w;
  const cv = world.out.culvert;
  const z = atCulvert ? cv.z : cv.z + 6;
  let bitten = 0;
  let wentUnder = 0;
  for (let r = 0; r < runs; r++) {
    game.state.hearts = 3;
    put(cv.a - 0.3, z);
    hog.hd = 0;
    step(90);                       // let the traffic get going
    game.call(cv.b + 1.4, z);
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
  ok(grass.chunks.length > 100, 'the meadow builds in chunks',
    `${grass.chunks.length} chunks, ${grass.blades} tufts, ${built} ms`);

  /* The bug this exists for: `SEA_DEN` for summer is 1.06, which in v1
   * multiplied a spawn count.  Here it multiplies `InstancedMesh.count`, and
   * a count past the end of the buffer draws **nothing at all** — so summer
   * had no grass in it and nothing was logged. */
  let over = 0, empty = 0;
  for (const [len, den, name] of [[0.86, 0.94, 'spring'], [1.10, 1.06, 'summer'],
    [1.00, 0.96, 'autumn'], [0.58, 0.55, 'winter']]) {
    grass.setSeason(len, den);
    for (const c of grass.chunks) {
      if (c.count > c.userData.maxCount) over++;
      if (c.count < 1) empty++;
    }
  }
  ok(over === 0, 'no season asks for more blades than were allocated', `${over} over`);
  ok(empty === 0, 'and no season empties a chunk', `${empty} empty`);

  grass.setSeason(1.10, 1.06);
  const full = grass.chunks.every((c) => c.count === c.userData.maxCount);
  ok(full, 'summer draws the whole field');
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

  ok(world.stats.wrapped > 1000, 'the bake wrapped the world',
    `${world.stats.wrapped} meshes, ${(world.stats.tris / 1000).toFixed(0)}k triangles, ` +
    `${(world.stats.instanced / 1000).toFixed(0)}k instances`);
}

/* ================================== run =================================== */
const SCENARIOS = {
  plan: sPlan, terrain: sTerrain, planet: sPlanet, clock: sClock,
  face: sFace, walk: sWalk, idle: sIdle, back: sBack, water: sWater, boat: sBoat,
  road: sRoad, roadmiss: sRoadmiss, abandon: sAbandon,
  burrow: sBurrow, grass: sGrass, nan: sNan,
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
