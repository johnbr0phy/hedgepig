import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { rngKit, clamp, TAU, bake, trs, shadowify } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { hardAt } from '../plan.js';
import {
  tree, log, mushroom, flowerClump, rock, bale, fencePost,
  stump, thistle, tussock, drystone, plank, bucket, crate, molehillProp,
} from '../props.js';

/* ------------------------------------------------------------------ *
 * The four green places: the long meadow, the butterfly garden, the wood,
 * and the mushroom garden.
 *
 * They are neighbours on the antiprism for the reason v1 insisted on —
 * **neighbours must share something** — so each hands something to the next.
 * The garden borrows the meadow's grass and adds beds to it; the wood takes
 * the flowers away and puts a roof on; the mushroom garden is the wood's
 * floor with the trees thinning out.  Nothing here starts from bare ground.
 *
 * Everything is laid out in metres east and north of the place's own centre,
 * and `ctx.at` puts it on the globe.
 * ------------------------------------------------------------------ */

/**
 * Materials that carry a **role** — and so the season — are deliberately not
 * cached by `cel`, because the season writes a colour into each one.  The
 * consequence bites here: a maker that calls `cel({ role })` per plant hands
 * the static merge in `world/index.js` a fresh material every time, and forty
 * bluebell clumps stay forty draw calls.  These are made once and shared.
 *
 * The un-roled entries repeat props.js's own argument sets on purpose — `cel`
 * *does* cache those, so a bench comes back with the same material instance a
 * fence post has and the two merge together.
 */
const M = {};
const mat = (key, make) => M[key] || (M[key] = make());
const timberMat = () => cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });
const metalMat = () => cel({ color: PAL.metal, bands: 3, tint: 0x5c688e });
const soilMat = () => cel({ color: PAL.soil, bands: 3, tint: 0x62568a });
const stoneMat = () => cel({ color: PAL.stone, bands: 3, tint: 0x6a6690 });
/** Grass that is a *prop* rather than a blade of the field: shared, and never
 *  flat-shaded — four faces round a stalk means four bands, and a clump of
 *  them strobes as you walk past, exactly as `reeds` found. */
const bladeMat = () => mat('propGrass', () => {
  const m = cel({ color: 0x86a055, bands: 3, tint: 0x556086, side: THREE.DoubleSide, role: 'grass' });
  m.flatShading = false;
  return m;
});
/** Ripe seed, and the grass a hare has lain on.  Fixed, and deliberately
 *  *not* on the `leaf` role for the reason the wood's litter is not: this is
 *  growth that has already finished, and tying it to the season's foliage
 *  turns it bright green in summer. */
const strawMat = () => mat('straw', () => cel({ color: PAL.straw, bands: 3, tint: 0x6a6090, flat: false }));

/** Somewhere to put instanced ground clutter, already seated on the surface. */
function instanceAt(im, i, ctx, u, v, yaw, lift, sx = 1, sz = 1) {
  /* **Flat, not planet.**  This used to compose the finished planet-space
   * matrix with `positionAt` and its own tangent frame — and `bakeToPlanet`
   * re-seats every instance it finds, treating the position it decodes as
   * flat coordinates.  Mapping an already-mapped point put the whole cloud
   * six metres *under* the ground at the garden's latitude, which is the one
   * error that leaves no trace at all: the leaf litter and the bed edging
   * were built, listed as done, and never once visible.  An instance is
   * authored flat, like everything else in this file, and bent once. */
  const p = ctx.at(u, v);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, heightAt(p.x, p.z) + lift, p.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, 1, sz)
  );
  im.setMatrixAt(i, m);
}

/**
 * How high a spot stands within its own place: 0 at the lowest ground in the
 * disc, 1 at the highest.
 *
 * **Sampled from `heightAt`, not worked out from the landform.**  A second
 * copy of the meadow ridge's arithmetic living here would drift out of step
 * with terrain.js the first time either was tuned, and the drift would arrive
 * as flowers massing on the wrong side of a hill — which nobody would read as
 * a bug, only as a dull meadow.
 */
function elevationIn(ctx, n = 24) {
  const h = (u, v) => { const p = ctx.at(u, v); return heightAt(p.x, p.z); };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const u = -ctx.R + (2 * ctx.R * i) / (n - 1);
      const v = -ctx.R + (2 * ctx.R * j) / (n - 1);
      if (Math.hypot(u, v) > ctx.R) continue;
      const y = h(u, v);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  const span = Math.max(0.25, hi - lo);
  return (u, v) => clamp((h(u, v) - lo) / span, 0, 1);
}

/**
 * The nearest spot to (u, v) with `pad` metres of soft ground round it.
 *
 * **The road goes straight through the middle of the mushroom garden.**  It
 * is the great circle through the roadside and the town, and on this layout
 * it passes within a metre of MGARD's own centre — so `roadOffset` there is
 * zero and `hardAt` is 1.  Every one of the fairy ring's fifteen mushrooms
 * and the stump they circle were standing **on the tarmac**, and had been
 * since the disc rebuild: nothing throws, nothing is logged, and a ring of
 * mushrooms in a carriageway reads at a glance as a ring of mushrooms.
 *
 * `ctx.scatter` has refused hard ground from the beginning, which is why
 * everything *scattered* in that place is correctly out on the verge and
 * only the hand-placed centrepiece was wrong.  This is the same rule for
 * things placed by hand, and it is a search rather than a corrected
 * constant, so it stays right if the road or the place ever moves.
 */
function softSpot(ctx, u, v, pad = 1, reach = 15) {
  const hard = (a, b) => { const p = ctx.at(a, b); return hardAt(p.x, p.z); };
  const clear = (a, b) => {
    if (hard(a, b) > 0.05) return false;
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * TAU;
      if (hard(a + Math.cos(t) * pad, b + Math.sin(t) * pad) > 0.4) return false;
    }
    return true;
  };
  if (clear(u, v)) return { u, v };
  for (let d = 1; d <= reach; d += 0.5) {
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * TAU + d;      // turn the ring each step, so it spirals
      const a = u + Math.cos(t) * d, b = v + Math.sin(t) * d;
      if (Math.hypot(a, b) <= ctx.R && clear(a, b)) return { u: a, v: b };
    }
  }
  return { u, v };
}

/** Which way the ground rises here, as a bearing in the place's own frame.
 *  Measured off `heightAt` for the same reason `elevationIn` is; add a right
 *  angle and you have the contour, which is the line a wall gets built on. */
function uphillAt(ctx, u, v, e = 3) {
  const h = (a, b) => { const p = ctx.at(a, b); return heightAt(p.x, p.z); };
  return Math.atan2(h(u, v + e) - h(u, v - e), h(u + e, v) - h(u - e, v));
}

/**
 * A run of no-go circles along a line, for anything long and solid.
 *
 * One big circle round a long thin thing is the unfairness §5 warns about
 * from the other side: the meadow's fallen log carried a **one-metre** radius
 * for a trunk 0.34 m thick, so a metre of clear grass either side of it
 * refused him with nothing there to see.  Circles of the thing's own
 * half-width, close enough together to overlap, cost a dot product each and
 * stop him where the thing actually is.
 */
function blockLine(ctx, u, v, turn, len, r) {
  const n = Math.max(1, Math.ceil(len / (r * 1.7)));
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + (len * i) / n;
    ctx.block(u + Math.cos(turn) * t, v + Math.sin(turn) * t, r);
  }
}

/**
 * Lay a prop along a bearing in the place's own frame.
 *
 * `ctx.put` seats a rig on the ground and leaves its heading alone, and the
 * heading is not free: a rig's own `rotation.y` is applied *after* the
 * tangent frame, and `makeBasis(east, up, north)` sends local +x to east — so
 * a prop whose geometry runs along +x runs along the bearing `turn` when its
 * rotation.y is **minus** that bearing.  Got backwards, everything long in
 * the world lies mirrored, which reads as a random scatter rather than as a
 * mistake.  `fenceArc` has always done this; it is written down now.
 */
function lay(ctx, parent, obj, u, v, turn, sink = 0) {
  ctx.put(obj, u, v);
  obj.position.y -= sink;
  obj.rotation.y = -turn;
  parent.add(obj);
  return obj;
}

/** A run of fence along an arc of the place's disc, post by post. */
function fenceArc(ctx, parent, { r, from, to, seed = 7, h = 0.55 }) {
  const n = Math.max(2, Math.round((Math.abs(to - from) * r) / 1.6));
  const span = (Math.abs(to - from) * r) / n;
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    const p = fencePost({ seed: seed + i, h, span: i < n ? span : 0, ahead: 0 });
    ctx.put(p, Math.cos(a) * r, Math.sin(a) * r);
    // turn the post so its rails run along the arc
    p.rotation.y = -(a + Math.PI / 2);
    parent.add(p);
  }
}

