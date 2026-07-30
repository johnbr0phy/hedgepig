import { clamp, lerp } from '../core/util.js';

/* ------------------------------------------------------------------ *
 * The round of places.
 *
 * v1 had three cycles of different lengths — 11 places over 220 m, a year
 * over 284 m, a day over 209 m — so that nothing ever repeated.  That worked
 * because the world only ever scrolled forward.  Here you can walk back the
 * way you came, so *distance* can no longer stand in for time: the year and
 * the day are clocks now, in `season.js`, and this file is only the ring of
 * places.
 *
 * The ring is the equator.  `x` is longitude, one lap is exactly
 * `CIRC` metres, and the planet's radius is derived from that rather than
 * chosen — which is the whole reason the walk closes on itself with no
 * seam to hide.  Ten places at thirty metres is three hundred metres round
 * and a radius of 47.75 m, and every other number in the world follows.
 *
 * `z` is latitude: the width of the field.  Walkable to ±BAND, rolling
 * hillside beyond that, poles a quarter of a lap away at ±75 m.
 * ------------------------------------------------------------------ */

export const PLACE_LEN = 30;
/** Crossfade between neighbouring places — v1's XF, as the same fraction. */
export const XF = PLACE_LEN * 0.25;
/** Walkable half-width of the field. */
export const BAND = 13;

/* Place ids.  The names are v1's `ZONE_NAME`, unchanged. */
export const BGARD = 0, WOOD = 1, MGARD = 2, LAKE = 3, MIRE = 4,
             HENS = 5, FARM = 6, ROAD = 7, TOWN = 8, MEADOW = 9;

/**
 * v1's `ORDER`, kept exactly — and the ordering rule with it: **neighbours
 * must share something**.  Garden into wood, wood into its mushroomy floor,
 * floor into the lake, lake into the mire at its edge, mire into the hens
 * that pick over it, hens into the farm they belong to, farm out onto its
 * road, road into the town it leads to, town back out into the meadow.  An
 * earlier build put a beach next to a snowfield and it was rejected on
 * sight.  Keep the walk continuous.
 */
export const ORDER = [BGARD, WOOD, MGARD, LAKE, MIRE, HENS, FARM, ROAD, TOWN, MEADOW];
export const COUNT = ORDER.length;
export const CIRC = PLACE_LEN * COUNT;

export const PLACE = {
  [BGARD]:  { name: 'the butterfly garden', dens: 0.95, len: 1.05, dry: 0.02, soil: 0.05, ground: 0x8d7f52 },
  [WOOD]:   { name: 'the wood',             dens: 0.30, len: 0.45, dry: 0.30, soil: 0.55, ground: 0x6b4f34 },
  [MGARD]:  { name: 'the mushroom garden',  dens: 0.58, len: 0.82, dry: 0.04, soil: 0.42, ground: 0x5a4c3c },
  [LAKE]:   { name: 'the lake',             dens: 0.14, len: 0.62, dry: 0.20, soil: 0.25, ground: 0x4f5a4c },
  [MIRE]:   { name: 'the mire',             dens: 0.19, len: 0.64, dry: 0.50, soil: 1.00, ground: 0x54463a },
  [HENS]:   { name: 'the hen run',          dens: 0.20, len: 0.38, dry: 0.55, soil: 0.70, ground: 0x7c6544 },
  [FARM]:   { name: 'the farmyard',         dens: 0.34, len: 0.50, dry: 0.80, soil: 0.58, ground: 0x8a7350 },
  [ROAD]:   { name: 'the road',             dens: 0.30, len: 0.46, dry: 0.75, soil: 0.55, ground: 0x74705f },
  [TOWN]:   { name: 'the edge of town',     dens: 0.16, len: 0.38, dry: 0.45, soil: 0.60, ground: 0x8c8a86 },
  [MEADOW]: { name: 'the long meadow',      dens: 1.00, len: 1.00, dry: 0.00, soil: 0.00, ground: 0x7d6a4c },
};

/** Fold a longitude into [-CIRC/2, CIRC/2). */
export function wrapX(x) {
  const c = CIRC;
  return ((((x + c / 2) % c) + c) % c) - c / 2;
}

