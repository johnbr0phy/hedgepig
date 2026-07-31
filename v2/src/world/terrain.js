import * as THREE from 'three';
import { clamp, sstep } from '../core/util.js';
import {
  R, CENTRE, LAKE, FARM, HENS, MIRE, MGARD, MEADOW,
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

/* Octaves of rolling ground, as directions on the sphere.  `f` is how many
 * times the wave repeats from one side of the planet to the other, which
 * makes the surface wavelength about `471 / f` metres.
 *
 * **The whole planet used to have 1.44 m of relief** — four octaves summing
 * to less than a metre and a half, on a world 300 m round, walked by an
 * animal 26 cm long.  Nothing was ever hidden behind anything: you could see
 * the entire visible world from anywhere in it, and it read as one flat
 * green wash however much was scattered on it.  That is most of what
 * "sparse" turned out to mean.
 *
 * It is 3.4 m now, over six octaves, and the gain is at the *middle* ones:
 * 24 m and 41 m wavelengths are features 12 to 20 metres across, which is
 * the scale you actually meet against an eleven-metre horizon.  You crest
 * things now, and things go out of sight behind them.
 *
 * Two limits worth knowing before raising it further:
 *
 *  - **The globe mesh resolves about 1.7 m.**  `DETAIL = 32` is 21 780 faces
 *    over 28 650 m²; anything sharper than roughly 3.5 m across comes out
 *    faceted.  There is a lot of headroom left — the coarsest octave here is
 *    14 m — but a cliff is not available at this mesh density.
 *  - **`walkableAt` refuses water and nothing else.**  No slope can stop him,
 *    so relief has to be self-limiting: the steepest gradient this sums to is
 *    about 0.30, or 17°, which is a hill rather than a wall.
 */
const WAVES = [
  { d: new THREE.Vector3(0.42, 0.79, 0.44).normalize(), f: 1.7, a: 1.45, p: 0.7 },
  { d: new THREE.Vector3(-0.83, 0.31, 0.46).normalize(), f: 3.1, a: 0.95, p: 2.1 },
  { d: new THREE.Vector3(0.29, -0.51, 0.81).normalize(), f: 6.2, a: 0.62, p: 4.4 },
  { d: new THREE.Vector3(-0.36, -0.72, 0.59).normalize(), f: 11.4, a: 0.34, p: 1.3 },
  { d: new THREE.Vector3(0.77, 0.18, -0.61).normalize(), f: 19.8, a: 0.155, p: 5.6 },
  { d: new THREE.Vector3(-0.14, 0.88, -0.45).normalize(), f: 34.0, a: 0.072, p: 3.0 },
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
  /* **The grading ramp is a cliff if it is short enough.**  This was
   * `sstep(4.8, 9.5)` — the whole relief faded in over 4.7 m — which at the
   * old 1.44 m of relief was a gentle verge and at 3.4 m is a 38° bank
   * running the entire way round the planet.  The steepest ground on the
   * world was not a hill; it was the edge of the road's own flat corridor.
   *
   * A mask that grades relief to zero has a gradient of about
   * `relief × 1.5 / width`, so the width has to scale with the relief.  Any
   * future landform that is taller than this one wants checking here first. */
  let m = sstep(5.0, 26.0, Math.abs(roadOffset(x, z)));
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

/* ------------------------------ landforms ------------------------------ *
 *
 * **A place with its own shape.**  The relief above is one wave field over
 * the whole planet, so every place had the same ground as every other and
 * differed only in what was scattered on it.  A landform is a term that
 * belongs to *one* place, faded in by that place's own weight — which is the
 * same trick `basin` and `dishes` already use for the lake and the mire, and
 * it inherits their two good properties: it is continuous everywhere, and it
 * needs no seam because `placeWeights` has none.
 *
 * Each one is written as a function of `dot(surface direction, axis)`, for
 * the reason the whole relief is: that form is smooth and single-valued over
 * a sphere by construction, so a landform cannot be written here that breaks
 * at a pole or at a longitude seam.
 *
 * Multiplied by a weight that reaches zero at the place's edge, so no
 * landform can ever step against its neighbour.
 */

/** An axis across a place, for laying a ridge or a valley along. */
function acrossAxis(centre, turn = 0) {
  const up = new THREE.Vector3(0, 0, 1);
  const e = new THREE.Vector3().crossVectors(up, centre.dir);
  if (e.lengthSq() < 1e-9) e.set(1, 0, 0);
  e.normalize();
  const n = new THREE.Vector3().crossVectors(centre.dir, e).normalize();
  return e.multiplyScalar(Math.cos(turn)).addScaledVector(n, Math.sin(turn)).normalize();
}

/** A gaussian bank: `a` metres high, `w` metres wide, centred `at` metres along. */
const bank = (t, at, w, a) => a * Math.exp(-(((t - at) / w) ** 2));

/* The long meadow: a ridge you walk over with a hollow behind it.  On a
 * planet whose horizon is eleven metres, a two-metre ridge is genuinely
 * something to be on the other side of. */
const MEADOW_AXIS = acrossAxis(CENTRE[MEADOW], 0.6);
function meadowForm(n) {
  const t = n.dot(MEADOW_AXIS) * R;
  return bank(t, 6.0, 11.0, 1.90) - bank(t, -9.0, 12.0, 1.00) + bank(t, 21, 8.0, 0.70);
}

function landform(x, z) {
  let h = 0;
  const wm = placeAmt(x, z, MEADOW);
  if (wm > 0.004) h += meadowForm(_n) * wm;
  return h;
}

/** The one answer to how high the ground is at flat coordinates (x, z). */
export function heightAt(x, z) {
  dirAt(x, z, _n);
  let h = relief(_n) * reliefMask(x, z);
  h += landform(x, z) * reliefMask(x, z);
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
