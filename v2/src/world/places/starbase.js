import * as THREE from 'three';
import { cel } from '../../core/toon.js';
import { bake, TAU } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { PAD_U, PAD_V, PAD_R } from '../plan.js';

/* ------------------------------------------------------------------ *
 * A Starship, at actual size, in the mire.
 *
 * **The mire is not an arbitrary choice.**  Starbase stands on a coastal
 * wetland at Boca Chica — a flat, low, wet place at the edge of the water.
 * The mire is this world's flat, low, wet place, and it is next door to the
 * lake.  It is the one address on the planet that is *right*.
 *
 * ------------------------------ the numbers -------------------------------
 *
 * Public figures for the current stack, and every one of them is used here
 * unscaled.  This is the whole point of the thing, so there is no fudge
 * factor anywhere in this file:
 *
 * | | |
 * |---|---|
 * | Super Heavy booster | 71 m tall, 9 m across, 33 Raptors (3 / 10 / 20) |
 * | hot-stage ring      | ~1.8 m |
 * | Ship                | ~52 m tall, 9 m across, 6 Raptors, 4 flaps |
 * | full stack          | ~123 m |
 * | launch mount        | ~20 m |
 * | catch tower         | ~146 m, ~12 m square in section |
 *
 * ------------------------- what that means here ---------------------------
 *
 * The planet is 300 m round, so its radius is 47.75 m.  Therefore:
 *
 *  - the stack is **2.6 planet radii** tall, and the tower is **3.1**;
 *  - the stack is **41 %** of the way round the world laid on its side;
 *  - the hedgepig is 0.26 m, so the stack is **473 hedgehogs**.
 *
 * It is visible from everywhere.  From the far side it comes up over the
 * horizon like a mast, because the horizon is real geometry here and the
 * curvature genuinely does cut its legs off.  That is not a bug to be tuned
 * away — it is the only honest way to draw a 123 m object on a 48 m world,
 * and it is the best thing about having built the world round.
 *
 * ------------------------------ three rules -------------------------------
 *
 * **1. Nothing here may be bent onto the planet.**  `bakeToPlanet` wraps flat
 * geometry round the sphere, which is right for ground and disastrous for a
 * rocket: a 123 m cylinder wrapped round a 48 m sphere curls up past its own
 * base and comes out the other side.  Everything vertical goes in a
 * `planetRigid` group, which is re-seated whole on the tangent frame at its
 * own foot.  The apron is the one thing that *is* bent, because it is ground.
 *
 * **2. Each standing thing gets its OWN rigid group.**  A rigid group stands
 * on one tangent plane, and a tangent plane leaves the sphere by `d²/2R` —
 * 2.1 m at 14 m out.  Put the rocket and the tower in one group seventeen
 * metres apart and one of them floats two metres in the air.  The tower, the
 * mount and every tank are seated separately, at their own feet.
 *
 * **3. Above the pad, the fog is off.**  The world's fog runs 11 m to 40 m —
 * it is a *ground haze*, sized to hide the horizon of a small planet from
 * something 26 cm tall.  Left on, everything above about 12 m of this would
 * be solid fog colour and the rocket would be a stump.  Steel standing 123 m
 * up is above the haze, which is also what it looks like in life: distant
 * hills fade, a rocket in clear air does not.  The apron and the tanks keep
 * their fog, because they are down in it with everything else.
 * ------------------------------------------------------------------ */

/* Metres.  Read the table above before changing any of them. */
const D = 9;                      // diameter, both stages
const RAD = D / 2;
const BOOSTER = 71;
const HOTSTAGE = 1.8;
const SHIP = 52.1;
const MOUNT = 20;                 // deck height of the launch mount
const TOWER = 146;
const TOWER_SEC = 11;             // across the lattice, corner to corner face
const TOWER_OUT = 17;             // how far the tower stands from the stack
/* The apron's size and address live in `plan.js`, with the town's paving and
 * the road, because being hard ground is decided there and the grass reads
 * it from there. One disc, one radius, two things that must agree. */
const APRON_R = PAD_R;

/* How far a rigid group's own tangent plane leaves the sphere at `d` metres
 * out: `d²/2R`, and it is 0.74 m at the launch mount's leg circle.  Every
 * leg, column and tank here is therefore drawn reaching BELOW its own datum
 * by this much, so the outermost feet meet the ground and the innermost are
 * simply buried.  A rigid structure on a small planet either does that or
 * stands on tiptoe at its edges. */
