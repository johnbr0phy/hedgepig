import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { rngKit, clamp, damp, TAU, bake, trs, shadowify } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { positionAt, basisAt } from '../planet.js';
import {
  rock, bale, fencePost, flowerClump, stump, thistle, tussock, drystone, gate,
  crate, bucket, plank, molehillProp, trough as stoneTrough,
} from '../props.js';

/* ------------------------------------------------------------------ *
 * The hen run and the farmyard.
 *
 * The only *built* places apart from the town, and they earn their keep by
 * being the only straight lines in a world of scattered things.  A fence is
 * a horizon you can read at a glance, which matters when the real horizon is
 * eleven metres away and curved.
 * ------------------------------------------------------------------ */

/**
 * Lay flat scraps on the ground: straw, feathers, whatever the wind has put
 * against a wall.  One instanced mesh, and every scrap gets the tangent frame
 * of its own spot — a wisp lying 4 cm proud of a rise is precisely the fault
 * `heightAt` exists to prevent, and at this scale it is a wisp of straw
 * floating.
 *
 * `pick` returns local (u, v), so the same maker does an even scatter over a
 * whole pen and a drift piled against a coop door.
 */
function strew(ctx, rng, { n, geo, mat, pick, lift = 0.01, len = [0.6, 1.5] }) {
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const { u, v } = pick(i);
    const p = ctx.at(u, v);
    const b = basisAt(p.x, p.z);
    fm.makeBasis(b.east, b.up, b.north);
    q.setFromRotationMatrix(fm);
    q.multiply(spin.setFromAxisAngle(up, rng.range(0, TAU)));
    m.compose(
      positionAt(p.x, heightAt(p.x, p.z) + lift, p.z, pos),
      q,
      scl.set(rng.range(len[0], len[1]), 1, 1)
    );
    im.setMatrixAt(i, m);
  }
  im.instanceMatrix.needsUpdate = true;
  im.userData.noOutline = true;
  return im;
}

/**
 * A dust bath: the bare scrape a hen scours out and then lies in with one
 * wing up, looking dead.
 *
 * It cannot be a hollow, because there is only one ground and it is
 * `heightAt` — anything dipping below it is simply inside the planet and
 * invisible.  So it is what a scrape actually leaves behind: a pale dry disc
 * with the thrown soil banked up in a rim round it, which reads as a dish
 * from every angle without a single vertex going under the turf.
 */
function scrape({ seed = 1, r = 0.62 } = {}) {
  const rng = rngKit(seed * 1499);
  const g = new THREE.Group();
  const dust = cel({ color: PAL.soilDry, bands: 3, tint: 0x62568a, flat: false });

  const disc = new THREE.CircleGeometry(r, 20);
  disc.rotateX(-Math.PI / 2);
  const p = disc.attributes.position;
  const ph = rng.range(0, TAU);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.hypot(x, z) / r;
    /* The ragged edge is a function of the **angle**, not per-vertex noise: a
     * circle's rim carries a duplicated vertex at the UV seam, and two
     * different random radii on the same corner opens a crack in it. */
    const a = Math.atan2(z, x);
    const wob = 1 + 0.075 * Math.sin(a * 5 + ph) + 0.045 * Math.sin(a * 9 - ph * 2);
    p.setX(i, x * wob);
    p.setZ(i, z * wob);
    p.setY(i, 0.004 + 0.05 * d * d * d);
  }
  disc.computeVertexNormals();
  const dish = new THREE.Mesh(disc, dust);
  dish.receiveShadow = true;
  g.add(dish);

  const soil = cel({ color: PAL.soil, bands: 3, tint: 0x62568a });
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, TAU);
    const rr = r * rng.range(0.95, 1.2);
    const clod = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.022, 0.045), 0), soil);
    clod.position.set(Math.cos(a) * rr, 0.012, Math.sin(a) * rr);
    clod.scale.y = 0.6;
    g.add(clod);
  }
  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/**
 * A galvanised feeder: a hopper nosed down into a shallow pan, with a hat on
 * it so the meal does not spoil.
 *
 * 0.47 m, which is the number that keeps it a feeder — at twice that it is a
 * dustbin, and next to a 26 cm hedgehog nothing looks wrong until you stand
 * him beside it.  The pan is deliberately wider than the barrel above it:
 * that step is the whole silhouette, and without it this is a bin with a lid.
 */
function feeder({ seed = 1 } = {}) {
  const rng = rngKit(seed * 1187);
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(0.17, 0.155, 0.05, 12), matrix: trs(0, 0.055, 0) });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    parts.push({
      geometry: new THREE.CylinderGeometry(0.009, 0.009, 0.06, 4),
      matrix: trs(Math.cos(a) * 0.12, 0.03, Math.sin(a) * 0.12),
    });
  }
  // the cone is nosed *down*, apex just inside the pan: that is what meters
  // the corn out, and it is the silhouette everyone recognises
  parts.push({ geometry: new THREE.ConeGeometry(0.115, 0.16, 12), matrix: trs(0, 0.16, 0, Math.PI, 0, 0) });
  parts.push({ geometry: new THREE.CylinderGeometry(0.115, 0.115, 0.14, 12), matrix: trs(0, 0.31, 0) });
  parts.push({ geometry: new THREE.ConeGeometry(0.15, 0.09, 12), matrix: trs(0, 0.425, 0) });

  const m = new THREE.Mesh(bake(parts), cel({ color: PAL.metal, bands: 3, tint: 0x5c688e }));
  m.rotation.y = rng.range(0, TAU);
  return shadowify(m);
}

