import * as THREE from 'three';
import { PAL, SEASONS, NIGHT } from '../core/palette.js';
import { applyPalette, setShadowTint } from '../core/toon.js';
import { setOutlineColor } from '../core/outline.js';
import { clamp, lerp, TAU, sstep } from '../core/util.js';

/* ------------------------------------------------------------------ *
 * The year and the day.
 *
 * v1 made both of them *distances*: a year was 284 m of walking and a day
 * 209 m, drifting against a 220 m round of places so that no combination
 * ever came back.  That only worked because the world scrolled one way.
 * Here you can walk back the way you came, and a season that reversed with
 * you would be a nonsense — so they are clocks now.
 *
 * The three periods are still deliberately coprime-ish, for the same
 * reason: a lap of the planet takes about 220 s at his pace, so a given
 * place, hour and season line up again only after many laps.
 *
 * **The year used to be shorter than one and a half days.**  150 s and
 * 204 s is 1.36 days per year, so a season lasted 51 s — less than half a
 * day — and the world went spring-summer-autumn-winter *inside a single
 * afternoon*.  Nothing in the code was wrong; every weight was derived
 * correctly from a year that was simply far too short, and what it produced
 * was a palette that never settled and snow that arrived and left twice
 * before dark.  It reads as a bug in the weather, and the bug is here.
 * A season is now 1.1 days, which is long enough to be a season and short
 * enough that you see all four.
 *
 * **Snow and night are times, not places.**  v1 tried them as zones, found
 * it jarring, and made them weights instead; that is kept exactly.  Season
 * drives grass length and density, the whole palette, what falls out of the
 * sky, whether there is ice on the lake, and whether the bees fly at all.
 * ------------------------------------------------------------------ */

export const DAY = 240;
export const YEAR = 1080;          // 4.5 days; a season is 1.125 of one
/** How long the moon takes to go round its phases.  Six days: one night to
 *  the next is a visibly different moon, one hour to the next is not. */
export const LUNATION = 6 * DAY;

/* Phase 0 is noon, not midnight — that is what `nightAt` below assumes, and
 * getting it the other way round lights the world at 40 % night while the
 * readout says "morning".  Which is exactly what happened. */
export const HOURS = ['noon', 'afternoon', 'evening', 'dusk', 'deep night', 'before dawn', 'dawn', 'morning'];

/**
 * What to call the hour, from the sun's own height and whether it is on the
 * way up.  It was an eighth of the clock each, which was fine while the clock
 * ran at one speed; with the phase warped, equal eighths are no longer equal
 * amounts of daylight and the readout said "dawn" for a sun already 25° up.
 * An hour has always been a description of the light, so read it off the
 * light.
 */
export function hourNameAt(alt, rising) {
  if (alt > 0.86) return 'noon';
  if (alt > 0.34) return rising ? 'morning' : 'afternoon';
  if (alt > 0.09) return rising ? 'early' : 'evening';
  if (alt > -0.03) return rising ? 'sunrise' : 'sunset';
  if (alt > -0.28) return rising ? 'dawn' : 'dusk';
  if (alt > -0.86) return rising ? 'before dawn' : 'night';
  return 'deep night';
}

/**
 * **The clock does not run at one speed.**
 *
 * A sun on a plain cosine moves *fastest* through the horizon and dawdles at
 * noon and midnight, which is precisely backwards for how a day looks: the
 * two minutes either side of sunset are the only part of the cycle where the
 * light has anything to say, and they were the part the world spent least
 * time in.  This warps the day-phase before anything reads it — slow near
 * the horizon crossings, quick over the top and under the bottom — so
 * twilight runs at 45 % speed and takes 18 % of the day instead of 8 %,
 * while noon and midnight run at 155 % and are over sooner.
 *
 * It is a *phase* warp, not a separate curve per system, and that is the
 * point: `sunAltAt`, `nightAt`, the hour readout and the moon all read the
 * warped phase, so they cannot disagree.  Day and night are still exactly
 * half the clock each — the warp is antisymmetric about the crossings.
 */
const SKEW = 0.55;                                  // 0 is a plain cosine; must stay under 1
export const solarPhase = (dp) => dp + (SKEW / (2 * TAU)) * Math.sin(2 * TAU * dp);

