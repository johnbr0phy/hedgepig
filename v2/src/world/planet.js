import * as THREE from 'three';
import { cel } from '../core/toon.js';
import { R, CIRC, wrapDelta } from './plan.js';

/* ------------------------------------------------------------------ *
 * The planet.
 *
 * Every builder in `world/` authors on a flat XZ plane, exactly as v1 did:
 * `x` runs along the walk, `z` across the field, `y` is up, and no builder
 * knows the planet exists.  This module is the projection that wraps that
 * plane onto a sphere once, after everything is built, plus the sphere
 * itself.
 *
 * The mapping is equirectangular with the walk on the equator:
 *
 *     x -> longitude   (wraps at exactly one circumference)
 *     z -> latitude    (poles a quarter-lap out, at ±75 m)
 *
 * **The radius is derived, not chosen.**  Ten places of thirty metres is a
 * three-hundred-metre round, so R = 300 / 2π = 47.75 m and the ring of
 * places closes into itself with no seam and no distortion along the walk.
 * That is the whole reason for this mapping over any other.  The cost is
 * that longitudes converge toward the poles, so the field gets squeezed in
 * x as you walk out sideways; at the edge of the walkable band (±13 m) that
 * squeeze is cos(13/47.75) = 3.7 %, which is under the width of a blade of
 * grass, and the poles themselves are bare hillside a long way from
 * anything.
 * ------------------------------------------------------------------ */

/** Planet radius in metres. Defined with the places, in `plan.js`. */
export { R };

/** Sphere centre, chosen so the flat origin sits on the surface with +Y up. */
export const CENTER = new THREE.Vector3(0, -R, 0);

/** Visible ground horizon for an eye h metres up. About 11 m at camera height. */
export const horizonFor = (h) => Math.sqrt(2 * R * h + h * h);

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/* ------------------------------- mapping ------------------------------- */

/** Outward surface normal ("up") at flat coordinates (x, z). */
export function normalAt(x, z, out = new THREE.Vector3()) {
  const la = x / R;
  const ph = z / R;
  const cp = Math.cos(ph);
  return out.set(Math.sin(la) * cp, Math.cos(la) * cp, Math.sin(ph));
}

/** World position of the flat point (x, z), raised y metres above the surface. */
export function positionAt(x, y, z, out = new THREE.Vector3()) {
  normalAt(x, z, out).multiplyScalar(R + y).add(CENTER);
  return out;
}

/**
 * Orthonormal tangent frame: east is +x, north is +z, up is the normal.
 * At the origin this is the identity, which is why content near the start
 * of the walk needs no correction at all.
 */
export function basisAt(x, z, up = new THREE.Vector3(), east = new THREE.Vector3(), north = new THREE.Vector3()) {
  const la = x / R;
  const ph = z / R;
  const sl = Math.sin(la), cl = Math.cos(la);
  const sp = Math.sin(ph), cp = Math.cos(ph);
  up.set(sl * cp, cl * cp, sp);
  east.set(cl, -sl, 0);
  north.set(-sl * sp, -cl * sp, cp);
  return { up, east, north };
}

/** Full placement matrix for the flat point (x, z) at height y. */
export function frameAt(x, z, y = 0, out = new THREE.Matrix4()) {
  const b = basisAt(x, z);
  out.makeBasis(b.east, b.up, b.north);
  out.setPosition(positionAt(x, y, z, _v));
  return out;
}

/** Inverse mapping: a world point back to flat (x, z, y). */
export function flatAt(worldPos, out = { x: 0, z: 0, y: 0 }) {
  _v.copy(worldPos).sub(CENTER);
  const r = _v.length() || 1;
  _v.multiplyScalar(1 / r);
  out.z = R * Math.asin(THREE.MathUtils.clamp(_v.z, -1, 1));
  out.x = R * Math.atan2(_v.x, _v.y);
  out.y = r - R;
  return out;
}

export { wrapDelta };

/* ---------------------------- geometry wrapping ---------------------------- */