/** Shortest signed difference between two longitudes, in metres of arc. */
export function wrapDelta(a, b) {
  let d = a - b;
  while (d > CIRC / 2) d -= CIRC;
  while (d < -CIRC / 2) d += CIRC;
  return d;
}

/** Index of the place containing longitude x, and how far into it we are. */
export function placeIndexAt(x) {
  const c = ((x % CIRC) + CIRC) % CIRC;
  const i = Math.floor(c / PLACE_LEN) % COUNT;
  return { i, local: c - i * PLACE_LEN };
}

/** Centre longitude of place slot `i`. */
export const placeCentre = (i) => i * PLACE_LEN + PLACE_LEN / 2;

/** First longitude at which place slot `i` starts. */
export const placeStart = (i) => i * PLACE_LEN;

/**
 * The blend at x: place `a` fading into place `b` by `t`.  Everything
 * spatial should read through this rather than through `placeIndexAt`, so
 * that edges fade instead of snapping — the same rule as v1's `segAt`.
 */
export function placeAt(x) {
  const { i, local } = placeIndexAt(x);
  const a = ORDER[i];
  if (local > PLACE_LEN - XF) {
    return { a, b: ORDER[(i + 1) % COUNT], t: (local - (PLACE_LEN - XF)) / XF, i, local };
  }
  return { a, b: a, t: 0, i, local };
}

/** A named property of the place at x, crossfaded across the boundary. */
export function placeProp(x, key) {
  const m = placeAt(x);
  return m.t ? lerp(PLACE[m.a][key], PLACE[m.b][key], m.t) : PLACE[m.a][key];
}

/** How much of place `kind` is in force at x — 0 outside it, 1 well inside. */
export function placeAmt(x, kind) {
  const m = placeAt(x);
  let v = 0;
  if (m.a === kind) v = 1 - m.t;
  if (m.b === kind) v = Math.max(v, m.t);
  return v;
}

/**
 * A band of hard ground inside its own place, with a soft edge.
 *
 * These are the three things that run the full width of the field — water,
 * tarmac, paving — and v1's hardest-won rule is about exactly them:
 * **anything full-width is an unavoidable wall for something that cannot
 * stop**.  So each one has to come with its own way across, which is why
 * the road has a culvert and the lake has a boat.
 *
 * The fractions are v1's, and the soft edge is scaled from its pixels to
 * this world's metres.
 */
const BANDS = {
  /* A 5.2 m ramp into the water, not 2.8.  The bank drops 1.55 m either way,
   * so the short version was a 31° slope right where he has to stand to get
   * into the boat — walkable by the letter of `walkableAt` and horrible. */
  [LAKE]: { a: 0.17, z: 0.85, edge: 5.2 },
  /* The tarmac is narrower than its place — 9.6 m of it, which at his pace
   * is seven seconds in the open.  v1's was 2 288 px, about ten metres, and
   * the whole balance of the culvert was tuned against that number: wider
   * and the tunnel stops being a choice, narrower and it stops being a
   * risk. */
  [ROAD]: { a: 0.34, z: 0.66, edge: 1.4 },
  [TOWN]: { a: 0.25, z: 0.77, edge: 1.4 },
};

export function bandAt(x, kind) {
  const B = BANDS[kind];
  if (!B) return 0;
  const { i, local } = placeIndexAt(x);
  if (ORDER[i] !== kind) return 0;
  return Math.min(
    clamp((local - PLACE_LEN * B.a) / B.edge, 0, 1),
    clamp((PLACE_LEN * B.z - local) / B.edge, 0, 1)
  );
}

/** The two longitudes where a band begins and ends. */
export function bandEdges(kind) {
  const B = BANDS[kind];
  const i = ORDER.indexOf(kind);
  return [placeStart(i) + PLACE_LEN * B.a, placeStart(i) + PLACE_LEN * B.z];
}

export const lakeAt = (x) => bandAt(x, LAKE);
export const roadAt = (x) => bandAt(x, ROAD);
export const townAt = (x) => bandAt(x, TOWN);

/** Ground that grass will not grow on, and thorns must not seed on. */
export const hardAt = (x) => Math.max(lakeAt(x), roadAt(x), townAt(x));