/**
 * A remnant of drystone wall, laid along a line a segment at a time.
 *
 * Segment by segment for the same reason the fence is post by post — bent
 * onto the sphere, geometry is squashed along longitude by `cos(latitude)`,
 * and a wall is the one thing where a squash reads as a wall built wrong.
 * Each segment stands on its own ground and is bedded four centimetres into
 * it, because the meadow rolls about 5 cm across a metre and a half and a
 * drystone wall floating at one end is the first thing the eye finds.
 *
 * `gaps` are the segments that are simply not there.  A wall with no gaps in
 * it is a wall somebody maintains, and nobody maintains this one.
 */
function wallRun(ctx, parent, { u, v, turn, len = 8, seg = 1.6, seed = 53, h = 0.55, gaps = [] }) {
  const n = Math.max(1, Math.round(len / seg));
  for (let i = 0; i < n; i++) {
    if (gaps.includes(i)) continue;
    const t = -len / 2 + seg * (i + 0.5);
    const su = u + Math.cos(turn) * t;
    const sv = v + Math.sin(turn) * t;
    lay(ctx, parent, drystone({ seed: seed + i * 3, len: seg, h }), su, sv, turn, 0.04);
    blockLine(ctx, su, sv, turn, seg * 0.9, 0.26);
  }
}

/**
 * A clump of grass gone to seed: the tall stuff that survives on a crest
 * because nothing grazes the top of a ridge.
 *
 * Two kinds, and the mix is the point — a dense nodding spindle (timothy,
 * foxtail) and an open panicle that catches the light as a haze rather than
 * as a shape.  One of each alone reads as a repeated prop.
 */
function seedHeads({ seed = 1, n = 12, h = 0.34 } = {}) {
  const rng = rngKit(seed * 7717);
  const g = new THREE.Group();
  const stalks = [];
  const heads = [];

  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0, 0.1);
    const hh = h * rng.range(0.62, 1.2);
    /* Ry sends +x to (cos a, 0, -sin a) and the euler's z term goes first, so
     * a negative z leans the stalk out along that same direction. */
    const at = trs(Math.cos(a) * rr, 0, -Math.sin(a) * rr, 0, a, -rng.range(0.04, 0.26));
    const sg = new THREE.CylinderGeometry(0.0035, 0.006, hh, 4);
    sg.translate(0, hh / 2, 0);
    stalks.push({ geometry: sg, matrix: at });

    if (rng.chance(0.55)) {
      const sp = new THREE.SphereGeometry(0.013, 6, 5);
      sp.scale(1, 3.1, 1);
      sp.rotateZ(-rng.range(0.15, 0.5));      // every ripe head nods
      sp.translate(0, hh + 0.03, 0);
      heads.push({ geometry: sp, matrix: at });
    } else {
      for (let k = 0; k < 4; k++) {
        const l = rng.range(0.035, 0.07);
        const br = new THREE.ConeGeometry(0.0035, l, 3);
        br.translate(0, l / 2, 0);
        heads.push({
          geometry: br,
          matrix: at.clone().multiply(trs(0, hh, 0, 0, rng.range(0, TAU), -rng.range(0.5, 1.0))),
        });
      }
    }
  }

  g.add(new THREE.Mesh(bake(stalks), bladeMat()));
  g.add(new THREE.Mesh(bake(heads), strawMat()));
  return shadowify(g);
}

/**
 * A hare's form: the bare oval she presses into the grass and comes back to.
 *
 * It is the one thing in the meadow that is an *absence* — no prop stands up
 * out of it — so it has to be legible as a shape in the turf, which means a
 * dished patch of soil whose rim goes **under** the grass line.  Authored
 * flat and laid on ground that rolls, a hard-edged disc would lift a corner
 * somewhere and read as a sheet of paper dropped on the field.
 */
function hareForm({ seed = 1, len = 0.66, wid = 0.42 } = {}) {
  const rng = rngKit(seed * 6473);
  const g = new THREE.Group();
  const soil = mat('bareSoil', () => cel({ color: 0x7a6448, bands: 3, tint: 0x62568a, flat: false }));

  const dish = new THREE.CircleGeometry(1, 20);
  dish.rotateX(-Math.PI / 2);
  const p = dish.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const d = Math.hypot(p.getX(i), p.getZ(i));
    p.setY(i, 0.012 - 0.05 * d * d);
    // ragged, because a form is worn rather than cut
    p.setX(i, p.getX(i) * (len / 2) * rng.range(0.9, 1.07));
    p.setZ(i, p.getZ(i) * (wid / 2) * rng.range(0.9, 1.07));
  }
  dish.computeVertexNormals();
  const bed = new THREE.Mesh(dish, soil);
  bed.receiveShadow = true;
  g.add(bed);

  // the scrape at one end, where she gets in and out
  for (let i = 0; i < 6; i++) {
    const a = rng.range(-0.9, 0.9);
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.012, 0.026), 0), soil);
    c.position.set(Math.cos(a) * len * 0.44, 0.008, Math.sin(a) * wid * 0.52);
    c.scale.y = 0.5;
    g.add(c);
  }

  // and the grass round the rim, pressed flat and gone pale under her
  const laid = [];
  for (let i = 0; i < 16; i++) {
    const a = rng.range(0, TAU);
    const l = rng.range(0.06, 0.13);
    const bg = new THREE.ConeGeometry(0.008, l, 3);
    bg.translate(0, l / 2, 0);
    laid.push({
      geometry: bg,
      matrix: trs(
        Math.cos(a) * (len / 2) * rng.range(0.85, 1.05), 0.008,
        -Math.sin(a) * (wid / 2) * rng.range(0.85, 1.05),
        0, a, -rng.range(1.25, 1.48), 1, 1, 0.45
      ),
    });
  }
  g.add(new THREE.Mesh(bake(laid), strawMat()));

  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/** A seedling rosette: five flat leaves out of one point, for a bed or a
 *  cold frame.  A tended place needs something that is not yet a flower. */
function rosette({ seed = 1, r = 0.07 } = {}) {
  const rng = rngKit(seed * 1567);
  const parts = [];
  const n = rng.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.3, 0.3);
    const l = r * rng.range(0.8, 1.25);
    const lf = new THREE.ConeGeometry(l * 0.42, l, 4);
    lf.translate(0, l / 2, 0);
    parts.push({ geometry: lf, matrix: trs(0, 0.004, 0, 0, a, -rng.range(0.95, 1.3), 1, 1, 0.34) });
  }
  const m = new THREE.Mesh(
    bake(parts),
    mat('gardenLeaf', () => cel({ color: 0x7fa356, bands: 3, tint: 0x55668c, role: 'leaf' }))
  );
  return shadowify(m);
}

/**
 * A raised bed: four boards on edge, soil above the turf line, and rows.
 *
 * **Rows are right here and nowhere else.**  The comment on the four flower
 * beds below says rows in a disc read as a mistake, and they do — but this is
 * the one place on the planet that is obviously *tended*, and what a tended
 * place looks like from a hedgehog's height is straight lines of things.
 * The whole bed is one rigid rig so its planting stands on the *soil* and not
 * on the ground the bed happens to be sitting on.
 */
function raisedBed({ seed = 1, w = 1.5, d = 0.95, side = 0.2 } = {}) {
  const rng = rngKit(seed * 1279);
  const g = new THREE.Group();

  const board = (len, px, pz, ry, s) => {
    const holder = new THREE.Group();
    const pl = plank({ seed: s, len, w: side });
    pl.rotation.x = -Math.PI / 2;      // Rx(-90) sends the board's width to up
    pl.position.y = side / 2;
    holder.add(pl);
    holder.position.set(px, 0, pz);
    holder.rotation.y = ry;
    g.add(holder);
  };
  board(w, 0, -d / 2, 0, seed * 3 + 1);
  board(w, 0, d / 2, 0, seed * 3 + 2);
  board(d, -w / 2, 0, Math.PI / 2, seed * 3 + 3);
  board(d, w / 2, 0, Math.PI / 2, seed * 3 + 4);

  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.07, side * 0.9, d - 0.07),
    mat('bedSoil', soilMat)
  );
  fill.position.y = side * 0.45;
  fill.receiveShadow = true;
  g.add(fill);

  const top = side * 0.9;
  for (let row = 0; row < 3; row++) {
    const z = -d / 2 + (d * (row + 1)) / 4;
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + (w * (i + 1)) / 5 + rng.range(-0.03, 0.03);
      const plant = row === 1
        ? rosette({ seed: seed * 40 + row * 7 + i, r: rng.range(0.06, 0.09) })
        : flowerClump({
          seed: seed * 40 + row * 7 + i,
          n: rng.int(4, 7),
          color: rng.pick([PAL.bloomWhite, PAL.bloomYellow, PAL.petal]),
          h: rng.range(0.09, 0.15),
        });
      plant.position.set(x, top, z + rng.range(-0.04, 0.04));
      g.add(plant);
    }
  }
  return g;
}

