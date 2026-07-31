import * as THREE from 'three';
import { clamp, lerp, sstep, TAU } from '../core/util.js';

/* ------------------------------------------------------------------ *
 * The places.
 *
 * v1 had a ring of zones along one axis, and so did the first cut of v2:
 * ten slices of longitude, a walkable band 26 m wide, and hillside you
 * could not enter on either side of it.  That is a corridor wrapped round a
 * globe, and it wastes the globe.
 *
 * **The ten places are the vertices of a pentagonal antiprism** — an
 * icosahedron with its two poles taken off.  Five sit at latitude +26.565°
 * and five at -26.565°, the lower ring turned 36° against the upper one, and
 * the consequence is worth the geometry: *every* place is exactly 63.435° of
 * arc from its five neighbours, which at this radius is **52.9 m**.  There
 * is no seam, no band, no edge and no pole; every square metre of the planet
 * belongs to some place, and you can set off in any direction at all and
 * walk into another one.
 *
 * v1's ordering rule survives intact — **neighbours must share something** —
 * because the antiprism has a zigzag Hamiltonian cycle that steps top, bottom,
 * top, bottom round the five, visiting all ten and closing on itself.  That
 * cycle *is* `ORDER`, so the old walk is still in there as one path among
 * many through an open world.
 *
 * Everything spatial takes (x, z) — still flat authoring coordinates, still
 * metres — and answers by **great-circle distance**, which is exact
 * everywhere including over the poles.  Nothing here has a special case in
 * it any more.
 * ------------------------------------------------------------------ */

/** One lap of the planet, and the radius that follows from it. */
export const CIRC = 300;
export const R = CIRC / TAU;

/** How wide the blend between two places is, in metres of arc. */
export const XF = 9;

/* Place ids.  The names are v1's `ZONE_NAME`, unchanged. */
export const BGARD = 0, WOOD = 1, MGARD = 2, LAKE = 3, MIRE = 4,
             HENS = 5, FARM = 6, ROAD = 7, TOWN = 8, MEADOW = 9;

/**
 * v1's `ORDER`.  Garden into wood, wood into its mushroomy floor, floor into
 * the lake, lake into the mire at its edge, mire into the hens that pick
 * over it, hens into the farm they belong to, farm out onto its road, road
 * into the town it leads to, town back out into the meadow, meadow into the
 * garden.  Laid onto the antiprism's zigzag, consecutive entries are
 * genuinely adjacent on the ground.
 */
export const ORDER = [BGARD, WOOD, MGARD, LAKE, MIRE, HENS, FARM, ROAD, TOWN, MEADOW];
export const COUNT = ORDER.length;

export const PLACE = {
  [BGARD]:  { name: 'the butterfly garden', dens: 1.15, len: 1.05, dry: 0.02, ground: 0x8d9a52 },
  [WOOD]:   { name: 'the wood',             dens: 0.45, len: 0.45, dry: 0.30, ground: 0x6b5434 },
  [MGARD]:  { name: 'the mushroom garden',  dens: 0.72, len: 0.82, dry: 0.04, ground: 0x5f5a3c },
  [LAKE]:   { name: 'the lake',             dens: 0.40, len: 0.62, dry: 0.20, ground: 0x55684c },
  [MIRE]:   { name: 'the mire',             dens: 0.34, len: 0.64, dry: 0.50, ground: 0x54463a },
  [HENS]:   { name: 'the hen run',          dens: 0.32, len: 0.38, dry: 0.55, ground: 0x7c6544 },
  [FARM]:   { name: 'the farmyard',         dens: 0.48, len: 0.50, dry: 0.80, ground: 0x8a7350 },
  [ROAD]:   { name: 'the roadside',         dens: 0.55, len: 0.46, dry: 0.75, ground: 0x74755f },
  [TOWN]:   { name: 'the edge of town',     dens: 0.38, len: 0.38, dry: 0.45, ground: 0x8c8a86 },
  [MEADOW]: { name: 'the long meadow',      dens: 1.25, len: 1.00, dry: 0.00, ground: 0x7d8a4c },
};

/* ------------------------- the sphere, in metres ------------------------- */

