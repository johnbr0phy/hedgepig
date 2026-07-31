import * as THREE from 'three';
import { cel } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { rippleTex } from '../../core/textures.js';
import { rngKit, lerp, clamp, TAU, bake, trs, shadowify } from '../../core/util.js';
import { heightAt, waterDepthAt, lakeShore, WATER_Y } from '../terrain.js';
import { CENTRE, LAKE, LAKE_R, offsetFrom, distance, bearing } from '../plan.js';
import { positionAt, basisAt } from '../planet.js';
import { reeds, reed, rock, log, flowerClump, tussock, plank } from '../props.js';

/* ------------------------------------------------------------------ *
 * The lake, and the mire at its edge.
 *
 * In the banded world the lake ran the full width of the field and was
 * therefore an **unavoidable wall**, which is what earned it the boat.  With
 * the world open it is a disc you can walk round — so the boat stays as the
 * *short* way over rather than the only way, which is a better thing for a
 * boat to be.
 *
 * The shoreline is not authored.  The bed is dug by `heightAt` and the water
 * is a flat sheet at `WATER_Y`, so the edge is simply the contour where one
 * crosses the other: retune the bed and the shore follows on its own.
 * ------------------------------------------------------------------ */

/* ----------------------------- local makers ----------------------------- *
 * Everything below belongs to these two places and nowhere else, so it lives
 * here rather than in `props.js` — the same reason `fenceArc` lives in
 * green.js.  A heron in the farmyard would be a mistake.
 */

const _m = new THREE.Matrix4();
const _fm = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _yq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _pv = new THREE.Vector3();
const _sv = new THREE.Vector3();

/**
 * Make a family of props share one material per season role.
 *
 * `cel` deliberately never caches a material carrying a `role`, because two
 * call sites sharing one would fight over its colour — so every clump that
 * `reed` or `tussock` builds mints its own.  Forty clumps is then forty
 * materials, which the static merge in world/index.js cannot fold, and forty
 * draw calls for one reed bed.  Handing them all the first one is safe and
 * costs nothing: `applyPalette` rewrites the colour of *every* material in a
 * role each frame, so they are already the same colour at runtime — the only
 * thing sharing changes is that the bed becomes one mesh.
 *
 * Keyed on the things a merge may not cross: two-sidedness and faceting.
 */
function shareRoles(obj, pool) {
  obj.traverse((o) => {
    const role = o.material?.userData?.role;
    if (!role) return;
    const key = `${role}|${o.material.side}|${o.material.flatShading}`;
    if (pool[key]) o.material = pool[key];
    else pool[key] = o.material;
  });
}

/**
 * The yaw that aims a prop's own +x along the ground from (u1, v1) toward
 * (u2, v2) — or square across it, with `square`.
 *
 * **Not `-(atan2(dv, du) + π/2)`,** which is the obvious thing, and is what
 * this file did first, and is wrong by an angle that depends on which way you
 * are pointing.
 *
 * A place's (u, v) axes are **not** the tangent frame the bake will seat the
 * prop in.  `offsetFrom` builds its east from `(0,0,1) × centre`, which comes
 * out as **minus** the tangent east — so +u runs *west* while +v runs north,
 * and the two frames differ by a **reflection**, not a rotation.  An angle
 * therefore does not carry across at all: a local heading φ arrives in the
 * world as π − φ, so a yaw derived from φ is out by `2φ − π`.  It happens to
 * be right for a line running due north and it is 60° out for the boardwalk,
 * which is how it was caught — a run of boards all neatly parallel to each
 * other and all skewed off the line they were laying, with the runners
 * underneath stepping sideways at every joint.
 *
 * `bearing` already answers the question honestly — a unit heading from one
 * flat point toward another, in the first one's own frame — and it is exact
 * over the poles, which no arctangent of a coordinate difference is.
 */
function facing(ctx, u1, v1, u2, v2, square = false) {
  const a = ctx.at(u1, v1);
  const b = ctx.at(u2, v2);
  const br = bearing(a.x, a.z, b.x, b.z);
  /* Local +x lands on `east·cos(yaw) − north·sin(yaw)` once the bake has
   * multiplied in the tangent basis; both branches are that, solved. */
  return square ? Math.atan2(-br.east, -br.north) : Math.atan2(-br.north, br.east);
}

/** Seat one instance of `im` on the ground at local (u, v), turned and scaled. */
function seatOn(im, i, ctx, u, v, yaw, lift, sx, sy, sz) {
  const p = ctx.at(u, v);
  const b = basisAt(p.x, p.z);
  _fm.makeBasis(b.east, b.up, b.north);
  _q.setFromRotationMatrix(_fm);
  _q.multiply(_yq.setFromAxisAngle(_up, yaw));
  _m.compose(positionAt(p.x, heightAt(p.x, p.z) + lift, p.z, _pv), _q, _sv.set(sx, sy, sz));
  im.setMatrixAt(i, _m);
  return p;
}

/**
 * A heron, standing in the margin.
 *
 * It is a **prop and not a critter**, which is the whole joke: everything
 * else alive out here moves when he comes near — the frogs plop off the
 * bank, the hens scatter, the fish rise and are gone — and the heron does
 * not, ever.  That is also the honest model of the bird: a real one will
 * hold one pose for twenty minutes waiting for something to swim past.
 *
 * At 0.95 m it stands nearly four hedgepigs tall, and standing underneath it
 * is most of the reason to walk round to this side of the lake.
 *
 * Built facing +x, so the caller can turn it to look out over the water.
 */