/**
 * A hurdle: four light rails and two stiles, leaning.
 *
 * It is built already tilted, in its own inner group, because the outer group
 * has to be free to turn about Y to aim it along the fence — and with an XYZ
 * euler an outer `rotation.x` is applied in the *parent* frame, so a hurdle
 * aimed one way round the ring would lean along it instead of against it.
 */
function hurdle({ seed = 1, w = 1.15, h = 0.9, lean = 0.3 } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const rng = rngKit(seed * 1439);
  const timber = cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });

  const parts = [];
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(w, 0.05, 0.026),
      matrix: trs(0, 0.1 + (i * (h - 0.14)) / 3, 0, 0, 0, rng.range(-0.012, 0.012)),
    });
  }
  for (const s of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.06, h, 0.032), matrix: trs(s * (w / 2 - 0.03), h / 2, 0) });
  }
  const dx = w - 0.06, dy = h - 0.14;
  parts.push({
    geometry: new THREE.BoxGeometry(Math.hypot(dx, dy), 0.045, 0.024),
    matrix: trs(0, h / 2, -0.028, 0, 0, Math.atan2(dy, dx)),
  });
  inner.add(new THREE.Mesh(bake(parts), timber));

  inner.rotation.x = -lean;                 // the top goes over toward local −z
  inner.position.y = 0.02;
  g.add(inner);
  return shadowify(g);
}

/** One hen: a body, a head that is not a separate mass, a comb, a beak. */
function hen(seed) {
  const rng = rngKit(seed * 3313);
  const g = new THREE.Group();
  const bodyMat = cel({
    color: rng.chance(0.6) ? PAL.hen : 0xb98a5a, bands: 'soft3', tint: 0x8a7fa8, flat: false,
  });
  const combMat = cel({ color: PAL.henRed, bands: 2, tint: 0x7a5a86, flat: false });
  const beakMat = cel({ color: 0xe0a63e, bands: 2, tint: 0x7a6a8e, flat: false });

  const bg = new THREE.SphereGeometry(0.10, 12, 9);
  bg.scale(1.25, 1, 0.9);
  const body = new THREE.Mesh(bg, bodyMat);
  body.position.y = 0.115;
  g.add(body);

  const neck = new THREE.Group();
  neck.position.set(0.085, 0.16, 0);
  g.add(neck);
  neck.add(new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), bodyMat));
  const comb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), combMat);
  comb.scale.set(0.5, 0.9, 0.35);
  comb.position.set(0.004, 0.045, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 5), beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.055, -0.004, 0);
  const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), combMat);
  wattle.position.set(0.035, -0.036, 0);
  neck.add(comb, beak, wattle);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 5), bodyMat);
  tail.position.set(-0.115, 0.16, 0);
  tail.rotation.z = 0.9;
  g.add(tail);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 4), beakMat);
    leg.position.set(0, 0.03, 0.035 * s);
    g.add(leg);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.neck = neck;
  return g;
}