/**
 * A cold frame: a box with a sheet of glass over it, propped open a crack.
 *
 * The prop stick is the whole detail.  A closed frame is a box; an open one
 * says somebody was here this morning and thought it warm enough.
 */
function coldFrame({ seed = 1, w = 0.95, d = 0.62, back = 0.34, front = 0.2 } = {}) {
  const rng = rngKit(seed * 1091);
  const g = new THREE.Group();
  const timber = mat('timber', timberMat);
  const parts = [];

  const fb = new THREE.BoxGeometry(w, front, 0.035);
  fb.translate(0, front / 2, -(d / 2));
  parts.push({ geometry: fb });
  const bb = new THREE.BoxGeometry(w, back, 0.035);
  bb.translate(0, back / 2, d / 2);
  parts.push({ geometry: bb });

  // the sides are trapezoids: high at the back, low at the front
  for (const s of [-1, 1]) {
    const sg = new THREE.BoxGeometry(0.035, back, d);
    const p = sg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) p.setY(i, p.getY(i) - (back - front) * clamp(0.5 - p.getZ(i) / d, 0, 1));
    }
    sg.computeVertexNormals();
    sg.translate(s * (w / 2 - 0.017), back / 2, 0);
    parts.push({ geometry: sg });
  }
  g.add(new THREE.Mesh(bake(parts), timber));

  // seedlings under it, which is the only reason a cold frame exists
  for (let i = 0; i < 7; i++) {
    const r = rosette({ seed: seed * 9 + i, r: rng.range(0.045, 0.075) });
    r.position.set(rng.range(-w * 0.38, w * 0.38), 0.02, rng.range(-d * 0.32, d * 0.32));
    g.add(r);
  }

  const tilt = Math.atan2(back - front, d);
  const lid = new THREE.Group();
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.05, Math.hypot(d, back - front) + 0.04),
    flat({ color: 0xdcecef, transparent: true, opacity: 0.34, side: THREE.DoubleSide })
  );
  pane.rotation.x = -Math.PI / 2;
  pane.userData.noMerge = true;        // transparent: its sort order is load-bearing
  lid.add(pane);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, d + 0.04), timber);
  lid.add(bar);
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.016, d + 0.04), timber);
    edge.position.x = s * (w / 2 + 0.012);
    lid.add(edge);
  }
  lid.rotation.x = -tilt;               // -x tips +z up, so the back is the high side
  lid.position.y = (front + back) / 2 + 0.06;
  g.add(lid);

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.11, 5), timber);
  stick.position.set(w * 0.3, front + 0.05, -(d / 2) + 0.02);
  stick.rotation.z = 0.12;
  g.add(stick);

  return shadowify(g);
}

/** A galvanised watering can.  It is as long as he is, which is the size a
 *  watering can is, and it is the one garden tool with a silhouette you can
 *  name from across the field. */
function wateringCan({ seed = 1 } = {}) {
  const rng = rngKit(seed * 1723);
  const g = new THREE.Group();
  const metal = mat('metal', metalMat);
  const h = 0.19, r = 0.085;

  const bg = new THREE.CylinderGeometry(r, r * 0.86, h, 10);
  bg.translate(0, h / 2, 0);
  g.add(new THREE.Mesh(bg, metal));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.009, 4, 10), metal);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = h - 0.004;
  g.add(rim);

  // the spout rises from the foot on one side to above the rim on the other
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.26, 6), metal);
  spout.position.set(0.11, 0.115, 0);
  spout.rotation.z = -0.75;
  g.add(spout);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.02, 9), metal);
  rose.position.set(0.19, 0.2, 0);
  rose.rotation.z = -0.75;
  g.add(rose);

  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.007, 3, 9, Math.PI), metal);
  hoop.position.y = h;
  hoop.rotation.y = Math.PI / 2;
  g.add(hoop);
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 3, 9, Math.PI * 0.9), metal);
  grip.position.set(-r * 0.9, h * 0.62, 0);
  grip.rotation.set(Math.PI / 2, 0, -0.4);
  g.add(grip);

  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/**
 * A row of bean canes: pairs crossed and tied, with a ridge cane along the
 * top.  A wigwam is the shape people draw; a row is the shape people build,
 * and it gives a straight line to walk down.
 */
function caneRow({ seed = 1, n = 5, len = 1.7, h = 1.35 } = {}) {
  const rng = rngKit(seed * 4177);
  const g = new THREE.Group();
  const cane = mat('cane', () => cel({ color: 0xbfa571, bands: 3, tint: 0x6b5b86 }));
  const twine = mat('twine', () => cel({ color: 0x6f6250, bands: 2, tint: 0x6b5b86 }));
  const foot = 0.24;
  const parts = [];
  const ties = [];
  const leaves = [];

  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len * i) / Math.max(1, n - 1);
    const cross = h * rng.range(0.86, 0.93);
    for (const s of [-1, 1]) {
      const hh = h * rng.range(0.94, 1.06);
      const cg = new THREE.CylinderGeometry(0.008, 0.011, hh, 4);
      cg.translate(0, hh / 2, 0);
      const lean = -s * Math.atan2(foot + 0.02, cross);
      parts.push({ geometry: cg, matrix: trs(x, 0, s * foot, lean, 0, 0) });

      // beans, going up: three or four leaves off the lower half
      for (let k = 0; k < 4; k++) {
        const t = 0.15 + 0.2 * k;
        const lf = new THREE.ConeGeometry(0.03, 0.09, 4);
        lf.translate(0, 0.045, 0);
        leaves.push({
          geometry: lf,
          matrix: trs(x, 0, s * foot, lean, 0, 0)
            .multiply(trs(0, hh * t, 0, 0, rng.range(0, TAU), -rng.range(0.9, 1.3), 1, 1, 0.35)),
        });
      }
    }
    ties.push({
      geometry: new THREE.BoxGeometry(0.03, 0.022, 0.06),
      matrix: trs(x, cross, 0, 0, rng.range(-0.2, 0.2), 0),
    });
  }
  const ridge = new THREE.CylinderGeometry(0.009, 0.009, len + 0.18, 5);
  ridge.rotateZ(Math.PI / 2);
  parts.push({ geometry: ridge, matrix: trs(0, h * 0.89, 0) });

  g.add(new THREE.Mesh(bake(parts), cane));
  g.add(new THREE.Mesh(bake(ties), twine));
  g.add(new THREE.Mesh(
    bake(leaves),
    mat('beanLeaf', () => cel({ color: 0x6f9c4e, bands: 3, tint: 0x55668c, role: 'leaf' }))
  ));
  return shadowify(g);
}

/** A garden bench: seat slats, a leaning back, and legs.  Nothing sits on it,
 *  which is most of what it is for. */
function bench({ seed = 1, len = 1.3 } = {}) {
  const rng = rngKit(seed * 5233);
  const g = new THREE.Group();
  const timber = mat('timber', timberMat);
  const parts = [];
  const seatY = 0.4, deep = 0.34;

  for (const z of [-0.1, 0.02, 0.14]) {
    parts.push({ geometry: new THREE.BoxGeometry(len, 0.03, 0.1), matrix: trs(0, seatY, z) });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lg = new THREE.BoxGeometry(0.055, seatY, 0.055);
      lg.translate(0, seatY / 2, 0);
      parts.push({ geometry: lg, matrix: trs(sx * (len / 2 - 0.11), 0, sz * (deep / 2 - 0.05)) });
    }
    // the back posts carry on up from the rear legs, leaning back a little
    const bp = new THREE.BoxGeometry(0.05, 0.42, 0.05);
    bp.translate(0, 0.21, 0);
    parts.push({ geometry: bp, matrix: trs(sx * (len / 2 - 0.11), seatY - 0.02, deep / 2 - 0.05, 0.14, 0, 0) });
  }
  for (const y of [0.6, 0.73]) {
    parts.push({
      geometry: new THREE.BoxGeometry(len - 0.08, 0.08, 0.026),
      matrix: trs(0, y, deep / 2 - 0.05 + (y - seatY) * 0.14, 0.14, 0, 0),
    });
  }

  const m = new THREE.Mesh(bake(parts), timber);
  m.rotation.y = rng.range(-0.03, 0.03);
  return shadowify(m);
}

