import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { petalTex } from '../../core/textures.js';
import { rngKit, clamp, lerp, TAU, trs, bake, shadowify } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import {
  tree, log, mushroom, flowerClump, rock, bale, fenceRun, scatter, contactShadow,
} from '../props.js';

/* ------------------------------------------------------------------ *
 * The four green places: the long meadow, the butterfly garden, the wood,
 * and the mushroom garden.
 *
 * They are neighbours on the ring for the reason v1 insisted on — meadow
 * into flowery meadow into wood into the woodland floor — so each one has
 * to hand something over to the next.  The garden borrows the meadow's
 * grass and adds beds to it; the wood takes the garden's flowers away and
 * puts a roof on; the mushroom garden is the wood's floor with the trees
 * thinning out.  Nothing here starts from bare ground.
 * ------------------------------------------------------------------ */

/** The long meadow: grass, flowers, a fallen log, and a fence along the north. */
export function buildMeadow(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:meadow';
  const rng = rngKit(ctx.slot * 101 + 5);
  const { x0, x1, cx } = ctx;

  scatter(rng, { x0: x0 + 1, x1: x1 - 1, z0: -12, z1: 12, n: 34, minGap: 0.9 }, (x, z, i) => {
    const c = rng.pick([PAL.bloomWhite, PAL.bloomYellow, PAL.bloomWhite, PAL.bloomBlue]);
    return flowerClump({ seed: 200 + i, n: rng.int(4, 9), color: c, h: rng.range(0.12, 0.22) });
  }).forEach((p) => g.add(p.obj));

  const fallen = log({ seed: 41, len: 2.1, r: 0.17 });
  fallen.position.set(cx - 6.5, heightAt(cx - 6.5, -4.2), -4.2);
  g.add(fallen);
  ctx.blockers.push({ x: cx - 6.5, z: -4.2, hx: 1.05, hz: 0.35 });

  g.add(fenceRun({ x0: x0 + 3, x1: x1 - 3, z: 11.4, seed: 7 }));

  // three stones he can shelter behind, and the fourth is a thorn's neighbour
  scatter(rng, { x0: x0 + 4, x1: x1 - 4, z0: -9, z1: 9, n: 5, minGap: 3 }, (x, z, i) =>
    rock({ seed: 300 + i, r: rng.range(0.16, 0.34) })
  ).forEach((p) => g.add(p.obj));

  /* Hay bales are **autumn only**, exactly as in v1: they are the clearest
   * single signal that the year has turned, and having them all year makes
   * the season stop meaning anything. */
  const bales = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const x = cx - 8 + i * 4.2;
    const z = 6.5 - (i % 2) * 1.4;
    const b = bale({ seed: 50 + i, r: 0.44 });
    b.position.set(x, heightAt(x, z), z);
    bales.add(b);
    ctx.blockers.push({ x, z, r: 0.55 });
  }
  g.add(bales);
  ctx.seasonal.push({ obj: bales, at: (s) => s.w[2] > 0.25 });

  root.add(g);
  return g;
}

/**
 * The butterfly garden.  v1 gave this place a flower boost of 3.6 and it is
 * still the densest thing on the ring — it is the one place that is
 * obviously *tended*, which is what makes the wild ones read as wild.
 */