function heron({ seed = 91 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 3571);

  const slate = cel({ color: 0x9aa3af, bands: 3, tint: 0x5c688e, flat: false });
  const wingMat = cel({ color: 0x828b9a, bands: 3, tint: 0x5c688e, flat: false });
  const pale = cel({ color: 0xdfe3e2, bands: 'soft3', tint: 0x7a86a8, flat: false });
  const dark = cel({ color: 0x3c414f, bands: 3, tint: 0x4a5578, flat: false });
  const billMat = cel({ color: 0xd8b45c, bands: 3, tint: 0x7a6a8e, flat: false });
  const legMat = cel({ color: 0xa08f74, bands: 3, tint: 0x6a5f8e, flat: false });

  /* Legs, one a little ahead of the other.  A heron at rest often stands on
   * one, but a bird on one leg reads from a distance as a bird with a leg
   * missing, and this one has to survive being looked at from 40 cm up. */
  const legs = [];
  const feet = [];
  for (const s of [-1, 1]) {
    const lh = 0.46;
    const lg = new THREE.CylinderGeometry(0.011, 0.014, lh, 5);
    lg.translate(0, lh / 2, 0);
    const fore = s > 0 ? 0.03 : -0.02;
    legs.push({ geometry: lg, matrix: trs(fore, 0, s * 0.045, 0, 0, -s * 0.02) });
    // two toes each, because on the shingle the feet are the part you see
    for (const t of [-0.28, 0.28]) {
      const toe = new THREE.BoxGeometry(0.07, 0.009, 0.011);
      toe.translate(0.035, 0, 0);
      feet.push({ geometry: toe, matrix: trs(fore, 0.005, s * 0.045, 0, t, 0) });
    }
  }
  g.add(new THREE.Mesh(bake(legs.concat(feet)), legMat));

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 9), slate);
  body.scale.set(1.5, 0.95, 0.8);
  body.position.y = 0.60;
  g.add(body);

  // tail: a stub cone laid back along -x, flattened so it reads as feathers
  const tg = new THREE.ConeGeometry(0.062, 0.22, 6);
  tg.rotateZ(Math.PI / 2);
  tg.translate(-0.30, 0.60, 0);
  const tail = new THREE.Mesh(tg, wingMat);
  tail.scale.z = 0.55;
  g.add(tail);

  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), wingMat);
    wing.scale.set(1.45, 0.85, 0.34);
    wing.position.set(-0.01, 0.61, s * 0.108);
    g.add(wing);
    const pg = new THREE.ConeGeometry(0.045, 0.28, 5);
    pg.rotateZ(Math.PI / 2);
    pg.translate(-0.20, 0, 0);
    const prim = new THREE.Mesh(pg, dark);
    prim.scale.z = 0.3;
    prim.position.set(-0.06, 0.565, s * 0.085);
    prim.rotation.y = -s * 0.10;
    g.add(prim);
  }

  /* The neck is folded, not extended.  An extended neck is the hunting bird
   * and it reads as a stork; the hunched S, with the head sitting over the
   * breast, is the shape you actually meet standing in a lake. */
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.00, 0.645, 0),
    new THREE.Vector3(0.09, 0.72, 0),
    new THREE.Vector3(0.145, 0.81, 0),
    new THREE.Vector3(0.128, 0.885, 0),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.024, 6, false), pale));

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), pale);
  head.scale.set(1.5, 0.95, 0.85);
  head.position.set(0.128, 0.905, 0);
  g.add(head);

  const bg = new THREE.ConeGeometry(0.019, 0.17, 6);
  bg.rotateZ(-Math.PI / 2);
  bg.translate(0.085, 0, 0);
  const bill = new THREE.Mesh(bg, billMat);
  bill.position.set(0.165, 0.902, 0);
  bill.rotation.z = -0.11;
  g.add(bill);

  // the crest: two black plumes off the back of the head, which is the one
  // marking that says grey heron and not gull
  for (const s of [-1, 1]) {
    const cg = new THREE.ConeGeometry(0.012, 0.13, 4);
    cg.rotateZ(Math.PI / 2);
    cg.translate(-0.065, 0, 0);
    const plume = new THREE.Mesh(cg, dark);
    plume.position.set(0.10, 0.928, s * 0.012);
    plume.rotation.z = -0.22;
    plume.rotation.y = -s * 0.12;
    g.add(plume);
  }

  // and the eye, which is the whole difference between standing still and
  // being a statue
  for (const s of [-1, 1]) {
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), billMat);
    iris.position.set(0.163, 0.915, s * 0.032);
    g.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 6, 5), dark);
    pupil.position.set(0.170, 0.915, s * 0.039);
    g.add(pupil);
  }

  g.rotation.y = rng.range(-0.06, 0.06);
  return shadowify(g);
}

/** Hemp: nothing else in the world is this colour, so it stays local. */
const ropeMat = () => cel({ color: 0xa8946e, bands: 3, tint: 0x6a5f8e });

/**
 * A mooring post: a stout stump of timber with two turns of rope round it
 * and an iron ring, standing where the boat comes in.  Half a metre of post
 * is knee-high to a man and twice the length of the hedgepig, which is the
 * right scale for a thing a rowing boat is tied to.
 */
function mooringPost({ seed = 97, h = 0.62 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 2909);
  const timber = cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });

  const pg = new THREE.BoxGeometry(0.1, h, 0.1);
  pg.translate(0, h / 2, 0);
  const post = new THREE.Mesh(pg, timber);
  post.rotation.y = rng.range(0, TAU);
  g.add(post);
  // the cap, worn round by forty years of rope
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.04, 8), timber);
  cap.position.y = h + 0.012;
  g.add(cap);

  const rope = ropeMat();
  for (let i = 0; i < 2; i++) {
    const turn = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.015, 4, 12), rope);
    turn.rotation.x = Math.PI / 2 + rng.range(-0.06, 0.06);
    turn.position.y = h - 0.13 - i * 0.042;
    g.add(turn);
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.042, 0.008, 4, 10),
    cel({ color: PAL.rust, bands: 3, tint: 0x5c688e })
  );
  ring.position.set(0.055, h * 0.55, 0);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);

  g.rotation.z = rng.sign() * rng.range(0.03, 0.09);    // nothing here is plumb
  return shadowify(g);
}

/**
 * A coil of rope, dropped on the bank.  Three turns, deliberately not
 * concentric — a coil laid perfectly is a machine part — and a loose end
 * wandering out of it, which is the bit that says somebody put it down.
 */