/**
 * A birch: the one pale trunk in a wood of dark ones.
 *
 * `tree` picks its bark at random from two browns, which is right for a wood
 * and cannot give you a *stand* of anything.  What makes a birch read at
 * forty metres is not its shape but its value — near-white against the
 * canopy — and what makes it read at two metres is the dark banding, which is
 * the only marked bark in the world.
 */
function birch({ seed = 1, h = 5.2, r = 0.075 } = {}) {
  const rng = rngKit(seed * 3121);
  const g = new THREE.Group();
  const pale = mat('birchBark', () => cel({ color: 0xe4dccb, bands: 3, tint: 0x6f6894, flat: false }));
  const dark = mat('birchMark', () => cel({ color: 0x4a4038, bands: 2, tint: 0x5a5480 }));

  const th = h * 0.84;
  const tg = new THREE.CylinderGeometry(r * 0.44, r, th, 8);
  tg.translate(0, th / 2, 0);
  g.add(new THREE.Mesh(tg, pale));

  const marks = [];
  for (let i = 0; i < 10; i++) {
    const y = th * rng.range(0.04, 0.78);
    const rr = r * (1 - 0.56 * (y / th)) + 0.004;
    const a = rng.range(0, TAU);
    const arc = rng.range(0.5, 1.5);
    const band = new THREE.CylinderGeometry(rr, rr, rng.range(0.02, 0.055), 6, 1, true, a, arc);
    band.translate(0, y, 0);
    marks.push({ geometry: band });
  }
  g.add(new THREE.Mesh(bake(marks), dark));

  for (let i = 0; i < 2; i++) {
    const lg = new THREE.CylinderGeometry(r * 0.16, r * 0.34, h * 0.3, 5);
    lg.translate(0, h * 0.15, 0);
    const limb = new THREE.Mesh(lg, pale);
    limb.position.set(0, h * 0.6, 0);
    limb.rotation.set(rng.range(0.45, 0.7), rng.range(0, TAU), 0);
    g.add(limb);
  }

  /* Birch foliage is thin and high: three small masses near the top, not the
   * big low lumps a `tree` gets, or the stand comes out as a hedge on stilts. */
  const canopy = mat('birchCanopy', () => cel({
    color: 0x628f4a, bands: 3, tint: 0x4f5d84, flat: false, role: 'canopy',
  }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng.range(-0.5, 0.5);
    const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.6, 0.85), 1), canopy);
    lump.position.set(Math.cos(a) * rng.range(0.15, 0.5), h * rng.range(0.78, 0.97), Math.sin(a) * rng.range(0.15, 0.5));
    lump.scale.y = rng.range(0.66, 0.85);
    g.add(lump);
  }

  g.rotation.z = rng.range(-0.035, 0.035);
  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/** Bracken: fronds off one crown, pinnae in pairs up each rib.  On the `leaf`
 *  role on purpose — the whole point of a bracken bank is that it goes rust
 *  in autumn and stands there dead all winter. */
function bracken({ seed = 1, h = 0.5, n = 5 } = {}) {
  const rng = rngKit(seed * 2593);
  const parts = [];

  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const fh = h * rng.range(0.7, 1.15);
    const at = trs(Math.cos(a) * 0.02, 0, -Math.sin(a) * 0.02, 0, a, -rng.range(0.25, 0.6));
    const rib = new THREE.CylinderGeometry(0.004, 0.008, fh, 4);
    rib.translate(0, fh / 2, 0);
    parts.push({ geometry: rib, matrix: at });

    const pn = 7;
    for (let k = 0; k < pn; k++) {
      const t = 0.28 + (0.7 * k) / (pn - 1);
      const l = fh * 0.4 * (1.05 - t);
      for (const s of [-1, 1]) {
        const pg = new THREE.ConeGeometry(0.022, l, 4);
        pg.rotateX((s * Math.PI) / 2);        // lay the pinna out to one side
        pg.scale(1, 0.34, 1);                 // and flatten it: a frond is a plane
        pg.translate(0, fh * t, (s * l) / 2);
        parts.push({ geometry: pg, matrix: at });
      }
    }
  }

  const m = new THREE.Mesh(
    bake(parts),
    mat('frond', () => {
      const f = cel({ color: 0x6f8f4a, bands: 3, tint: 0x55668c, side: THREE.DoubleSide, role: 'leaf' });
      f.flatShading = false;
      return f;
    })
  );
  return shadowify(m);
}

/** Bluebells: bells hung off one side of a nodding stem, which is what makes
 *  them bluebells and not blue flowers.  Spring only — see `buildWood`. */
function bluebells({ seed = 1, n = 9, h = 0.2 } = {}) {
  const rng = rngKit(seed * 2179);
  const g = new THREE.Group();
  const stems = [];
  const bells = [];

  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0, 0.09);
    const hh = h * rng.range(0.75, 1.2);
    const at = trs(Math.cos(a) * rr, 0, -Math.sin(a) * rr, 0, a, -rng.range(0.05, 0.3));
    const sg = new THREE.CylinderGeometry(0.003, 0.0045, hh, 4);
    sg.translate(0, hh / 2, 0);
    stems.push({ geometry: sg, matrix: at });

    for (let k = 0; k < 5; k++) {
      const bg = new THREE.ConeGeometry(0.011, 0.028, 5);
      bg.rotateX(Math.PI);                    // the bell hangs
      bg.translate(0.012 + 0.005 * k, hh * (0.6 + 0.09 * k), 0);
      bells.push({ geometry: bg, matrix: at });
    }
  }

  g.add(new THREE.Mesh(
    bake(stems),
    mat('bellStem', () => cel({ color: 0x6f9152, bands: 3, tint: 0x55668c, role: 'stem' }))
  ));
  g.add(new THREE.Mesh(
    bake(bells),
    mat('bell', () => cel({ color: PAL.bloomBlue, bands: 3, tint: 0x6a5a90, flat: false }))
  ));
  return shadowify(g);
}

/** A patch of moss.  No role: moss is the one green thing on the planet that
 *  does not turn, and that is exactly why a damp hollow keeps its colour in
 *  November when everything above it has gone. */
function mossPatch({ seed = 1, r = 0.34 } = {}) {
  const rng = rngKit(seed * 1867);
  const parts = [];
  for (let i = 0, n = rng.int(4, 7); i < n; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0, r * 0.7);
    const s = r * rng.range(0.34, 0.6);
    parts.push({
      geometry: new THREE.IcosahedronGeometry(s, 1),
      matrix: trs(Math.cos(a) * rr, 0.008, Math.sin(a) * rr, 0, rng.range(0, TAU), 0, 1.3, 0.3, 1.15),
    });
  }
  const m = new THREE.Mesh(
    bake(parts),
    mat('moss', () => cel({ color: 0x5e7f45, bands: 3, tint: 0x4f5d84, flat: false }))
  );
  return shadowify(m, false, true);
}

/**
 * A fallen trunk, lying along a bearing you choose, blocked along its own
 * axis — and optionally with fungus on it.
 *
 * `log` yaws itself at random, which is right for one log dropped in a field
 * and wrong the moment two of them are supposed to have come down together,
 * or the moment you need to know which way it lies to block it.
 */
function fallenTrunk(ctx, parent, { u, v, turn, seed = 1, len = 2.4, r = 0.18, fungus = 0, rng }) {
  const l = log({ seed, len, r });
  lay(ctx, parent, l, u, v, turn);

  const shelf = mat('bracket', () => cel({ color: 0xd9c39a, bands: 3, tint: 0x6a6690, flat: false }));
  const gill = mat('gill', () => cel({ color: 0x9c7f56, bands: 2, tint: 0x6a6690, flat: false }));
  for (let i = 0; i < fungus; i++) {
    const s = rng.sign();
    const rr = rng.range(0.045, 0.085);
    const holder = new THREE.Group();
    holder.position.set(rng.range(-len * 0.42, len * 0.42), r * rng.range(0.55, 1.05), s * r * 0.86);
    holder.rotation.y = s > 0 ? 0 : Math.PI;
    const plate = new THREE.Group();
    plate.rotation.x = -0.2;                 // shelves droop at the outer edge
    /* theta from -π/2 to π/2 is the half of the disc on the +z side, so the
     * flat edge lands against the trunk and the shelf sticks out of it. */
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(rr, rr * 0.72, 0.016, 10, 1, false, -Math.PI / 2, Math.PI),
      shelf
    );
    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(rr * 0.9, rr * 0.64, 0.01, 10, 1, false, -Math.PI / 2, Math.PI),
      gill
    );
    under.position.y = -0.012;
    plate.add(cap, under);
    holder.add(plate);
    l.add(holder);
  }
  // and a couple of little ones on the top, where the bark has gone
  for (let i = 0; i < Math.min(2, fungus); i++) {
    const m = mushroom({ seed: seed * 13 + i, h: rng.range(0.04, 0.07), cap: rng.range(0.03, 0.05) });
    m.position.set(rng.range(-len * 0.35, len * 0.35), r * 1.85, rng.range(-r * 0.3, r * 0.3));
    l.add(m);
  }

  blockLine(ctx, u, v, turn, len * 0.88, r + 0.1);
  return l;
}