const SINK = (d) => (d * d) / (2 * 47.75) + 0.35;

/** The tallest thing in the world, for anyone who wants to check. */
export const STACK = BOOSTER + HOTSTAGE + SHIP;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** One piece, as `bake` wants it: a geometry and where to put it. */
function part(geometry, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  return {
    geometry,
    matrix: new THREE.Matrix4().compose(
      _v.set(x, y, z),
      _q.setFromEuler(_e.set(rx, ry, rz)),
      _s.set(s, s, s)
    ),
  };
}

/* Stainless, and unfogged — see rule 3.  `cache: false` on none of these:
 * they are shared instances so the season recolours them like everything
 * else, and there are only five. */
const MAT = {
  steel: () => cel({ color: 0xb4bac2, bands: 3, tint: 0x5a6a90, flat: false, fog: false }),
  dark: () => cel({ color: 0x6b7078, bands: 3, tint: 0x50608c, flat: false, fog: false }),
  tile: () => cel({ color: 0x24262b, bands: 2, tint: 0x424268, flat: false, fog: false }),
  engine: () => cel({ color: 0x43484f, bands: 2, tint: 0x4a5680, flat: false, fog: false }),
  concrete: () => cel({ color: 0x8e8b83, bands: 3, tint: 0x5d5580, flat: false }),
  tank: () => cel({ color: 0xd8d6cf, bands: 3, tint: 0x60598a, flat: false }),
};

/* ------------------------------ the engines ------------------------------ *
 * Thirty-three of them, in the real 3 / 10 / 20 arrangement, because the
 * count is the single most quoted fact about this vehicle and a ring of
 * "some" engines would be the one detail anybody bothers to check. */
function raptors(rings, bell, len) {
  const geo = new THREE.ConeGeometry(bell, len, 7, 1, true);
  const out = [];
  for (const [n, r] of rings) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (r > 3 ? 0.08 : 0);
      // point down: a cone is +y, so a half turn about x puts the bell at the bottom
      out.push(part(geo, Math.cos(a) * r, -len / 2, Math.sin(a) * r, Math.PI, 0, 0));
    }
  }
  return out;
}

/* ------------------------------- the booster ------------------------------ */
function superHeavy() {
  const g = new THREE.Group();

  const skirt = 6;
  const steel = [
    part(new THREE.CylinderGeometry(RAD, RAD * 0.97, skirt, 22), 0, skirt / 2, 0),
    part(new THREE.CylinderGeometry(RAD, RAD, BOOSTER - skirt, 22), 0, skirt + (BOOSTER - skirt) / 2, 0),
    // the raceway: one thin spine up the side, and it is what gives a bare
    // cylinder a direction to be seen turning
    part(new THREE.BoxGeometry(0.55, BOOSTER - skirt - 2, 0.9), RAD, skirt + (BOOSTER - skirt) / 2, 0),
  ];

  /* Four grid fins near the top, and the two catch pins just under them —
   * the pins are what the tower's arms take hold of, so they are the reason
   * the chopsticks are drawn where they are. */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    steel.push(part(
      new THREE.BoxGeometry(4.4, 0.4, 3.4),
      Math.cos(a) * (RAD + 2.0), BOOSTER - 6, Math.sin(a) * (RAD + 2.0), 0, -a, 0
    ));
  }
  for (const s of [-1, 1]) {
    steel.push(part(new THREE.BoxGeometry(1.5, 1.0, 1.6), 0, BOOSTER - 8.5, s * (RAD + 0.5)));
  }

  const body = new THREE.Mesh(bake(steel), MAT.steel());
  g.add(body);
  g.add(new THREE.Mesh(bake(raptors([[3, 1.15], [10, 2.4], [20, 3.75]], 0.62, 1.9)), MAT.engine()));

  // the hot-stage ring: open, vented, and blackened from the last flight
  g.add(new THREE.Mesh(
    bake([part(new THREE.CylinderGeometry(RAD, RAD, HOTSTAGE, 22, 1, true), 0, BOOSTER + HOTSTAGE / 2, 0)]),
    MAT.dark()
  ));
  return g;
}

/* -------------------------------- the ship -------------------------------- *
 * The nose is a lathe rather than a cone: an ogive is what a Starship has,
 * and a straight cone reads as a party hat on a drainpipe — which is what
 * the first version of this was.
 */
