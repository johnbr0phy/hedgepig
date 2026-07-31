import * as THREE from 'three';
import { bake } from '../core/util.js';
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

  /* ---------------------------- the static merge ---------------------------- *
   * ~830 props seated rigidly is ~830 draw calls before the shadow pass
   * doubles them — the measured bulk of the frame.  Everything static and
   * opaque that shares a material becomes ONE mesh here.  Excluded, by
   * `noMerge` or by nature: whatever toggles visibility (thorns, seasonal),
   * whatever animates in place (the cat), everything transparent (sort
   * order is load-bearing), instanced meshes, and the pickable tarmac.
   * Materials are shared instances, so the season keeps recolouring the
   * merged mesh exactly as it recoloured the props. */
  {
    for (const p of built.pickables || []) p.userData.noMerge = true;
    const skipOut = (val) => {
      if (!val) return;
      if (val.isObject3D) val.userData.noMerge = true;
      else if (Array.isArray(val)) val.forEach(skipOut);
      else if (typeof val === 'object') for (const k of Object.keys(val)) skipOut(val[k]);
    };
    skipOut(built.out);

    root.updateMatrixWorld(true);
    const blockedUp = (o) => {
      for (let p = o; p; p = p.parent) if (p.userData?.noMerge) return true;
      return false;
    };
    const groups = new Map();
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.material) return;
      if (Array.isArray(o.material) || o.material.transparent) return;
      if (blockedUp(o)) return;
      const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder | 0}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, ro: o.renderOrder, members: [] });
      g.members.push(o);
    });
    let before = 0, after = 0;
    for (const g of groups.values()) {
      if (g.members.length < 2) continue;
      before += g.members.length;
      after++;
      const merged = bake(g.members.map((o) => ({ geometry: o.geometry, matrix: o.matrixWorld })));
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, g.mat);
      mesh.castShadow = g.cast;
      mesh.receiveShadow = g.recv;
      mesh.renderOrder = g.ro;
      root.add(mesh);
      for (const o of g.members) o.removeFromParent();
    }
    stats.merged = { before, after };
  }

  scene.add(root);

  built.postBake?.(scene);

  /* Everything a tap may land on.  The grass is deliberately not in here: a
   * tap that hit a blade would call him a hand's breadth from where you
   * meant, and the ground is a single mesh that covers the whole planet. */
  const pickables = [ground.land, ...(built.pickables || [])];
  const blockers = built.blockers || [];
  const platforms = built.platforms || [];
  const _d = new THREE.Vector3();
  const _f = new THREE.Vector3();

  return {
    root, ground, water, grass, stats,
    pickables,
    interactables: built.interactables || [],
    /** Named things the game needs: the thorns, the traffic, the boat, the culvert. */
    out: built.out || {},
    setFlash: (fn) => built.setFlash?.(fn),
    setSound: (fn) => built.setSound?.(fn),
    heightAt,

    blockers,

    /**
     * Register a no-go at runtime — what you sow, which the builders never
     * saw.  Returns the record, which is the handle you pass back to
     * `removeBlocker`.
     */
    addBlocker(x, z, r) {
      const b = { x, z, r, dir: dirAt(x, z, new THREE.Vector3()), cosR: Math.cos(r / R) };
      blockers.push(b);
      return b;
    },

    removeBlocker(b) {
      const i = blockers.indexOf(b);
      if (i >= 0) blockers.splice(i, 1);
    },

    /**
     * Anything he may not walk into, beyond the water itself.
     *
     * One dot product each and no trigonometry: a blocker is stored as the
     * direction of its centre and the cosine of its radius, so the test is
     * "is this direction inside that cone".  With two hundred blockers on an
     * open planet, `acos` per blocker per step was showing up in the frame.
     *
     * `(fx, fz)` is where the step is coming *from*, and it buys one thing
     * that matters more than it looks: **a blocker may never hold something
     * that is already inside it.**  A snowman sown on top of him would
     * otherwise be a cage — every direction refused, his own escape included
     * — and the only cure would be a rule about where things may be sown,
     * which is a rule that will eventually be got wrong.  Deeper is refused;
     * anything else is allowed.
     *
     * Not *strictly* outward, which was the first version of this and was
     * still a cage: with a second blocker in front of him the only way out is
     * `tryStep`'s slide, and a slide is tangential — the same depth, not
     * less — so both moves were refused and he was pinned between two things
     * he could have walked around.
     */
    blockedAt(x, z, fx, fz, y) {
      dirAt(x, z, _d);
      const inside = fx !== undefined ? dirAt(fx, fz, _f) : null;
      for (const b of blockers) {
        if (b.enabled === false) continue;
        /* A blocker with a `top` is something climbable, and it only blocks
         * you while you are **below** its surface.  Standing on the log, the
         * log is not in your way; the same record is a wall from the ground
         * and a floor from above. */
        if (b.top !== undefined && y !== undefined && y >= b.top - 0.04) continue;
        const d = _d.dot(b.dir);
        if (d <= b.cosR) continue;
        if (inside) {
          const was = inside.dot(b.dir);
          if (was > b.cosR && d <= was) continue;     // already in it, and not going deeper
        }
        return true;
      }
      return false;
    },

    platforms,

    /**
     * The highest thing he could be standing on at (x, z), or `null`.
     *
     * **This is not a second source of ground.**  `heightAt` still owns the
     * terrain and everything else in the world still reads it — the globe
     * mesh, every prop, every blade, the water.  A platform is consulted by
     * exactly one thing, his feet, and only for a surface at or below where
     * they already are: `ceil` is his current height plus a step, so he can
     * walk up onto something low and cannot be teleported onto a log he is
     * strolling past at ground level.
     *
     * Walk off the edge and there is no platform at the new spot, so the
     * support drops to the ground and he falls, which is the whole mechanic
     * and costs nothing to express.
     */
    platformAt(x, z, ceil) {
      let best = null;
      for (const p of platforms) {
        if (p.top > ceil) continue;
        if (best && p.top <= best.top) continue;
        if (distance(x, z, p.x, p.z) > p.r) continue;
        best = p;
      }
      return best;
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
