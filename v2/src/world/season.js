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
 * reason: a lap of the planet takes about 220 s at his pace, the day is
 * 150 s and the year 204 s, so a given place, hour and season line up again
 * roughly once every four hours of play.
 *
 * **Snow and night are times, not places.**  v1 tried them as zones, found
 * it jarring, and made them weights instead; that is kept exactly.  Season
 * drives grass length and density, the whole palette, what falls out of the
 * sky, whether there is ice on the lake, and whether the bees fly at all.
 * ------------------------------------------------------------------ */

export const DAY = 150;
export const YEAR = 204;

/* Phase 0 is noon, not midnight — that is what `nightAt` below assumes, and
 * getting it the other way round lights the world at 40 % night while the
 * readout says "morning".  Which is exactly what happened. */
export const HOURS = ['noon', 'afternoon', 'evening', 'dusk', 'deep night', 'before dawn', 'dawn', 'morning'];

/**
 * How dark it is at day-phase `dp`. v1's `nightAt`, unchanged: flat dark
 * through the small hours and quick at the edges.
 */
export const nightAt = (dp) => clamp((-Math.cos(dp * TAU) - 0.22) / 0.78, 0, 1);

/**
 * How high the sun is at day-phase `dp`: +1 overhead, -1 under our feet.
 *
 * Exported next to `nightAt` on purpose, and the harness asserts they agree.
 * Written as `-cos` once — the exact opposite of this — which lit the world at
 * 40 % night while the readout said "morning", and read as a moody palette
 * rather than as a bug for an embarrassingly long time.
 */
export const sunAltAt = (dp) => Math.cos(dp * TAU);

const _a = new THREE.Color();
const _b = new THREE.Color();
const _c = new THREE.Color();
const _d = new THREE.Color();

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

function seasonNumber(key, w) {
  let v = 0;
  for (let i = 0; i < 4; i++) v += SEASONS[i][key] * w[i];
  return v;
}

