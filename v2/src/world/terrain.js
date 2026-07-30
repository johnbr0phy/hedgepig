import { TAU, clamp, sstep, lerp } from '../core/util.js';
import {
  CIRC, BAND, LAKE, ROAD, TOWN, MIRE, FARM, HENS,
  wrapDelta, bandEdges, lakeAt, roadAt, townAt, placeAmt, placeCentre, ORDER,
} from './plan.js';

/* ------------------------------------------------------------------ *
 * The shape of the ground.
 *
 * One function, `heightAt`, and everything in the world is placed through
 * it: the terrain mesh, the sphere under it, every prop, every blade of
 * grass, the hedgepig's feet.  The reference build learned this the
 * expensive way — it had a displaced sphere *and* a flat terrain grid that
 * disagreed by 65 mm, and the sphere came up through the road.  Here there
 * is only ever one answer to "how high is the ground here", and the sphere
 * is drawn from the same answer, 65 mm lower.
 *
 * Two rules shape the relief:
 *
 *  - **It vanishes at the poles.**  Every term is `cos(odd × latitude)`,
 *    which is exactly zero at ±90°.  All longitudes meet at a pole, so a
 *    relief that did not vanish there would tear.
 *  - **It stays off the field and off the two rings.**  The walked band is
 *    nearly flat; the road and the lake run pole to pole, so each needs a
 *    corridor of its own or a hillside rises through the tarmac.
 * ------------------------------------------------------------------ */

/** Still water sits a little below the flat datum; the bed is dug under it. */
export const WATER_Y = -0.34;
/** How deep the lake bed goes at its middle. */
const LAKE_DEPTH = 1.55;
/** The sphere is drawn this far under the terrain grid, and never meets it. */
export const SPHERE_CLEARANCE = 0.065;

const K = TAU / CIRC;           // metres of arc -> radians, on either axis

/** Corridor mask: 0 on the centreline of a full-width band, 1 well clear. */
function corridor(x, kind, pad = 6) {
  const [a, b] = bandEdges(kind);
  const mid = (a + b) / 2;
  const half = (b - a) / 2;
  return sstep(half + 0.5, half + pad, Math.abs(wrapDelta(x, mid)));
}

/** The big rolling relief, well away from anything built. */
function relief(x, z) {
  const la = x * K;
  const ph = z * K;
  return (
    2.35 * Math.sin(3 * la + 0.7) * Math.cos(ph) +
    0.95 * Math.sin(7 * la - 1.9) * Math.cos(3 * ph) +
    0.40 * Math.sin(13 * la + 2.4) * Math.cos(5 * ph)
  );
}

/**
 * How much relief is allowed here.  Flat across the field, flat along both
 * full-width rings, rising to full strength on the open hillside beyond.
 */
function reliefMask(x, z) {
  let m = sstep(7, 24, Math.abs(z));
  m *= corridor(x, ROAD, 7);
  m *= corridor(x, LAKE, 9);
  m *= corridor(x, TOWN, 7);
  return m;
}

/**
 * The gentle unevenness *inside* the field, so it is not a billiard table.
 *
 * **Every term is periodic in longitude and vanishes at the poles**, which is
 * why they are all `sin(integer × la) · cos(odd × ph)` — **with a phase
 * offset on the longitude and never on the latitude.**  Two of them had one
 * on the latitude at first, `cos(5·ph + 1.1)`, which is a cosine that is
 * emphatically *not* zero at 90°, and it put 74 mm of relief onto the pole
 * where every longitude in the world has to agree on one height.
 *
 * The octave before that was value noise, which is neither periodic nor
 * polar: it left an 80 mm step at the seam where one lap meets the next, a
 * ridge running pole to pole through the butterfly garden that nobody would
 * have found by looking, because it is exactly the size of a molehill.
 * `smoke.js terrain` measures both.
 */
function ripple(x, z) {
  const la = x * K, ph = z * K;
  return (
    0.115 * Math.sin(11 * la + 1.4) * Math.cos(3 * ph) +
    0.062 * Math.sin(23 * la - 0.6) * Math.cos(5 * ph) +
    0.041 * Math.sin(37 * la + 2.7) * Math.cos(ph) +
    0.028 * Math.sin(53 * la - 1.2) * Math.cos(3 * ph)
  );
}

/**
 * Dig the lake: a dish across the band, right across the field and a good way
 * beyond it — but **closed off before the poles**.
 *
 * It was pole to pole at first, which is what "full width" suggests and what
 * makes it an unavoidable wall.  It is unavoidable long before then: the
 * walkable field ends at ±13 m and the graded ground at ±34 m.  Carried all
 * the way out, the basin tore the planet open: every longitude meets at the
 * pole, so a trench 1.55 m deep that exists at some longitudes and not others
 * cannot close, and the ground there was 1.7 m of gash.  It shuts between 34
 * and 46 m of latitude, where there is no water drawn and nothing to see.
 */
function basin(x, z) {
  const l = lakeAt(x);
  if (l <= 0) return 0;
  const polar = sstep(46, 34, Math.abs(z));
  if (polar <= 0) return 0;
  // smoothstep the dish so the shore rises out of the ground rather than
  // meeting it at a lip — the shoreline is then wherever the bed crosses
  // WATER_Y, which is a contour and not a piece of authored geometry
  return -LAKE_DEPTH * sstep(0, 1, l) ** 0.85 * polar;
}

/** The mire is a shallow dish; the farmyard and hen run are graded flat. */
function dishes(x, z) {
  let h = 0;
  h -= 0.22 * placeAmt(x, MIRE) * sstep(BAND + 3, 2, Math.abs(z));
  return h;
}

/** The one answer to how high the ground is at flat coordinates (x, z). */
export function heightAt(x, z) {
  const mask = reliefMask(x, z);
  let h = relief(x, z) * mask;
  // hold the field's own unevenness back from tarmac and paving too
  const hard = Math.max(roadAt(x), townAt(x));
  h += ripple(x, z) * (1 - hard * 0.92);
  h += basin(x, z);
  h += dishes(x, z);
  return h;
}

/** Numerical surface normal, in flat space. Used to sit props on slopes. */
export function slopeAt(x, z, out = { nx: 0, nz: 0 }) {
  const e = 0.35;
  out.nx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  out.nz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return out;
}

/** Depth of standing water at (x, z); 0 on dry land. */
export function waterDepthAt(x, z) {
  if (lakeAt(x) <= 0) return 0;
  return Math.max(0, WATER_Y - heightAt(x, z));
}

export const inWater = (x, z) => waterDepthAt(x, z) > 0.02;

/**
 * Walkable test for the hedgepig.  He may not swim (v1: water is crossed in
 * the boat, never waded), may not leave the field, and may not stand on the
 * tarmac's far verge without having crossed it properly.
 */
export function walkableAt(x, z) {
  if (Math.abs(z) > BAND) return false;
  if (waterDepthAt(x, z) > 0.06) return false;
  return true;
}

/** Where the ground meets the water, for a given latitude — the shoreline. */
export function shoreAt(z, side = -1) {
  const [a, b] = bandEdges(LAKE);
  const from = side < 0 ? a - 4 : b + 4;
  const to = side < 0 ? a + 6 : b - 6;
  let lo = from, hi = to;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (waterDepthAt(mid, z) > 0.02) hi = mid; else lo = mid;
  }
  return lo;
}
