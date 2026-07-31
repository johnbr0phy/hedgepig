import { clamp, lerp, TAU, rngKit } from './util.js';
import { CENTRE, LAKE, LAKE_R, distance } from '../world/plan.js';

/* ------------------------------------------------------------------ *
 * Sound.  All of it synthesised — there is not one sample file in the
 * build, for the same reason there is not one texture: the whole world is
 * made in front of you, and a .mp3 of a real meadow stapled onto a drawn
 * one would be the loudest wrong thing in it.
 *
 * The rules, learned from every web game that ever screeched:
 *
 *  - **Nothing before a gesture.**  The context is created suspended and
 *    resumed by the first pointer or key, which is also the only thing the
 *    autoplay policy allows.
 *  - **Everything ranges off him**, like the hazards: the lake gets louder
 *    as *he* nears the water, the traffic as *he* nears the road.  The
 *    camera hears through his ears, not its own.
 *  - **The bed follows the clock.**  Wind always; birds in daylight and
 *    never in winter; crickets after dusk; rain when it rains; and snow is
 *    not a sound but a hush — it *ducks* everything else, which is what
 *    snow actually does to a field.
 *  - **Footfalls come off the real gait.**  `anim.js` reports the frame a
 *    foot actually plants; nothing here runs on its own timer that could
 *    drift against the legs.  The one cue that says "puppet" has an audio
 *    twin, and it is a footstep loop.
 *  - **Quiet.**  This is a meadow, not a game show.  The master sits low
 *    and the compressor is there for safety, not loudness.
 * ------------------------------------------------------------------ */

const MASTER = 0.42;

