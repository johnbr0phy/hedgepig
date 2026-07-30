import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Hermite smoothstep that tolerates a descending range. */
export function sstep(a, b, v) {
  const t = clamp((v - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Shortest signed way round a circle — v1's `wrapAng`, and it matters for
 *  the same reason: without it he turns the long way to a target behind him. */
export function wrapAng(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** Frame-rate independent approach: `t` is the fraction closed per second. */
export function damp(a, b, rate, dt) {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

/** Deterministic PRNG, so the meadow is the same meadow on every load. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngKit(seed) {
  const r = mulberry32(seed);
  return {
    next: r,
    range: (a, b) => a + (b - a) * r(),
    int: (a, b) => Math.floor(a + (b - a + 1) * r()),
    pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
    chance: (p) => r() < p,
    sign: () => (r() < 0.5 ? -1 : 1),
    // a unit vector in the XZ plane
    dir: () => {
      const a = r() * TAU;
      return [Math.cos(a), Math.sin(a)];
    },
  };
}

/** Cheap value noise on a 2D lattice — used for the terrain and for scatter. */
export function noise2(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const h = (a, b) => {
    let n = Math.imul(a ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul(b ^ seed, 0xc2b2ae35);
    n = Math.imul(n ^ (n >>> 15), 0x2545f491);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return lerp(
    lerp(h(xi, zi), h(xi + 1, zi), u),
    lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u),
    v
  );
}

/**
 * Merge a list of {geometry, matrix} into one buffer geometry — one draw call.
 * Mixed indexed/non-indexed batches are flattened first or the merge rejects
 * them, and attributes not shared by every part are dropped for the same reason.
 */
export function bake(parts) {
  let geos = parts.map(({ geometry, matrix }) => {
    const g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    return g;
  });
  if (!geos.length) return null;
  const indexed = geos.filter((g) => g.index).length;
  if (indexed > 0 && indexed < geos.length) {
    geos = geos.map((g) => {
      if (!g.index) return g;
      const flat = g.toNonIndexed();
      g.dispose();
      return flat;
    });
  }
  const common = geos.reduce(
    (acc, g) => acc.filter((name) => g.attributes[name] !== undefined),
    Object.keys(geos[0].attributes)
  );
  for (const g of geos) {
    for (const name of Object.keys(g.attributes)) {
      if (!common.includes(name)) g.deleteAttribute(name);
    }
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compose a matrix from loose position/euler/scale args. */
export function trs(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _v.set(px, py, pz);
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  return _m.clone().compose(_v, _q, _s);
}

/** A box whose local origin sits at the centre of its base. */
export function boxOnGround(w, h, d, mat) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, mat);
}

export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export function cyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

export function sphere(r, wseg, hseg, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, wseg, hseg), mat);
  m.position.set(x, y, z);
  return m;
}

export function plane(w, h, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * Shadow flags across a subtree.  Transparent meshes are skipped: petals,
 * water and gauze are there to be seen through, and a hard shadow from one
 * of them is worse than no shadow at all.
 */
export function shadowify(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const seeThrough = o.userData.noShadow ||
      (o.material && !Array.isArray(o.material) && o.material.transparent);
    o.castShadow = cast && !seeThrough;
    o.receiveShadow = receive;
  });
  return obj;
}
