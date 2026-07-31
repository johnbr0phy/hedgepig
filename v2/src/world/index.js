import * as THREE from 'three';
import { bakeToPlanet } from './planet.js';
import { buildGround, buildWater } from './ground.js';
import { buildGrass } from './grass.js';
import { heightAt } from './terrain.js';
import { R, dirAt, distance } from './plan.js';

/* ------------------------------------------------------------------ *
 * Assembly.
 *
 * Every builder authors in metres and knows nothing about the planet.  This
 * runs them in order, hands the pile to `bakeToPlanet` once, and then owns
 * the per-frame update for everything static.
 *
 * The order matters in one way: the bake comes last, and anything that keeps
 * a moving pivot — the boat, the traffic, the hens — is built *after* it and
 * seats itself on the surface every frame.  Bending a rig's geometry would
 * bend its pivots with it.
 * ------------------------------------------------------------------ */

export function buildWorld(scene, { places = null, grass: withGrass = true } = {}) {
  const root = new THREE.Group();
  root.name = 'world';

  const ground = buildGround(scene);
  const water = buildWater(root);
  const built = places
    ? places(root)
    : { blockers: [], interactables: [], update: null, pickables: [] };
  /* Skippable, and only for the harness: the meadow streams, so building it
   * is cheap, but no assertion about the walk or the hazards needs a blade. */
  const grass = withGrass ? buildGrass(root) : {
    group: null, chunks: [], blades: 0, liveCells: 0,
    setSeason() {}, setWind() {}, update() {}, prime() {},
  };

  const stats = bakeToPlanet(root);
  scene.add(root);

  built.postBake?.(scene);

  /* Everything a tap may land on.  The grass is deliberately not in here: a
   * tap that hit a blade would call him a hand's breadth from where you
   * meant, and the ground is a single mesh that covers the whole planet. */
  const pickables = [ground.land, ...(built.pickables || [])];
  const blockers = built.blockers || [];
  const _d = new THREE.Vector3();

  return {
    root, ground, water, grass, stats,
    pickables,
    interactables: built.interactables || [],
    /** Named things the game needs: the thorns, the traffic, the boat, the culvert. */
    out: built.out || {},
    setFlash: (fn) => built.setFlash?.(fn),
    setSound: (fn) => built.setSound?.(fn),
    heightAt,

    /**
     * Anything he may not walk into, beyond the water itself.
     *
     * One dot product each and no trigonometry: a blocker is stored as the
     * direction of its centre and the cosine of its radius, so the test is
     * "is this direction inside that cone".  With two hundred blockers on an
     * open planet, `acos` per blocker per step was showing up in the frame.
     */
    blockedAt(x, z) {
      dirAt(x, z, _d);
      for (const b of blockers) {
        if (b.enabled === false) continue;
        if (_d.dot(b.dir) > b.cosR) return true;
      }
      return false;
    },

    /** Nearest interactable within reach of him, or null. */
    nearest(x, z, reach = 0.8) {
      let best = null, bd = reach;
      for (const it of this.interactables) {
        const d = distance(x, z, it.x, it.z);
        if (d < bd) { bd = d; best = it; }
      }
      return best;
    },

    update(dt, hog, climate) {
      water.update(dt);
      grass.update(dt, hog.x, hog.z, hog.y);
      built.update?.(dt, hog, climate);
    },
  };
}