/**
 * Split any triangle with an edge longer than `maxEdge`.
 *
 * This is what makes wrapping arbitrary geometry safe.  A fence rail authored
 * as a twenty-metre box has two vertices along its length; bending only those
 * two would chord straight through the planet.  Bisecting until every span is
 * short means the flat builders can produce planet-scale geometry unchanged.
 *
 * Material groups are tracked by hand through the passes.  `toNonIndexed()`
 * drops them and the rebuilt geometry starts empty — and a mesh with a
 * material *array* and no groups is not drawn at all, silently.  In the
 * reference build that took out every sign in the world at once and nothing
 * threw.
 */
function subdivideLongEdges(geo, maxEdge) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const max2 = maxEdge * maxEdge;

  const attrNames = Object.keys(g.attributes);
  let arrays = attrNames.map((n) => ({
    name: n,
    size: g.attributes[n].itemSize,
    src: g.attributes[n].array,
  }));
  let count = g.attributes.position.count;

  const srcGroups = geo.groups && geo.groups.length ? geo.groups : null;
  let gid = new Int32Array(count / 3);
  if (srcGroups) {
    for (const grp of srcGroups) {
      const t0 = Math.floor(grp.start / 3);
      const t1 = Math.min(gid.length, t0 + Math.floor(grp.count / 3));
      for (let t = t0; t < t1; t++) gid[t] = grp.materialIndex ?? 0;
    }
  }

  // bounded pass count: each pass at least halves the longest edge
  for (let pass = 0; pass < 12; pass++) {
    const pos = arrays.find((a) => a.name === 'position').src;
    let splits = 0;
    const out = arrays.map((a) => ({ name: a.name, size: a.size, dst: [] }));
    const gidOut = [];

    for (let t = 0; t < count; t += 3) {
      let worst = -1, wi = 0;
      for (let e = 0; e < 3; e++) {
        const a = t + e, b = t + ((e + 1) % 3);
        const dx = pos[a * 3] - pos[b * 3];
        const dy = pos[a * 3 + 1] - pos[b * 3 + 1];
        const dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > worst) { worst = d2; wi = e; }
      }
      if (worst <= max2) {
        for (const a of out) {
          const src = arrays.find((x) => x.name === a.name).src;
          for (let e = 0; e < 3; e++) {
            for (let k = 0; k < a.size; k++) a.dst.push(src[(t + e) * a.size + k]);
          }
        }
        gidOut.push(gid[t / 3]);
        continue;
      }
      splits++;
      gidOut.push(gid[t / 3], gid[t / 3]);
      // i0-i1 is the long edge, i2 the opposite corner
      const i0 = t + wi, i1 = t + ((wi + 1) % 3), i2 = t + ((wi + 2) % 3);
      for (const a of out) {
        const src = arrays.find((x) => x.name === a.name).src;
        const mid = [];
        for (let k = 0; k < a.size; k++) {
          mid.push((src[i0 * a.size + k] + src[i1 * a.size + k]) * 0.5);
        }
        const push = (idx) => {
          for (let k = 0; k < a.size; k++) a.dst.push(src[idx * a.size + k]);
        };
        // (i0, mid, i2) and (mid, i1, i2) preserve winding
        push(i0); a.dst.push(...mid); push(i2);
        a.dst.push(...mid); push(i1); push(i2);
      }
    }

    arrays = out.map((a) => ({ name: a.name, size: a.size, src: Float32Array.from(a.dst) }));
    gid = Int32Array.from(gidOut);
    count = arrays.find((a) => a.name === 'position').src.length / 3;
    if (!splits) break;
  }

  const result = new THREE.BufferGeometry();
  for (const a of arrays) {
    result.setAttribute(a.name, new THREE.BufferAttribute(a.src, a.size));
  }
  if (srcGroups) {
    let start = 0;
    for (let t = 1; t <= gid.length; t++) {
      if (t === gid.length || gid[t] !== gid[start]) {
        result.addGroup(start * 3, (t - start) * 3, gid[start]);
        start = t;
      }
    }
  }
  if (g !== geo) g.dispose();
  return result;
}

/**
 * Bend a geometry whose vertices are flat *world* coordinates onto the
 * sphere.  Returns a new geometry; the input is left alone.
 */