function starship() {
  const g = new THREE.Group();
  const barrel = SHIP - 17;

  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    // an ogive: radius falls as the quarter-cosine, so it meets the barrel flat
    pts.push(new THREE.Vector2(RAD * Math.cos(t * Math.PI / 2) ** 0.62 + 0.001, barrel + t * 17));
  }
  const nose = new THREE.LatheGeometry(pts, 22);

  const steel = [
    part(new THREE.CylinderGeometry(RAD, RAD, barrel, 22), 0, barrel / 2, 0),
    { geometry: nose, matrix: new THREE.Matrix4() },
  ];
  /* Four flaps: two small ones at the shoulder, two big ones at the skirt,
   * all four canted back.  They are the silhouette — a Starship without them
   * is a grain silo. */
  for (const s of [-1, 1]) {
    steel.push(part(new THREE.BoxGeometry(3.4, 6.2, 0.7),
      Math.cos(s > 0 ? 0.9 : Math.PI - 0.9) * (RAD + 1.3), barrel + 2.0,
      Math.sin(s > 0 ? 0.9 : Math.PI - 0.9) * (RAD + 1.3), 0, -s * 0.9, s * 0.42));
    steel.push(part(new THREE.BoxGeometry(4.6, 8.4, 0.9),
      Math.cos(s > 0 ? 0.75 : Math.PI - 0.75) * (RAD + 1.8), 6.5,
      Math.sin(s > 0 ? 0.75 : Math.PI - 0.75) * (RAD + 1.8), 0, -s * 0.75, s * 0.30));
  }
  g.add(new THREE.Mesh(bake(steel), MAT.steel()));

  /* The heat shield: black tiles down ONE side only.  A Starship tiled all
   * round is a pencil; the whole read of the thing is stainless on the lee
   * side and black on the windward, and you can see which way it means to
   * come back down. */
  const shell = new THREE.CylinderGeometry(RAD + 0.06, RAD + 0.06, barrel, 22, 1, true, -1.15, 2.3);
  const noseShell = new THREE.LatheGeometry(
    pts.map((p) => new THREE.Vector2(p.x + 0.06, p.y)), 14, -1.15, 2.3
  );
  g.add(new THREE.Mesh(bake([
    part(shell, 0, barrel / 2, 0),
    { geometry: noseShell, matrix: new THREE.Matrix4() },
  ]), MAT.tile()));

  // three sea-level Raptors inside three vacuum ones
  g.add(new THREE.Mesh(bake([
    ...raptors([[3, 1.05]], 0.6, 1.7),
    ...raptors([[3, 2.7]], 1.15, 3.0),
  ]), MAT.engine()));
  return g;
}

/* ---------------------------- the launch mount ---------------------------- *
 * Six legs and a deck, and the stack stands on top of it — which is why the
 * booster's own base is twenty metres in the air and why you cannot see its
 * engines from underneath without walking in among the legs.
 */
function launchMount() {
  const g = new THREE.Group();
  const legR = 8.4;
  const sink = SINK(legR);
  const legH = MOUNT - 3 + sink;
  const steel = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.2;
    steel.push(part(new THREE.CylinderGeometry(0.85, 1.0, legH, 8),
      Math.cos(a) * legR, legH / 2 - sink, Math.sin(a) * legR));
    // one brace per bay, so it reads as a structure and not six lamp posts
    const b = ((i + 1) / 6) * TAU + 0.2;
    const mid = new THREE.Vector3(
      (Math.cos(a) + Math.cos(b)) * legR / 2, MOUNT * 0.45, (Math.sin(a) + Math.sin(b)) * legR / 2
    );
    steel.push(part(new THREE.BoxGeometry(2 * legR * Math.sin(Math.PI / 6), 0.55, 0.55),
      mid.x, mid.y, mid.z, 0, -(a + b) / 2 + Math.PI / 2, 0));
  }
  // the deck: a hexagonal table with the rocket's own hole through the middle
  steel.push(part(new THREE.CylinderGeometry(legR + 1.4, legR + 1.4, 3, 6), 0, MOUNT - 1.5, 0));
  g.add(new THREE.Mesh(bake(steel), MAT.dark()));
  return g;
}

/* ------------------------------- the tower -------------------------------- *
 * A square lattice with two arms on it.  It is drawn as one baked geometry
 * because it is otherwise a hundred and eighty draw calls standing in a bog.
 */
