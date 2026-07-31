import * as THREE from 'three';
import { rngKit, clamp, TAU } from '../../core/util.js';
import { heightAt, waterDepthAt } from '../terrain.js';
import {
  R, CENTRE, CENTRES, PLACE, ORDER, offsetFrom, arcTo, dirAt, hardAt, distance,
  BGARD, WOOD, MGARD, LAKE, MIRE, HENS, FARM, ROAD, TOWN, MEADOW,
} from '../plan.js';
import { bramble } from '../props.js';
import { buildMeadow, buildGarden, buildWood, buildMushrooms } from './green.js';
import { buildLake, buildMire } from './water.js';
import { buildHens, buildFarm } from './farm.js';
import { buildRoad, buildTown } from './road.js';

/* ------------------------------------------------------------------ *
 * Composition.
 *
 * Ten builders, each handed a **centre and a disc** rather than a slice of
 * longitude, and a shared bag to put its blockers, interactables and movers
 * in.  No builder knows about any other, and none of them knows the world is
 * round: they lay content out in metres east and north of their own centre
 * and `ctx.at` puts it on the globe through the exponential map.
 *
 * That last part matters more than it sounds.  A place is 44 m across on a
 * 47.75 m sphere — a third of the way round it — so a flat offset would be
 * metres out at the rim and the far edge of every place would pull away from
 * the ground.
 * ------------------------------------------------------------------ */

const BUILDERS = [
  [BGARD, buildGarden],
  [WOOD, buildWood],
  [MGARD, buildMushrooms],
  [LAKE, buildLake],
  [MIRE, buildMire],
  [HENS, buildHens],
  [FARM, buildFarm],
  [ROAD, buildRoad],
  [TOWN, buildTown],
  [MEADOW, buildMeadow],
];

/** How far out a place may put its own content before it treads on a neighbour. */
export const PLACE_R = 21;

/** How many bramble clumps exist at all. The leg decides how many are live. */
const THORN_POOL = 260;