export function buildGarden(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:garden';
  const rng = rngKit(ctx.slot * 211 + 3);
  const { x0, x1, cx } = ctx;

  // four beds, edged in stone, running across the field
  const edgeMat = cel({ color: PAL.chalk, bands: 3, tint: 0x6f6894 });
  for (let bed = 0; bed < 4; bed++) {
    const bz = -8.5 + bed * 5.6;
    const bx = cx + (bed % 2 ? 3.4 : -3.4);
    const w = 6.5, d = 2.6;

    const edge = [];
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const a = t * TAU;
      const ex = bx + Math.cos(a) * w * 0.5;
      const ez = bz + Math.sin(a) * d * 0.5;
      const s = new THREE.BoxGeometry(0.26, 0.14, 0.2);
      edge.push({ geometry: s, matrix: trs(ex, heightAt(ex, ez) + 0.05, ez, 0, a, 0) });
    }
    const rim = new THREE.Mesh(bake(edge), edgeMat);
    g.add(shadowify(rim));

    scatter(rng, { x0: bx - w * 0.42, x1: bx + w * 0.42, z0: bz - d * 0.36, z1: bz + d * 0.36, n: 18, minGap: 0.3 },
      (x, z, i) => flowerClump({
        seed: 400 + bed * 30 + i,
        n: rng.int(6, 12),
        color: rng.pick([PAL.petal, PAL.bloomYellow, PAL.bloomRed, PAL.bloomBlue, PAL.bloomWhite]),
        h: rng.range(0.18, 0.34),
      })
    ).forEach((p) => g.add(p.obj));
  }

  /* A birdbath, which is the only thing standing in this place and so does
   * all the work of telling you where you are from across the field. */
  const bath = new THREE.Group();
  const stone = cel({ color: PAL.stone, bands: 3, tint: 0x6a6690, flat: false });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.52, 10), stone);
  pillar.position.y = 0.26;
  bath.add(pillar);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.2, 0.12, 14), stone);
  bowl.position.y = 0.56;
  bath.add(bowl);
  const dish = new THREE.Mesh(
    new THREE.CircleGeometry(0.27, 14),
    cel({ color: PAL.water, bands: 2, tint: 0x59718f, flat: false, role: 'water' })
  );
  dish.rotation.x = -Math.PI / 2;
  dish.position.y = 0.615;
  bath.add(dish);
  bath.position.set(cx, heightAt(cx, 0), 0);
  g.add(shadowify(bath));
  ctx.blockers.push({ x: cx, z: 0, r: 0.42 });
  ctx.interactables.push({
    x: cx, z: 0, label: 'the birdbath',
    action: () => ctx.flash('he drinks, and shakes his whiskers dry'),
  });

  root.add(g);
  return g;
}

/**
 * The wood.
 *
 * Two things make a wood at this scale and neither is the trees: the light
 * going out under the canopy, and the ground going brown.  The trees are
 * placed to leave a walkable corridor down the middle — a wood you have to
 * fight through is a wall, and v1's rule about walls applies to scenery as
 * much as to hazards.
 */
export function buildWood(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:wood';
  const rng = rngKit(ctx.slot * 307 + 11);
  const { x0, x1, cx } = ctx;

  const trunks = scatter(rng, { x0: x0 - 1, x1: x1 + 1, z0: -13, z1: 13, n: 26, minGap: 2.2 }, (x, z, i) => {
    // keep a clear way through the middle of the field
    if (Math.abs(z) < 2.2 && rng.chance(0.75)) return null;
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
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.3 });
  });

  /* Leaf litter: flat cards on the ground, one instanced mesh.  They are
   * seasonal in colour only — the litter itself lies all year, because a
   * wood floor that is bare in spring reads as a building site. */
  const leafGeo = new THREE.PlaneGeometry(0.055, 0.042);
  leafGeo.rotateX(-Math.PI / 2);
  /* Fixed brown, and deliberately **not** on the `leaf` role.  Litter is
   * what fell last year; tying it to the season's foliage colour turns the
   * woodland floor bright green in summer, which is a lawn of paper. */
  const litterMat = cel({
    color: 0x8a6a3e, bands: 2, tint: 0x6a5a86, side: THREE.DoubleSide,
  });
  const N = 1400;
  const litter = new THREE.InstancedMesh(leafGeo, litterMat, N);
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const x = rng.range(x0 - 1, x1 + 1);
    const z = rng.range(-13, 13);
    m.compose(
      new THREE.Vector3(x, heightAt(x, z) + 0.012, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, TAU), 0)),
      new THREE.Vector3(rng.range(0.7, 1.5), 1, rng.range(0.7, 1.5))
    );
    litter.setMatrixAt(i, m);
  }
  litter.instanceMatrix.needsUpdate = true;
  litter.receiveShadow = true;
  litter.userData.noOutline = true;
  g.add(litter);

  /* The fairy house, carried over from v1 — a door in a tree, and nothing
   * else.  Everything about it is what you are not shown. */
  const host = trunks.find((p) => Math.abs(p.z) > 3) || trunks[0];
  if (host) {
    const door = new THREE.Mesh(
      new THREE.CircleGeometry(0.13, 5),
      cel({ color: 0x8a4f3c, bands: 3, tint: 0x6a5a86 })
    );
    door.position.set(host.x + 0.2, heightAt(host.x, host.z) + 0.14, host.z);
    door.rotation.y = Math.PI / 2;
    door.scale.y = 1.35;
    g.add(door);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 6, 5),
      cel({ color: PAL.bloomYellow, bands: 2, tint: 0x7a6a8e })
    );
    knob.position.set(host.x + 0.215, heightAt(host.x, host.z) + 0.14, host.z + 0.06);
    g.add(knob);
    ctx.interactables.push({
      x: host.x, z: host.z + 0.4, label: 'the little door',
      action: () => ctx.flash('nobody answers, but something is listening'),
    });
  }

  root.add(g);
  return g;
}