/**
 * How high the sun is at day-phase `dp`: +1 overhead, -1 under our feet.
 *
 * Exported next to `nightAt` on purpose, and the harness asserts they agree.
 * Written as `-cos` once — the exact opposite of this — which lit the world at
 * 40 % night while the readout said "morning", and read as a moody palette
 * rather than as a bug for an embarrassingly long time.
 */
export const sunAltAt = (dp) => Math.cos(solarPhase(dp) * TAU);

/**
 * How dark it is at day-phase `dp`. v1's `nightAt`, with its -0.22 offset so
 * that dusk lags sunset — but now *derived from the sun* rather than written
 * out again in parallel, so the two can no longer drift apart.
 */
export const nightAt = (dp) => clamp((-sunAltAt(dp) - 0.22) / 0.78, 0, 1);

/** How far the sun's arc leans off the vertical, so noon is not the zenith. */
const TILT = 0.42;

/**
 * Where the sun is, in his own frame: x east, y up, z north.  It **sets**,
 * which is new — the old rig held the key light at 0.22 elevation or above
 * at all times, so the sun never once touched the horizon: it swung round in
 * azimuth and bobbed, and since it was never below the skyline the sky's
 * "whichever of sun and anti-sun is up" test never fired and the moon was
 * only ever the sun wearing a different colour.
 */
export function sunDirAt(dp, out = new THREE.Vector3()) {
  const th = solarPhase(dp) * TAU;
  // -sin, so he sees it rise in the east and set in the west, not the reverse
  return out.set(-Math.sin(th), Math.cos(th) * Math.cos(TILT), Math.cos(th) * Math.sin(TILT))
    .normalize();
}

/**
 * Where the moon is.  Its lag behind the sun **is** its phase — that is the
 * actual astronomy and it costs nothing: a full moon is opposite the sun and
 * therefore up all night, a new moon is beside the sun and therefore not
 * there at all, and a crescent is a thing you catch near dawn or dusk.  The
 * old moon was pinned exactly opposite the sun while being *drawn* with an
 * unrelated phase, which is a full moon's geometry with a crescent's face.
 */
export function moonDirAt(dp, phase, out = new THREE.Vector3()) {
  const th = (solarPhase(dp) + phase) * TAU;
  return out.set(-Math.sin(th), Math.cos(th) * Math.cos(TILT), Math.cos(th) * Math.sin(TILT))
    .normalize();
}

const _a = new THREE.Color();
const _b = new THREE.Color();
const _c = new THREE.Color();
const _d = new THREE.Color();
const _e = new THREE.Color();

/** Blend a named colour across the four season palettes. */
function seasonColor(key, w, out = new THREE.Color()) {
  out.setRGB(0, 0, 0);
  for (let i = 0; i < 4; i++) {
    if (w[i] <= 0) continue;
    _a.set(SEASONS[i][key]);
    out.r += _a.r * w[i];
    out.g += _a.g * w[i];
    out.b += _a.b * w[i];
  }
  return out;
}

/**
 * The colour of the air at the skyline, by sun altitude.
 *
 * Read down it: pale warm while the sun is high, gold as it comes down, red
 * on the horizon itself, then the magenta afterglow, then the blue hour, then
 * nothing.  This ramp is doing the work that a Rayleigh/Mie scattering model
 * does in a photoreal sky — the stops are chosen rather than integrated,
 * which is the correct trade in a world drawn with four-band toon ramps.
 */
const GLOW = [
  [0.55, 0xfff2d2], [0.26, 0xffd79a], [0.08, 0xffab5e],
  [-0.02, 0xef6f52], [-0.12, 0xb85386], [-0.26, 0x5b4f96], [-0.45, 0x2b2f5a],
];
/** Opposite the sun: the counter-glow, which is pinker and much fainter. */
const COUNTER = [
  [0.55, 0xeef2f0], [0.26, 0xdfe6ee], [0.08, 0xd0b6c8],
  [-0.02, 0xb98fae], [-0.12, 0x74689f], [-0.26, 0x3f4478], [-0.45, 0x252a4e],
];