export function buildHens(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:hens';
  const rng = rngKit(701);

  /* --- the run: a ring of posts and wire, with a gap you can walk in by --- */
  const PEN = 6.5;
  /* Radians of the ring left open.  It was [1.9, 2.7], which drops four posts
   * — and once the rails stop dead at the mouth instead of running on into
   * mid-air, that is a **7.9 m hole in a 13 m pen**: a fence with one side
   * missing rather than a run with a way in.  One post, and the gateway is
   * 3.1 m, which is a gap you can get a barrow through and still reads as
   * enclosed from anywhere inside it. */
  const GAP = [2.05, 2.35];
  const wireMat = flat({
    color: 0x9aa0a8, transparent: true, opacity: 0.30, side: THREE.DoubleSide, cache: false,
  });
  const timber = cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });
  const N = 26;
  const open = (ang) => ang > GAP[0] && ang < GAP[1];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    if (open(a)) continue;
    const u = Math.cos(a) * PEN, v = Math.sin(a) * PEN;
    const span = (TAU / N) * PEN;
    /* The rails ran on from the last post *into* the gateway and met nothing,
     * which is a fence with two rails hanging in the air across the one way
     * in.  A post at the mouth of the run carries nothing forward. */
    const ends = open(((i + 1) / N) * TAU);
    const starts = open(((i - 1 + N) / N) * TAU);
    const p = fencePost({ seed: 900 + i, h: 0.95, span: ends ? 0 : span, ahead: 0 });
    ctx.put(p, u, v);
    // rotation.y = -(a + π/2) sends the post's local +x along the arc, which
    // is where `fencePost` runs its rails
    p.rotation.y = -(a + Math.PI / 2);
    g.add(p);
    ctx.block(u, v, 0.55);

    if (!ends) {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(span, 0.9), wireMat);
      quad.position.y = 0.45;
      quad.userData.noOutline = true;
      quad.userData.noShadow = true;
      p.add(quad);

      /* A third rail, low down, and thinner than the two above it.  Two rails
       * and a haze of mesh is a paddock; what says *hen run* is that the
       * bottom of it is shut, because everything a hen is afraid of comes in
       * underneath. */
      const rg = new THREE.BoxGeometry(span, 0.032, 0.022);
      rg.translate(span / 2, 0, 0);
      const low = new THREE.Mesh(rg, timber);
      low.position.y = 0.2;
      low.castShadow = true;
      low.receiveShadow = true;
      p.add(low);
    }

    /* Where wire stops it has to be strained against something.  A brace back
     * along the fence line at each side of the gateway is one box each and it
     * is the difference between a run somebody built and a run from a kit. */
    if (ends || starts) {
      const dy = 0.86, dx = 0.62 * (ends ? -1 : 1);
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.06, Math.hypot(dx, dy), 0.05), timber);
      br.position.set(dx / 2, dy / 2, 0);
      br.rotation.z = -Math.atan2(dx, dy);
      br.castShadow = true;
      br.receiveShadow = true;
      p.add(br);
    }
  }

  /* A spare hurdle stood against the wire beside the gateway — what is
   * actually used to shut a run at dusk, and what is left leaning there all
   * day.  Local −z is radially outward once the post rotation is applied, so
   * it leans onto the fence rather than away from it. */
  {
    // midway between two posts, so 1.2 m of hurdle does not stand inside one
    const a = ((10 + 11) / 2 / N) * TAU;
    const hd = hurdle({ seed: 9, w: 1.2, h: 0.88, lean: 0.3 });
    ctx.put(hd, Math.cos(a) * 6.1, Math.sin(a) * 6.1);
    hd.rotation.y = -(a + Math.PI / 2);
    g.add(hd);
    // two blockers rather than one: a circle round a 1.2 m board either lets
    // him through the ends of it or stops him half a metre off the face
    for (const t of [-0.42, 0.42]) {
      ctx.block(Math.cos(a) * 6.1 - Math.sin(a) * t, Math.sin(a) * 6.1 + Math.cos(a) * t, 0.3);
    }
  }

  /* --- the coop --- */
  const coop = new THREE.Group();
  const boardMat = cel({ color: 0xa4633f, bands: 3, tint: 0x6b5b86 });
  const roofMat = cel({ color: PAL.slate, bands: 3, tint: 0x5f5e86 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.1), boardMat);
  box.position.y = 0.45;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 1.3), roofMat);
  roof.position.y = 0.94;
  roof.rotation.z = 0.14;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.44), flat({ color: 0x2b2130 }));
  door.position.set(0.755, 0.28, 0);
  door.rotation.y = Math.PI / 2;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.3), boardMat);
  ramp.position.set(1.08, 0.14, 0);
  ramp.rotation.z = -0.28;
  coop.add(box, roof, door, ramp);
  coop.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  ctx.put(coop, -3.2, 2.4);
  coop.rotation.y = -0.6;
  g.add(coop);
  ctx.block(-3.2, 2.4, 1.0);
  ctx.interact(-1.9, 2.4, 'the coop', ctx.lines(
    'warm, and full of grumbling',
    'an egg rolls somewhere inside',
    'the grumbling stops. then starts again, about him.'
  ));

  /* --- what is kept in the run --- */
  const FEED = [2.3, -1.5];
  const BATH = [3.3, 2.3];
  const BALE = [-1.7, 3.7];
  /* The coop's door is on its local +x, and the coop is turned -0.6, so the
   * foot of the ramp is here.  Derived rather than eyed: everything that has
   * ever been placed in this project by eye ended up inside something. */
  const DOOR = [-3.2 + Math.cos(-0.6) * 1.15, 2.4 - Math.sin(-0.6) * 1.15];

  const feed = feeder({ seed: 3 });
  ctx.put(feed, FEED[0], FEED[1]);
  g.add(feed);
  ctx.block(FEED[0], FEED[1], 0.2);
  ctx.interact(FEED[0] + 0.6, FEED[1] - 0.5, 'the feeder', ctx.lines(
    'spilled corn, and a great deal of interest in it',
    'he cannot reach the pan. he is philosophical about the floor',
    'three hens arrive at once and stand on each other'
  ));

  const bath = scrape({ seed: 5, r: 0.68 });
  ctx.put(bath, BATH[0], BATH[1]);
  g.add(bath);
  /* No blocker on purpose.  A scrape is 3 cm of banked soil, and being
   * stopped by something you can see over is the one unfairness nobody
   * forgives — and walking through the middle of it is the joke. */
  ctx.interact(BATH[0], BATH[1] + 0.9, 'the dust bath', ctx.lines(
    'a hen-shaped hollow, still warm',
    'he tries it. he is the wrong shape and enjoys it anyway',
    'dust in every quill. it will be there until the next rain'
  ));

  // a bale burst open by the coop, which is where the straw in here came from
  const burst = bale({ seed: 71, r: 0.3 });
  ctx.put(burst, BALE[0], BALE[1]);
  burst.rotation.y = 0.7;
  g.add(burst);
  ctx.block(BALE[0], BALE[1], 0.34);

  // an upturned crate: turned over, one corner off the ground, and the gap
  // under it is exactly the sort of place he would rather be
  const box2 = crate({ seed: 77, s: 0.42 });
  ctx.put(box2, -2.3, -1.1);
  box2.rotation.x = Math.PI;
  box2.rotation.z = 0.09;
  box2.position.y += 0.43;
  g.add(box2);
  ctx.block(-2.3, -1.1, 0.26);

  // the water: one pail standing, one on its side where a hen knocked it
  const pail = bucket({ seed: 81, r: 0.12, h: 0.19 });
  ctx.put(pail, 1.5, -2.7);
  g.add(pail);
  ctx.block(1.5, -2.7, 0.16);
  const spilt = bucket({ seed: 83, r: 0.11, h: 0.17 });
  ctx.put(spilt, -0.9, -3.9);
  spilt.rotation.z = Math.PI / 2;
  spilt.position.y += 0.11;
  g.add(spilt);
  ctx.block(-0.9, -3.9, 0.14);

  /* A perch: a plank across two stumps, which is what a perch is when nobody
   * has bought one.  The angle is worked out from the two stumps rather than
   * guessed, so the board lands on both of them. */
  const PA = [0.9, 3.4], PB = [2.0, 3.8];
  for (const [i, s] of [PA, PB].entries()) {
    const st = stump({ seed: 91 + i, r: 0.15, h: 0.3 });
    ctx.put(st, s[0], s[1]);
    g.add(st);
    ctx.block(s[0], s[1], 0.16);
  }
  const perch = plank({ seed: 93, len: 1.45, w: 0.15 });
  ctx.put(perch, (PA[0] + PB[0]) / 2, (PA[1] + PB[1]) / 2);
  perch.position.y += 0.3;
  perch.rotation.y = -Math.atan2(PB[1] - PA[1], PB[0] - PA[0]);
  g.add(perch);

  /* --- scratched-over ground --- */
  const strawMat = cel({ color: PAL.straw, bands: 2, tint: 0x6f628e, side: THREE.DoubleSide });
  const strawGeo = new THREE.PlaneGeometry(0.13, 0.02);
  strawGeo.rotateX(-Math.PI / 2);
  g.add(strew(ctx, rng, {
    n: 900, geo: strawGeo, mat: strawMat,
    pick: () => {
      const a = rng.range(0, TAU);
      const d = Math.sqrt(rng.next()) * PEN;
      return { u: Math.cos(a) * d, v: Math.sin(a) * d };
    },
  }));
  /* And drifts of it where it is actually thrown: at the coop door, under the
   * feeder, round the burst bale.  An even scatter over a whole pen is what
   * "some straw" looks like on a spreadsheet; a yard has heaps and bare
   * patches, and the heaps are where the work happens. */
  const drifts = [DOOR, FEED, BALE, BALE];
  g.add(strew(ctx, rng, {
    n: 340, geo: strawGeo, mat: strawMat, lift: 0.013, len: [0.8, 2.1],
    pick: () => {
      const c = rng.pick(drifts);
      const a = rng.range(0, TAU);
      const d = Math.sqrt(rng.next()) * 1.05;
      return { u: c[0] + Math.cos(a) * d, v: c[1] + Math.sin(a) * d };
    },
  }));

  // feathers, thickest where they are lost: the dust bath and the door
  const featherGeo = new THREE.PlaneGeometry(0.06, 0.022);
  featherGeo.rotateX(-Math.PI / 2);
  const lost = [DOOR, BATH, BATH, FEED];
  g.add(strew(ctx, rng, {
    n: 70, geo: featherGeo, lift: 0.012, len: [0.7, 1.3],
    mat: cel({ color: 0xf0e7d4, bands: 2, tint: 0x8a7fa8, side: THREE.DoubleSide }),
    pick: (i) => {
      if (i % 3 === 0) {
        const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * PEN;
        return { u: Math.cos(a) * d, v: Math.sin(a) * d };
      }
      const c = rng.pick(lost);
      const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 1.3;
      return { u: c[0] + Math.cos(a) * d, v: c[1] + Math.sin(a) * d };
    },
  }));

  /* --- outside the wire --- */
  /* Nothing grazes a hen run, so what grows against the outside of it is
   * exactly what nothing eats: coarse tussock, thistle, and the moles working
   * the soft ground the hens have manured for them. */
  ctx.scatter(rng, { n: 11, minGap: 2.3, inner: 7.6 }, (u, v, i) =>
    tussock({ seed: 950 + i, r: rng.range(0.2, 0.34) })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 8, minGap: 3.0, inner: 8.5 }, (u, v, i) =>
    thistle({ seed: 980 + i, h: rng.range(0.4, 0.58) })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 9, minGap: 2.0, inner: 7.2 }, (u, v, i) =>
    molehillProp({ seed: 1000 + i, r: rng.range(0.1, 0.16) })
  ).forEach((p) => g.add(p.obj));

  root.add(g);

  /* --- the hens themselves, after the bake so they can wander --- */
  ctx.post.push((scene) => {
    const flock = [];
    for (let i = 0; i < 6; i++) {
      const h = hen(i + 1);
      h.matrixAutoUpdate = false;
      scene.add(h);
      const a = rng.range(0, TAU), d = rng.range(0, PEN - 1);
      flock.push({
        obj: h, u: Math.cos(a) * d, v: Math.sin(a) * d,
        hd: rng.range(0, TAU), wait: rng.range(0, 3), peck: 0,
      });
    }
    ctx.out.hens = flock;

    const mm = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    ctx.updaters.push((dt, hog) => {
      for (const f of flock) {
        /* **A hedgehog in the run scatters the flock** — ranged off him, as
         * everything is.  A hen that ignores an animal barrelling through
         * her pen at ball speed is furniture with feathers. */
        const at = ctx.at(f.u, f.v);
        if (hog && !(f.flee > 0)) {
          const dx = hog.x - at.x, dz = hog.z - at.z;
          const d2 = dx * dx + dz * dz;
          const scare = 1.0 + (hog.ball || 0) * 0.8;
          if (d2 < scare * scare) {
            f.flee = 1.3;
            f.peck = 0;
            f.hd = Math.atan2(at.z - hog.z, at.x - hog.x) + rng.range(-0.4, 0.4);
            f.squawked = false;
          }
        }
        f.flee = Math.max(0, (f.flee || 0) - dt);
        if (f.flee > 0 && !f.squawked) { f.squawked = true; ctx.sound?.('squawk'); }

        f.wait -= dt;
        if (f.wait <= 0) {
          f.wait = rng.range(1.4, 4.5);
          f.hd = rng.range(0, TAU);
          f.peck = f.flee > 0 ? 0 : (rng.chance(0.6) ? 1.2 : 0);
        }
        if (f.peck > 0 && f.flee <= 0) {
          f.peck -= dt;
          f.obj.userData.neck.rotation.z = -1.0 * Math.abs(Math.sin(f.peck * 9));
        } else {
          // a fleeing hen runs neck-up, four times her strolling pace
          f.obj.userData.neck.rotation.z = damp(f.obj.userData.neck.rotation.z, f.flee > 0 ? 0.35 : 0, 6, dt);
          const sp = (f.flee > 0 ? 0.95 : 0.22) * dt;
          let nu = f.u + Math.cos(f.hd) * sp;
          let nv = f.v + Math.sin(f.hd) * sp;
          if (Math.hypot(nu, nv) > PEN - 0.7) { f.hd += Math.PI; }
          else { f.u = nu; f.v = nv; }
        }
        const p = ctx.at(f.u, f.v);
        const b = basisAt(p.x, p.z);
        mm.makeBasis(b.east, b.up, b.north);
        // a fleeing hen bounces; a strolling one only bobs with her step
        const hop = f.flee > 0 ? Math.abs(Math.sin(f.flee * 22)) * 0.03 : 0;
        mm.setPosition(positionAt(p.x, heightAt(p.x, p.z) + hop, p.z, pos));
        rot.makeRotationY(-f.hd);
        mm.multiply(rot);
        f.obj.matrix.copy(mm);
        f.obj.matrixWorldNeedsUpdate = true;
      }
    });
  });

  return g;
}