/**
 * Leaf litter, instanced and seated rigidly.
 *
 * Fixed brown, and deliberately *not* on the `leaf` role — litter is what
 * fell last year, and tying it to the season's foliage turns the woodland
 * floor bright green in summer.
 *
 * `around` is what makes it read as litter rather than as a texture: leaves
 * gather **under** things.  Given the trunks, most of the scatter lands
 * within a couple of metres of one, which thickens the floor where the canopy
 * is and leaves a clearing bare for nothing.
 */
function litterOver(ctx, rng, {
  n, size = 0.055, color = 0x8a6a3e, around = null, spread = 2.4, lift = 0.012, loose = 0.35,
}) {
  const leafGeo = new THREE.PlaneGeometry(size, size * 0.76);
  leafGeo.rotateX(-Math.PI / 2);
  const im = new THREE.InstancedMesh(
    leafGeo,
    cel({ color, bands: 2, tint: 0x6a5a86, side: THREE.DoubleSide }),
    n
  );
  const hosts = around && around.length ? around : null;
  let placed = 0;
  for (let i = 0, guard = 0; placed < n && guard < n * 6; guard++) {
    let u, v;
    if (hosts && !rng.chance(loose)) {
      const host = hosts[Math.floor(rng.next() * hosts.length) % hosts.length];
      const a = rng.range(0, TAU);
      const d = Math.sqrt(rng.next()) * spread;
      u = host.u + Math.cos(a) * d;
      v = host.v + Math.sin(a) * d;
    } else {
      const a = rng.range(0, TAU);
      const d = Math.sqrt(rng.next()) * ctx.R;
      u = Math.cos(a) * d;
      v = Math.sin(a) * d;
    }
    /* The same refusal `ctx.scatter` makes, and for a sharper reason here:
     * the road's great circle crosses the mushroom garden, so a leaf cloud
     * laid over the whole disc lands a third of itself on the tarmac. */
    const p = ctx.at(u, v);
    if (hardAt(p.x, p.z) > 0.25) continue;
    instanceAt(im, placed++, ctx, u, v, rng.range(0, TAU), lift, rng.range(0.7, 1.5), rng.range(0.7, 1.5));
  }
  im.count = placed;
  im.instanceMatrix.needsUpdate = true;
  im.receiveShadow = true;
  im.userData.noOutline = true;
  return im;
}

/* ------------------------------------------------------------------ */

/**
 * The long meadow: grass, flowers, a fallen log, a fence along one side —
 * and, since terrain.js grew landforms, **a ridge with a hollow behind it.**
 *
 * The ridge is the only piece of ground on the planet worth composing
 * against, so everything added here is placed by *height* rather than by
 * scatter: flowers mass in the damp hollow and thin out on the exposed crest,
 * the coarse stuff is the other way round, and the wall runs along a contour
 * read off `heightAt` rather than along a bearing somebody guessed.
 */
export function buildMeadow(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:meadow';
  const rng = rngKit(101);
  const high = elevationIn(ctx);

  /* Flowers, thinning as the ground rises.  A meadow is not one density: the
   * hollow holds the water and the crest is grazed, wind-burnt and thin, and
   * that difference is most of what makes a ridge read as a ridge from
   * inside the grass rather than from the orbit view. */
  ctx.scatter(rng, { n: 108, minGap: 0.92 }, (u, v, i) => {
    if (!rng.chance(1 - 0.74 * high(u, v))) return null;
    return flowerClump({
      seed: 200 + i,
      n: rng.int(4, 9),
      color: rng.pick([PAL.bloomWhite, PAL.bloomYellow, PAL.bloomWhite, PAL.bloomBlue]),
      h: rng.range(0.12, 0.22),
    });
  }).forEach((p) => g.add(p.obj));

  /* The fallen log.  Its blocker used to be a single circle of radius 1 m
   * round a trunk 0.34 m thick — nearly a metre of clear grass at each end
   * that refused him with nothing there to see.  `log` yaws itself, so the
   * fix is to tell it which way to lie and block it along that line. */
  const fallen = log({ seed: 41, len: 2.1, r: 0.17 });
  lay(ctx, g, fallen, -5.5, -3.2, 0.9);
  blockLine(ctx, -5.5, -3.2, 0.9, 2.0, 0.28);

  fenceArc(ctx, g, { r: 15, from: 0.5, to: 1.9, seed: 7 });

  ctx.scatter(rng, { n: 7, minGap: 4 }, (u, v, i) =>
    rock({ seed: 300 + i, r: rng.range(0.16, 0.34) })
  ).forEach((p) => g.add(p.obj));

  /* Stone on the crest, where the soil is thinnest.  Small, and unblocked
   * like the rest of the meadow's rocks: at 0.3 m these are things he goes
   * over, and a no-go round each one would be a minefield of invisible
   * refusals in the one part of the field with a view. */
  ctx.scatter(rng, { n: 14, minGap: 1.8 }, (u, v, i) => {
    if (!rng.chance(high(u, v) ** 2)) return null;
    return rock({ seed: 340 + i, r: rng.range(0.1, 0.24) });
  }).forEach((p) => g.add(p.obj));

  /* --- the crest: seed heads, thistles, and a wall along the contour --- */

  ctx.scatter(rng, { n: 66, minGap: 0.8 }, (u, v, i) => {
    if (!rng.chance(0.1 + 0.9 * high(u, v) ** 1.6)) return null;
    return seedHeads({ seed: 1200 + i, n: rng.int(9, 18), h: rng.range(0.26, 0.44) });
  }).forEach((p) => g.add(p.obj));

  /* A thistle wants light and disturbed ground, so it wants the top of the
   * bank.  Not blocked: it is a plant with spines and not a wall, the
   * brambles are the world's hazard, and a no-go round every weed in the
   * meadow would make the crest unwalkable for no gain. */
  ctx.scatter(rng, { n: 22, minGap: 2.1 }, (u, v, i) => {
    if (!rng.chance(0.15 + 0.85 * high(u, v))) return null;
    return thistle({ seed: 1300 + i, h: rng.range(0.42, 0.58) });
  }).forEach((p) => g.add(p.obj));

  /* The wall: a remnant of a field boundary nobody has kept up, running
   * along the contour of the ridge's shoulder because that is where a wall
   * gets built — you do not carry stone uphill.  The contour is *measured*
   * off `heightAt`, so it stays a contour if the landform is ever retuned. */
  const wallU = -1.5, wallV = 9.5;
  const contour = uphillAt(ctx, wallU, wallV) + Math.PI / 2;
  wallRun(ctx, g, { u: wallU, v: wallV, turn: contour, len: 8, seg: 1.6, seed: 60, gaps: [2] });
  const stub = { u: 6.4, v: 6.6 };
  wallRun(ctx, g, {
    u: stub.u, v: stub.v, turn: uphillAt(ctx, stub.u, stub.v) + Math.PI / 2,
    len: 3.2, seg: 1.6, seed: 82, h: 0.46,
  });

  /* Two stumps, both on the wall's line: a field boundary is a hedge as often
   * as it is stone, and what is left of the hedge is the stumps. */
  for (const [su, sv, sr] of [[-4.8, 12.9, 0.22], [-8.9, -1.7, 0.26]]) {
    const st = stump({ seed: 1400 + Math.round(su * 10), r: sr, h: sr * 1.4 });
    ctx.put(st, su, sv);
    g.add(st);
    ctx.block(su, sv, sr * 1.05);
  }

  /* --- the hollow: wet ground, coarse grass, moles --- */

  ctx.scatter(rng, { n: 26, minGap: 1.7 }, (u, v, i) => {
    if (!rng.chance(1 - high(u, v) ** 0.7)) return null;
    /* Small: a tussock's straw mound is a wide dome and at 0.34 m it reads
     * from ten metres as a boulder rather than as coarse grass. */
    return tussock({ seed: 1500 + i, r: rng.range(0.17, 0.26) });
  }).forEach((p) => g.add(p.obj));

  /* Moles work the deep soil at the foot of a bank and not the thin stuff on
   * top of it.  Unblocked: a molehill is 12 cm of loose earth and he goes
   * straight over the top of it. */
  ctx.scatter(rng, { n: 16, minGap: 1.4 }, (u, v, i) => {
    if (!rng.chance(1 - high(u, v))) return null;
    return molehillProp({ seed: 1600 + i, r: rng.range(0.09, 0.15) });
  }).forEach((p) => g.add(p.obj));

  /* The hare's form, in the lee of the ridge, which is where a hare lies:
   * out of the wind, with the whole hollow in front of her. */
  const form = hareForm({ seed: 17 });
  ctx.put(form, -8.2, -7.0);
  g.add(form);
  ctx.interact(-8.2, -6.2, "a hare's form", ctx.lines(
    'a hare was lying here. the grass is still flat, and still warm.',
    'she is not here. she is somewhere he cannot see, watching him.',
    'he turns round twice in it. it fits him very badly.'
  ));

  /* Hay bales are **autumn only**, exactly as in v1: they are the clearest
   * single signal that the year has turned, and having them all year round
   * makes the season stop meaning anything. */
  const bales = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = bale({ seed: 50 + i, r: 0.44 });
    const u = -7 + i * 3.4, v = 6.5 - (i % 2) * 1.6;
    ctx.put(b, u, v);
    bales.add(b);
    ctx.block(u, v, 0.55);
  }
  g.add(bales);
  bales.userData.noMerge = true;      // seasonal: shown and hidden whole
  ctx.seasonal.push({ obj: bales, at: (s) => s.w[2] > 0.25 });

  root.add(g);
  return g;
}

