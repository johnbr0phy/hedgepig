import * as THREE from 'three';
import { clamp, sstep } from '../core/util.js';
import {
  R, COUNT, CENTRE, BGARD, WOOD, MGARD, LAKE, MIRE, HENS, FARM, ROAD, TOWN, MEADOW,
  dirAt, lakeAt, townAt, roadOffset, placeWeights, offsetFrom, ROAD_AXIS,
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
 *
 * This grades the *wave field* only — the noise — and not the landforms
 * below, which are drawn by hand and graded by hand.  See the landform
 * section for why that separation had to exist.
 *
 * `w` is the place weights, already computed once by `heightAt`.
 */
function reliefMask(x, z, w) {
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
  m *= 1 - 0.85 * w[FARM];
  m *= 1 - 0.80 * w[HENS];
  /* And the mire, which is the one *natural* place that has to be flat: a
   * mire is what a hollow does when nothing drains out of it, and thirty-four
   * puddles laid as flat discs on ground with 1.9 m of wave in it float at
   * one edge and sink at the other.  Half, not all — a mire with no shape at
   * all is a car park. */
  m *= 1 - 0.50 * w[MIRE];
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
function dishes(w) {
  return -0.24 * w[MIRE] - 0.08 * w[MGARD];
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
 *
 * **Landforms do not go through `reliefMask`, and that is not an oversight.**
 * The first cut of this passed them through it with the waves, and four of
 * the ten places came out wrong in ways that took a map to see.  The road is
 * a great circle through the roadside, the town, *the mushroom garden and the
 * middle of the lake* — four of the ten centres lie on it — so the corridor
 * that keeps the tarmac flat was cutting a ten-metre causeway straight
 * through the middle of the hollow and the basin.  `basin` and `dishes` have
 * always escaped the mask for exactly that reason; a landform is the same
 * kind of thing.  And the farm, the hens and the town are damped to 15–20 %
 * there, which turned "a flat pad standing on a rise" into a saucer with a
 * raised rim, because the damping lifts as the place's weight falls.
 *
 * So the mask grades the *noise*, and each landform grades itself.  The bill
 * for that is real and is paid here: nothing else is checking these, and the
 * two numbers that matter — 0.22 m of rise per 0.4 m of ground, and the
 * relief floor — are both in `smoke.js terrain`.
 *
 * Two rules came out of drawing ten of them:
 *
 *  - **What a form is worth at the place's rim is a scarp all the way round
 *    it.**  The weight goes 1 → 0.5 over about 4.5 m, so a form still worth a
 *    metre out at 22 m lays a 0.1 m/m ring round the place — invisible in the
 *    code and perfectly visible on the ground.  Every form here is written to
 *    come back to something small before it gets there, which is why several
 *    of them are a shelf up followed by a shelf down.
 *  - **A radial form has to be flat at its own centre.**  Distance from a
 *    centre has a corner at zero, so anything with a slope in it becomes a
 *    cone point standing in the middle of the place.  `pad` and a `bank`
 *    centred on zero both are flat there; `shelf(d, …)` would not be.
 */

/** The east/north frame at a place's centre — the one the builders lay their
 *  (u, v) out in, so a turn measured here means the same thing there. */
function placeFrame(centre) {
  const up = new THREE.Vector3(0, 0, 1);
  const e = new THREE.Vector3().crossVectors(up, centre.dir);
  if (e.lengthSq() < 1e-9) e.set(1, 0, 0);
  e.normalize();
  return { e, n: new THREE.Vector3().crossVectors(centre.dir, e).normalize() };
}

/** An axis across a place, for laying a ridge or a valley along. */
function acrossAxis(centre, turn = 0) {
  const { e, n } = placeFrame(centre);
  return e.multiplyScalar(Math.cos(turn)).addScaledVector(n, Math.sin(turn)).normalize();
}

/**
 * The turn that aims that axis at something — a neighbouring place, the road.
 *
 * Seven of the ten below are aimed at something `plan.js` already knows —
 * five at a neighbouring place, two at the road — and the first cut had
 * their bearings as measured constants: `-2.83`, `2.20`, `-0.94`.  Every one
 * of those is a fact about the antiprism, and the antiprism is in `plan.js`;
 * writing them down here is the same class of mistake as a feature finding
 * his face with a literal.  Move a centre and these follow it.
 *
 * The other three — the meadow, the lake, the mire — are aimed at something
 * a *builder* laid out, so they stay as turns in the place's own (u, v): the
 * lake's east is where the jetty is, and the mire's north is across the line
 * of stepping stones.
 */
function turnToward(centre, dir) {
  const { e, n } = placeFrame(centre);
  return Math.atan2(dir.dot(n), dir.dot(e));
}
const towardPlace = (from, to) => turnToward(CENTRE[from], CENTRE[to].dir);

/** A gaussian bank: `a` metres high, `w` metres wide, centred `at` metres along. */
const bank = (t, at, w, a) => a * Math.exp(-(((t - at) / w) ** 2));

/** A shelf: flat at nothing below `at - w`, flat `a` metres up above `at + w`.
 *  A step down is a shelf with a negative `a`; a table is one of each. */
const shelf = (t, at, w, a) => a * sstep(at - w, at + w, t);

/** A round pad: `a` metres up out to radius `r`, off the edge over a `w` skirt. */
const pad = (d, r, w, a) => a * (1 - sstep(r - w, r + w, d));

/** Metres of arc from a place's centre — still a function of `dot(n, axis)`. */
const arcOf = (n, centre) => R * Math.acos(clamp(n.dot(centre.dir), -1, 1));

/* The long meadow: a ridge you walk over with a hollow behind it.  On a
 * planet whose horizon is eleven metres, a two-metre ridge is genuinely
 * something to be on the other side of. */
const MEADOW_AXIS = acrossAxis(CENTRE[MEADOW], 0.6);
function meadowForm(n) {
  const t = n.dot(MEADOW_AXIS) * R;
  return bank(t, 6.0, 11.0, 1.90) - bank(t, -9.0, 12.0, 1.00) + bank(t, 21, 8.0, 0.70);
}

/* The butterfly garden: terraced.  One broad step down, with the four beds
 * straddling the riser, and a bank across the top of the slope, because a
 * garden with butterflies in it is a garden with something taking the wind
 * off.
 *
 * **The step runs the way the ground already falls, and it had to be turned
 * round to get there.**  Cut the other way it was worth nothing: the wave
 * field drops 1.7 m across this place toward the mushroom garden, a step of
 * 0.95 m against it very nearly cancelled, and the garden measured *flatter*
 * with a terrace in it than without one.  Which is the honest lesson —
 * a terrace is what you make when the ground is already sloping, so a
 * landform's first question is which way the relief under it goes. */
const BGARD_AXIS = acrossAxis(CENTRE[BGARD], towardPlace(BGARD, MEADOW) + Math.PI);
function gardenForm(n) {
  const t = n.dot(BGARD_AXIS) * R;
  return shelf(t, 3, 5.0, -0.90) + bank(t, -13, 6.0, 0.70);
}

/* The wood: the ground climbs as you go in, all the way to a bank across the
 * back of it.  Trees on a rise are visible from much further off than trees
 * on the flat, which is most of what makes a wood somewhere you head for. */
const WOOD_AXIS = acrossAxis(CENTRE[WOOD], towardPlace(WOOD, LAKE));
function woodForm(n) {
  const t = n.dot(WOOD_AXIS) * R;
  return pad(arcOf(n, CENTRE[WOOD]), 8, 8, 1.60) + bank(t, 14, 5.0, 1.30);
}

/* The mushroom garden: a damp hollow at the foot of the wood's rise, with
 * the wood's side of it a metre higher than the lake's, so it sits in the
 * lee of the hill and everything that falls on the hill ends up in it.  The
 * dish `dishes` digs is 80 mm; this is what gives it a shape. */
const MGARD_AXIS = acrossAxis(CENTRE[MGARD], towardPlace(MGARD, WOOD));
function mgardForm(n) {
  const t = n.dot(MGARD_AXIS) * R;
  return -pad(arcOf(n, CENTRE[MGARD]), 8, 8, 1.25) + shelf(t, 0, 14, 1.00);
}

/* The lake: a steep bank up one side and a long shingle slope opposite,
 * which is what a pond in a field looks like — one side undercut, one side
 * walked into by everything that drinks there.
 *
 * Both terms are worth nothing at the middle on purpose: the basin is dug to
 * a depth, and a landform that lifted the centre would silently drain it.
 *
 * **The bank is a shelf and not a gaussian, and that is the whole reason it
 * fits.**  `basin` already spends 0.152 of the 0.22 ceiling on its own rim at
 * the waterline, so anything with a tail there adds straight onto it — a
 * gaussian crest 5 m back from the water measured **0.262**, half again over
 * the limit, and no amplitude that still read as a bank got it under.  A
 * smoothstep has compact support: it is *exactly* flat below its riser, so
 * the bank can start a metre outside the waterline and owe the basin nothing.
 * Negating `t` puts the riser on the far side from the shingle.
 *
 * The shingle is the same shape at a third of the pitch, and it is a shelf
 * for a second reason: **anything that lifts the ground near the waterline
 * drags the waterline inward, onto a steeper part of the dish.**  A wide
 * gaussian worth half a metre at the shore pulled it in from 10.85 m to
 * 10.10 m and the rise there went from 0.152 to 0.207 — the lake got
 * *smaller* and *steeper* from a term whose whole purpose was to be gentle,
 * and nothing about it looked like a mistake. */
const LAKE_AXIS = acrossAxis(CENTRE[LAKE], 0);      // +t is the jetty's side
function lakeForm(n) {
  const t = n.dot(LAKE_AXIS) * R;
  return shelf(-t, 16.5, 3.75, 1.55) + shelf(t, 20, 8.0, 0.60);
}

/* The mire: flat and low — `reliefMask` holds the waves down here — with two
 * tussocky swells, set either side of the line of stepping stones rather
 * than across it.  A swell you have to climb over on the one dry route is a
 * landform arguing with a builder. */
const MIRE_AXIS = acrossAxis(CENTRE[MIRE], Math.PI / 2);   // across the stones
function mireForm(n) {
  const t = n.dot(MIRE_AXIS) * R;
  return bank(t, -11, 5.0, 0.42) + bank(t, 9, 4.2, 0.34);
}

/* The hen run: the yard is levelled a metre up, and the ground falls off it
 * on the side away from the farm — so you walk in on the level from the
 * farmyard and the run stands over everything on the mire side. */
const HENS_AXIS = acrossAxis(CENTRE[HENS], towardPlace(HENS, FARM) + Math.PI);
function hensForm(n) {
  const t = n.dot(HENS_AXIS) * R;
  return shelf(t, -19, 8.0, 1.15) - shelf(t, 10, 4.0, 1.15);
}

/* The farmyard: a flat pad standing on a rise.  The pad is the yard — a
 * barn, a trough and a gate all want one plane under them — and the rise is
 * set a little to one side of it, so it reads as a hill somebody levelled
 * the top of rather than as a cone with a farm on it. */
const FARM_AXIS = acrossAxis(CENTRE[FARM], towardPlace(FARM, TOWN));
function farmForm(n) {
  const t = n.dot(FARM_AXIS) * R;
  return pad(arcOf(n, CENTRE[FARM]), 11.5, 5.0, 1.25) + bank(t, -9, 14, 0.40);
}

/* The roadside: a cutting.  A bank either side and the tarmac down between
 * them, which is the one piece of ground on this planet that is there
 * because somebody dug it.  Laid on the road's own across-axis, so both
 * banks run parallel to the carriageway; they are worth 45 mm on the
 * centreline, so the road itself stays as flat as the corridor made it. */
/* **Read off `roadOffset`, not off a fixed axis.**  This used to project onto
 * `ROAD_ACROSS`, a single vector square to the road at the roadside's centre,
 * which is exact only while the road is a great circle.  It is not one any
 * more — see the bend in `plan.js` — so a fixed axis would have left these
 * two banks running dead straight through the lake while the carriageway
 * they belong to curved away from it. */
function roadForm(n, x, z) {
  const t = roadOffset(x, z);
  return bank(t, -12, 6.0, 1.15) + bank(t, 12.5, 6.5, 0.95);
}

/* The town: the ground steps up, twice, to where the terrace stands, and the
 * square and the wall and the cat stay down on the lower step.
 *
 * The axis is the road's own *along* direction and that is the whole trick.
 * Step across the road and the tarmac is banked over its 9.6 m width by the
 * full height of the riser; step along it and the street simply climbs, which
 * is what a street in a town on a hill does. */
const TOWN_AXIS = acrossAxis(CENTRE[TOWN], turnToward(CENTRE[TOWN], ROAD_AXIS) + Math.PI / 2);
function townForm(n) {
  const t = n.dot(TOWN_AXIS) * R;
  return shelf(t, 3.0, 2.8, 0.80) + shelf(t, 12, 3.5, 0.45);
}

/**
 * Every place's own shape, weighed by how much of that place is here.
 *
 * The weights are **exactly** zero for any place more than `XF` further off
 * than the nearest one, so this loop does two or three of these at a typical
 * point and never all ten.  That exactness is why there is no epsilon cutoff
 * any more: the old `> 0.004` test dropped a term that was worth up to 6 mm,
 * which is a step, and this file's whole claim is that it has none.
 */
const FORMS = [
  [MEADOW, meadowForm], [BGARD, gardenForm], [WOOD, woodForm], [MGARD, mgardForm],
  [LAKE, lakeForm], [MIRE, mireForm], [HENS, hensForm], [FARM, farmForm],
  [ROAD, roadForm], [TOWN, townForm],
];

/* The flat coordinates go through as well as the direction, because the road
 * reads its own across-offset and that is a function of (x, z).  Only the
 * road wants them, and only where its weight is non-zero, so it costs
 * nothing anywhere else on the planet. */
function landform(n, w, x, z) {
  let h = 0;
  for (let i = 0; i < FORMS.length; i++) {
    const a = w[FORMS[i][0]];
    if (a > 0) h += FORMS[i][1](n, x, z) * a;
  }
  return h;
}

/** The one answer to how high the ground is at flat coordinates (x, z).
 *
 * The place weights are worked out **once** and handed to everything that
 * wants them.  They used to be recomputed by every caller — `reliefMask`
 * twice, `dishes` twice, `landform` once — and each call is ten arc-cosines,
 * so the cheapest way to make ten landforms affordable was to stop asking
 * the same question five times. */
const _w = new Float64Array(COUNT);

export function heightAt(x, z) {
  dirAt(x, z, _n);
  placeWeights(x, z, _w);
  let h = relief(_n) * reliefMask(x, z, _w);
  h += landform(_n, _w, x, z);
  h += basin(x, z);
  h += dishes(_w);
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