/**
 * A milk churn.  Straight barrel, a shoulder that runs in to a narrow neck,
 * a lid with a lip on it, two lugs to lift it by and two hoops round the
 * belly — that outline is the whole recognition, and without the shoulder it
 * is a bin.
 *
 * 0.63 m to the lid, which is a real churn and, standing beside him, two and
 * a half times his own length.
 */
function churn({ seed = 1 } = {}) {
  const rng = rngKit(seed * 1051);
  const g = new THREE.Group();
  const H = 0.4, r = 0.145;

  const steel = [
    { geometry: new THREE.CylinderGeometry(r, r * 0.95, H, 12), matrix: trs(0, H / 2, 0) },
    { geometry: new THREE.CylinderGeometry(0.072, r, 0.13, 12), matrix: trs(0, H + 0.065, 0) },
    { geometry: new THREE.CylinderGeometry(0.07, 0.07, 0.07, 10), matrix: trs(0, H + 0.165, 0) },
  ];
  g.add(new THREE.Mesh(bake(steel), cel({ color: PAL.metal, bands: 3, tint: 0x5c688e })));

  const dark = [
    { geometry: new THREE.CylinderGeometry(0.084, 0.084, 0.026, 10), matrix: trs(0, H + 0.213, 0) },
    { geometry: new THREE.SphereGeometry(0.022, 8, 6), matrix: trs(0, H + 0.23, 0, 0, 0, 0, 1, 0.7, 1) },
  ];
  for (const y of [0.075, H - 0.055]) {
    dark.push({ geometry: new THREE.TorusGeometry(r * 0.99, 0.009, 4, 12), matrix: trs(0, y, 0, Math.PI / 2, 0, 0) });
  }
  for (const s of [-1, 1]) {
    dark.push({ geometry: new THREE.BoxGeometry(0.03, 0.055, 0.018), matrix: trs(s * 0.1, H + 0.045, 0) });
  }
  g.add(new THREE.Mesh(bake(dark), cel({ color: 0x6f7684, bands: 3, tint: 0x5c688e })));

  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/**
 * The muck heap.  Straw and dung rotting quietly, and warm right through a
 * winter — which is why a real hedgehog will move into one, and why this one
 * is worth walking over to.
 *
 * Dark, low and wide, with straw still standing out of the flanks where the
 * fork left it, and the fork itself stuck in the top.  A dome on its own is a
 * mound of earth; the straw is what makes it muck.
 */
function muckHeap({ seed = 1, r = 0.95, h = 0.48 } = {}) {
  const rng = rngKit(seed * 1289);
  const g = new THREE.Group();

  /* Sunk to its own equator rather than built as a half sphere: the buried
   * half costs nothing to draw and the rim comes out rounded, which is what
   * a heap tipped off a fork looks like at the foot. */
  const mound = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 2),
    cel({ color: 0x4a3b2c, bands: 3, tint: 0x5a4a78 })
  );
  const mp = mound.geometry.attributes.position;
  const v = new THREE.Vector3();
  const ph = rng.range(0, TAU);
  for (let i = 0; i < mp.count; i++) {
    v.fromBufferAttribute(mp, i);
    /* The lumps are a **function of direction**, not per-vertex noise.  An
     * icosahedron comes out non-indexed, so every corner exists once per face
     * — jitter each copy on its own and the surface tears into confetti. */
    const s = 1 + 0.1 * Math.sin((v.x / r) * 4.1 + ph) * Math.cos((v.z / r) * 3.3 - ph);
    mp.setXYZ(i, v.x * s, v.y * s * (h / r), v.z * s);
  }
  mound.geometry.computeVertexNormals();
  mound.position.y = 0.02;
  g.add(mound);

  const wisps = [];
  for (let i = 0; i < 30; i++) {
    const a = rng.range(0, TAU);
    const t = rng.range(0.3, 1.08);            // how far out on the flank
    const rr = r * t * 0.9;
    /* On the dome, not near it: the height has to come from the *same*
     * fraction the radius does, or every wisp on the lower flank is buried
     * inside the heap it is supposed to be sticking out of. */
    const y = h * Math.sqrt(Math.max(0, 1 - (rr / r) ** 2)) + 0.015;
    const len = rng.range(0.1, 0.24);
    const sg = new THREE.BoxGeometry(len, 0.012, 0.008);
    sg.translate(len / 2, 0, 0);
    wisps.push({
      geometry: sg,
      matrix: trs(Math.cos(a) * rr, y, Math.sin(a) * rr, 0, -a, rng.range(-0.5, 0.4)),
    });
  }
  g.add(new THREE.Mesh(bake(wisps), cel({ color: PAL.straw, bands: 2, tint: 0x6f628e })));

  // the fork, left standing in it, because it always is
  const fork = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 1.15, 6), cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 }));
  shaft.position.y = 0.575;
  fork.add(shaft);
  const tines = [];
  for (const s of [-1, 0, 1]) {
    const tg = new THREE.CylinderGeometry(0.008, 0.004, 0.26, 5);
    tines.push({ geometry: tg, matrix: trs(s * 0.055, -0.13, 0, 0, 0, -s * 0.06) });
  }
  tines.push({ geometry: new THREE.BoxGeometry(0.13, 0.02, 0.022), matrix: trs(0, 0, 0) });
  const head = new THREE.Mesh(bake(tines), cel({ color: PAL.metal, bands: 3, tint: 0x5c688e }));
  fork.add(head);
  fork.rotation.set(0, rng.range(0, TAU), rng.range(0.24, 0.4));
  fork.position.set(rng.range(-0.2, 0.2), h * 0.72, rng.range(-0.2, 0.2));
  g.add(fork);

  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/** The farmyard: a barn, a trough, bales, and the ruts of something heavy. */