/**
 * The butterfly garden.  v1 gave this place a flower boost of 3.6 and it is
 * still the densest thing on the planet — the one place that is obviously
 * *tended*, which is what makes the wild ones read as wild.
 *
 * Tended means *tools*, and tools are what was missing: a garden with no
 * bucket in it is a flower meadow with edging round it.  Everything added
 * here is something somebody put down and will come back for.
 */
export function buildGarden(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:garden';
  const rng = rngKit(211);

  /* Four beds set round the birdbath rather than in rows: the place is a
   * disc now, and rows in a disc read as a mistake. */
  const edgeMat = cel({ color: PAL.chalk, bands: 3, tint: 0x6f6894 });
  const stoneGeo = new THREE.BoxGeometry(0.13, 0.075, 0.10);
  const NEDGE = 44;
  const im = new THREE.InstancedMesh(stoneGeo, edgeMat, NEDGE * 4);
  let e = 0;

  for (let bed = 0; bed < 4; bed++) {
    const ang = (bed / 4) * TAU + 0.4;
    const bu = Math.cos(ang) * 8.5, bv = Math.sin(ang) * 8.5;
    const rx = 3.4, ry = 2.1;

    for (let i = 0; i < NEDGE; i++) {
      const a = (i / NEDGE) * TAU;
      const du = Math.cos(a) * rx, dv = Math.sin(a) * ry;
      // turn the bed to face the middle, so four beds read as a garden
      const u = bu + du * Math.cos(ang) - dv * Math.sin(ang);
      const v = bv + du * Math.sin(ang) + dv * Math.cos(ang);
      instanceAt(im, e++, ctx, u, v, a + ang + rng.range(-0.2, 0.2), 0.03);
    }

    for (let i = 0; i < 16; i++) {
      const a = rng.range(0, TAU);
      const d = Math.sqrt(rng.next());
      const du = Math.cos(a) * rx * 0.8 * d, dv = Math.sin(a) * ry * 0.8 * d;
      const fl = flowerClump({
        seed: 400 + bed * 30 + i,
        n: rng.int(6, 12),
        color: rng.pick([PAL.petal, PAL.bloomYellow, PAL.bloomRed, PAL.bloomBlue, PAL.bloomWhite]),
        h: rng.range(0.18, 0.34),
      });
      ctx.put(fl,
        bu + du * Math.cos(ang) - dv * Math.sin(ang),
        bv + du * Math.sin(ang) + dv * Math.cos(ang));
      g.add(fl);
    }
  }
  im.count = e;
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = true;
  im.receiveShadow = true;
  g.add(im);

  /* The birdbath: the only thing standing in this place, so it does all the
   * work of telling you where you are from right across the field. */
  const bath = new THREE.Group();
  const stone = cel({ color: PAL.stone, bands: 3, tint: 0x6a6690, flat: false });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.52, 10), stone);
  pillar.position.y = 0.26;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.2, 0.12, 14), stone);
  bowl.position.y = 0.56;
  const dish = new THREE.Mesh(
    new THREE.CircleGeometry(0.27, 14),
    cel({ color: PAL.water, bands: 2, tint: 0x59718f, flat: false, role: 'water' })
  );
  dish.rotation.x = -Math.PI / 2;
  dish.position.y = 0.615;
  bath.add(pillar, bowl, dish);
  ctx.put(bath, 0, 0);
  g.add(bath);
  ctx.block(0, 0, 0.42);
  ctx.interact(0, 1.0, 'the birdbath', ctx.lines(
    'he drinks, and shakes his whiskers dry',
    'a wren was here first. it left, with opinions.',
    'look up tonight: the spiky stars over the wood are called the hedgepig'
  ));

  /* --- the path --- *
   *
   * Stepping stones from the gate side of the garden to the bath, with one
   * branch off it.  Slabs, not a paved strip: the grass has to come up
   * between them or it is a pavement, and this is a garden.  Instanced, so
   * a winding path of thirty stones is one draw call.
   */
  const slabGeo = new THREE.CylinderGeometry(0.155, 0.135, 0.045, 7);
  const path = new THREE.InstancedMesh(slabGeo, mat('slab', stoneMat), 40);
  let np = 0;
  const runPath = (a0, a1, from, to, wobble) => {
    const steps = Math.max(2, Math.round(Math.abs(from - to) / 0.62));
    for (let i = 0; i <= steps && np < path.count; i++) {
      const t = i / steps;
      const a = a0 + (a1 - a0) * t + Math.sin(t * 3.1) * wobble;
      const d = from + (to - from) * t;
      instanceAt(path, np++, ctx,
        Math.cos(a) * d + rng.range(-0.09, 0.09),
        Math.sin(a) * d + rng.range(-0.09, 0.09),
        rng.range(0, TAU), 0.015, rng.range(0.85, 1.2), rng.range(0.85, 1.2));
    }
  };
  runPath(5.9, 5.5, 13.5, 0.75, 0.1);       // in from the rim to the bath
  /* The second run is written as 6.9 rather than 0.62 on purpose: these are
   * lerped, and lerping 5.5 to 0.62 sweeps the long way round and lays the
   * path in a circle across the whole garden. */
  runPath(5.5, 6.9, 1.0, 4.6, 0.12);        // and away toward the raised beds
  path.count = np;
  path.instanceMatrix.needsUpdate = true;
  path.receiveShadow = true;
  g.add(path);

  /* --- the working end: beds, frame, canes, tools --- */

  const BEDS = [
    { u: 4.4, v: 3.9, turn: 0.9, w: 1.6, d: 1.0 },
    { u: 6.0, v: 1.5, turn: 0.75, w: 1.4, d: 0.9 },
    { u: -3.6, v: 5.4, turn: 2.3, w: 1.5, d: 0.95 },
  ];
  BEDS.forEach((b, i) => {
    const rb = raisedBed({ seed: 30 + i * 5, w: b.w, d: b.d });
    lay(ctx, g, rb, b.u, b.v, b.turn);
    /* Three circles down the bed's long axis rather than one round the whole
     * thing: the corners stay a shade permeable, which is the right way for
     * a rectangle to be wrong. */
    for (const t of [-b.w * 0.3, 0, b.w * 0.3]) {
      ctx.block(b.u + Math.cos(b.turn) * t, b.v + Math.sin(b.turn) * t, b.d * 0.55);
    }
  });

  const frame = coldFrame({ seed: 5 });
  lay(ctx, g, frame, 8.2, -2.6, 2.5);
  for (const t of [-0.3, 0.3]) {
    ctx.block(8.2 + Math.cos(2.5) * t, -2.6 + Math.sin(2.5) * t, 0.34);
  }
  ctx.interact(7.4, -3.2, 'the cold frame', ctx.lines(
    'the glass is fogged on the inside. something in there is growing.',
    'a hedgehog looks back at him out of the glass. he thinks better of it.',
    'somebody props the lid open on warm days. today the lid is open.'
  ));

  for (const [cu, cv, ct, cn] of [[2.0, 7.6, 1.1, 5], [5.0, 6.6, 1.35, 4]]) {
    lay(ctx, g, caneRow({ seed: 90 + cn, n: cn, len: 0.42 * (cn - 1) + 0.4, h: 1.35 }), cu, cv, ct);
  }

  /* The bench looks at the birdbath, because that is what it is for.  Its
   * back is local +z and `rotation.y = -turn` sends +z to (-sin, cos), so a
   * turn a right angle off the bearing to the middle sits him facing it. */
  const seat = bench({ seed: 12, len: 1.3 });
  const seatTurn = Math.atan2(-3.7, 8.8) + Math.PI / 2;
  lay(ctx, g, seat, -8.8, 3.7, seatTurn);
  for (const t of [-0.45, 0, 0.45]) {
    ctx.block(-8.8 + Math.cos(seatTurn) * t, 3.7 + Math.sin(seatTurn) * t, 0.19);
  }
  ctx.interact(-8.0, 3.35, 'the bench', ctx.lines(
    'nobody has sat on it for a while. the legs have gone green at the foot.',
    'he gets under it, which is the correct use of a bench',
    'from under here the whole garden is legs and stems'
  ));

  /* The tools, left where they were put down — beside the frame, not tidied
   * into a line.  A can standing next to a bucket next to a crate is a shop
   * window; these are three things at three angles, a stride apart. */
  const can = wateringCan({ seed: 3 });
  ctx.put(can, 7.0, -1.5);
  g.add(can);
  ctx.block(7.0, -1.5, 0.12);

  const pail = bucket({ seed: 73, r: 0.12, h: 0.18 });
  ctx.put(pail, 6.2, -2.9);
  g.add(pail);
  ctx.block(6.2, -2.9, 0.11);

  const box = crate({ seed: 71, s: 0.38 });
  lay(ctx, g, box, 8.9, -1.1, 0.6);
  ctx.block(8.9, -1.1, 0.2);

  const box2 = crate({ seed: 77, s: 0.34 });
  lay(ctx, g, box2, 8.97, -1.17, 1.1);
  box2.position.y += 0.38;                 // stacked, and not quite square on
  ctx.block(8.97, -1.17, 0.18);

  /* Edging along the path: low things, close together, which is what tells
   * you the path was meant rather than worn. */
  ctx.scatter(rng, { r: 12, inner: 1.6, n: 34, minGap: 0.55 }, (u, v, i) => {
    const a = Math.atan2(v, u);
    const d = Math.hypot(u, v);
    /* Within a metre of the way in, and nowhere else: the wrapped angle to
     * the path's bearing, times the radius, is the arc distance off it. */
    const near = Math.abs(((a - 5.7 + Math.PI * 3) % TAU) - Math.PI) * d;
    if (near > 0.9 || d > 13) return null;
    return flowerClump({
      seed: 900 + i, n: rng.int(4, 8),
      color: rng.pick([PAL.bloomWhite, PAL.petal, PAL.bloomYellow]),
      h: rng.range(0.1, 0.18),
    });
  }).forEach((p) => g.add(p.obj));

  root.add(g);
  return g;
}

