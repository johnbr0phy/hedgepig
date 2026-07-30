import * as THREE from 'three';
import { clamp, sstep } from '../core/util.js';
import {
  R, CENTRE, LAKE, FARM, HENS, MIRE, MGARD,
  dirAt, lakeAt, townAt, roadOffset, placeAmt, offsetFrom,
} from './plan.js';

/* ------------------------------------------------------------------ *
 * The shape of the ground.
 *
 * One function, `heightAt`, and everything is placed through it: the globe
 * itself, every prop, every blade of grass, his feet.  There is exactly one
 * answer to how high the ground is anywhere — the rule the reference build
 * learned expensively, when its displaced sphere and its flat grid disagreed
 * by 65 mm and the sphere came up through the road.
 *
 * **The relief is a function of the surface direction, not of latitude and
 * longitude.**  That one change deletes every special case the banded
 * version needed: no seam to close where one lap meets the next, no terms
 * that have to vanish at the poles, no corridor arithmetic that falls apart
 * where the longitudes converge.  A sum of sines of `dot(n, D)` is smooth
 * and single-valued over the whole sphere by construction — **neither of the
 * two bugs the harness found in the old version can be written in this
 * form**, which is a better outcome than fixing them was.
 * ------------------------------------------------------------------ */

/** Still water sits a little below the flat datum; the bed is dug under it. */
export const WATER_Y = -0.34;
const LAKE_DEPTH = 1.5;

/* Four octaves of rolling ground, as directions on the sphere.  The
 * frequencies are how many times the wave repeats from one side of the
 * planet to the other, so the longest is about a 60 m swell and the shortest
 * about 10 m. */
const WAVES = [
  { d: new THREE.Vector3(0.42, 0.79, 0.44).normalize(), f: 2.6, a: 0.86, p: 0.7 },
  { d: new THREE.Vector3(-0.83, 0.31, 0.46).normalize(), f: 5.1, a: 0.36, p: 2.1 },
  { d: new THREE.Vector3(0.29, -0.51, 0.81).normalize(), f: 9.3, a: 0.155, p: 4.4 },
  { d: new THREE.Vector3(-0.36, -0.72, 0.59).normalize(), f: 15.7, a: 0.065, p: 1.3 },
];

const _n = new THREE.Vector3();

function relief(dir) {
  let h = 0;
  for (const w of WAVES) h += w.a * Math.sin(dir.dot(w.d) * w.f + w.p);
  return h;
}

/**
 * How much relief survives here.  Built ground is graded flat, and the road
 * gets a corridor of its own because it circles the planet and is laid at a
 * fixed height across its whole width.
 */
function reliefMask(x, z) {
  let m = sstep(4.8, 9.5, Math.abs(roadOffset(x, z)));
  m *= 1 - 0.92 * townAt(x, z);
  m *= 1 - 0.85 * placeAmt(x, z, FARM);
  m *= 1 - 0.80 * placeAmt(x, z, HENS);
  return clamp(m, 0, 1);
}

/** Dig the lake: a radially symmetric dish about its own centre. */
function basin(x, z) {
  const l = lakeAt(x, z);
  if (l <= 0) return 0;
  /* No exponent on the smoothstep.  `l ** 0.8` has an infinite gradient as
   * `l` leaves zero, which put a 0.9 m/m cliff round the whole waterline —
   * walkable by the letter of `walkableAt` and horrible. */
  return -LAKE_DEPTH * sstep(0, 1, l);
}

/** The mire is a shallow dish, and the mushroom garden dips a little. */
function dishes(x, z) {
  return -0.24 * placeAmt(x, z, MIRE) - 0.08 * placeAmt(x, z, MGARD);
}

/** The one answer to how high the ground is at flat coordinates (x, z). */
export function heightAt(x, z) {
  dirAt(x, z, _n);
  let h = relief(_n) * reliefMask(x, z);
  h += basin(x, z);
  h += dishes(x, z);
  return h;
}

/**
 * Numerical surface normal, in flat space.
 *
 * The x step is divided by `cos(latitude)`: a metre of longitude is only a
 * metre of ground at the equator, and near the poles it is almost nothing.
 * Without that, everything sitting on a slope leans harder and harder the
 * further north it is placed.
 */
export function slopeAt(x, z, out = { nx: 0, nz: 0 }) {
  const e = 0.3;
  const cs = Math.max(0.05, Math.cos(z / R));
  out.nx = (heightAt(x + e / cs, z) - heightAt(x - e / cs, z)) / (2 * e);
  out.nz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return out;
}

/** Depth of standing water at (x, z); 0 on dry land. */
export function waterDepthAt(x, z) {
  if (lakeAt(x, z) <= 0) return 0;
  return Math.max(0, WATER_Y - heightAt(x, z));
}

export const inWater = (x, z) => waterDepthAt(x, z) > 0.02;

/**
 * Walkable test.
 *
 * **There is no edge to the world any more.**  He may not swim — v1's rule,
 * water is crossed in the boat and never waded — and the game may put things
 * in his way, and that is the whole list.  Everywhere else on the planet, in
 * any direction, for as far as he likes, is his.
 */
export function walkableAt(x, z) {
  return waterDepthAt(x, z) <= 0.06;
}

/**
 * Where the water's edge is, `bearing` radians round from the lake's centre.
 * Bisected against the same `waterDepthAt` everything else uses, so the
 * shoreline stays a contour and not a piece of authored geometry.
 */
export function lakeShore(bearing) {
  const at = (d) => offsetFrom(CENTRE[LAKE], Math.cos(bearing) * d, Math.sin(bearing) * d);
  let lo = 0, hi = 22;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    if (waterDepthAt(p.x, p.z) > 0.02) lo = mid; else hi = mid;
  }
  const p = at(hi);
  return { d: hi, x: p.x, z: p.z };
}