function rampAt(ramp, alt, out) {
  if (alt >= ramp[0][0]) return out.set(ramp[0][1]);
  for (let i = 1; i < ramp.length; i++) {
    if (alt >= ramp[i][0]) {
      const t = (alt - ramp[i][0]) / (ramp[i - 1][0] - ramp[i][0]);
      return out.set(ramp[i][1]).lerp(_a.set(ramp[i - 1][1]), t);
    }
  }
  return out.set(ramp[ramp.length - 1][1]);
}
const glowAt = (alt, out) => rampAt(GLOW, alt, out);
const counterAt = (alt, out) => rampAt(COUNTER, alt, out);

function seasonNumber(key, w) {
  let v = 0;
  for (let i = 0; i < 4; i++) v += SEASONS[i][key] * w[i];
  return v;
}

export function createClimate({
  scene, sun, fill, bounce, hemi, sky, grass, ground = null, pipeline,
  /* 0.915 of a day is mid-morning *after the warp* — the light is off the
   * vertical, which is when a cel ramp has the most to say.  Before the warp
   * the same number was well past sunrise; a raw phase is no longer an hour. */
  startAt = 0.30, startHour = 0.915,
}) {
  const state = {
    t: startAt * YEAR,
    dayT: startHour * DAY,
    w: [1, 0, 0, 0],
    season: 'spring',
    hour: 'morning',
    night: 0,
    snow: 0,          // how much snow lies
    snowFall: 0,      // how much is coming down
    leafFall: 0,
    wind: 0.16,
    wet: 0,
    /** 0 clear, 1 a front sitting right over him. */
    front: 0,
    /** The true sun, which goes below the horizon. */
    sunDir: new THREE.Vector3(-0.4, 0.8, 0.45),
    /** The true moon, wherever its phase has put it. */
    moonDir: new THREE.Vector3(0.4, -0.8, -0.45),
    /** What the key light actually follows: the sun by day, the moon by night. */
    keyDir: new THREE.Vector3(-0.4, 0.8, 0.45),
    keyIsSun: true,
    sunAlt: 1,
    moonAlt: -1,
    moonPhase: 0.5,
    /** 0 by night, 1 in clear daylight — the honest one, unlike `1 - night`. */
    day: 1,
    /** How dark it *looks*, which starts at sunset, not thirteen degrees after. */
    dark: 0,
    /** Peaks with the sun on the skyline and is zero by 20° either side. */
    golden: 0,
    /** The sun is *under* the horizon but the sky is still lit. */
    twilight: 0,
    dayPhase: 0.34,
    yearPhase: startAt,
  };

  const skyTop = new THREE.Color();
  const skyMid = new THREE.Color();
  const skyHaze = new THREE.Color();
  const fogCol = new THREE.Color();
  const skyGlow = new THREE.Color();
  const skyCounter = new THREE.Color();
  const grassCol = new THREE.Color();
  const groundCol = new THREE.Color();

  scene.fog = new THREE.Fog(PAL.fog, 11, 40);

  function update(dt) {
    state.t += dt;
    state.dayT += dt;

    const yp = (state.t / YEAR) % 1;
    const dp = (state.dayT / DAY) % 1;
    state.yearPhase = yp;
    state.dayPhase = dp;

    /* --- the season: four weights, only ever two of them non-zero --- */
    const f = yp * 4;
    const i = Math.floor(f) % 4;
    const t = f - Math.floor(f);
    const w = state.w;
    w[0] = w[1] = w[2] = w[3] = 0;
    w[i] = 1 - t;
    w[(i + 1) % 4] = t;
    state.season = t < 0.5 ? SEASONS[i].name : SEASONS[(i + 1) % 4].name;

    /* ------------------------------ the weather ------------------------------ *
     *
     * It used to be a **pure function of the season weights**, which is to say
     * it was not weather at all: at a given point in the year it always
     * rained, exactly as hard, and between those points it never did.  Nothing
     * ever arrived and nothing ever cleared, so the one event the sky can give
     * you — the rain stopping — could only happen at one fixed moment of the
     * year, and the rainbow that is earned by it with it.
     *
     * A front is a slow wander put through a threshold.  The wander is two
     * sines at periods that do not divide each other, so it does not repeat
     * on any timescale you will sit through; the threshold is what makes it
     * *weather* rather than a breathing amplitude, because a threshold has a
     * before and an after.  The season moves the threshold, not the rain: a
     * wet season is one where the front gets over the bar often and stays,
     * and summer is one where it rarely does.
     */
    const wander = 0.5
      + 0.34 * Math.sin(state.t * 0.0197)
      + 0.22 * Math.sin(state.t * 0.0071 + 2.3)
      + 0.10 * Math.sin(state.t * 0.0523 + 5.1);
    // how much of the year's weather this season is inclined to give
    const damp = 0.30 * w[0] + 0.02 * w[1] + 0.46 * w[2] + 0.34 * w[3];
    state.front = sstep(0.72 - damp * 0.52, 0.94 - damp * 0.52, wander);
    state.wet = state.front * (0.45 + 0.55 * damp);

    /* Snow is rain that is cold enough, and **it lies and it melts**.  As a
     * direct function of the winter weight it appeared and vanished on the
     * calendar with no relation to whether anything was falling — you could
     * stand in a blizzard on bare grass, and in bright sun on deep snow. */
    const cold = clamp((w[3] - 0.10) / 0.45, 0, 1);
    state.snowFall = state.wet * cold;
    const melt = 0.004 + 0.030 * (1 - cold);
    state.snow = clamp(state.snow + (state.snowFall * 0.045 - melt) * dt, 0, 1);

    /* Wind is weather, not a constant: a slow swell and an occasional gust
     * front laid over the seasonal base, so the meadow breathes in waves
     * instead of shimmering at one fixed amplitude forever.  It also **gets
     * up before the rain does** — `front` leads `wet`, because the threshold
     * is lower for the wind — which is the cheapest possible way to make the
     * weather feel like it is coming from somewhere. */
    const base = 0.10 + 0.14 * w[2] + 0.10 * w[3] + 0.05 * w[0];
    const swell = 0.6 + 0.4 * Math.sin(state.t * 0.11 + Math.sin(state.t * 0.043) * 2.1);
    const gust = Math.max(0, Math.sin(state.t * 0.31) - 0.82) * 3.4;    // brief, a few times a minute
    const blow = sstep(0.58 - damp * 0.42, 0.88 - damp * 0.42, wander);
    state.wind = base * (swell + gust) * (1 + blow * 1.15);

    // leaves come down with the season, and far faster when it blows
    state.leafFall = clamp((w[2] - 0.25) / 0.45, 0, 1) * (0.45 + 0.9 * blow);

    /* --- the day --- */
    const sp = solarPhase(dp) % 1;
    state.night = nightAt(dp);
    state.hour = hourNameAt(sunAltAt(dp), sp > 0.5);

    /* --- where the light comes from --- */
    const alt = sunAltAt(dp);                        // +1 noon, -1 midnight
    state.sunAlt = alt;
    state.moonPhase = (state.t / LUNATION) % 1;
    sunDirAt(dp, state.sunDir);
    moonDirAt(dp, state.moonPhase, state.moonDir);
    state.moonAlt = state.moonDir.y;
    // 0 new, 1 full — and it is how much light the moon has to give
    const fullness = 0.5 - 0.5 * Math.cos(state.moonPhase * TAU);

    state.day = sstep(-0.02, 0.26, alt);
    /* **`night` is not darkness, it is night.**  v1's curve carries a
     * deliberate -0.22 offset so that dusk lags sunset, which is right for
     * anything that asks *is it night* — fireflies, the owl, lit windows —
     * and quite wrong for anything that asks *what colour is it*.  It stays
     * flat at zero until the sun is 13° under, so the whole of dusk was being
     * painted in full daylight sky colours with only the horizon glow laid
     * over the top: a flat cream wash where the blue hour should be.  This is
     * the colour curve, and it starts the moment the sun touches the rim. */
    state.dark = 1 - sstep(-0.35, 0.10, alt);
    const dk = state.dark;
    state.golden = clamp(1 - Math.abs(alt) / 0.30, 0, 1);
    state.twilight = sstep(-0.42, -0.02, alt) * (1 - sstep(-0.02, 0.10, alt));

    /* How dark the *lighting* is, which is neither of the other two.  `night`
     * is still zero through all of dusk, so lighting off it leaves the world
     * at full noon intensity under a violet sky; `dark` reaches one before the
     * sun is 20° under, so lighting off *that* makes dusk as black as
     * midnight.  Take the higher of the two with the fast one held back:
     * evening dims steadily and the small hours are still the darkest part. */
    const lum = Math.max(state.night, dk * 0.62);

    /* Two keys, one light.  The sun hands over to the moon in the window
     * where **both** are dark — the sun below -0.02 and the moon not yet
     * counted until then — so the direction swaps while nothing is casting,
     * and what you see across the swap is a minute of skylight only.  That
     * minute is the blue hour, and it is free.
     *
     * And there is a floor under all of it.  The old rig never let the sun
     * below 0.22 elevation, so there was *always* a key light — take the
     * clamp away without replacing it and a moonless night has no directional
     * light at all, which came out as a black field with a catchlight
     * floating in it.  A clear night is not black; it is dim and blue and it
     * comes from the whole sky.  So: the moon when there is one, and a fifth
     * of a light from overhead when there is not. */
    const sunKey = sstep(-0.02, 0.17, alt);
    const moonLight = fullness * sstep(-0.02, 0.16, state.moonAlt);
    const moonKey = moonLight * (1 - sstep(-0.06, 0.04, alt));
    state.keyIsSun = sunKey > 0.001;
    if (state.keyIsSun) {
      state.keyDir.copy(state.sunDir);
    } else if (moonKey > 0.02) {
      state.keyDir.copy(state.moonDir);
    } else {
      // no moon: skyglow, from above and leaning away from where the sun went
      state.keyDir.set(-state.sunDir.x * 0.35, 1, -state.sunDir.z * 0.35).normalize();
    }
    /* Never let the key lie flat on the ground: grazing is the whole point at
     * dawn, but at 0° every toon surface takes the same band and the world
     * goes flat.  Lift it, keeping its bearing. */
    if (state.keyDir.y < 0.14) {
      state.keyDir.y = 0.14;
      state.keyDir.normalize();
    }

    /* --- colour --- */
    seasonColor('sky', w, skyMid);
    seasonColor('haze', w, skyHaze);
    _c.set(PAL.skyTop);
    skyTop.copy(skyMid).lerp(_c, 0.45);

    // night pulls everything toward the night palette
    if (dk > 0) {
      _d.set(NIGHT.skyTop); skyTop.lerp(_d, dk * 0.92);
      _d.set(NIGHT.sky);    skyMid.lerp(_d, dk * 0.9);
      _d.set(NIGHT.haze);   skyHaze.lerp(_d, dk * 0.85);
    }

    /* Overcast.  A front is cloud, and cloud is what actually makes a rainy
     * day look rainy — not the drops, which are four pixels each and mostly
     * behind the grass.  The sky flattens toward a wet grey, the difference
     * between its three stops closes up, and the sunset behind it is muted
     * rather than cancelled: a red sky through cloud is the good kind. */
    if (state.front > 0) {
      _d.set(0xa8b0bb);
      const oc = state.front * 0.62;
      skyTop.lerp(_d, oc); skyMid.lerp(_d, oc * 0.86); skyHaze.lerp(_d, oc * 0.62);
    }

    /* The horizon glow.
     *
     * The dome was a function of *height only*, so a sunset looked exactly
     * the same in every direction you turned — the one thing that gives a sky
     * an hour and a bearing was missing, and no amount of tuning the three
     * stops could put it back.  `glowAt` is the colour of the air right at
     * the skyline for a given sun altitude, and the dome now lays it in on
     * the sun's side and its own cooler counterpart opposite: warm where the
     * sun is going down, violet-blue away from it. */
    glowAt(alt, skyGlow);
    counterAt(alt, skyCounter);
    const glowAmt = clamp(state.golden * 0.92 + state.twilight * 0.55, 0, 1)
      * (1 - state.front * 0.45);

    sky.setColors({
      top: skyTop, mid: skyMid, haze: skyHaze, night: dk,
      glow: skyGlow, counter: skyCounter, glowAmt,
      cloud: _a.set(PAL.cloud).lerp(_b.set(0x8f9ac4), dk)
        .lerp(skyGlow, state.golden * 0.55).getHex(),
      cloudShade: _a.set(PAL.cloudShade).lerp(_b.set(0x5c648e), dk)
        .lerp(skyCounter, state.golden * 0.40).getHex(),
      moonPhase: state.moonPhase,
      moonUp: sstep(-0.06, 0.06, state.moonAlt),
      sunUp: sstep(-0.05, 0.05, alt),
      starAmt: 1 - sstep(-0.22, 0.02, alt),
      // the aurora belongs to deep winter nights and nowhere else
      aurora: state.night * w[3],
    });

    /* Fog takes the horizon colour, so the world dissolves into its own sky.
     *
     * **Guarded, and the guard is load-bearing.**  The orbit view takes the
     * fog off the scene entirely — from up there it is a haze between you
     * and a planet you are supposed to see whole — and this line then threw
     * on `null.color` every frame.  Because `frame()` re-armed its own
     * `requestAnimationFrame` at the *end*, one throw did not drop one
     * frame: it stopped the loop for good, and the game froze the instant
     * you pressed P.  (The other half of that fix is in `main.js`, which now
     * arms the next frame first.) */
    if (scene.fog) {
      fogCol.copy(skyHaze).lerp(skyMid, 0.35)
        .lerp(skyGlow, state.golden * 0.45 + state.twilight * 0.30);
      scene.fog.color.copy(fogCol);
      /* Weather closes the world in.  Snow does it hardest — it is the one
       * kind of weather that is genuinely opaque — and rain does it too. */
      scene.fog.near = lerp(11, 7, dk) * lerp(1, 0.72, state.snowFall) * lerp(1, 0.86, state.wet);
      scene.fog.far = lerp(40, 26, dk) * lerp(1, 0.62, state.snowFall) * lerp(1, 0.78, state.wet);
    } else {
      fogCol.copy(skyHaze).lerp(skyMid, 0.35)
        .lerp(skyGlow, state.golden * 0.45 + state.twilight * 0.30);
    }

    /* --- lights --- *
     * The key is the sun's colour while the sun is up and the moon's once it
     * is not, and between the two it is simply *off*: a directional light at
     * a tenth of an intensity still draws a shadow with a bearing, and a
     * shadow pointing at a sun that set two minutes ago is the kind of thing
     * nobody names but everybody feels.  What lights the blue hour is the
     * hemisphere and the fill, which is also what lights it outdoors. */
    seasonColor('sun', w, _a);
    // the low sun is its own colour, not the noon one dimmed
    _a.lerp(skyGlow, state.golden * 0.62);
    _b.set(NIGHT.sun);
    sun.color.copy(state.keyIsSun ? _a : _b.set(0xc3d2ff));
    sun.intensity = state.keyIsSun
      ? lerp(2.15, 0.95, state.golden) * sunKey * lerp(1, 0.72, state.wet)
      : (0.26 + 0.46 * moonKey) * dk * lerp(1, 0.6, state.wet);

    seasonColor('fill', w, _a);
    _b.set(NIGHT.fill);
    fill.color.copy(_a).lerp(_b, dk);
    // the fill carries the twilight: it is the sky, and at dusk the sky is lit
    fill.intensity = lerp(1.05, 0.42, lum) + state.twilight * 0.55;

    _a.set(PAL.hemiSky); _b.set(NIGHT.hemiSky);
    hemi.color.copy(_a).lerp(_b, dk).lerp(skyGlow, state.golden * 0.34 + state.twilight * 0.30);
    _a.set(PAL.hemiGround); _b.set(NIGHT.hemiGround);
    hemi.groundColor.copy(_a).lerp(_b, dk);
    hemi.intensity = lerp(1.05, 0.52, lum) + state.twilight * 0.22;
    bounce.intensity = lerp(0.32, 0.14, lum);

    /* --- the world's own colours --- */
    seasonColor('grass', w, grassCol);
    seasonColor('ground', w, groundCol);
    /* Snow lies over both, and does not tint them — it **replaces** them.
     * At 0.72 and 0.86 it did not replace them either: deep snow came out as
     * a pale mint field that read as grass in bad weather, because a 60 %
     * lerp from green still has a lot of green in it.  Snow is white. */
    if (state.snow > 0) {
      /* Not pure white.  A snowfield lit at 2.15 intensity clips every
       * channel and comes out as a flat sheet of paper with no form in it at
       * all; the shading has to have somewhere to go. */
      _a.set(0xdfe9f1);
      grassCol.lerp(_a, state.snow * 0.93);
      groundCol.lerp(_a, state.snow * 0.97);
    }
    // and it covers the place tint in the vertices, which the material cannot
    ground?.setSnow?.(state.snow);
    /* Wet ground is darker ground.  Rain that changes nothing underfoot is
     * a particle system, not weather. */
    if (state.wet > 0) {
      _a.set(0x3c4436);
      grassCol.lerp(_a, state.wet * 0.22 * (1 - state.snow));
      groundCol.lerp(_a, state.wet * 0.30 * (1 - state.snow));
    }
    // and the whole lot cools off after dark
    if (dk > 0) {
      _a.set(0x5a6a94);
      grassCol.lerp(_a, lum * 0.5);
      groundCol.lerp(_a, lum * 0.5);
    }

    seasonColor('canopy', w, _c);
    seasonColor('leaf', w, _d);
    seasonColor('stem', w, _e);
    /* Snow dusts the trees before night blues them: a winter wood should
     * whiten, not just pale. */
    if (state.snow > 0) {
      _a.set(0xdfe8f0);
      _c.lerp(_a, state.snow * 0.55);
      _d.lerp(_a, state.snow * 0.40);
      _e.lerp(_a, state.snow * 0.40);
    }
    if (dk > 0) {
      _a.set(0x46527e);
      _c.lerp(_a, dk * 0.55);
      _d.lerp(_a, dk * 0.55);
      _e.lerp(_a, dk * 0.55);
    }

    _a.set(PAL.water);
    if (state.snow > 0.45) _a.lerp(_b.set(PAL.ice), clamp((state.snow - 0.45) / 0.4, 0, 1));
    if (dk > 0) _a.lerp(_b.set(0x2f4568), dk * 0.7);

    applyPalette({
      grass: grassCol,
      groundTint: groundCol,
      canopy: _c,
      leaf: _d,
      stem: _e,
      water: _a,
      far: _b.copy(groundCol).lerp(fogCol, 0.35),
    });

    /* Lit things.  There is no light source in this world but the sky, so a
     * window at night is a *colour*, not a lamp — an unlit material that
     * goes from dark glass to warm paper.  It costs nothing and reads from
     * right across the field, which a real point light at this scale would
     * not. */
    const lit = clamp((dk - 0.30) / 0.35, 0, 1);
    applyPalette({
      window: _a.set(0x2b2130).lerp(_b.set(0xffd489), lit),
      lamp: _a.set(0x6a6858).lerp(_b.set(0xfff0c0), lit),
      headlamp: _a.set(0xfff2c8).lerp(_b.set(0xfffbe8), lit),
    });
    state.lit = lit;

    // shade goes bluer and deeper after dark; ink goes with it
    _a.set(0x6b5f8e).lerp(_b.set(0x2d3352), dk);
    setShadowTint(_a.getHex());
    _a.set(PAL.ink).lerp(_b.set(NIGHT.ink), dk);
    setOutlineColor(_a.getHex());
    pipeline.ink.mat.uniforms.uInk.value.copy(_a);

    /* --- the grade --- */
    const gr = pipeline.grade.mat.uniforms;
    /* Golden hour is not "everything warmer" — it is the *split*: the lit
     * side goes gold and the shade goes further blue at the same time, and it
     * is the distance between them that reads as evening.  Warming both is
     * what a sepia filter does, and it looks like one. */
    _a.set(0xaea9d2).lerp(_b.set(0x6d78ad), dk).lerp(_b.set(0x7f8cd8), state.golden * 0.55);
    gr.uShadowTint.value.copy(_a);
    _a.set(0xfff8ea).lerp(_b.set(0xc3ccec), dk).lerp(_b.set(0xffd9a2), state.golden * 0.72);
    gr.uLightTint.value.copy(_a);
    gr.uSaturation.value = lerp(1.12, 0.86, dk) * lerp(1, 0.88, state.wet)
      + state.golden * 0.14;
    gr.uWarmth.value = lerp(0.028, -0.02, dk) + 0.045 * w[2] + state.golden * 0.05
      - state.twilight * 0.035;
    gr.uVignette.value = lerp(0.16, 0.30, dk) + state.golden * 0.05;

    /* --- the field itself --- */
    grass.setSeason(seasonNumber('len', w), seasonNumber('den', w));
    grass.setWind(state.wind * lerp(1, 1.7, state.wet));

    return state;
  }

  return { state, update, DAY, YEAR };
}