export function createClimate({
  scene, sun, fill, bounce, hemi, sky, grass, pipeline,
  startAt = 0.30, startHour = 0.86,
}) {
  const state = {
    t: startAt * YEAR,
    // 0.86 of a day is mid-morning: the light is off the vertical, which is
    // when a cel ramp has the most to say
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
    sunDir: new THREE.Vector3(-0.4, 0.8, 0.45),
    dayPhase: 0.34,
    yearPhase: startAt,
  };

  const skyTop = new THREE.Color();
  const skyMid = new THREE.Color();
  const skyHaze = new THREE.Color();
  const fogCol = new THREE.Color();
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

    /* v1's derived weights, unchanged in shape: snow lies once winter is
     * properly in, and it lags the first flakes. */
    state.snowFall = clamp((w[3] - 0.08) / 0.5, 0, 1);
    state.snow = clamp((w[3] - 0.16) / 0.5, 0, 1);
    state.leafFall = clamp((w[2] - 0.25) / 0.45, 0, 1);
    // rain sits between autumn and winter, and a little in spring
    state.wet = clamp(w[2] * 0.5 + w[3] * 0.25 + w[0] * 0.22 - 0.18, 0, 1);
    state.wind = 0.10 + 0.14 * w[2] + 0.10 * w[3] + 0.05 * w[0];

    /* --- the day --- */
    state.night = nightAt(dp);
    const n = state.night;
    state.hour = HOURS[Math.floor(dp * 8) % 8];

    /* --- where the light comes from --- */
    const alt = sunAltAt(dp);                        // +1 noon, -1 midnight
    const az = dp * TAU;
    // never let the key light lie flat on the ground: at dawn and dusk it
    // grazes, which is what we want, but a light at 0° elevation gives every
    // toon surface the same band and the world goes flat
    const elev = Math.max(Math.abs(alt), 0.22) * (alt < 0 ? 0.75 : 1);
    state.sunDir.set(Math.sin(az) * 0.85, elev, Math.cos(az) * 0.5).normalize();

    /* --- colour --- */
    seasonColor('sky', w, skyMid);
    seasonColor('haze', w, skyHaze);
    _c.set(PAL.skyTop);
    skyTop.copy(skyMid).lerp(_c, 0.45);

    // night pulls everything toward the night palette
    if (n > 0) {
      _d.set(NIGHT.skyTop); skyTop.lerp(_d, n * 0.92);
      _d.set(NIGHT.sky);    skyMid.lerp(_d, n * 0.9);
      _d.set(NIGHT.haze);   skyHaze.lerp(_d, n * 0.85);
    }

    sky.setColors({
      top: skyTop, mid: skyMid, haze: skyHaze, night: n,
      cloud: _a.set(PAL.cloud).lerp(_b.set(0x8f9ac4), n).getHex(),
      cloudShade: _a.set(PAL.cloudShade).lerp(_b.set(0x5c648e), n).getHex(),
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
      fogCol.copy(skyHaze).lerp(skyMid, 0.35);
      scene.fog.color.copy(fogCol);
      scene.fog.near = lerp(11, 7, n) * lerp(1, 0.72, state.snowFall);
      scene.fog.far = lerp(40, 26, n) * lerp(1, 0.62, state.snowFall);
    } else {
      fogCol.copy(skyHaze).lerp(skyMid, 0.35);
    }

    /* --- lights --- */
    seasonColor('sun', w, _a);
    _b.set(NIGHT.sun);
    sun.color.copy(_a).lerp(_b, n);
    sun.intensity = lerp(2.15, 0.52, n) * lerp(1, 0.72, state.wet);

    seasonColor('fill', w, _a);
    _b.set(NIGHT.fill);
    fill.color.copy(_a).lerp(_b, n);
    fill.intensity = lerp(1.05, 0.42, n);

    _a.set(PAL.hemiSky); _b.set(NIGHT.hemiSky);
    hemi.color.copy(_a).lerp(_b, n);
    _a.set(PAL.hemiGround); _b.set(NIGHT.hemiGround);
    hemi.groundColor.copy(_a).lerp(_b, n);
    hemi.intensity = lerp(1.05, 0.46, n);
    bounce.intensity = lerp(0.32, 0.12, n);

    /* --- the world's own colours --- */
    seasonColor('grass', w, grassCol);
    seasonColor('ground', w, groundCol);
    // snow lies over both, and does not tint them — it replaces them
    if (state.snow > 0) {
      _a.set(0xe6eef2);
      grassCol.lerp(_a, state.snow * 0.72);
      groundCol.lerp(_a, state.snow * 0.86);
    }
    // and the whole lot cools off after dark
    if (n > 0) {
      _a.set(0x5a6a94);
      grassCol.lerp(_a, n * 0.5);
      groundCol.lerp(_a, n * 0.5);
    }

    seasonColor('canopy', w, _c);
    seasonColor('leaf', w, _d);
    if (n > 0) {
      _a.set(0x46527e);
      _c.lerp(_a, n * 0.55);
      _d.lerp(_a, n * 0.55);
    }

    _a.set(PAL.water);
    if (state.snow > 0.45) _a.lerp(_b.set(PAL.ice), clamp((state.snow - 0.45) / 0.4, 0, 1));
    if (n > 0) _a.lerp(_b.set(0x2f4568), n * 0.7);

    applyPalette({
      grass: grassCol,
      groundTint: groundCol,
      canopy: _c,
      leaf: _d,
      water: _a,
      far: _b.copy(groundCol).lerp(fogCol, 0.35),
    });

    /* Lit things.  There is no light source in this world but the sky, so a
     * window at night is a *colour*, not a lamp — an unlit material that
     * goes from dark glass to warm paper.  It costs nothing and reads from
     * right across the field, which a real point light at this scale would
     * not. */
    const lit = clamp((n - 0.25) / 0.4, 0, 1);
    applyPalette({
      window: _a.set(0x2b2130).lerp(_b.set(0xffd489), lit),
      lamp: _a.set(0x6a6858).lerp(_b.set(0xfff0c0), lit),
      headlamp: _a.set(0xfff2c8).lerp(_b.set(0xfffbe8), lit),
    });
    state.lit = lit;

    // shade goes bluer and deeper after dark; ink goes with it
    _a.set(0x6b5f8e).lerp(_b.set(0x2d3352), n);
    setShadowTint(_a.getHex());
    _a.set(PAL.ink).lerp(_b.set(NIGHT.ink), n);
    setOutlineColor(_a.getHex());
    pipeline.ink.mat.uniforms.uInk.value.copy(_a);

    /* --- the grade --- */
    const gr = pipeline.grade.mat.uniforms;
    _a.set(0xaea9d2).lerp(_b.set(0x6d78ad), n);
    gr.uShadowTint.value.copy(_a);
    _a.set(0xfff8ea).lerp(_b.set(0xc3ccec), n);
    gr.uLightTint.value.copy(_a);
    gr.uSaturation.value = lerp(1.12, 0.86, n) * lerp(1, 0.88, state.wet);
    gr.uWarmth.value = lerp(0.028, -0.02, n) + 0.045 * w[2];
    gr.uVignette.value = lerp(0.16, 0.30, n);

    /* --- the field itself --- */
    grass.setSeason(seasonNumber('len', w), seasonNumber('den', w));
    grass.setWind(state.wind * lerp(1, 1.7, state.wet));

    return state;
  }

  return { state, update, DAY, YEAR };
}