/** Unit direction of the flat point (x, z). Equirectangular, exactly as before. */
export function dirAt(x, z, out = new THREE.Vector3()) {
  const la = x / R, ph = z / R;
  const cp = Math.cos(ph);
  return out.set(Math.sin(la) * cp, Math.cos(la) * cp, Math.sin(ph));
}

/** And back again: a direction to the flat coordinates that produced it. */
export function flatOf(dir, out = { x: 0, z: 0 }) {
  out.z = R * Math.asin(clamp(dir.z, -1, 1));
  out.x = R * Math.atan2(dir.x, dir.y);
  return out;
}

/** Great-circle distance in metres between two directions. */
export const arcBetween = (a, b) => R * Math.acos(clamp(a.dot(b), -1, 1));

/* ---------------------------- the ten centres ---------------------------- */

/** Latitude of an icosahedron's two rings: atan(1/2), 26.565°. */
const RING_LAT = Math.atan(0.5);

/**
 * The antiprism, and the zigzag through it.  Index i of `ORDER` goes to the
 * upper ring when i is even and the lower ring when it is odd, stepping one
 * fifth of the way round every two places — so consecutive places are always
 * one antiprism edge apart, and the tenth closes back onto the first.
 */
export const CENTRE = {};
export const CENTRES = [];
{
  for (let i = 0; i < COUNT; i++) {
    const kind = ORDER[i];
    const upper = i % 2 === 0;
    const step = Math.floor(i / 2);
    const lat = upper ? RING_LAT : -RING_LAT;
    const lon = (step / 5) * TAU + (upper ? 0 : TAU / 10);
    const dir = new THREE.Vector3(
      Math.cos(lat) * Math.sin(lon),
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat)
    );
    const flat = flatOf(dir);
    const c = { kind, dir, x: flat.x, z: flat.z, name: PLACE[kind].name };
    CENTRE[kind] = c;
    CENTRES.push(c);
  }
}

/** Flat coordinates `u` metres east and `v` metres north of a place's centre.
 *
 * This is the exponential map, not a tangent-plane approximation: a place is
 * 26 m across on a 47.75 m sphere, which is 32° of arc, and a flat offset
 * would be several metres out at the rim.  Builders lay their content out in
 * (u, v) exactly as they used to lay it out in (x, z), and this puts it on
 * the globe. */
const _e = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 0, 1);
export function offsetFrom(centre, u, v, out = { x: 0, z: 0 }) {
  const c = centre.dir ? centre.dir : centre;
  // an east/north frame at the centre; +z is the polar axis of the mapping
  _e.crossVectors(_up, c);
  if (_e.lengthSq() < 1e-9) _e.set(1, 0, 0);
  _e.normalize();
  _n.crossVectors(c, _e).normalize();

  const d = Math.hypot(u, v);
  if (d < 1e-9) return flatOf(c, out);
  const ang = d / R;
  _p.copy(c).multiplyScalar(Math.cos(ang))
    .addScaledVector(_e, (Math.sin(ang) * u) / d)
    .addScaledVector(_n, (Math.sin(ang) * v) / d);
  return flatOf(_p.normalize(), out);
}

/** How far (x, z) is from a place's centre, in metres of arc. */
const _q = new THREE.Vector3();
export function arcTo(centre, x, z) {
  dirAt(x, z, _q);
  return arcBetween(_q, centre.dir);
}

/* ------------------------------ the blend ------------------------------ */

/**
 * How much of each place is in force at (x, z).  The weights sum to one.
 *
 * **Every place is weighed, not just the nearest two.**  Nearest-and-second
 * is the obvious way to do a soft Voronoi and it has one fatal degeneracy:
 * where three or more regions meet, which centre comes *second* is decided
 * by floating-point noise, and any quantity that reads a particular place's
 * weight jumps as it flips.  On this layout the two poles are **five-way
 * ties** — every upper centre is exactly 63.435° from the north pole — so
 * the ground had a 12 cm step at each of them and the seam test caught it
 * from the other side of the planet.
 *
 * A falloff weight against the *nearest* distance has no such seam: it is
 * continuous everywhere, it reduces to an ordinary two-way crossfade when
 * only two places are near, and at a tie it simply gives every tied place an
 * equal share, which is what a tie means.
 */
