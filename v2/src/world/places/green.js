import * as THREE from 'three';
import { cel } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { rngKit, TAU } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { basisAt, positionAt } from '../planet.js';
import { tree, log, mushroom, flowerClump, rock, bale, fencePost } from '../props.js';

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

/** Somewhere to put instanced ground clutter, already seated on the surface. */
function instanceAt(im, i, ctx, u, v, yaw, lift, sx = 1, sz = 1, tmp = {}) {
  const p = ctx.at(u, v);
  const b = basisAt(p.x, p.z);
  const fm = new THREE.Matrix4().makeBasis(b.east, b.up, b.north);
  const q = new THREE.Quaternion().setFromRotationMatrix(fm);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  const m = new THREE.Matrix4().compose(
    positionAt(p.x, heightAt(p.x, p.z) + lift, p.z, new THREE.Vector3()),
    q,
    new THREE.Vector3(sx, 1, sz)
  );
  im.setMatrixAt(i, m);
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

/** The long meadow: grass, flowers, a fallen log, and a fence along one side. */
export function buildMeadow(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:meadow';
  const rng = rngKit(101);

  ctx.scatter(rng, { n: 62, minGap: 1.1 }, (u, v, i) =>
    flowerClump({
      seed: 200 + i,
      n: rng.int(4, 9),
      color: rng.pick([PAL.bloomWhite, PAL.bloomYellow, PAL.bloomWhite, PAL.bloomBlue]),
      h: rng.range(0.12, 0.22),
    })
  ).forEach((p) => g.add(p.obj));

  const fallen = log({ seed: 41, len: 2.1, r: 0.17 });
  ctx.put(fallen, -5.5, -3.2);
  g.add(fallen);
  ctx.block(-5.5, -3.2, 1.0);

  fenceArc(ctx, g, { r: 15, from: 0.5, to: 1.9, seed: 7 });

  ctx.scatter(rng, { n: 7, minGap: 4 }, (u, v, i) =>
    rock({ seed: 300 + i, r: rng.range(0.16, 0.34) })
  ).forEach((p) => g.add(p.obj));

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
 */
export function buildWood(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:wood';
  const rng = rngKit(307);

  const trunks = ctx.scatter(rng, { n: 46, minGap: 2.4 }, (u, v, i) => {
    if (Math.abs(v) < 2.0 && rng.chance(0.7)) return null;   // a way through
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

  /* Leaf litter, instanced and seated rigidly.  Fixed brown, and deliberately
   * *not* on the `leaf` role — litter is what fell last year, and tying it to
   * the season's foliage turns the woodland floor bright green in summer. */
  const leafGeo = new THREE.PlaneGeometry(0.055, 0.042);
  leafGeo.rotateX(-Math.PI / 2);
  const litterMat = cel({ color: 0x8a6a3e, bands: 2, tint: 0x6a5a86, side: THREE.DoubleSide });
  const N = 2600;
  const litter = new THREE.InstancedMesh(leafGeo, litterMat, N);
  for (let i = 0; i < N; i++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * ctx.R;
    instanceAt(litter, i, ctx, Math.cos(a) * d, Math.sin(a) * d,
      rng.range(0, TAU), 0.012, rng.range(0.7, 1.5), rng.range(0.7, 1.5));
  }
  litter.instanceMatrix.needsUpdate = true;
  litter.receiveShadow = true;
  litter.userData.noOutline = true;
  g.add(litter);

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

/** The mushroom garden: the wood's floor, with the trees mostly gone. */
export function buildMushrooms(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:mushrooms';
  const rng = rngKit(401);

  ctx.scatter(rng, { n: 9, minGap: 4, inner: 8 }, (u, v, i) =>
    tree({ seed: 600 + i, h: rng.range(3.2, 4.6), spread: rng.range(0.9, 1.4) })
  ).forEach((p) => {
    g.add(p.obj);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.32 });
  });

  /* A stump with a fairy ring round it.  The ring is the point of the place:
   * a circle of anything is instantly not-natural, and it is the only shape
   * in the world that says *somebody comes here*. */
  const stump = new THREE.Group();
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
  stump.add(body, top);
  ctx.put(stump, 0, 0);
  g.add(stump);
  ctx.block(0, 0, 0.44);

  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * TAU;
    const r = 1.5 + rng.range(-0.12, 0.12);
    const mush = mushroom({ seed: 700 + i, h: rng.range(0.09, 0.15), cap: rng.range(0.06, 0.095) });
    ctx.put(mush, Math.cos(a) * r, Math.sin(a) * r);
    g.add(mush);
  }

  // and the rest, scattered as they actually grow: in twos and threes
  ctx.scatter(rng, { n: 40, minGap: 1.2 }, (u, v, i) => {
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

  root.add(g);
  return g;
}