/** The mushroom garden: the wood's floor, with the trees mostly gone. */
export function buildMushrooms(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:mushrooms';
  const rng = rngKit(ctx.slot * 401 + 13);
  const { x0, x1, cx } = ctx;

  // the last few trees of the wood, thinning out west to east
  scatter(rng, { x0: x0 - 1, x1: x0 + 9, z0: -12, z1: 12, n: 6, minGap: 3 }, (x, z, i) =>
    tree({ seed: 600 + i, h: rng.range(3.2, 4.6), spread: rng.range(0.9, 1.4) })
  ).forEach((p) => {
    g.add(p.obj);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.3 });
  });

  /* A stump, and a fairy ring round it.  The ring is the point of the
   * place: a circle of anything is instantly not-natural, and it is the
   * only shape in the world that says *somebody comes here*. */
  const sx = cx, sz = 1.2;
  const stump = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.42, 12),
    cel({ color: PAL.timberDark, bands: 3, tint: 0x63537f })
  );
  stump.position.set(sx, heightAt(sx, sz) + 0.21, sz);
  g.add(shadowify(stump));
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(0.335, 12),
    cel({ color: 0xbf9f74, bands: 3, tint: 0x63537f })
  );
  top.rotation.x = -Math.PI / 2;
  top.position.set(sx, heightAt(sx, sz) + 0.421, sz);
  g.add(top);
  ctx.blockers.push({ x: sx, z: sz, r: 0.44 });

  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * TAU;
    const r = 1.35 + rng.range(-0.1, 0.1);
    const x = sx + Math.cos(a) * r;
    const z = sz + Math.sin(a) * r;
    const mush = mushroom({ seed: 700 + i, h: rng.range(0.09, 0.15), cap: rng.range(0.06, 0.095) });
    mush.position.set(x, heightAt(x, z), z);
    g.add(mush);
  }

  // and the rest, scattered as they actually grow: in twos and threes
  scatter(rng, { x0: x0 + 1, x1: x1 - 1, z0: -12, z1: 12, n: 22, minGap: 1.1 }, (x, z, i) => {
    const clump = new THREE.Group();
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
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

  scatter(rng, { x0: x0 + 2, x1: x1 - 2, z0: -10, z1: 10, n: 7, minGap: 2.4 }, (x, z, i) =>
    rock({ seed: 900 + i, r: rng.range(0.12, 0.3) })
  ).forEach((p) => g.add(p.obj));

  root.add(g);
  return g;
}