/**
 * The wood.
 *
 * Two things make a wood at this scale and neither is the trees: the light
 * going out under the canopy, and the ground going brown.  The trees leave a
 * clear way through the middle, because a wood you have to fight through is
 * a wall, and v1's rule about walls applies to scenery as much as to hazards.
 *
 * The third thing, added since: **it has to have somewhere the light gets
 * in.** A wood at one density is a texture. A wood with a clearing in it,
 * a stand of pale trunks on one side and three trees down together on the
 * other is a *place*, and every one of those is one rule about where things
 * may stand.
 */
export function buildWood(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:wood';
  const rng = rngKit(307);

  /* The clearing: off-centre, and off the corridor on purpose so that the
   * way through and the open ground are two different discoveries. */
  const GLADE = { u: 7.6, v: -6.4, r: 4.1 };
  const gladeD = (u, v) => Math.hypot(u - GLADE.u, v - GLADE.v);

  const trunks = ctx.scatter(rng, { n: 56, minGap: 2.3 }, (u, v, i) => {
    if (Math.abs(v) < 2.0 && rng.chance(0.7)) return null;   // a way through
    if (gladeD(u, v) < GLADE.r) return null;                 // and a way up
    return tree({
      seed: 500 + i,
      h: rng.range(3.4, 6.2),
      spread: rng.range(1.0, 1.9),
      trunk: rng.range(0.13, 0.24),
      lumps: rng.int(3, 5),
    });
  });
  trunks.forEach((p) => {
    g.add(p.obj);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.32 });
  });

  /* A stand of birch on one flank.  Birch comes up in a crowd on the light
   * edge of a wood and it is the one tree here you can identify at forty
   * metres, which is what a stand is *for*: it says which part of the wood
   * you are in, and this wood had no parts. */
  const BIRCH = { u: -9.0, v: 5.2, r: 3.4 };
  const stand = [];
  for (let guard = 0; stand.length < 10 && guard < 300; guard++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * BIRCH.r;
    const u = BIRCH.u + Math.cos(a) * d, v = BIRCH.v + Math.sin(a) * d;
    if (stand.some((s) => Math.hypot(s.u - u, s.v - v) < 1.3)) continue;
    const b = birch({ seed: 640 + stand.length, h: rng.range(4.6, 6.4), r: rng.range(0.06, 0.095) });
    ctx.put(b, u, v);
    g.add(b);
    ctx.block(u, v, 0.17);
    stand.push({ u, v });
  }

  /* The deadfall: three trunks down together on the near edge of the
   * clearing, which is why the clearing is there. */
  const deadfall = [
    { u: 4.6, v: -2.2, turn: 0.42, len: 3.2, r: 0.23, seed: 660 },
    { u: 5.4, v: -3.1, turn: 1.05, len: 2.7, r: 0.19, seed: 663 },
    { u: 3.4, v: -3.4, turn: 2.5, len: 2.2, r: 0.16, seed: 666 },
  ];
  for (const d of deadfall) fallenTrunk(ctx, g, { ...d, fungus: 2, rng });

  /* Stumps: this wood has been cut before, which is the only explanation a
   * clearing has ever needed. */
  ctx.scatter(rng, { n: 9, minGap: 3.4 }, (u, v, i) => {
    if (gladeD(u, v) < GLADE.r * 0.55) return null;
    return stump({ seed: 1700 + i, r: rng.range(0.17, 0.3), h: rng.range(0.22, 0.36) });
  }).forEach((p) => {
    g.add(p.obj);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.24 });
  });

  /* Bracken, thickest round the rim of the clearing, which is exactly where
   * it grows: it wants the light but it will not stand in the open. */
  ctx.scatter(rng, { n: 46, minGap: 1.25 }, (u, v, i) => {
    const d = gladeD(u, v);
    const edge = Math.exp(-(((d - GLADE.r * 1.15) / 2.2) ** 2));
    if (d < GLADE.r * 0.8) return null;
    if (!rng.chance(0.2 + 0.8 * edge)) return null;
    return bracken({ seed: 1800 + i, h: rng.range(0.38, 0.66), n: rng.int(4, 7) });
  }).forEach((p) => g.add(p.obj));

  /* What is in the clearing is the *point* of the clearing: grass that has
   * had sun on it, and flowers, neither of which exists anywhere else under
   * this canopy. */
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, TAU);
    // not sqrt: this one *should* mass in the middle, where the light is
    const d = rng.next() * GLADE.r * 0.9;
    const u = GLADE.u + Math.cos(a) * d, v = GLADE.v + Math.sin(a) * d;
    const p = i % 3 === 0
      ? seedHeads({ seed: 1900 + i, n: rng.int(10, 20), h: rng.range(0.3, 0.5) })
      : flowerClump({
        seed: 1900 + i, n: rng.int(5, 10),
        color: rng.pick([PAL.bloomWhite, PAL.petal, PAL.bloomYellow]),
        h: rng.range(0.14, 0.26),
      });
    ctx.put(p, u, v);
    g.add(p);
  }
  ctx.interact(GLADE.u, GLADE.v - 1.2, 'the clearing', ctx.lines(
    'sun, in a wood. he sits down in the middle of it for a while.',
    'the grass in here is a foot taller than any of it under the trees',
    'at night the hole in the canopy is full of stars and nothing else'
  ));

  /* Bluebells, and **spring only**.  A wood floor blue in August is the same
   * mistake as hay bales in April: it is the one thing that would have told
   * you what month it is, spent. */
  const bells = new THREE.Group();
  ctx.scatter(rng, { n: 54, minGap: 0.9 }, (u, v, i) => {
    // drifts: they come up in sheets, so three clumps to a spot
    const clump = new THREE.Group();
    for (let k = 0, n = rng.int(1, 3); k < n; k++) {
      const b = bluebells({ seed: 2000 + i * 4 + k, n: rng.int(6, 12), h: rng.range(0.15, 0.25) });
      b.position.set(rng.range(-0.28, 0.28), 0, rng.range(-0.28, 0.28));
      clump.add(b);
    }
    return clump;
  }).forEach((p) => bells.add(p.obj));
  bells.userData.noMerge = true;      // seasonal: shown and hidden whole
  g.add(bells);
  ctx.seasonal.push({ obj: bells, at: (s) => s.w[0] > 0.25 });

  /* Litter, gathered under the canopy rather than spread evenly over the
   * disc — so the clearing comes out bare for nothing, and the floor under
   * the trees comes out deep. */
  g.add(litterOver(ctx, rng, { n: 3000, around: trunks, spread: 2.6, loose: 0.3 }));

  /* The fairy house, carried over from v1 — a door in a tree, and nothing
   * else.  Everything about it is what you are not shown. */
  const host = trunks.find((p) => Math.hypot(p.u, p.v) > 5) || trunks[0];
  if (host) {
    const door = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.CircleGeometry(0.13, 5),
      cel({ color: 0x8a4f3c, bands: 3, tint: 0x6a5a86 })
    );
    panel.position.set(0.2, 0.14, 0);
    panel.rotation.y = Math.PI / 2;
    panel.scale.y = 1.35;
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 6, 5),
      cel({ color: PAL.bloomYellow, bands: 2, tint: 0x7a6a8e })
    );
    knob.position.set(0.215, 0.14, 0.06);
    door.add(panel, knob);
    ctx.put(door, host.u, host.v);
    g.add(door);
    ctx.interact(host.u + 0.7, host.v, 'the little door', ctx.lines(
      'nobody answers, but something is listening',
      'a crumb he left last time is gone',
      'tonight the knob is polished. somebody has visitors.'
    ));
  }

  root.add(g);
  return g;
}