const _d = new THREE.Vector3();
const _dist = new Float64Array(COUNT);
export function placeWeights(x, z, out = new Float64Array(COUNT)) {
  dirAt(x, z, _d);
  let nearest = Infinity;
  for (let i = 0; i < COUNT; i++) {
    const d = R * Math.acos(clamp(_d.dot(CENTRES[i].dir), -1, 1));
    _dist[i] = d;
    if (d < nearest) nearest = d;
  }
  let sum = 0;
  for (let i = 0; i < COUNT; i++) {
    // squared, so the weight leaves zero smoothly rather than with a corner
    const k = Math.max(0, 1 - (_dist[i] - nearest) / XF);
    const w = k * k;
    out[CENTRES[i].kind] = w;
    sum += w;
  }
  for (let i = 0; i < COUNT; i++) out[i] /= sum;
  return out;
}

const _wt = new Float64Array(COUNT);

/**
 * Which place is this, and what is it turning into?  The two heaviest
 * weights, for naming and for anything that wants a simple pair.
 */
export function placeAt(x, z) {
  placeWeights(x, z, _wt);
  let a = 0, b = 1;
  if (_wt[1] > _wt[0]) { a = 1; b = 0; }
  for (let i = 2; i < COUNT; i++) {
    if (_wt[i] > _wt[a]) { b = a; a = i; }
    else if (_wt[i] > _wt[b]) { b = i; }
  }
  const t = _wt[a] + _wt[b] > 0 ? _wt[b] / (_wt[a] + _wt[b]) : 0;
  return { a, b, t, wa: _wt[a], wb: _wt[b] };
}

/** A named property of the place at (x, z), blended over all of them. */
export function placeProp(x, z, key) {
  placeWeights(x, z, _wt);
  let v = 0;
  for (let i = 0; i < COUNT; i++) if (_wt[i] > 0) v += _wt[i] * PLACE[i][key];
  return v;
}

/** How much of place `kind` is in force at (x, z). */
export function placeAmt(x, z, kind) {
  placeWeights(x, z, _wt);
  return _wt[kind];
}

/** The place you would name if asked — the nearest centre, no blending. */
export function placeKindAt(x, z) {
  const m = placeAt(x, z);
  return m.t > 0.5 ? m.b : m.a;
}

/* ------------------------- the two hard surfaces ------------------------- */

/**
 * The lake is **a lake**, not an ocean: a disc you can walk round.
 *
 * In the banded world it ran the full width of the field and was therefore
 * an unavoidable wall, which is what earned it the boat.  Open the world and
 * that reasoning evaporates — so the boat stays as the *short* way over
 * rather than the only way, which is a better thing for it to be.
 */
export const LAKE_R = 13.5;
const LAKE_EDGE = 7.0;
export function lakeAt(x, z) {
  const d = arcTo(CENTRE[LAKE], x, z);
  return 1 - sstep(LAKE_R - LAKE_EDGE, LAKE_R, d);
}

/**
 * The road, on the other hand, is **still a ring**: the great circle through
 * the roadside and the town, which is where a road on a small planet would
 * go and which keeps v1's sharpest rule alive.  It cannot be walked round,
 * so it has to be crossed — and there is a culvert under it for anyone who
 * would rather not try the tarmac.
 */
export const ROAD_HALF = 4.8;
const ROAD_EDGE = 1.6;
export const ROAD_AXIS = new THREE.Vector3()
  .crossVectors(CENTRE[ROAD].dir, CENTRE[TOWN].dir).normalize();
/** Along-ring reference frame: A at the roadside's centre, B a quarter turn on. */
export const ROAD_A = CENTRE[ROAD].dir.clone();
export const ROAD_B = new THREE.Vector3().crossVectors(ROAD_AXIS, ROAD_A).normalize();

/** Signed metres across the road: 0 on the centreline, + on the town side. */
export function roadOffset(x, z) {
  dirAt(x, z, _d);
  return R * Math.asin(clamp(_d.dot(ROAD_AXIS), -1, 1));
}