/** Two seconds of white noise, shared by everything that hisses. */
function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function createAudio() {
  /** @type {AudioContext} */
  let ctx = null;
  let master, duck, comp, noise;
  const rng = rngKit(1109);

  /* Three states, cycled by M: everything, just-the-weather, nothing. */
  const MODES_M = ['on', 'quiet', 'off'];
  let mode = localStorage.getItem('hedgepig.sound') || (localStorage.getItem('hedgepig.mute') === '1' ? 'off' : 'on');
  if (!MODES_M.includes(mode)) mode = 'on';
  let muted = mode === 'off';
  let unlocked = false;

  /* Persistent beds, built once at unlock: {src|osc, filter, gain} */
  let wind, rain, crickets, cicadas, lake, rumble, swish;

  /* One-shot schedulers */
  let birdIn = 3;
  let musicIn = 6;
  let prevBall = 0;
  let prevCarD = Infinity;
  let prevDayPhase = 0;
  const feet = { last: 0 };

  /** A looping noise voice through a bandpass, starting silent. */
  function noiseVoice(type, freq, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.start();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(duck);
    return { src, f, g };
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = mode === 'on' ? MASTER : mode === 'quiet' ? MASTER * 0.55 : 0;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    duck = ctx.createGain();          // the snow hush rides this
    duck.gain.value = 1;
    duck.connect(comp).connect(master).connect(ctx.destination);
    noise = noiseBuffer(ctx);

    wind = noiseVoice('bandpass', 320, 0.45);
    rain = noiseVoice('highpass', 2400, 0.7);
    lake = noiseVoice('bandpass', 700, 1.2);
    swish = noiseVoice('bandpass', 3400, 0.6);   // his own body through the blades

    /* Crickets: a high carrier chopped ~26 times a second.  The chop is an
     * oscillator into the gain's AudioParam, which is the whole trick. */
    {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 4300;
      const chop = ctx.createOscillator();
      chop.frequency.value = 26;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      const level = ctx.createGain();
      level.gain.value = 0;
      chop.connect(depth).connect(g.gain);
      osc.connect(g).connect(level).connect(duck);
      osc.start(); chop.start();
      crickets = { g: level };
    }

    /* Cicadas: the crickets' day shift, higher and harsher, summer noon. */
    {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 5600;
      const chop = ctx.createOscillator();
      chop.frequency.value = 42;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const level = ctx.createGain();
      level.gain.value = 0;
      chop.connect(depth).connect(g.gain);
      osc.connect(g).connect(level).connect(duck);
      osc.start(); chop.start();
      cicadas = { g: level };
    }

    /* The ball: a low rolling rumble, pitch and level driven every frame. */
    {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = 0.3;
      src.start();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 140;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(duck);
      rumble = { f, g };
    }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    build();
    if (ctx.state === 'suspended') ctx.resume();
  }

  /* ------------------------------- one-shots ------------------------------ */

  /** A pitched blip: the atom every melodic sound here is built from. */
  function blip(freq, { dur = 0.18, vol = 0.12, type = 'sine', glide = 0, at = 0, pan = 0 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let out = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    o.connect(g);
    out.connect(duck);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A puff of filtered noise: footsteps, sniffs, whooshes. */
  function puff(freq, { dur = 0.08, vol = 0.1, q = 1, glide = 0, at = 0 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + rng.next() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (glide) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + glide), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(duck);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** One footfall.  Wet ground pats, dry ground ticks. */
  function footfall(wet = 0) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    if (now - feet.last < 0.05) return;      // four feet, but not a drumroll
    feet.last = now;
    puff(lerp(1900, 900, wet), { dur: 0.045, vol: 0.05 + wet * 0.02, q: 0.8 });
    blip(lerp(150, 110, wet), { dur: 0.05, vol: 0.035, type: 'sine' });
  }

  function sniff() {
    if (!ctx || muted) return;
    const n = 2 + (rng.next() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      puff(1350 + rng.range(-150, 150), { dur: 0.06, vol: 0.028, q: 1.6, at: i * 0.11 });
    }
  }

  /** Sowing: a two-note pluck, pitched by what came up. */
  const SCALE = [523.3, 587.3, 659.3, 784.0, 880.0];    // C major pentatonic
  function sow(kind = '') {
    if (!ctx || muted) return;
    let h = 0;
    for (const c of kind) h = (h * 31 + c.charCodeAt(0)) % 997;
    const a = SCALE[h % SCALE.length];
    const b = SCALE[(h + 2) % SCALE.length] * 2;
    blip(a, { dur: 0.5, vol: 0.10, type: 'triangle' });
    blip(b, { dur: 0.7, vol: 0.06, type: 'sine', at: 0.09 });
  }

  function hurt() {
    if (!ctx || muted) return;
    blip(880, { dur: 0.16, vol: 0.16, type: 'square', glide: -430 });
    blip(70, { dur: 0.22, vol: 0.14, type: 'sine', at: 0.02 });
  }

  function home() {
    if (!ctx || muted) return;
    [0, 2, 4].forEach((s, i) => blip(SCALE[s], { dur: 0.5, vol: 0.09, type: 'triangle', at: i * 0.13 }));
    blip(SCALE[0] * 2, { dur: 0.9, vol: 0.07, type: 'sine', at: 0.42 });
  }

  /** The owl, from somewhere in the wood — pass which side of you it is. */
  function hoot(pan = 0) {
    if (!ctx || muted) return;
    blip(392, { dur: 0.28, vol: 0.05, type: 'sine', glide: -40, pan });
    blip(330, { dur: 0.55, vol: 0.06, type: 'sine', glide: -50, at: 0.42, pan });
  }

  /** A fish breaking the surface, or a frog getting out of his way. */
  function plip() {
    if (!ctx || muted) return;
    blip(820, { dur: 0.1, vol: 0.05, type: 'sine', glide: -520 });
    puff(1800, { dur: 0.09, vol: 0.03, q: 1.2, at: 0.02 });
  }

  /** Something small being happily eaten. */
  function nom() {
    if (!ctx || muted) return;
    blip(310, { dur: 0.09, vol: 0.06, type: 'triangle', glide: -70 });
    blip(255, { dur: 0.11, vol: 0.05, type: 'triangle', glide: -60, at: 0.13 });
  }

  /** A tongue at the water. */
  function lap() {
    if (!ctx || muted) return;
    for (let i = 0; i < 3; i++) {
      puff(1100 + rng.range(-100, 100), { dur: 0.05, vol: 0.022, q: 1.4, at: i * 0.16 });
    }
  }

  /** Distant thunder: a long low grumble, never a crack. */
  function thunder() {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = 0.18;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 90;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6);
    src.connect(f).connect(g).connect(duck);
    src.start(t0);
    src.stop(t0 + 2.8);
  }

  /** The sneeze: a squeak of an animal a fifth of a metre long. */
  function sneeze() {
    if (!ctx || muted) return;
    puff(2100, { dur: 0.07, vol: 0.06, q: 0.8 });
    blip(760, { dur: 0.12, vol: 0.07, type: 'triangle', glide: -320, at: 0.03 });
  }

  /** A hen with somewhere better to be. */
  function squawk() {
    if (!ctx || muted) return;
    for (let i = 0; i < 3; i++) {
      blip(rng.range(560, 720), { dur: 0.09, vol: 0.045, type: 'square', glide: rng.range(80, 200), at: i * 0.11 });
    }
  }

  /** A short birdsong phrase, off to one side. */
  function birdPhrase() {
    const notes = 3 + Math.floor(rng.next() * 3);
    const base = rng.range(2300, 3400);
    const pan = rng.range(-0.8, 0.8);
    let at = 0;
    for (let i = 0; i < notes; i++) {
      blip(base * rng.range(0.9, 1.25), {
        dur: rng.range(0.05, 0.12), vol: 0.035, type: 'sine',
        glide: rng.range(-500, 700), at, pan,
      });
      at += rng.range(0.07, 0.16);
    }
  }

  /** The music box: one soft pluck at a time, seasons apart. */
  const MODES = {
    spring: [523.3, 587.3, 659.3, 784.0, 880.0],
    summer: [523.3, 659.3, 698.5, 784.0, 987.8],
    autumn: [440.0, 523.3, 587.3, 659.3, 784.0],
    winter: [392.0, 440.0, 523.3, 587.3, 698.5],
  };
  function musicNote(season) {
    const scale = MODES[season] || MODES.summer;
    const f = scale[Math.floor(rng.next() * scale.length)];
    blip(f, { dur: 1.6, vol: 0.045, type: 'sine', pan: rng.range(-0.4, 0.4) });
    blip(f * 2.005, { dur: 1.1, vol: 0.018, type: 'sine' });     // a detuned octave shimmer
    if (rng.next() < 0.3) blip(f * 1.5, { dur: 1.4, vol: 0.03, type: 'sine', at: rng.range(0.3, 0.7) });
  }

  /* --------------------------------- update -------------------------------- */

  /**
   * Once a frame.  `state` is the climate state; `world.out.cars` is what the
   * road pass built.  Every gain here is set with a short time-constant so
   * nothing ever clicks.
   */
  function update(dt, hog, state, world) {
    if (!ctx || mode === 'off') return;
    const t = ctx.currentTime;
    const set = (param, v, tc = 0.25) => param.setTargetAtTime(v, t, tc);

    const day = 1 - state.night;
    const hush = 1 - state.snow * 0.65;        // snow is a hush, not a sound
    set(duck.gain, hush, 0.8);

    // wind: always there, harder in winter and in weather, wandering slowly
    const windAmt = clamp(0.16 + state.wind * 0.5 + state.snowFall * 0.2, 0, 0.8);
    set(wind.g.gain, windAmt * 0.16);
    set(wind.f.frequency, 280 + Math.sin(t * 0.13) * 90 + state.wind * 160, 1.2);

    // rain on the leaves, straight off how wet the sky is
    set(rain.g.gain, clamp(state.wet, 0, 1) * 0.09);

    // crickets after dusk, silent in winter and under rain
    const cricketAmt = state.night * (state.season === 'winter' ? 0 : 1) * (1 - state.wet);
    set(crickets.g.gain, cricketAmt * 0.05);

    // and cicadas at the hot height of a summer day
    const summer = state.w ? state.w[1] : 0;
    set(cicadas.g.gain, summer * day * (1 - state.wet) * 0.016);

    // the lake, as near as HE is to the water
    const toShore = distance(hog.x, hog.z, CENTRE[LAKE].x, CENTRE[LAKE].z) - LAKE_R;
    const lakeAmt = clamp(1 - toShore / 9, 0, 1);
    set(lake.g.gain, lakeAmt * lakeAmt * 0.07);
    set(lake.f.frequency, 650 + Math.sin(t * 0.7) * 180, 0.5);

    // his own passage through the grass, scaled by how hard he is pushing
    const swishAmt = hog.gait * (1 - hog.ball) * (1 + (hog.rainHurry || 0) * 2);
    set(swish.g.gain, swishAmt * 0.022, 0.1);

    /* Traffic: the nearest live car, WITH its doppler — the pitch leans on
     * the closing speed, so a car coming at you and a car leaving you are
     * different sounds, which is most of what "a car went by" is. */
    let carD = Infinity;
    for (const c of world?.out?.cars || []) {
      if (c.live) carD = Math.min(carD, distance(hog.x, hog.z, c.x, c.z));
    }
    const carAmt = Number.isFinite(carD) ? clamp(1 - carD / 7, 0, 1) : 0;
    let doppler = 0;
    if (Number.isFinite(carD) && Number.isFinite(prevCarD) && dt > 0) {
      doppler = clamp(((prevCarD - carD) / dt) * 22, -140, 140);
    }
    prevCarD = carD;

    // rolling: rumble level and pitch off the real tuck and speed
    const rolling = hog.ball * hog.gait;
    set(rumble.g.gain, rolling * 0.14 + carAmt * carAmt * 0.05);
    set(rumble.f.frequency, 120 + rolling * 130 + carAmt * 260 + doppler * carAmt, 0.15);

    // the tuck and the unfurl, as one-shots off the ball crossing half
    if (prevBall < 0.5 && hog.ball >= 0.5) puff(900, { dur: 0.3, vol: 0.09, glide: -600 });
    if (prevBall > 0.5 && hog.ball <= 0.5) puff(500, { dur: 0.22, vol: 0.06, glide: 400 });
    prevBall = hog.ball;

    // birds in daylight, never in winter, and not in the rain
    birdIn -= dt;
    if (birdIn <= 0) {
      birdIn = rng.range(3, 9) / Math.max(0.15, day);
      if (day > 0.5 && state.season !== 'winter' && state.wet < 0.4) birdPhrase();
    }

    // and the music box, very sparse, resting entirely at deep night
    musicIn -= dt;
    if (musicIn <= 0) {
      musicIn = rng.range(4, 11);
      if (state.night < 0.9) musicNote(state.season);
    }

    /* Dawn gets a whole phrase — once, as the sun clears the ground.  The
     * only time the music box plays more than a note or two together. */
    const dp = state.dayPhase ?? 0;
    if (prevDayPhase < 0.82 && dp >= 0.82 && !muted) {
      const scale = MODES[state.season] || MODES.summer;
      [0, 1, 2, 3, 4, 2, 4].forEach((si, i) => {
        blip(scale[si % scale.length] * (si >= scale.length ? 2 : 1), {
          dur: 0.9, vol: 0.05, type: 'sine', at: i * 0.28,
        });
      });
    }
    prevDayPhase = dp;
  }

  /** The boat working at its mooring lines. */
  function creak() {
    if (!ctx || muted) return;
    blip(90, { dur: 0.3, vol: 0.05, type: 'triangle', glide: 25 });
    blip(310, { dur: 0.4, vol: 0.025, type: 'sawtooth', glide: 60, at: 0.05 });
  }

  /** A drip in the culvert, twice — once itself, once its echo. */
  function drip() {
    if (!ctx || muted) return;
    blip(1150, { dur: 0.09, vol: 0.05, type: 'sine', glide: -700 });
    blip(1150, { dur: 0.11, vol: 0.02, type: 'sine', glide: -700, at: 0.19 });
  }

  function toggleMute() {
    mode = MODES_M[(MODES_M.indexOf(mode) + 1) % MODES_M.length];
    localStorage.setItem('hedgepig.sound', mode);
    /* `quiet` keeps the beds — wind, rain, crickets — and mutes every
     * one-shot: the meadow still breathes, and nothing pips at you. */
    muted = mode !== 'on';
    const level = mode === 'on' ? MASTER : mode === 'quiet' ? MASTER * 0.55 : 0;
    if (master && ctx) master.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
    return mode;
  }

  return {
    unlock, update, toggleMute,
    footfall, sniff, sow, hurt, home, hoot, plip, squawk, nom, lap, sneeze, thunder, creak, drip,
    get muted() { return muted; },
  };
}