export function wrapGeometry(geo, maxEdge = 2.2, smooth = false) {
  const g = subdivideLongEdges(geo, maxEdge);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    positionAt(pos.getX(i), pos.getY(i), pos.getZ(i), v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  if (!smooth) {
    g.deleteAttribute('normal');
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  return g;
}

/* -------------------------------- baking -------------------------------- */

/**
 * Project an already-built flat world onto the planet.  Runs once, after
 * every builder has finished, and touches only geometry and transforms.
 *
 *  - InstancedMesh        -> every instance re-seated rigidly on the surface
 *  - userData.planetRigid -> left as a rig and re-seated whole, so pivots
 *                            survive (gates, the boat, anything animated)
 *  - everything else      -> subdivided and bent vertex by vertex
 */
export function bakeToPlanet(root, { maxEdge = 2.2 } = {}) {
  root.updateMatrixWorld(true);

  const underRigid = (o) => {
    for (let p = o.parent; p && p !== root.parent; p = p.parent) {
      if (p.userData.planetRigid) return true;
    }
    return false;
  };

  const rigid = [];
  root.traverse((o) => {
    if (o.userData.planetRigid && !underRigid(o)) {
      rigid.push({ obj: o, world: o.matrixWorld.clone() });
    }
  });

  const jobs = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isLine && !o.isPoints) return;
    if (o.userData.planetRigid || underRigid(o)) return;
    jobs.push({ obj: o, world: o.matrixWorld.clone() });
  });

  const stats = { wrapped: 0, instanced: 0, rigid: rigid.length, tris: 0 };

  for (const { obj, world } of jobs) {
    if (obj.isInstancedMesh) {
      const im = obj.instanceMatrix;
      for (let i = 0; i < obj.count; i++) {
        _m.fromArray(im.array, i * 16).premultiply(world);
        _m.decompose(_v, _q, _s);
        const b = basisAt(_v.x, _v.z);
        const fq = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(b.east, b.up, b.north)
        );
        const p = positionAt(_v.x, _v.y, _v.z, new THREE.Vector3());
        _m.compose(p, fq.multiply(_q), _s);
        _m.toArray(im.array, i * 16);
      }
      im.needsUpdate = true;
      /* Instanced clouds get their bound from the instances, not the source
       * geometry, so they are culled by hand in `world.update()` instead —
       * see the chunk list there.  Leaving three.js to do it would cull the
       * whole grass field the moment its source blade left the frustum. */
      obj.frustumCulled = false;
      obj.computeBoundingSphere?.();
      stats.instanced += obj.count;
    } else {
      const flatGeo = obj.geometry.clone().applyMatrix4(world);
      const bent = wrapGeometry(flatGeo, maxEdge, obj.userData.smoothNormals);
      flatGeo.dispose();
      obj.geometry = bent;
      /* Culled, and it matters: the bake leaves every mesh with an identity
       * transform and its geometry in root space, so the geometry's own
       * bounding sphere *is* a world-space bound and the frustum test is
       * exact. */
      obj.frustumCulled = true;
      stats.wrapped++;
      stats.tris += bent.attributes.position.count / 3;
    }
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    obj.scale.set(1, 1, 1);
    obj.matrixAutoUpdate = true;
  }

  // Baked geometry is in root space now, so every container above it must
  // become the identity or its transform would apply a second time.
  root.traverse((o) => {
    if (o === root || o.isMesh || o.isLine || o.isPoints) return;
    if (o.userData.planetRigid || underRigid(o)) return;
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
  });

  // Re-seat the rigs. Their parents are identity by now, so local is world.
  const fm = new THREE.Matrix4();
  for (const { obj, world } of rigid) {
    world.decompose(_v, _q, _s);
    const b = basisAt(_v.x, _v.z);
    fm.makeBasis(b.east, b.up, b.north);
    obj.position.copy(positionAt(_v.x, _v.y, _v.z, new THREE.Vector3()));
    obj.quaternion.setFromRotationMatrix(fm).multiply(_q);
    obj.scale.copy(_s);
  }

  return stats;
}

/* The globe itself used to be built here, as a bare sphere under a separate
 * terrain grid.  It is `ground.js` now, and it *is* the terrain: one surface,
 * displaced by `heightAt`, coloured by place.  Two surfaces that had to agree
 * to within 65 mm are one surface that cannot disagree with itself. */