function ropeCoil({ seed = 101, r = 0.15 } = {}) {
  const rng = rngKit(seed * 2687);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const rr = r * (1 - i * 0.22);
    const t = new THREE.TorusGeometry(rr, 0.016, 4, 14);
    t.rotateX(Math.PI / 2);
    parts.push({
      geometry: t,
      matrix: trs(rng.range(-0.02, 0.02), 0.016 + i * 0.011, rng.range(-0.02, 0.02),
        rng.range(-0.05, 0.05), 0, rng.range(-0.05, 0.05)),
    });
  }
  const a = rng.range(0, TAU);
  const end = new THREE.CatmullRomCurve3([
    new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r),
    new THREE.Vector3(Math.cos(a) * (r + 0.12), 0.018, Math.sin(a) * (r + 0.12) + 0.06),
    new THREE.Vector3(Math.cos(a) * (r + 0.24) - 0.05, 0.016, Math.sin(a) * (r + 0.2) + 0.14),
  ]);
  parts.push({ geometry: new THREE.TubeGeometry(end, 6, 0.016, 5, false) });
  return shadowify(new THREE.Mesh(bake(parts), ropeMat()));
}

/** A water lily in flower: a cup of petals on the sheet, and never more than
 *  one or two open at a time, which is why they are placed by hand. */
function lilyBloom({ seed = 103 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 2381);
  const petals = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rng.range(-0.14, 0.14);
    const pg = new THREE.ConeGeometry(0.017, 0.075, 4);
    pg.translate(0, 0.038, 0);
    petals.push({
      geometry: pg,
      matrix: trs(Math.cos(a) * 0.016, 0.012, -Math.sin(a) * 0.016, 0, a, -rng.range(0.75, 1.05)),
    });
  }
  g.add(new THREE.Mesh(
    bake(petals),
    cel({ color: PAL.bloomWhite, bands: 'soft3', tint: 0x8a8fae, flat: false })
  ));
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 7, 5),
    cel({ color: PAL.bloomYellow, bands: 2, tint: 0x7a6a8e, flat: false })
  );
  eye.scale.y = 0.55;
  eye.position.y = 0.026;
  g.add(eye);
  return shadowify(g);
}

/**
 * Bog cotton: thin stems with a white tuft on top, and the one thing that
 * makes a bog look like anything from a distance.  **Summer only** — it is
 * seed-head, not flower, and having it all year would make the mire read the
 * same in February as in July, which is the fault v1's hay bales were kept
 * seasonal to avoid.
 */
function bogCotton({ seed = 107, n = 7, h = 0.3 } = {}, stemMat, tuftMat) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 2213);
  const stems = [];
  const tufts = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0, 0.09);
    const hh = h * rng.range(0.7, 1.25);
    const lean = rng.range(0.03, 0.16);
    const sg = new THREE.CylinderGeometry(0.0035, 0.005, hh, 4);
    sg.translate(0, hh / 2, 0);
    stems.push({
      geometry: sg,
      matrix: trs(Math.cos(a) * rr, 0, -Math.sin(a) * rr, 0, a, -lean),
    });
    /* The tuft rides on the *leaning* tip, so it is derived from the stem it
     * grew on rather than guessed at the stem's nominal height — the lesson
     * from four features that ended up inside the hedgepig's own face. */
    const out = rr + Math.sin(lean) * hh;
    tufts.push({
      geometry: new THREE.IcosahedronGeometry(rng.range(0.019, 0.028), 0),
      matrix: trs(
        Math.cos(a) * out, Math.cos(lean) * hh, -Math.sin(a) * out,
        rng.range(0, TAU), rng.range(0, TAU), 0, 1, 1.35, 1
      ),
    });
  }
  // both baked: this clump is repeated three dozen times and it lives in a
  // group the static merge is not allowed to touch, so it pays for itself
  g.add(new THREE.Mesh(bake(stems), stemMat));
  g.add(new THREE.Mesh(bake(tufts), tuftMat));
  return shadowify(g);
}

/**
 * A rotting post: the last of a fence nobody has mended, standing in the wet.
 *
 * The top is split rather than sawn, because that is what tells you it has
 * been out here for thirty years, and it leans — a post in a bog always
 * leans, and a plumb one would read as new.
 */
function rottenPost({ seed = 109, h = 0.82 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 2069);
  const wood = cel({ color: 0x5a4a3a, bands: 3, tint: 0x5f527f });

  const parts = [];
  const body = h * rng.range(0.68, 0.78);
  const bg = new THREE.BoxGeometry(0.085, body, 0.085);
  bg.translate(0, body / 2, 0);
  parts.push({ geometry: bg, matrix: trs(0, -0.03, 0) });      // sunk a little

  // two prongs of different heights, leaning apart: the split
  for (const s of [-1, 1]) {
    const ph = (h - body) * rng.range(0.5, 1.15);
    const pg = new THREE.BoxGeometry(0.036, ph, 0.075);
    pg.translate(0, ph / 2, 0);
    parts.push({ geometry: pg, matrix: trs(s * 0.023, body - 0.04, 0, 0, 0, -s * rng.range(0.05, 0.16)) });
  }
  g.add(new THREE.Mesh(bake(parts), wood));

  // a bracket fungus, on the shaded side
  const shelf = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 8, 6, 0, TAU, 0, Math.PI / 2),
    cel({ color: 0xc9b487, bands: 3, tint: 0x6a5f8e, flat: false })
  );
  const fa = rng.range(0, TAU);
  shelf.scale.set(1.15, 0.3, 0.8);
  shelf.position.set(Math.cos(fa) * 0.045, body * rng.range(0.5, 0.8), Math.sin(fa) * 0.045);
  g.add(shelf);

  const moss = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.07, 0),
    cel({ color: 0x5f7a4a, bands: 3, tint: 0x4f5d84, flat: false, role: 'leaf' })
  );
  moss.scale.set(1.2, 0.35, 1.1);
  moss.position.y = 0.02;
  g.add(moss);

  g.rotation.set(rng.range(-0.13, 0.13), rng.range(0, TAU), rng.range(-0.13, 0.13));
  return shadowify(g);
}

/**
 * A standing pool: a flat dark disc with a mud lip, and **no depth at all**.
 *
 * `buildWater` owns the only water surface on the planet and it carries a
 * per-vertex depth for its own shore; a second sheet out here would have to
 * duplicate that and would disagree with it the first time either was
 * retuned.  So this is peat-coloured paint on the ground, he walks straight
 * through it, and only the sound of it changes.  It is lit rather than unlit
 * for one reason: an unlit dark disc reads as a hole in the world.
 */
