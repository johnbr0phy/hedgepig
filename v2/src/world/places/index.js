import * as THREE from 'three';
import { rngKit, clamp } from '../../core/util.js';
import { heightAt, waterDepthAt } from '../terrain.js';
import {
  ORDER, PLACE_LEN, PLACE, placeStart, placeCentre, hardAt, wrapDelta,
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
 * Ten builders, run in ring order, each handed a slice of longitude and a
 * shared bag to put its blockers, its interactables and its movers in.  No
 * builder knows about any other, and none of them knows about the planet —
 * the bake in `world/index.js` happens after all of this and bends the lot.
 *
 * Two things are built here rather than in a place, because they belong to
 * the whole ring: the brambles, which have to be spread evenly over every
 * grassy place and thinned per leg, and the seasonal show/hide pass.
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

/** How many bramble clumps exist at all. The leg decides how many are live. */
const THORN_POOL = 150;

export function buildPlaces(root) {
  const hooks = { flash: () => {} };

  const shared = {
    blockers: [],
    interactables: [],
    pickables: [],
    seasonal: [],
    updaters: [],
    post: [],
    out: {},
    flash: (m) => hooks.flash(m),
  };

  for (const [kind, build] of BUILDERS) {
    const slot = ORDER.indexOf(kind);
    const x0 = placeStart(slot);
    build(root, {
      ...shared,
      kind, slot, x0, x1: x0 + PLACE_LEN, cx: placeCentre(slot),
      name: PLACE[kind].name,
    });
  }

  /* ------------------------------- brambles ------------------------------- */
  /* Spread over the whole ring, not per place, so the density can be raised
   * per leg without any one place turning into a hedge.  v1's rule holds:
   * they never seed on hard ground, which is why they have never once grown
   * on the tarmac or in the lake. */
  const rng = rngKit(31337);
  const thorns = [];
  const group = new THREE.Group();
  group.name = 'brambles';
  let guard = 0;
  while (thorns.length < THORN_POOL && guard++ < THORN_POOL * 40) {
    const x = rng.range(0, PLACE_LEN * ORDER.length);
    const z = rng.range(-11.5, 11.5);
    if (hardAt(x) > 0.25) continue;
    if (waterDepthAt(x, z) > 0) continue;
    // never right on top of something solid, and never in a wall of itself
    let clash = shared.blockers.some((b) => {
      const dx = Math.abs(wrapDelta(x, b.x));
      const dz = Math.abs(z - b.z);
      return b.r ? Math.hypot(dx, dz) < b.r + 0.6 : dx < b.hx + 0.6 && dz < b.hz + 0.6;
    });
    if (!clash) {
      clash = thorns.some((t) => Math.hypot(wrapDelta(t.x, x), t.z - z) < 1.5);
    }
    if (clash) continue;

    const r = rng.range(0.34, 0.52);
    const obj = bramble({ seed: 2000 + thorns.length, r });
    obj.position.set(x, heightAt(x, z), z);
    group.add(obj);
    /* The hitbox is the plant you can see, a little tighter than its
     * silhouette: v1 matched car hitboxes to the drawn car for the same
     * reason, and being clipped by something that looked like a miss is the
     * one unfairness a player will not forgive. */
    thorns.push({ x, z, r: r * 0.78, obj, live: true });
  }
  root.add(group);
  shared.out.thorns = thorns;

  return {
    blockers: shared.blockers,
    interactables: shared.interactables,
    pickables: shared.pickables,
    out: shared.out,

    setFlash(fn) { hooks.flash = fn; },

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
