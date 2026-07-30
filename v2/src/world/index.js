import * as THREE from 'three';
import { buildPlanet, bakeToPlanet, flatAt } from './planet.js';
import { buildGround, buildWater } from './ground.js';
import { buildGrass } from './grass.js';
import { heightAt, walkableAt, waterDepthAt } from './terrain.js';
import { CIRC, wrapDelta } from './plan.js';

/* ------------------------------------------------------------------ *
 * Assembly.
 *
 * Every builder authors flat, in metres, knowing nothing about the planet.
 * This file runs them in order, hands the finished pile to `bakeToPlanet`
 * once, and then owns the per-frame update for everything static.
 *
 * The order matters in exactly one way: the bake must come last, and
 * anything that has to keep a moving pivot (the boat, the gate, the cars)
 * must be marked `planetRigid` before it gets there.  Things that move
 * freely — the hedgepig, the weather — are built *after* the bake and
 * seated on the surface themselves, every frame.
 * ------------------------------------------------------------------ */

export function buildWorld(scene, { places = null, grass: withGrass = true } = {}) {
  const root = new THREE.Group();
  root.name = 'world';

  const planet = buildPlanet(scene);
  const ground = buildGround(root);
  const water = buildWater(root);
  const built = places ? places(root) : { blockers: [], interactables: [], update: null, pickables: [] };
  /* Skippable, and only for the harness: the meadow is a hundred thousand
   * instances and about a second of build time, and no assertion about the
   * walk or the hazards depends on a single blade of it. */
  const grass = withGrass ? buildGrass(root) : {
    group: null, chunks: [], blades: 0,
    setSeason() {}, setWind() {}, update() {},
  };

  const stats = bakeToPlanet(root);
  scene.add(root);

  /* Anything that moves is built now, after the bake, and seats itself on
   * the surface every frame: the boat, the traffic, the hens.  Bending a
   * rig's geometry would bend its pivots with it. */
  built.postBake?.(scene);

  /* Everything the camera's ray may land on when you call him somewhere.
   * The grass is deliberately not in here: a tap that hit a blade would
   * call him a hand's breadth from where you meant. */
  const pickables = [...ground.chunks, ...(built.pickables || [])];

  const blockers = built.blockers || [];

  return {
    root, planet, ground, water, grass, stats,
    pickables,
    interactables: built.interactables || [],
    /** Named things the game needs to reach: thorns, cars, the boat, the culvert. */
    out: built.out || {},
    setFlash: (fn) => built.setFlash?.(fn),
    heightAt,

    /** Anything a hedgepig may not walk into, beyond water and the field's edge. */
    blockedAt(x, z) {
      for (const b of blockers) {
        if (b.enabled === false) continue;
        const dx = wrapDelta(x, b.x);
        const dz = z - b.z;
        if (b.r) {
          if (dx * dx + dz * dz < b.r * b.r) return true;
        } else if (Math.abs(dx) < b.hx && Math.abs(dz) < b.hz) {
          return true;
        }
      }
      return false;
    },

    /** Nearest interactable within reach of him, or null. */
    nearest(x, z, reach = 0.7) {
      let best = null, bd = reach * reach;
      for (const it of this.interactables) {
        const dx = wrapDelta(it.x, x);
        const dz = it.z - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = it; }
      }
      return best;
    },

    update(dt, hog, climate) {
      water.update(dt);
      grass.update(dt, hog.x, hog.z);
      built.update?.(dt, hog, climate);
    },
  };
}