function poolDisc(rng, { r = 0.5, mat, rimMat }) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CircleGeometry(r, 14), mat);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.012;
  face.userData.noOutline = true;
  face.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.99, r * 1.22, 14), rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.008;
  rim.userData.noOutline = true;
  rim.receiveShadow = true;
  g.add(face, rim);
  g.scale.set(1, 1, rng.range(0.65, 1.35));
  g.rotation.y = rng.range(0, TAU);
  return g;
}

export function buildLake(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:lake';
  const rng = rngKit(503);

  /* --- reed beds, following the shoreline all the way round it --- */
  const RING = 54;
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * TAU + rng.range(-0.03, 0.03);
    const shore = lakeShore(a);
    const bed = reeds({
      seed: 1000 + i,
      n: rng.int(12, 26),
      h: rng.range(0.26, 0.46),
      r: rng.range(0.25, 0.55),
    });
    // a little outside the water, so they stand in the wet rather than in it
    const d = shore.d + rng.range(0.15, 1.1);
    ctx.put(bed, Math.cos(a) * d, Math.sin(a) * d);
    g.add(bed);
  }

  /* --- lily pads: flat discs sitting on the sheet, never under it --- */
  const padMat = cel({ color: 0x5f8f52, bands: 2, tint: 0x4f6a8c, flat: false, role: 'leaf' });
  const padGeo = new THREE.CircleGeometry(0.11, 12, 0.35, TAU - 0.7);
  padGeo.rotateX(-Math.PI / 2);
  const PADS = 110;
  const pads = new THREE.InstancedMesh(padGeo, padMat, PADS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  const padSpots = [];
  let np = 0;
  for (let i = 0; i < PADS * 3 && np < PADS; i++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * (LAKE_R - 2.5);
    const p = ctx.at(Math.cos(a) * d, Math.sin(a) * d);
    if (waterDepthAt(p.x, p.z) < 0.2) continue;
    const b = basisAt(p.x, p.z);
    fm.makeBasis(b.east, b.up, b.north);
    q.setFromRotationMatrix(fm);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TAU)));
    m.compose(
      positionAt(p.x, WATER_Y + 0.012, p.z, new THREE.Vector3()),
      q,
      new THREE.Vector3(rng.range(0.7, 1.6), 1, rng.range(0.7, 1.6))
    );
    pads.setMatrixAt(np++, m);
    padSpots.push({ u: Math.cos(a) * d, v: Math.sin(a) * d });
  }
  pads.count = np;
  pads.instanceMatrix.needsUpdate = true;
  pads.userData.noOutline = true;
  g.add(pads);

  // a few flowers among them, because a lily pad without one is a leaf
  for (let i = 0; i < 9 && padSpots.length; i++) {
    const s = padSpots[Math.floor(rng.next() * padSpots.length)];
    const fl = flowerClump({ seed: 1100 + i, n: 3, color: PAL.bloomWhite, h: 0.05 });
    const p = ctx.at(s.u, s.v);
    fl.position.set(p.x, WATER_Y + 0.02, p.z);
    fl.userData.planetRigid = true;
    g.add(fl);
  }

  /* --- the jetty, on the near shore --- */
  const jetty = new THREE.Group();
  const timber = cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });
  for (let i = 0; i < 7; i++) {
    // named `board` rather than `plank`: `plank` is a prop maker now, and a
    // local const shadowing an import is a trap laid for the next edit
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 1.0), timber);
    board.position.set(-0.8 + i * 0.26, 0.12, 0);
    jetty.add(board);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const pile = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), timber);
      pile.position.set(-0.7 + i * 0.62, -0.1, 0.42 * s);
      jetty.add(pile);
    }
  }
  const shoreA = lakeShore(0);
  ctx.put(jetty, Math.cos(0) * (shoreA.d - 0.5), 0);
  jetty.position.y = WATER_Y + 0.12;
  g.add(jetty);

  ctx.scatter(rng, { n: 14, minGap: 1.8, inner: LAKE_R + 1 }, (u, v, i) =>
    rock({ seed: 1200 + i, r: rng.range(0.14, 0.36) })
  ).forEach((p) => g.add(p.obj));

  const drift = log({ seed: 1301, len: 1.5, r: 0.13 });
  const sh = lakeShore(2.4);
  ctx.put(drift, Math.cos(2.4) * (sh.d + 0.7), Math.sin(2.4) * (sh.d + 0.7));
  g.add(drift);

  /* ---------------------- the shoreline, sampled once ---------------------- *
   * `lakeShore` bisects the bed twenty-six deep on every call, and everything
   * below asks where the water's edge is a few hundred times.  One table of
   * 96 bearings read back by interpolation is the same contour to within a
   * couple of centimetres, and it is still the contour — nothing here
   * authors a shoreline. */
  const SHORE_N = 96;
  const shoreTab = new Float64Array(SHORE_N);
  for (let i = 0; i < SHORE_N; i++) shoreTab[i] = lakeShore((i / SHORE_N) * TAU).d;
  const shoreAt = (a) => {
    const t = (((a / TAU) % 1) + 1) * SHORE_N;
    const i = Math.floor(t);
    return lerp(shoreTab[i % SHORE_N], shoreTab[(i + 1) % SHORE_N], t - i);
  };
  const local = (a, d, off = 0) => [
    Math.cos(a) * d - Math.sin(a) * off,
    Math.sin(a) * d + Math.cos(a) * off,
  ];

  /* Which way round the lake is shingle, and which is the cut bank.
   *
   * **This file may not assume.**  The bed is dug in terrain.js and the shore
   * is only the contour where it crosses `WATER_Y`, so the gentle side is
   * *measured* — how fast does the ground climb away from the water — and if
   * the bed is ever retuned the beach moves with it instead of stranding
   * itself halfway up a bank. */
  const bankRise = (a) => {
    const d = shoreAt(a) + 3;
    const p = ctx.at(...local(a, d));
    return heightAt(p.x, p.z) - WATER_Y;
  };
  let aShingle = 2.6, aSteep = 5.5, gentlest = Infinity, sharpest = -Infinity;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    /* The jetty is at bearing 0 and the far mooring at π.  A beach laid
     * through either of them would bury the one thing the lake is for. */
    if (Math.abs(Math.sin(a / 2)) < 0.26 || Math.abs(Math.cos(a / 2)) < 0.26) continue;
    const rise = bankRise(a);
    if (rise < gentlest) { gentlest = rise; aShingle = a; }
    if (rise > sharpest) { sharpest = rise; aSteep = a; }
  }

  /* ------------------------------ the spit ------------------------------ *
   * A tongue of shingle running out from the gentle bank and hooking, the
   * way a bar built by a current always does.  Its toe goes under: the
   * pebbles are seated on the bed like everything else, so where the bed
   * drops below `WATER_Y` they are simply beneath the sheet — which is what
   * the end of a spit does, and the sheet is transparent enough to show it.
   *
   * Wet stones are darker than dry ones, so the waterline draws itself. */
  const spitAt = (t, off) => {
    const a = aShingle + 0.085 * t * t;
    /* Three quarters of it is dry, and the last quarter goes under: a bar
     * whose whole length stands proud is a causeway, and one that is mostly
     * submerged is a rumour. */
    return local(a, lerp(shoreAt(a) + 2.6, shoreAt(a) - 0.85, t), off);
  };
  const PEB = 220;
  const pebGeo = new THREE.IcosahedronGeometry(1, 0);
  const dryPeb = new THREE.InstancedMesh(
    pebGeo, cel({ color: 0xa8a08e, bands: 3, tint: 0x6a6690 }), PEB);
  const wetPeb = new THREE.InstancedMesh(
    pebGeo, cel({ color: 0x6d675a, bands: 3, tint: 0x60618c }), PEB);
  let nDry = 0, nWet = 0;
  for (let i = 0; i < PEB; i++) {
    let u, v;
    if (i % 5 === 0) {
      // a thin strand of the same shingle either side, along the waterline
      const a = aShingle + rng.range(-0.62, 0.62);
      [u, v] = local(a, shoreAt(a) + rng.range(-0.4, 1.3));
    } else {
      const t = rng.next();
      // two rolls rather than one, so the crest is stonier than the flanks
      const off = (rng.next() + rng.next() - 1) * lerp(1.6, 0.4, t);
      [u, v] = spitAt(t, off);
    }
    const p = ctx.at(u, v);
    const wet = waterDepthAt(p.x, p.z) > 0.02;
    const s = rng.range(0.028, 0.085);
    seatOn(wet ? wetPeb : dryPeb, wet ? nWet++ : nDry++, ctx, u, v,
      rng.range(0, TAU), s * 0.3,
      s * rng.range(0.8, 1.45), s * rng.range(0.4, 0.62), s * rng.range(0.8, 1.45));
  }
  for (const [im, n] of [[dryPeb, nDry], [wetPeb, nWet]]) {
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    im.receiveShadow = true;
    im.userData.noOutline = true;      // ink round every pebble is a scribble
    g.add(im);
  }

  // the cobbles the shingle sorted out, along the crest
  for (let i = 0; i < 7; i++) {
    const [u, v] = spitAt(rng.range(0.04, 0.86), rng.range(-0.42, 0.42));
    const r = rng.range(0.13, 0.27);
    const cobble = rock({ seed: 1600 + i, r });
    cobble.scale.y = 0.7;
    ctx.put(cobble, u, v);
    g.add(cobble);
    if (r > 0.2) ctx.block(u, v, r * 0.8);
  }

  /* --- reeds standing in the shallows, rather than on the bank behind them --- */
  const rolePool = {};
  for (let i = 0; i < 32; i++) {
    const a = rng.range(0, TAU);
    if (Math.abs(Math.sin(a / 2)) < 0.2) continue;                  // the jetty
    if (Math.abs(Math.sin((a - aShingle) / 2)) < 0.16) continue;    // the beach is bare
    const [u, v] = local(a, shoreAt(a) + rng.range(-0.55, 0.3));
    const clump = reed({ seed: 1700 + i, h: rng.range(0.42, 0.66), n: rng.int(7, 13) });
    shareRoles(clump, rolePool);
    ctx.put(clump, u, v);
    g.add(clump);
  }

  /* --- lily rafts --- *
   * The pads above are an even sprinkle over the whole sheet, which is how
   * nobody has ever seen a lily.  They raft, in the lee of a bank, and the
   * open water between the rafts is what makes them read as growing rather
   * than as scattered. */
  const RAFT = 100;
  const rafts = new THREE.InstancedMesh(padGeo, padMat, RAFT);
  let nRaft = 0;
  const bloomSpots = [];
  for (let k = 0; k < 5 && nRaft < RAFT; k++) {
    /* Never on the boat's line.  It crosses along the diameter through
     * bearings 0 and π, and a raft it ploughs through twice a minute is a
     * raft that should not have been there. */
    const a = rng.range(0.5, Math.PI - 0.5) + (rng.chance(0.5) ? Math.PI : 0);
    const [cu, cv] = local(a, shoreAt(a) - rng.range(1.5, 3.6));
    for (let i = 0; i < 30 && nRaft < RAFT; i++) {
      const ra = rng.range(0, TAU);
      const rd = Math.sqrt(rng.next()) * rng.range(0.9, 1.8);
      const u = cu + Math.cos(ra) * rd, v = cv + Math.sin(ra) * rd;
      const p = ctx.at(u, v);
      if (waterDepthAt(p.x, p.z) < 0.18) continue;
      const b = basisAt(p.x, p.z);
      fm.makeBasis(b.east, b.up, b.north);
      q.setFromRotationMatrix(fm);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TAU)));
      m.compose(
        positionAt(p.x, WATER_Y + 0.012, p.z, new THREE.Vector3()),
        q,
        new THREE.Vector3(rng.range(0.8, 1.7), 1, rng.range(0.8, 1.7))
      );
      rafts.setMatrixAt(nRaft++, m);
      if (i === 0 || rng.chance(0.05)) bloomSpots.push({ u, v });
    }
  }
  rafts.count = nRaft;
  rafts.instanceMatrix.needsUpdate = true;
  rafts.userData.noOutline = true;
  g.add(rafts);

  // one or two flowers open per raft, never a bed of them
  for (let i = 0; i < Math.min(6, bloomSpots.length); i++) {
    const s = bloomSpots[Math.floor(rng.next() * bloomSpots.length)];
    const bloom = lilyBloom({ seed: 1800 + i });
    const p = ctx.at(s.u, s.v);
    bloom.position.set(p.x, WATER_Y + 0.014, p.z);
    bloom.userData.planetRigid = true;
    g.add(bloom);
  }

  /* ------------------------------ the heron ------------------------------ */
  const aHeron = aShingle + 0.44;
  const dHeron = shoreAt(aHeron) - 0.26;      // ankle deep, which is where it fishes
  const bird = heron({ seed: 91 });
  const [hu, hv] = local(aHeron, dHeron);
  ctx.put(bird, hu, hv);
  /* Its bill is built along +x, and this aims that at the middle of the lake
   * — so it is looking at the water, which is the only thing it ever does. */
  bird.rotation.y = facing(ctx, hu, hv, 0, 0) + rng.range(-0.12, 0.12);
  g.add(bird);
  /* Tight, and deliberately so: at his height the heron is two legs a finger
   * apart, and being stopped by a bird he could have walked under is exactly
   * the unfairness that is never forgiven. */
  ctx.block(hu, hv, 0.17);
  const [iu, iv] = local(aHeron, dHeron + 0.95);
  ctx.interact(iu, iv, 'the heron', ctx.lines(
    'it has not moved. he checks again. it has not moved.',
    'it is watching the water. it has been watching the water all day.',
    'they stand together a while. one of them blinks.'
  ));

  /* --------------------- moorings, and what ties to them --------------------- */
  const nearD = shoreAt(0), farD = shoreAt(Math.PI);
  const postA = mooringPost({ seed: 97, h: 0.62 });
  ctx.put(postA, nearD + 0.5, -0.62);
  g.add(postA);
  ctx.block(nearD + 0.5, -0.62, 0.1);
  const postB = mooringPost({ seed: 98, h: 0.55 });
  ctx.put(postB, -(farD + 0.45), 0.55);
  g.add(postB);
  ctx.block(-(farD + 0.45), 0.55, 0.1);

  const coil = ropeCoil({ seed: 101, r: 0.15 });
  ctx.put(coil, nearD + 0.9, -0.28);
  g.add(coil);

  /* ------------------------- the rest of the margin ------------------------- */
  // marsh marigolds, which grow with their feet in it and nowhere else
  ctx.scatter(rng, { n: 16, r: 15.5, inner: 11.4, minGap: 0.9 }, (u, v, i) =>
    flowerClump({ seed: 1900 + i, n: rng.int(4, 8), color: PAL.bloomYellow, h: rng.range(0.1, 0.19) })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 14, r: 15.5, inner: 11.4, minGap: 1.5 }, (u, v, i) => {
    const t = tussock({ seed: 1950 + i, r: rng.range(0.22, 0.4) });
    shareRoles(t, rolePool);
    return t;
  }).forEach((p) => g.add(p.obj));

  // and the scree the cut bank sheds, on the other side of the water
  for (let i = 0; i < 10; i++) {
    const a = aSteep + rng.range(-0.55, 0.55);
    const [u, v] = local(a, shoreAt(a) + rng.range(0.3, 3.6));
    const r = rng.range(0.16, 0.44);
    const s = rock({ seed: 1960 + i, r });
    ctx.put(s, u, v);
    g.add(s);
    if (r > 0.26) ctx.block(u, v, r * 0.8);
  }

  // two more pieces of driftwood, up at the strand line where they wash in
  for (let i = 0; i < 2; i++) {
    const a = aShingle + rng.sign() * rng.range(0.7, 1.5);
    const [u, v] = local(a, shoreAt(a) + rng.range(0.1, 0.9));
    const len = rng.range(1.0, 1.6);
    const wood = log({ seed: 1310 + i, len, r: rng.range(0.09, 0.14) });
    ctx.put(wood, u, v);
    g.add(wood);
    ctx.block(u, v, len * 0.38);
  }

  root.add(g);

  /* --------------------------- the boat, after the bake -------------------- */
  ctx.post.push((scene) => {
    const boat = new THREE.Group();
    const hullMat = cel({ color: 0xb5754a, bands: 3, tint: 0x6b5b86, flat: false });
    const hullGeo = new THREE.SphereGeometry(0.34, 14, 10, 0, TAU, 0, Math.PI / 2);
    hullGeo.scale(1.35, 0.55, 0.8);
    hullGeo.rotateX(Math.PI);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.16;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.33, 0.022, 6, 18),
      cel({ color: PAL.timberDark, bands: 3, tint: 0x6b5b86 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.35, 0.8, 1);
    rim.position.y = 0.17;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.26), hullMat);
    seat.position.y = 0.10;
    boat.add(hull, rim, seat);
    scene.add(boat);
    boat.matrixAutoUpdate = false;

    /* Moored just off two opposite shores.  Straight across is 27 m of
     * water against about 42 m of walking round, so the boat is worth
     * taking without being the only way. */
    const near = lakeShore(0);
    const far = lakeShore(Math.PI);
    const moorA = ctx.at(near.d - 0.35, 0);
    const moorB = ctx.at(-(far.d - 0.35), 0);
    const landA = ctx.at(near.d + 0.7, 0);
    const landB = ctx.at(-(far.d + 0.7), 0);

    const state = {
      mesh: boat, moorA, moorB, landA, landB,
      side: -1, x: moorA.x, z: moorA.z, crossing: 0, bob: 0,
    };
    ctx.out.boat = state;

    const mm = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    ctx.updaters.push((dt, hog) => {
      state.bob += dt;
      const from = state.side < 0 ? state.moorA : state.moorB;
      const to = state.side < 0 ? state.moorB : state.moorA;

      if (state.crossing > 0) {
        state.crossing = Math.min(1, state.crossing + dt / 9);
        // ease in and out, so it leaves and arrives like a boat, not a lift
        const t = state.crossing * state.crossing * (3 - 2 * state.crossing);
        // across the lake along its own diameter, through the centre
        const u = lerp(near.d - 0.35, -(far.d - 0.35), state.side < 0 ? t : 1 - t);
        const p = ctx.at(u, 0);
        state.x = p.x; state.z = p.z;
        if (hog.afloat === state) { hog.x = p.x; hog.z = p.z; }
        if (state.crossing >= 1) {
          state.crossing = 0;
          state.side *= -1;
          if (hog.afloat === state) {
            hog.afloat = null;
            const land = state.side < 0 ? state.landA : state.landB;
            hog.x = land.x; hog.z = land.z;
            hog.y = heightAt(hog.x, hog.z);
            ctx.flash('ashore, and shaking the lake off');
          }
        }
      } else {
        state.x = from.x; state.z = from.z;
      }

      const y = WATER_Y + 0.02 + Math.sin(state.bob * 1.6) * 0.012;
      const b = basisAt(state.x, state.z);
      mm.makeBasis(b.east, b.up, b.north);
      mm.setPosition(positionAt(state.x, y, state.z, pos));
      rot.makeRotationZ(Math.sin(state.bob * 1.1) * 0.04);
      mm.multiply(rot);
      boat.matrix.copy(mm);
      boat.matrixWorldNeedsUpdate = true;
    });
  });

  return g;
}