export function buildPlaces(root) {
  const hooks = { flash: () => {}, sound: () => {} };

  const shared = {
    blockers: [],
    platforms: [],
    interactables: [],
    pickables: [],
    seasonal: [],
    updaters: [],
    post: [],
    out: {},
    flash: (m) => hooks.flash(m),
    sound: (name) => hooks.sound(name),
  };

  for (const [kind, build] of BUILDERS) {
    const centre = CENTRE[kind];
    const at = (u, v, out) => offsetFrom(centre, u, v, out);

    const ctx = {
      ...shared,
      kind,
      centre,
      name: PLACE[kind].name,
      R: PLACE_R,
      at,

      /**
       * Put an object at (u, v) local metres, standing on the ground —
       * **rigidly**.
       *
       * Geometry authored flat and then bent onto the sphere is squashed
       * along longitude by `cos(latitude)`: nothing at all on the equator,
       * 11 % at a place's centre, and half at 60° north.  In a world that
       * was one band round the equator that never mattered.  In an open one
       * it would flatten every mushroom in the northern half of the planet.
       * `planetRigid` re-seats the whole prop on the surface instead, with
       * the tangent frame for its own spot and its geometry untouched.
       */
      put(obj, u, v) {
        const p = at(u, v);
        obj.position.set(p.x, heightAt(p.x, p.z), p.z);
        obj.userData.planetRigid = true;
        return p;
      },

      /** A circular no-go, at local coordinates. */
      block(u, v, r) {
        const p = at(u, v);
        shared.blockers.push({ x: p.x, z: p.z, r });
        return p;
      },

      /**
       * Something he can get **on top of**: a disc of radius `r` whose walkable
       * surface is `top` metres above the ground under it.  A fallen trunk, a
       * stump, a boulder, a low wall.
       *
       * It registers a no-go as well, with the platform's height on it — so
       * the log stops him at ground level and stops stopping him once he is
       * standing on it.  Without that pairing a climbable log is either a wall
       * you cannot get onto or a ghost you walk through.
       */
      stand(u, v, r, top) {
        const p = at(u, v);
        /* `top` comes in as a height above the ground, which is how a builder
         * thinks about a log, and is stored as an **absolute** height, which
         * is how his feet think about one.  Keeping both in the same record
         * under the same name is how the first version of this snapped him
         * onto everything he walked past: the ceiling test compared a relative
         * 0.24 against an absolute 1.06 and let it through. */
        const abs = heightAt(p.x, p.z) + top;
        shared.platforms.push({ x: p.x, z: p.z, r, top: abs, rise: top });
        shared.blockers.push({ x: p.x, z: p.z, r: r * 0.92, top: abs });
        return p;
      },

      /** Something he can walk up to, at local coordinates. */
      interact(u, v, label, action) {
        const p = at(u, v);
        shared.interactables.push({ x: p.x, z: p.z, label, action });
        return p;
      },

      /**
       * A rotating set of lines for an interactable — the second visit says
       * something the first did not, which is the whole difference between
       * a sign and an acquaintance.
       */
      lines(...msgs) {
        let i = 0;
        return () => shared.flash(msgs[i++ % msgs.length]);
      },

      /**
       * Scatter within the place's disc, refusing hard ground and water so
       * that no builder has to remember to — v1's thorns had exactly this
       * rule, and it is why they never once grew on the tarmac.
       */
      scatter(rng, { r = PLACE_R, inner = 0, n, minGap = 0.6, avoidWater = true }, make) {
        const placed = [];
        let guard = 0;
        while (placed.length < n && guard++ < n * 40) {
          const a = rng.range(0, TAU);
          // sqrt for an even spread over the disc rather than a bullseye
          const d = Math.sqrt(rng.range((inner / r) ** 2, 1)) * r;
          const u = Math.cos(a) * d, v = Math.sin(a) * d;
          const p = at(u, v);
          if (hardAt(p.x, p.z) > 0.4) continue;
          if (avoidWater && waterDepthAt(p.x, p.z) > 0) continue;
          let clash = false;
          for (const q of placed) {
            if (Math.hypot(q.u - u, q.v - v) < minGap) { clash = true; break; }
          }
          if (clash) continue;
          const obj = make(u, v, placed.length);
          if (obj) {
            obj.position.set(p.x, heightAt(p.x, p.z), p.z);
            obj.userData.planetRigid = true;      // see `put`
            placed.push({ u, v, x: p.x, z: p.z, obj });
          }
        }
        return placed;
      },
    };

    build(root, ctx);
  }

  /* ------------------------------- brambles ------------------------------- */
  /* Spread over the whole planet rather than per place, so the density can be
   * raised leg by leg without any one place turning into a hedge.  v1's rule
   * holds: they never seed on hard ground. */
  const rng = rngKit(31337);
  const thorns = [];
  const group = new THREE.Group();
  group.name = 'brambles';
  let guard = 0;
  while (thorns.length < THORN_POOL && guard++ < THORN_POOL * 40) {
    // an even scatter over the sphere: z by arcsine, x uniform
    const z = R * Math.asin(rng.range(-1, 1));
    const x = rng.range(0, 300);
    if (hardAt(x, z) > 0.25) continue;
    if (waterDepthAt(x, z) > 0) continue;
    let clash = shared.blockers.some((b) => distance(x, z, b.x, b.z) < b.r + 0.7);
    if (!clash) clash = thorns.some((t) => distance(x, z, t.x, t.z) < 2.2);
    if (clash) continue;

    const r = rng.range(0.34, 0.52);
    const obj = bramble({ seed: 2000 + thorns.length, r });
    obj.position.set(x, heightAt(x, z), z);
    obj.userData.planetRigid = true;
    obj.userData.noMerge = true;      // the leg toggles each bush's visibility
    group.add(obj);
    /* The hitbox is the plant you can see, a little tighter than its
     * silhouette: being clipped by something that looked like a miss is the
     * one unfairness a player will not forgive. */
    thorns.push({ x, z, r: r * 0.78, obj, live: true });
  }
  root.add(group);
  shared.out.thorns = thorns;

  /* Blockers are stored as directions with a cosine threshold, so the test in
   * `world.blockedAt` is one dot product each and no trigonometry at all. */
  const blockers = shared.blockers.map((b) => ({
    ...b,
    dir: dirAt(b.x, b.z, new THREE.Vector3()),
    cosR: Math.cos(b.r / R),
  }));

  return {
    blockers,
    platforms: shared.platforms,
    interactables: shared.interactables,
    pickables: shared.pickables,
    out: shared.out,

    setFlash(fn) { hooks.flash = fn; },
    setSound(fn) { hooks.sound = fn; },

    /** Movers are built after the bake, so they keep their own pivots. */
    postBake(scene) {
      for (const fn of shared.post) fn(scene);
    },

    update(dt, hog, climate) {
      for (const fn of shared.updaters) fn(dt, hog, climate);
      for (const s of shared.seasonal) {
        const on = s.at(climate);
        if (s.obj.visible !== on) s.obj.visible = on;
      }
    },
  };
}