function catchTower() {
  const g = new THREE.Group();
  const h = TOWER_SEC / 2;
  const sink = SINK(h * Math.SQRT2);
  const steel = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      steel.push(part(new THREE.CylinderGeometry(0.55, 0.55, TOWER + sink, 8),
        sx * h, (TOWER + sink) / 2 - sink, sz * h));
    }
  }
  const LEVELS = 20;
  const rise = TOWER / LEVELS;
  for (let i = 1; i <= LEVELS; i++) {
    const y = i * rise;
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * TAU;
      const cx = Math.cos(a) * h, cz = Math.sin(a) * h;
      // the rung along this face
      steel.push(part(new THREE.BoxGeometry(TOWER_SEC, 0.38, 0.38), cx, y, cz, 0, -a, 0));
      // and one diagonal across the bay below it, alternating hand each level
      const len = Math.hypot(TOWER_SEC, rise);
      steel.push(part(new THREE.BoxGeometry(len, 0.3, 0.3), cx, y - rise / 2, cz,
        0, -a, (i % 2 ? 1 : -1) * Math.atan2(rise, TOWER_SEC)));
    }
  }

  /* The chopsticks, out at the height they would be holding a booster's
   * catch pins.  Drawn open and reaching over the pad, which is the pose
   * everybody has seen and the only one that says what they are for. */
  const armY = BOOSTER + MOUNT - 8.5;
  const reach = TOWER_OUT + 6;
  for (const s of [-1, 1]) {
    steel.push(part(new THREE.BoxGeometry(reach, 1.5, 2.1), -reach / 2 - h, armY, s * 3.4));
  }
  steel.push(part(new THREE.BoxGeometry(3.2, 5.0, TOWER_SEC + 2), -h - 1.4, armY, 0));

  g.add(new THREE.Mesh(bake(steel), MAT.steel()));
  return g;
}