/** Metres along the road from the roadside's centre, wrapping at one lap. */
export function roadAlong(x, z) {
  dirAt(x, z, _d);
  return R * Math.atan2(_d.dot(ROAD_B), _d.dot(ROAD_A));
}

/** Flat coordinates of the point `along` metres round the road, `across` off it. */
export function roadPoint(along, across, out = { x: 0, z: 0 }) {
  const a = along / R, b = across / R;
  _p.set(0, 0, 0)
    .addScaledVector(ROAD_A, Math.cos(a) * Math.cos(b))
    .addScaledVector(ROAD_B, Math.sin(a) * Math.cos(b))
    .addScaledVector(ROAD_AXIS, Math.sin(b));
  return flatOf(_p.normalize(), out);
}

export function roadAt(x, z) {
  return 1 - sstep(ROAD_HALF - ROAD_EDGE, ROAD_HALF, Math.abs(roadOffset(x, z)));
}

/** The town's paving: a disc, like the lake. */
export const TOWN_R = 11;
export function townAt(x, z) {
  return 1 - sstep(TOWN_R - 4, TOWN_R, arcTo(CENTRE[TOWN], x, z));
}

/** Ground that grass will not grow on, and brambles must not seed on. */
export const hardAt = (x, z) => Math.max(lakeAt(x, z), roadAt(x, z), townAt(x, z));

/* ------------------------------ longitude ------------------------------ */

/** Shortest signed difference between two longitudes, in metres of arc. */
export function wrapDelta(a, b) {
  let d = a - b;
  while (d > CIRC / 2) d -= CIRC;
  while (d < -CIRC / 2) d += CIRC;
  return d;
}

/**
 * True distance between two flat points, over the surface.
 *
 * Not `hypot(wrapDelta(x), dz)` — that is only right near the equator, and
 * with content spread over the whole globe it is wrong by a factor of
 * `cos(latitude)` in x.  Everything that measures "how far is he from that"
 * must come through here.
 */
const _r1 = new THREE.Vector3();
const _r2 = new THREE.Vector3();
export function distance(x1, z1, x2, z2) {
  dirAt(x1, z1, _r1);
  dirAt(x2, z2, _r2);
  return arcBetween(_r1, _r2);
}

/**
 * The point `dist` metres of arc from (x1, z1) along the great circle toward
 * (x2, z2).  A true slerp, not a lerp-and-normalise: the callers use it to
 * park him a stated distance from something solid, and an approximation there
 * puts him a stated distance *inside* it.
 *
 * Degenerate cases return the start point, so a caller that asks to step
 * toward where it already is gets an answer rather than a NaN.
 */
const _s1 = new THREE.Vector3();
const _s2 = new THREE.Vector3();
export function towards(x1, z1, x2, z2, dist, out = { x: 0, z: 0 }) {
  dirAt(x1, z1, _s1);
  dirAt(x2, z2, _s2);
  const ang = Math.acos(clamp(_s1.dot(_s2), -1, 1));
  const s = Math.sin(ang);
  if (!(s > 1e-7)) return flatOf(_s1, out);
  const f = clamp(dist / R, 0, ang);
  _p.copy(_s1).multiplyScalar(Math.sin(ang - f) / s)
    .addScaledVector(_s2, Math.sin(f) / s);
  return flatOf(_p.normalize(), out);
}

/** Unit heading from one flat point toward another, in the first one's frame. */
export function bearing(x1, z1, x2, z2) {
  dirAt(x1, z1, _r1);
  dirAt(x2, z2, _r2);
  // east and north at the first point
  _e.set(Math.cos(x1 / R), -Math.sin(x1 / R), 0);
  const la = x1 / R, ph = z1 / R;
  _n.set(-Math.sin(la) * Math.sin(ph), -Math.cos(la) * Math.sin(ph), Math.cos(ph));
  // the component of the second direction in that tangent plane
  _p.copy(_r2).addScaledVector(_r1, -_r2.dot(_r1));
  const east = _p.dot(_e);
  const north = _p.dot(_n);
  const len = Math.hypot(east, north) || 1;
  return { east: east / len, north: north / len, angle: Math.atan2(north, east) };
}