export function buildFarm(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:farm';
  const rng = rngKit(809);

  /* --- the barn.  The one thing you can see from a place away, which is
   * deliberate: with an eleven-metre horizon, exactly one landmark tall
   * enough to break it is worth more than ten that are not. --- */
  const barn = new THREE.Group();
  const wallMat = cel({ color: 0xb2603f, bands: 3, tint: 0x6b5b86 });
  const roofMat = cel({ color: PAL.slate, bands: 3, tint: 0x5f5e86 });
  const gableMat = cel({ color: 0xa2553a, bands: 3, tint: 0x6b5b86 });
  const W = 5.2, D = 3.6, H = 2.6;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
  walls.position.y = H / 2;
  barn.add(walls);

  /* A pitched roof from two slabs rather than a prism: the ink pass finds the
   * ridge on its own, and a prism's end caps read as cardboard.  `s * +angle`
   * — rotating about +x by a negative angle lifts the *far* edge, and both
   * slabs then meet low in the middle, which is a valley and not a roof. */
  for (const s of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.1, D * 0.68), roofMat);
    slab.position.set(0, H + 0.42, (D * 0.28) * s);
    slab.rotation.x = s * 0.62;
    barn.add(slab);
  }
  for (const s of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, 0.95); tri.closePath();
    const gab = new THREE.Mesh(new THREE.ShapeGeometry(tri), gableMat);
    gab.position.set((W / 2) * s, H, 0);
    gab.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    barn.add(gab);
  }
  const opening = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), flat({ color: 0x261e2e }));
  opening.position.set(0, 0.95, D / 2 + 0.01);
  barn.add(opening);
  barn.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  ctx.put(barn, -1.5, 4.5);
  barn.rotation.y = 0.3;
  g.add(barn);
  ctx.block(-1.5, 4.5, 2.6);
  ctx.interact(-1.5, 2.0, 'the barn door', ctx.lines(
    'it smells of hay and old rain',
    'something above shifts its weight on a beam',
    'at dusk the swallows stitch this doorway shut'
  ));

  // bales stacked against the barn, and a few loose
  for (let i = 0; i < 6; i++) {
    const b = bale({ seed: 60 + i, r: 0.42 });
    const u = 2.4 + (i % 3) * 0.95, v = 4.0 + Math.floor(i / 3) * 0.9;
    ctx.put(b, u, v);
    if (i > 2) b.position.y += 0.84;
    g.add(b);
    if (i <= 2) ctx.block(u, v, 0.5);
  }

  /* --- the trough --- */
  const trough = new THREE.Group();
  const tMat = cel({ color: PAL.stoneDark, bands: 3, tint: 0x635e8c });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.6), tMat);
  shell.position.y = 0.21;
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(1.44, 0.46),
    cel({ color: PAL.water, bands: 2, tint: 0x59718f, flat: false, role: 'water' })
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = 0.37;
  trough.add(shell, surf);
  trough.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  ctx.put(trough, 4.5, -2.5);
  g.add(trough);
  ctx.block(4.5, -2.5, 0.8);
  ctx.interact(4.5, -3.4, 'the trough', ctx.lines(
    'he drinks for a long time',
    'his reflection has a leaf on its nose. so, it turns out, does he',
    'green water. wonderful, apparently.'
  ));

  /* --- ruts: two dark bands worn across the yard --- */
  const rutMat = cel({ color: 0x4f4233, bands: 2, tint: 0x5f5286, transparent: true, opacity: 0.5 });
  const rutGeo = new THREE.PlaneGeometry(0.9, 0.26);
  rutGeo.rotateX(-Math.PI / 2);
  const ruts = new THREE.InstancedMesh(rutGeo, rutMat, 120);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  let k = 0;
  for (const side of [-0.55, 0.55]) {
    for (let i = 0; i < 60; i++) {
      const u = -16 + i * 0.55;
      const v = side + Math.sin(u * 0.15) * 1.2;
      const p = ctx.at(u, v);
      const b = basisAt(p.x, p.z);
      fm.makeBasis(b.east, b.up, b.north);
      q.setFromRotationMatrix(fm);
      m.compose(
        positionAt(p.x, heightAt(p.x, p.z) + 0.012, p.z, new THREE.Vector3()),
        q, new THREE.Vector3(1, 1, 1)
      );
      ruts.setMatrixAt(k++, m);
    }
  }
  ruts.count = k;
  ruts.instanceMatrix.needsUpdate = true;
  ruts.receiveShadow = true;
  ruts.userData.noOutline = true;
  g.add(ruts);

  /* --- the approach: a gate in a drystone wall, straddling the track --- *
   *
   * The ruts wander as `sin(u · 0.15) · 1.2`, so the track's centre line at a
   * given `u` is a number and not a guess — the gate is set on it, and the
   * wall runs off both sides of it.  Rotated a quarter turn, the gate's local
   * +x runs along −v, which is across the track.
   */
  const GATE_U = -8.5;
  const GATE_V = Math.sin(GATE_U * 0.15) * 1.2;
  const fiveBar = gate({ seed: 121, w: 3.0, h: 1.15 });
  ctx.put(fiveBar, GATE_U, GATE_V);
  fiveBar.rotation.y = Math.PI / 2;
  g.add(fiveBar);
  /* **Only the posts are blocked.**  The bottom bar hangs a quarter of a
   * metre off the ground and he is thirteen centimetres tall: a gate stops a
   * tractor, and every hedgehog that ever met one went under it.  Blocking
   * the leaf would make the one built approach in the world a wall. */
  for (const s of [-1, 1]) {
    ctx.block(GATE_U, GATE_V + s * 1.57, 0.2);
  }
  for (const s of [-1, 1]) {
    const at = GATE_V + s * 2.8;
    const wall = drystone({ seed: 127 + s, len: 2.4, h: 0.62 });
    ctx.put(wall, GATE_U, at);
    wall.rotation.y = Math.PI / 2;
    g.add(wall);
    // a run of wall needs a run of blockers: one circle round 2.4 m of it
    // either lets him through the ends or stops him a metre short of it
    for (const t of [-0.9, -0.3, 0.3, 0.9]) ctx.block(GATE_U, at + t, 0.3);
  }

  /* --- the muck heap.  Warm right through a winter, which is why a real one
   * of him would be living in it and why it is worth crossing the yard for. */
  const MUCK = [2.7, -4.7];
  const heap = muckHeap({ seed: 131, r: 0.95, h: 0.5 });
  ctx.put(heap, MUCK[0], MUCK[1]);
  g.add(heap);
  /* 0.85 against a footprint of about 0.95: the muck is only ankle-deep out
   * there, and being stopped by something that looked like a miss is the one
   * unfairness nobody forgives. */
  ctx.block(MUCK[0], MUCK[1], 0.85);
  ctx.interact(MUCK[0], MUCK[1] - 1.2, 'the muck heap', ctx.lines(
    'warm. warmer than anything else out here',
    'he considers moving in, and is not entirely joking',
    'steam off the top of it, and the smell arrives a moment later'
  ));

  /* --- what the yard has standing about in it --- */
  const stack = new THREE.Group();
  const c0 = crate({ seed: 101, s: 0.44 });
  const c1 = crate({ seed: 103, s: 0.42 });
  c1.position.set(0.03, 0.44, -0.02);
  c1.rotation.y += 0.34;
  const c2 = crate({ seed: 105, s: 0.4 });
  c2.position.set(-0.02, 0.86, 0.04);
  c2.rotation.y -= 0.2;
  c2.rotation.z = 0.05;                 // the top one of a stack never sits square
  const c3 = crate({ seed: 107, s: 0.42 });
  c3.rotation.x = Math.PI / 2;          // and one on its side, off the end
  c3.position.set(0.66, 0.21, 0.32);
  stack.add(c0, c1, c2, c3);
  ctx.put(stack, -4.7, 3.1);
  g.add(stack);
  ctx.block(-4.7, 3.1, 0.3);
  ctx.block(-4.7 + 0.66, 3.1 + 0.32, 0.26);

  /* Planks, stacked but not squared off.  `plank` bows each board along its
   * own length, so a pile of them has daylight through it without a single
   * gap being authored. */
  const timberPile = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const pk = plank({ seed: 141 + i, len: rng.range(1.05, 1.35), w: 0.17 });
    pk.position.set(rng.range(-0.07, 0.07), i * 0.036, rng.range(-0.05, 0.05));
    pk.rotation.y = rng.range(-0.07, 0.07);
    timberPile.add(pk);
  }
  const slid = plank({ seed: 149, len: 1.3, w: 0.17 });
  slid.position.set(0.34, 0.09, 0.26);
  slid.rotation.set(0, 0.22, 0.06);
  timberPile.add(slid);
  ctx.put(timberPile, -5.8, 1.9);
  g.add(timberPile);
  for (const t of [-0.45, 0.45]) ctx.block(-5.8 + t, 1.9, 0.3);

  // two more stone troughs, one still in use and one shoved against the wall
  const t2 = stoneTrough({ seed: 151, len: 1.2 });
  ctx.put(t2, -3.5, -2.5);
  g.add(t2);
  for (const t of [-0.35, 0.35]) ctx.block(-3.5 + t, -2.5, 0.28);
  const t3 = stoneTrough({ seed: 153, len: 1.0 });
  ctx.put(t3, -7.0, 2.3);
  t3.rotation.y = 0.5;
  g.add(t3);
  ctx.block(-7.0, 2.3, 0.38);

  // churns: one standing by the barn, one on its side beside it
  const ch1 = churn({ seed: 161 });
  ctx.put(ch1, 1.3, 2.6);
  g.add(ch1);
  ctx.block(1.3, 2.6, 0.2);
  const ch2 = churn({ seed: 163 });
  ctx.put(ch2, 0.85, 2.1);
  ch2.rotation.z = Math.PI / 2;
  ch2.position.y += 0.15;
  g.add(ch2);
  ctx.block(0.85, 2.1, 0.2);

  // the chopping block, and the offcuts nobody has picked up
  const block = stump({ seed: 167, r: 0.24, h: 0.34 });
  ctx.put(block, -5.1, -2.7);
  g.add(block);
  ctx.block(-5.1, -2.7, 0.22);
  for (const [i, o] of [[0.42, -0.34], [-0.36, -0.5]].entries()) {
    const off = plank({ seed: 171 + i, len: 0.5, w: 0.14 });
    ctx.put(off, -5.1 + o[0], -2.7 + o[1]);
    off.rotation.y = rng.range(0, TAU);
    g.add(off);
  }

  const pail = bucket({ seed: 173, r: 0.12, h: 0.19 });
  ctx.put(pail, -2.8, -3.2);
  g.add(pail);
  ctx.block(-2.8, -3.2, 0.15);

  ctx.scatter(rng, { n: 20, minGap: 1.4, inner: 8 }, (u, v, i) =>
    flowerClump({
      seed: 1600 + i, n: rng.int(3, 7),
      color: rng.pick([PAL.bloomYellow, PAL.bloomWhite]), h: 0.14,
    })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 8, minGap: 3, inner: 10 }, (u, v, i) =>
    rock({ seed: 1700 + i, r: rng.range(0.14, 0.3) })
  ).forEach((p) => g.add(p.obj));

  /* --- the rough ground round the yard --- *
   *
   * The pad itself is graded flat and everything on it is square to
   * everything else, which is the whole point of a yard: it is the one place
   * in this world where a right angle belongs.  So the edge has to be
   * *rougher* than the meadow, not tidier — coarse tussock, thistle where the
   * muck has run, and the moles working the soft ground under all of it.
   */
  ctx.scatter(rng, { n: 13, minGap: 2.3, inner: 8.5 }, (u, v, i) =>
    tussock({ seed: 1750 + i, r: rng.range(0.2, 0.36) })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 9, minGap: 3.0, inner: 10.5 }, (u, v, i) =>
    thistle({ seed: 1780 + i, h: rng.range(0.42, 0.6) })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 11, minGap: 2.2, inner: 8 }, (u, v, i) =>
    molehillProp({ seed: 1810 + i, r: rng.range(0.1, 0.17) })
  ).forEach((p) => g.add(p.obj));

  // stumps at the edge: whatever the barn's roof timbers came out of
  ctx.scatter(rng, { n: 4, minGap: 5, inner: 13 }, (u, v, i) =>
    stump({ seed: 1840 + i, r: rng.range(0.18, 0.3), h: rng.range(0.24, 0.36) })
  ).forEach((p) => { g.add(p.obj); ctx.block(p.u, p.v, 0.2); });

  root.add(g);
  return g;
}