/**
 * The mire.
 *
 * The only place that is unpleasant underfoot.  Puddles rather than water:
 * flat discs at ground level with no depth to them, so he walks straight
 * through and only the sound of it changes.
 */
export function buildMire(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:mire';
  const rng = rngKit(601);

  const puddleMat = cel({
    color: 0x5c6f74, bands: 2, tint: 0x4d5e84, flat: false,
    map: rippleTex(), transparent: true, opacity: 0.85, role: 'water',
  });
  puddleMat.map.repeat.set(2, 2);
  puddleMat.map.wrapS = puddleMat.map.wrapT = THREE.RepeatWrapping;

  ctx.scatter(rng, { n: 34, minGap: 1.4 }, (u, v, i) => {
    const r = rng.range(0.3, 1.15);
    const geo = new THREE.CircleGeometry(r, 16);
    geo.rotateX(-Math.PI / 2);
    const p = new THREE.Mesh(geo, puddleMat);
    p.position.y = 0.014;
    p.scale.set(1, 1, rng.range(0.6, 1.3));
    p.rotation.y = rng.range(0, TAU);
    p.userData.noOutline = true;
    p.receiveShadow = true;
    const holder = new THREE.Group();
    holder.add(p);
    return holder;
  }).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 52, minGap: 0.9 }, (u, v, i) =>
    reeds({ seed: 1400 + i, n: rng.int(8, 18), h: rng.range(0.18, 0.34), r: rng.range(0.16, 0.4) })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 16, minGap: 2.2 }, (u, v, i) => {
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(rng.range(0.2, 0.4), 8, 6, 0, TAU, 0, Math.PI / 2),
      cel({ color: PAL.mud, bands: 3, tint: 0x5f5286, flat: false })
    );
    mound.scale.y = rng.range(0.3, 0.55);
    mound.castShadow = true;
    return mound;
  }).forEach((p) => g.add(p.obj));

  /* Stepping stones across the middle: the one dry line through the place,
   * and the only navigation this world asks of you. */
  for (let i = 0; i < 11; i++) {
    const u = -7 + i * 1.4;
    const v = Math.sin(i * 0.8) * 1.5;
    const s = rock({ seed: 1500 + i, r: rng.range(0.22, 0.32) });
    s.scale.y = 0.5;
    ctx.put(s, u, v);
    g.add(s);
  }

  /* --------------------------- the standing pools --------------------------- *
   * Small dark discs with a lip of mud, and **no depth at all**.  `buildWater`
   * owns the only water surface on the planet and it now carries a per-vertex
   * depth for its own shore; a second sheet out here would have to duplicate
   * that and would disagree with it the first time either was retuned.  So
   * these are peat-coloured paint on the ground: he walks straight through and
   * only the sound of it changes. */
  const poolMat = cel({ color: 0x3b4744, bands: 2, tint: 0x4d5e84, flat: false });
  const poolRim = cel({ color: 0x4a3d31, bands: 3, tint: 0x5f5286, flat: false });

  /* ---------------------------- the boardwalk ---------------------------- *
   * Somebody laid duckboards across the wettest line of the place, and one
   * board has gone.  The gap is the whole point of it: a walk you can simply
   * follow is scenery, and a walk with a hole in it is a place you have been.
   *
   * Built **board by board**, each seated on its own, for the same reason the
   * fence is built post by post — one nine-metre plank laid rigidly on a
   * 47.75 m sphere stands 20 cm out of the ground at each end, and he is
   * 26 cm long.
   *
   * It runs across the **lowest ground in the place** — the hollow out at
   * (-9, 0), which sits at 0.18 m against 0.6 m at the rim — and well clear
   * of the stepping stones, which own the middle.  Two dry routes through one
   * small place should cross different parts of it, or the second is only a
   * copy of the first. */
  const WALK_A = [-11.8, -4.2], WALK_B = [-7.4, 3.4];
  const walkAng = Math.atan2(WALK_B[1] - WALK_A[1], WALK_B[0] - WALK_A[0]);
  const walkLen = Math.hypot(WALK_B[0] - WALK_A[0], WALK_B[1] - WALK_A[1]);
  const BOARDS = Math.round(walkLen / 0.285);
  const GAP = Math.round(BOARDS * 0.62);      // derived, so retuning cannot lose it
  /* Boards lie **across** the walk, so each one's +x is squared to the line
   * *at its own point* — see `facing`.  Which leaves the walk itself running
   * down every unit's local -z, where the runners go. */
  const bearerMat = cel({ color: PAL.timberDark, bands: 3, tint: 0x6b5b86 });
  for (let i = 0; i <= BOARDS; i++) {
    const t = i / BOARDS;
    const u = lerp(WALK_A[0], WALK_B[0], t);
    const v = lerp(WALK_A[1], WALK_B[1], t);
    const unit = new THREE.Group();
    for (const s of [-1, 1]) {
      const bearer = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.3), bearerMat);
      bearer.position.set(s * 0.21, 0.028, 0);
      bearer.castShadow = true;
      bearer.receiveShadow = true;
      unit.add(bearer);
    }
    // the missing board keeps its runners: two bare bearers is what tells you
    // a board has gone, rather than the walk simply being shorter
    if (i !== GAP) {
      const board = plank({ seed: 2100 + i, len: 0.66, w: 0.17 });
      board.position.y = 0.055;
      board.rotation.z = rng.range(-0.035, 0.035);     // none of them lie flat
      unit.add(board);
    }
    ctx.put(unit, u, v);
    // aimed at the next board along, which past the end simply extrapolates
    const ahead = (i + 1) / BOARDS;
    unit.rotation.y = facing(ctx, u, v,
      lerp(WALK_A[0], WALK_B[0], ahead), lerp(WALK_A[1], WALK_B[1], ahead), true
    ) + rng.range(-0.045, 0.045);
    g.add(unit);
  }

  const gapU = lerp(WALK_A[0], WALK_B[0], GAP / BOARDS);
  const gapV = lerp(WALK_A[1], WALK_B[1], GAP / BOARDS);
  const gapPool = poolDisc(rng, { r: 0.3, mat: poolMat, rimMat: poolRim });
  ctx.put(gapPool, gapU, gapV);
  g.add(gapPool);
  ctx.interact(gapU + 0.55, gapV - 0.3, 'the missing board', ctx.lines(
    'the board is gone. the bog took it, or somebody did.',
    'he looks down through the gap. dark water, and his own face on it.',
    'he goes round. a hedgepig has four feet to lose and no spares.'
  ));

  /* A stone step off each end, half sunk, where the walk gives out.  `walkAng`
   * is safe here where it would not be for a rotation: this is a displacement
   * in (u, v), and (u, v) is where these coordinates live. */
  for (const [end, out] of [[WALK_A, -1], [WALK_B, 1]]) {
    const step = rock({ seed: 2150 + (out > 0 ? 1 : 0), r: 0.26 });
    step.scale.y = 0.4;
    ctx.put(step, end[0] + Math.cos(walkAng) * out * 0.46,
      end[1] + Math.sin(walkAng) * out * 0.46);
    g.add(step);
  }

  /* Nothing else is sown on the walk or on the stepping stones: a tussock
   * growing up through a board is the sort of thing you see once and then
   * cannot stop seeing. */
  const onWalk = (u, v, pad) => {
    const dx = WALK_B[0] - WALK_A[0], dy = WALK_B[1] - WALK_A[1];
    const t = clamp(((u - WALK_A[0]) * dx + (v - WALK_A[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(u - (WALK_A[0] + dx * t), v - (WALK_A[1] + dy * t)) < pad;
  };
  const onStones = (u, v, pad) => Math.abs(v) < 1.6 + pad && Math.abs(u) < 7.6 + pad;

  /* Tussocks are what a mire actually looks like from a hedgepig's height:
   * a floor you cannot see across, in hummocks he has to go round. */
  const rolePool = {};
  ctx.scatter(rng, { n: 46, minGap: 1.15 }, (u, v, i) => {
    if (onWalk(u, v, 0.5)) return null;
    const t = tussock({ seed: 2000 + i, r: rng.range(0.2, 0.44) });
    shareRoles(t, rolePool);
    return t;
  }).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 22, minGap: 1.7 }, (u, v, i) => {
    if (onWalk(u, v, 0.8) || onStones(u, v, 0.5)) return null;
    return poolDisc(rng, { r: rng.range(0.28, 0.8), mat: poolMat, rimMat: poolRim });
  }).forEach((p) => g.add(p.obj));

  /* Bog cotton, **summer only**.  It is a seed head and not a flower, and a
   * mire that looked the same in February as in July would be one less thing
   * the year does to this world — the reasoning that keeps v1's hay bales to
   * the autumn. */
  const cottonStem = cel({ color: 0x7d8f52, bands: 3, tint: 0x556086, role: 'stem' });
  const cottonTuft = cel({ color: PAL.bloomWhite, bands: 'soft', tint: 0x9a8fae, flat: false });
  const cotton = new THREE.Group();
  ctx.scatter(rng, { n: 36, minGap: 1.0 }, (u, v, i) => {
    if (onWalk(u, v, 0.45)) return null;
    return bogCotton(
      { seed: 2200 + i, n: rng.int(4, 9), h: rng.range(0.22, 0.36) },
      cottonStem, cottonTuft
    );
  }).forEach((p) => cotton.add(p.obj));
  cotton.userData.noMerge = true;        // seasonal: shown and hidden whole
  g.add(cotton);
  ctx.seasonal.push({ obj: cotton, at: (s) => s.w[1] > 0.22 });

  // reed clumps at the pool lips, tall enough to lose him behind one
  ctx.scatter(rng, { n: 15, minGap: 1.3 }, (u, v, i) => {
    if (onWalk(u, v, 0.5)) return null;
    const clump = reed({ seed: 2300 + i, h: rng.range(0.34, 0.56), n: rng.int(6, 11) });
    shareRoles(clump, rolePool);
    return clump;
  }).forEach((p) => g.add(p.obj));

  /* The rotting post: the last of a fence nobody has mended, and the stub of
   * the next one along, which is all that is left of it. */
  const post = rottenPost({ seed: 109, h: 0.86 });
  ctx.put(post, WALK_A[0] - 0.95, WALK_A[1] + 0.4);
  g.add(post);
  ctx.block(WALK_A[0] - 0.95, WALK_A[1] + 0.4, 0.12);
  const stub = rottenPost({ seed: 113, h: 0.3 });
  ctx.put(stub, WALK_A[0] - 2.4, WALK_A[1] + 1.05);
  g.add(stub);
  ctx.block(WALK_A[0] - 2.4, WALK_A[1] + 1.05, 0.1);

  // half-sunk stones, the ones the ice left
  ctx.scatter(rng, { n: 9, minGap: 2.4 }, (u, v, i) => {
    if (onWalk(u, v, 0.6) || onStones(u, v, 0.4)) return null;
    const s = rock({ seed: 2400 + i, r: rng.range(0.14, 0.32) });
    s.scale.y = 0.45;
    return s;
  }).forEach((p) => g.add(p.obj));

  root.add(g);
  return g;
}