/** A cryogenic tank: a cylinder with a dome on it, which is all one is. */
function cryoTank(h = 12, r = 3) {
  const g = new THREE.Group();
  const sink = SINK(r);
  g.add(new THREE.Mesh(bake([
    part(new THREE.CylinderGeometry(r, r, h - r + sink, 14), 0, (h - r + sink) / 2 - sink, 0),
    part(new THREE.SphereGeometry(r, 14, 6, 0, TAU, 0, Math.PI / 2), 0, h - r, 0),
  ]), MAT.tank()));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* ------------------------------------------------------------------ */

/**
 * Put the whole site down at local (u, v) in whatever place is building it.
 *
 * Returns the apron's radius so the caller can clear its own scatter out
 * from under it — a launch pad with reeds growing through the concrete is
 * funny once and then it is just wrong.
 */
export function buildStarbase(root, ctx, { u = PAD_U, v = PAD_V } = {}) {
  const centre = ctx.at(u, v);
  const base = heightAt(centre.x, centre.z);

  /* ------------------------------- the apron ------------------------------ *
   *
   * **The concrete follows the ground; it does not raise it.**  The first
   * version of this was a plinth — a flat slab clearing the highest terrain
   * under its footprint — and the mire has 0.9 m of wave in it across
   * twenty-six metres, so the slab stood nearly a metre proud and the
   * hedgepig, whose hop peaks at 0.42 m, could not get onto his own launch
   * site.  Grading a pad flat means owning a second source of ground, and
   * HANDOVER §5 is unambiguous that there is exactly one.
   *
   * So it is a **skin**: a radial mesh whose every vertex sits 3 cm over
   * `heightAt`, which is the same trick the mire's own standing pools use
   * eighty lines up.  No platform, no step, no hop — he simply walks onto it
   * and the sound underfoot is the only thing that changes.
   */
  const RINGS = 14, SEGS = 48;
  const pos = [], idx = [];
  const yAt = (du, dv, lift) => {
    const p = ctx.at(u + du, v + dv);
    return [p.x - centre.x, heightAt(p.x, p.z) + lift, p.z - centre.z];
  };
  pos.push(...yAt(0, 0, 0.03));
  for (let r = 1; r <= RINGS; r++) {
    const d = (r / RINGS) * APRON_R;
    for (let i = 0; i < SEGS; i++) {
      const a = (i / SEGS) * TAU;
      pos.push(...yAt(Math.cos(a) * d, Math.sin(a) * d, 0.03));
    }
  }
  /* And a rim that drops into the bog, so the edge is a kerb rather than a
   * wafer of paper lying on the grass. */
  const rim0 = pos.length / 3;
  for (let i = 0; i < SEGS; i++) {
    const a = (i / SEGS) * TAU;
    pos.push(...yAt(Math.cos(a) * APRON_R, Math.sin(a) * APRON_R, -0.32));
  }
  for (let i = 0; i < SEGS; i++) idx.push(0, 1 + i, 1 + ((i + 1) % SEGS));
  for (let r = 1; r < RINGS; r++) {
    const a0 = 1 + (r - 1) * SEGS, b0 = 1 + r * SEGS;
    for (let i = 0; i < SEGS; i++) {
      const j = (i + 1) % SEGS;
      idx.push(a0 + i, b0 + i, b0 + j, a0 + i, b0 + j, a0 + j);
    }
  }
  const outer = 1 + (RINGS - 1) * SEGS;
  for (let i = 0; i < SEGS; i++) {
    const j = (i + 1) % SEGS;
    idx.push(outer + i, rim0 + i, rim0 + j, outer + i, rim0 + j, outer + j);
  }
  const apronGeo = new THREE.BufferGeometry();
  apronGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  apronGeo.setIndex(idx);
  apronGeo.computeVertexNormals();

  const apron = new THREE.Mesh(apronGeo, MAT.concrete());
  apron.position.set(centre.x, 0, centre.z);
  apron.receiveShadow = true;
  root.add(apron);

  /* Everything that stands up.  One rigid group each, seated at its own
   * foot — see rule 2.  `noMerge` on all of them: a 123 m mesh folded into a
   * shared merged mesh gives that mesh a bounding sphere the size of the
   * solar system, and every prop inside it stops being culled. */
  const rigid = [];
  const stand = (obj, du, dv, lift = 0) => {
    const p = ctx.at(u + du, v + dv);
    // each on its own ground, which is the other half of rule 2
    obj.position.set(p.x, heightAt(p.x, p.z) + lift, p.z);
    obj.userData.planetRigid = true;
    obj.userData.noMerge = true;
    root.add(obj);
    rigid.push(obj);
    return p;
  };

  const stack = new THREE.Group();
  stack.name = 'starship';
  const booster = superHeavy();
  booster.position.y = MOUNT;
  stack.add(booster);
  const ship = starship();
  ship.position.y = MOUNT + BOOSTER + HOTSTAGE;
  stack.add(ship);
  const mount = launchMount();
  stand(stack, 0, 0);
  stand(mount, 0, 0);
  stand(catchTower(), TOWER_OUT, 0);

  const tanks = [];
  for (let i = 0; i < 4; i++) {
    const a = -0.55 + i * 0.36;
    const t = cryoTank(11 + (i % 2) * 2.5, 2.8);
    stand(t, Math.cos(a) * -17.5, Math.sin(a) * -17.5 - 4);
    tanks.push(t);
  }

  /* Shadows.  The things standing at pad level cast; nothing above the mount
   * does.  The shadow camera is ±17 m around HIM (HANDOVER §3), so a 123 m
   * rocket does not fit inside it under any sun — and what an object poking
   * out of an orthographic shadow frustum produces is not a long shadow, it
   * is a solid black wall across the whole map.  The mount and the tanks are
   * inside it and do all the work that can honestly be done. */
  for (const o of rigid) o.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  for (const o of [mount, ...tanks]) o.traverse((m) => { if (m.isMesh) m.castShadow = true; });

  /* --------------------------- getting near it ---------------------------- *
   *
   * The apron itself blocks nothing — he walks straight onto it, and
   * `padAt` in `plan.js` is what keeps the grass and the brambles off it.
   * The only no-go here is what is actually solid.
   */
  ctx.block(u, v, 9.4);                           // he may not walk into the legs
  ctx.block(u + TOWER_OUT, v, 6.2);
  ctx.interact(u, v + APRON_R - 1.4, 'the pad', ctx.lines(
    'a hundred and twenty-three metres of it. the planet is three hundred round.',
    'thirty-three engines at the bottom. he has counted them twice.',
    'nobody in the wood will believe a word of this.',
    'the black side is the side that comes back down. the badger was not impressed.',
    'it is leaning very slightly. everything on a round world is.',
  ));

  /* `booster` and `ship` come out separately because hot-stage separation
   * needs to take one away from the other — see `game/mission.js`. */
  return {
    apron, stack, booster, ship, mount, tower: rigid[2], tanks,
    apronR: APRON_R, at: centre, base, height: MOUNT + STACK,
  };
}