/**
 * The mushroom garden: the wood's floor, with the trees mostly gone.
 *
 * It is a damp hollow — `dishes` in terrain.js drops it 8 cm below its
 * neighbours — and everything here is what damp shade does to dead wood.
 * The one shape that carries the place is the ring, and there are three of
 * them now: a circle of anything is instantly not-natural, and it is still
 * the only shape in the world that says *somebody comes here*.
 */
export function buildMushrooms(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:mushrooms';
  const rng = rngKit(401);

  const trees = ctx.scatter(rng, { n: 12, minGap: 4, inner: 8 }, (u, v, i) =>
    tree({ seed: 600 + i, h: rng.range(3.2, 4.6), spread: rng.range(0.9, 1.4) })
  );
  trees.forEach((p) => {
    g.add(p.obj);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.32 });
  });

  /* A stump with a fairy ring round it.  The ring is the point of the place:
   * a circle of anything is instantly not-natural, and it is the only shape
   * in the world that says *somebody comes here*.
   *
   * It is no longer at (0, 0), and `softSpot` says why: the road's great
   * circle runs through this place's centre and the whole ring was laid on
   * the tarmac.  Everything hand-placed here goes through that search. */
  const home = softSpot(ctx, 0, 0, 2.1);
  const stumpG = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.42, 12),
    cel({ color: PAL.timberDark, bands: 3, tint: 0x63537f })
  );
  body.position.y = 0.21;
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(0.335, 12),
    cel({ color: 0xbf9f74, bands: 3, tint: 0x63537f })
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.421;
  stumpG.add(body, top);
  ctx.put(stumpG, home.u, home.v);
  g.add(stumpG);
  ctx.block(home.u, home.v, 0.44);

  /* Three rings, and the two new ones are deliberately not concentric with
   * the first, not the same size, and not complete: a ring you can read as
   * laid out is a fairy ring; three tidy ones are a diagram. */
  const rings = [
    { ...home, r: 1.5, n: 15, seed: 700, gap: -1 },
    { ...softSpot(ctx, -8.5, 6.2, 1.4), r: 1.15, n: 13, seed: 730, gap: 4 },
    { ...softSpot(ctx, 7.6, -8.0, 2.4), r: 2.05, n: 21, seed: 760, gap: 12 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      if (i === ring.gap || i === ring.gap + 1) continue;
      const a = (i / ring.n) * TAU;
      const rr = ring.r + rng.range(-0.12, 0.12);
      const mush = mushroom({
        seed: ring.seed + i,
        h: rng.range(0.09, 0.15),
        cap: rng.range(0.06, 0.095),
      });
      ctx.put(mush, ring.u + Math.cos(a) * rr, ring.v + Math.sin(a) * rr);
      g.add(mush);
    }
  }

  /* Two runs of fallen timber, laid end to end with a kink in each — a tree
   * comes down in one line and then breaks, and the break is what stops it
   * reading as a fence made of logs.  Fungus lives on the underside of the
   * damp end, which is the whole reason this place is called what it is. */
  const runs = [
    [{ u: -9.6, v: -3.4, turn: 0.92, len: 2.6, r: 0.2, seed: 780, fungus: 3 },
     { u: -8.1, v: -1.2, turn: 1.22, len: 2.2, r: 0.18, seed: 784, fungus: 2 }],
    [{ u: 9.6, v: 1.4, turn: 1.05, len: 2.4, r: 0.19, seed: 788, fungus: 3 },
     { u: 11.0, v: 3.5, turn: 0.78, len: 2.0, r: 0.16, seed: 792, fungus: 2 }],
  ];
  const logs = [];
  for (const run of runs) {
    for (const l of run) {
      const s = softSpot(ctx, l.u, l.v, l.len * 0.55);
      fallenTrunk(ctx, g, { ...l, ...s, rng });
      logs.push(s);
    }
  }

  // and the rest, scattered as they actually grow: in twos and threes
  ctx.scatter(rng, { n: 64, minGap: 1.1 }, (u, v, i) => {
    const clump = new THREE.Group();
    for (let k = 0, n = rng.int(2, 4); k < n; k++) {
      const mush = mushroom({
        seed: 800 + i * 5 + k,
        h: rng.range(0.06, 0.13),
        cap: rng.range(0.045, 0.085),
        spotted: rng.chance(0.55),
        color: rng.pick([PAL.mushroomCap, 0xd9a05a, 0xe8dcc0]),
      });
      mush.position.set(rng.range(-0.16, 0.16), 0, rng.range(-0.16, 0.16));
      clump.add(mush);
    }
    return clump;
  }).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 12, minGap: 2.6 }, (u, v, i) =>
    rock({ seed: 900 + i, r: rng.range(0.12, 0.3) })
  ).forEach((p) => g.add(p.obj));

  /* Moss, on the ground and on the stone.  It is the only green in the place
   * that is still green in February, and it is what makes the hollow read as
   * damp rather than as dead. */
  ctx.scatter(rng, { n: 26, minGap: 1.3 }, (u, v, i) =>
    mossPatch({ seed: 2100 + i, r: rng.range(0.22, 0.45) })
  ).forEach((p) => g.add(p.obj));

  /* Tussocks: coarse grass on a wet foot.  They are the one prop in props.js
   * whose whole job is to tell you the ground under it is soft. */
  ctx.scatter(rng, { n: 14, minGap: 2.2 }, (u, v, i) =>
    tussock({ seed: 2200 + i, r: rng.range(0.18, 0.28) })
  ).forEach((p) => g.add(p.obj));

  /* Deeper litter than the wood's: two layers, the lower one darker and
   * flatter, which is what a year of leaves under a year of leaves looks
   * like once the top of it has gone to mould. */
  const hosts = [...trees.map((p) => ({ u: p.u, v: p.v })), ...logs];
  g.add(litterOver(ctx, rng, {
    n: 1100, size: 0.075, color: 0x6b5232, around: hosts, spread: 3.6, lift: 0.006, loose: 0.5,
  }));
  g.add(litterOver(ctx, rng, {
    n: 2400, size: 0.062, around: hosts, spread: 3.2, lift: 0.016, loose: 0.45,
  }));

  root.add(g);
  return g;
}
