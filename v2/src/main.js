import * as THREE from 'three';
import { PAL } from './core/palette.js';
import { Pipeline } from './core/post.js';
import { buildSky } from './core/sky.js';
import { setOutlineResolution } from './core/outline.js';
import { createHud } from './core/hud.js';
import { Chase } from './core/chase.js';
import { buildWorld } from './world/index.js';
import { buildPlaces } from './world/places/index.js';
import { createClimate } from './world/season.js';
import { createWeather } from './world/weather.js';
import { R, CENTER, basisAt, positionAt } from './world/planet.js';
import { clamp, wrapAng } from './core/util.js';
import { placeAt, placeKindAt, PLACE, WOOD, CIRC, CENTRES, PAD, bearing, distance } from './world/plan.js';
import { waterDepthAt } from './world/terrain.js';
import { blobTex } from './core/textures.js';
import { Hog } from './hog/hog.js';
import { createGame } from './game/game.js';
import { createAudio } from './core/audio.js';
import { createCritters } from './world/critters.js';
import { createCharacters } from './world/characters.js';
import { createDialogue } from './core/dialogue.js';
import { createPuffs, createPrints } from './core/puffs.js';
import { createHoglet } from './game/hoglet.js';
import { createMission } from './game/mission.js';
import { createTouch } from './core/touch.js';

/* ------------------------------------------------------------------ *
 * the hedgepig adventure — v2.
 *
 * Entry point: renderer, the two-light anime rig, the world, him, and the
 * loop.  Lighting is one warm quantised key, one cool bounce from the
 * opposite quarter, a weak up-light so undersides never go flat, and a
 * hemisphere with a violet ground colour so nothing in shade is ever black.
 *
 * The one thing here that is really about the planet: **the lights are
 * pinned to his local surface frame**, not to world space.  Physically that
 * is a cheat — walk a quarter of the way round and the sun should have set.
 * What it buys is that the field is lit the same way wherever you are, and
 * the time of day is driven by the clock in `season.js` instead of by where
 * you happen to be standing, which is the whole point of the rewrite.
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('view');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(new THREE.Color(PAL.fog), 1);

const scene = new THREE.Scene();

/* Near plane at 4 cm: he is 26 cm long and you can push the camera right up
 * to his nose, and a near plane that clips his snout is the first thing
 * anyone notices. */
const camera = new THREE.PerspectiveCamera(48, 1, 0.04, 400);
camera.rotation.order = 'YXZ';

/* --------------------------------- light --------------------------------- */
const sun = new THREE.DirectionalLight(PAL.sun, 2.15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
/* The shadow camera has to cover everything the fog does not hide, not just
 * what is near him.  At ±6 m it did cover him beautifully — 6 mm per texel —
 * and dropped **the entire rest of the world into shadow**, because a
 * fragment sampled outside the shadow map clamps to its edge and comes back
 * occluded.  What that looks like is a pool of daylight around the hedgepig
 * and a dark planet beyond it, which is a very convincing bug: it reads as
 * deliberate art direction until you walk. */
const SHADOW_HALF = 17;
sun.shadow.camera.left = -SHADOW_HALF;
sun.shadow.camera.right = SHADOW_HALF;
sun.shadow.camera.top = SHADOW_HALF;
sun.shadow.camera.bottom = -SHADOW_HALF;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 46;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.012;
scene.add(sun, sun.target);

const fill = new THREE.DirectionalLight(PAL.fill, 1.05);
scene.add(fill, fill.target);

const bounce = new THREE.DirectionalLight(0xd8cbe8, 0.32);
scene.add(bounce, bounce.target);

const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.05);
scene.add(hemi);

/* --------------------------------- world --------------------------------- */
const sky = buildSky(scene, 260);
const world = buildWorld(scene, { places: buildPlaces });
const hog = new Hog(world, { scene });
const chase = new Chase(camera, canvas, hog, world);
const pipeline = new Pipeline(renderer, scene, camera);
const hud = createHud();
const weather = createWeather(scene);
const climate = createClimate({ scene, sun, fill, bounce, hemi, sky, grass: world.grass, ground: world.ground, pipeline });
const audio = createAudio();
const critters = createCritters(scene, {
  plip: () => audio.plip(),
  /* The hoot arrives from the owl's side of the frame. */
  hoot: () => {
    const owl = critters?.owl;
    if (!owl) return audio.hoot();
    const b = Math.atan2(owl.z - hog.z, owl.x - hog.x);
    audio.hoot(Math.max(-0.8, Math.min(0.8, Math.sin(b - chase.yaw))));
  },
});
const characters = createCharacters(scene);
const dialogue = createDialogue();
const puffs = createPuffs(scene);
const prints = createPrints(scene);
const hoglet = createHoglet(scene);
const hoglet2 = createHoglet(scene, { seed: 331, phase: 87.3 });
/* The second hoglet follows the FIRST — a train, each watching the one
 * ahead.  The adapter is mutated in place each frame; a hoglet is enough
 * of a hedgehog for another hoglet's purposes. */
const hoglet1Leader = { x: 0, z: 0, hd: 0, gait: 0, speed: 0.85, shiver: 0, night: 0, wet: 0 };
const game = createGame({ world, hog, hud, climate, audio });
const mission = createMission({
  scene, camera, chase, hog, world, hud, climate, sky, audio, game, puffs, renderer,
});
/* Nothing that flies, hops, or lives in the wood comes to Mars.  Every one of
 * these ranges off *him* rather than off the camera — which is the invariant
 * the whole world is built on — so left running they would all have followed
 * him there and gone on being a robin in a butterscotch sky. */
/* Thumbs.  Built lazily on the first real touch, so a laptop with a
 * touchscreen gets the buttons only once somebody uses their hands. */
const touch = createTouch({
  canvas, chase,
  onHop: () => { if (!mission.active) hog.jump(); },
  onAct: () => tryBoard(),
});

mission.leaveBehind(
  scene.getObjectByName('critters'), characters.group,
  hoglet.parts?.root, hoglet.parts?.shadow,
  hoglet2.parts?.root, hoglet2.parts?.shadow,
);

/* The tap ripple: one ring, reused, spreading from wherever was called. */
const ripple = new THREE.Mesh(
  new THREE.RingGeometry(0.84, 0.92, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xfff8e8, transparent: true, opacity: 0, depthWrite: false, fog: false })
);
ripple.matrixAutoUpdate = false;
ripple.visible = false;
ripple.renderOrder = 4;
scene.add(ripple);
const rippleAt = { x: 0, z: 0, t: 0 };

/* A tap sows **and sends him**, as it always did — and the keys still drive
 * him, which is the point: a click is for "over there, while I watch", the
 * keys are for steering.  They cannot fight, because a live throttle drops
 * the target outright (see `hog.driveBy`), so whichever you touched last is
 * the one in charge. */
chase.onCall = (x, z) => {
  game.call(x, z);
  rippleAt.x = x; rippleAt.z = z; rippleAt.t = 0.55;
};

/* ------------------------------- the keys -------------------------------- *
 *
 * WASD drives him, **relative to the camera** — W is away from you, which is
 * the only mapping anybody has to be told once. On a planet that is not a
 * world-space vector: the camera's forward is built in his own tangent frame
 * from `chase.yaw`, and `hog.driveBy` takes a heading in exactly that frame,
 * so the whole conversion is one angle and no vectors at all.
 *
 * **Double-tap a direction to roll**, which is where the double-*click* used
 * to live. Holding it keeps him tucked; letting go of everything unfurls him.
 * That keeps the gesture people already knew and puts it on the hand that is
 * now steering.
 *
 * The heading comes off the **camera's own forward**, not off `chase.yaw`.
 * They agree to within the camera's smoothing lag most of the time, but not
 * always: the chase clamps its position when the ground would come between it
 * and him, and then re-aims — so the yaw it was asked for and the direction it
 * is actually looking part company exactly when you are backed into a bank,
 * which is exactly when you are pressing keys hardest.
 *
 * `RIGHT_OF` was *measured* rather than reasoned. The sign depends on the
 * handedness of (east, up, north) as `makeBasis` consumes it, and getting it
 * backwards gives mirrored controls — which reads as a broken camera rather
 * than as a wrong sign. Screen-right is forward + π/2 in that frame, and
 * `east × up = north`; both were checked against the live camera.
 */
const RIGHT_OF = Math.PI / 2;
const _camFwd = new THREE.Vector3();
let compassIn = 0;
const DRIVE_KEYS = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
};
const held = new Set();
let rollHeld = false;
let lastDriveTap = { key: '', at: -1e9 };

function driveHog() {
  /* The thumb and the keys go down the **same** path from here: a screen-space
   * forward and right, turned into a heading against wherever the camera is
   * actually looking.  Two routes to `driveBy` would be two chances to
   * disagree about which way "forward" is. */
  const stick = touch.drive();
  let f, r, throttle, roll;
  if (stick) {
    f = stick.f; r = stick.r; throttle = stick.throttle; roll = stick.roll;
  } else {
    f = (held.has('f') ? 1 : 0) - (held.has('b') ? 1 : 0);
    r = (held.has('r') ? 1 : 0) - (held.has('l') ? 1 : 0);
    throttle = Math.min(1, Math.hypot(f, r));
    roll = rollHeld;
  }
  if (!f && !r) {
    rollHeld = false;
    hog.driveBy(0, 0, false);
    return;
  }
  const b = basisAt(hog.x, hog.z);
  camera.getWorldDirection(_camFwd);
  const fe = _camFwd.dot(b.east);
  const fn = _camFwd.dot(b.north);
  /* Looking almost straight down, the forward has no bearing left in it and
   * the heading would spin on rounding error.  Fall back to what the chase
   * was asked for, which always has one. */
  const yaw = Math.hypot(fe, fn) > 1e-3 ? Math.atan2(fn, fe) : chase.yaw;

  const east = Math.cos(yaw) * f + Math.cos(yaw + RIGHT_OF) * r;
  const north = Math.sin(yaw) * f + Math.sin(yaw + RIGHT_OF) * r;
  // a diagonal is not faster than a straight line
  hog.driveBy(Math.atan2(north, east), throttle, roll);
}

/* Sound: unlocked by the first gesture (the autoplay rule and also simply
 * polite), fed by the same edges the animation runs on. */
window.addEventListener('pointerdown', audio.unlock, { once: true });
window.addEventListener('keydown', audio.unlock, { once: true });
world.setSound?.((name) => audio[name]?.());
hog.onFootfall = () => {
  const s = climate.state;
  audio.footfall(s.wet);
  /* Dust off a dry scurry, splash off a wet one, powder in snow — spawned
   * at the place the foot planted, where it stays as he runs on. */
  if (hog.gait > 0.45) {
    const kind = s.snow > 0.5
      ? { n: 2, up: 0.10, spread: 0.05, px: 18, color: 0xeef4fa }
      : s.wet > 0.3
        ? { n: 2, up: 0.14, spread: 0.05, px: 13, color: 0xb8cfdd }
        : { n: 2, up: 0.07, spread: 0.06, px: 16, color: 0xc9ba90 };
    puffs.burst(hog.x, hog.y + 0.004, hog.z, kind);
  }
  // and where the ground would take a print, it takes one
  if (s.snow > 0.45) prints.stamp(hog.x, hog.y, hog.z, hog.hd, 0x8f9ab8);
  else if (s.wet > 0.4) prints.stamp(hog.x, hog.y, hog.z, hog.hd, 0x5f5444);
};
/* His voice.  The animator fires these as often as the *animation* wants;
 * `audio` decides how often he actually says anything — see the voice gate
 * in `core/audio.js`.  Wiring the sounds straight to the animation gave a
 * hedgehog snuffling without pause, forever. */
hog.onSniff = () => audio.snuffle();
hog.onNuzzle = () => audio.chunter();
hog.onPleased = () => audio.peep();
hog.onGrumble = () => audio.grumble();
hog.onJump = () => audio.hop();
hog.onLand = (plat) => {
  audio.land(!!plat);
  const s = climate.state;
  puffs.burst(hog.x, hog.y + 0.004, hog.z, { n: 5, up: 0.10, spread: 0.14, px: 16,
    color: s.snow > 0.4 ? 0xe8eef4 : 0xcbb98e });
};
hog.onSneeze = () => {
  audio.sneeze();
  puffs.burst(hog.x, hog.y + 0.07, hog.z, { n: 3, up: 0.05, spread: 0.12, px: 12, color: 0xe8dcc8 });
};
hog.onNom = () => {
  audio.nom();
  puffs.burst(hog.x, hog.y + 0.05, hog.z, { n: 4, up: 0.08, spread: 0.08, px: 10, color: 0xd8c8a8 });
};

/* ------------------------------- the frame ------------------------------- */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pipeline.setSize(w, h);
  setOutlineResolution(pipeline.size.x, pipeline.size.y);
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------ planet view ------------------------------ */
let planetView = false;
let orbit = 0.6;
const orbitDir = new THREE.Vector3();
let savedFog = null;

function setPlanetView(on) {
  planetView = on;
  if (on) {
    savedFog = scene.fog;
    scene.fog = null;
    camera.far = 1200;
    const s = sun.shadow.camera;
    s.left = -R * 1.15; s.right = R * 1.15; s.top = R * 1.15; s.bottom = -R * 1.15;
    s.far = R * 6;
    s.updateProjectionMatrix();
  } else {
    scene.fog = savedFog;
    camera.far = 400;
    const s = sun.shadow.camera;
    s.left = -SHADOW_HALF; s.right = SHADOW_HALF; s.top = SHADOW_HALF; s.bottom = -SHADOW_HALF;
    s.far = 46;
    s.updateProjectionMatrix();
  }
  camera.updateProjectionMatrix();
  sky.setOrbit(on);
}

/* --------------------------------- input --------------------------------- */
window.addEventListener('keyup', (e) => {
  const d = DRIVE_KEYS[e.code];
  if (d) { held.delete(d); if (!held.size) rollHeld = false; }
});
// let go of the window with a key down and he would run on for ever
window.addEventListener('blur', () => { held.clear(); rollHeld = false; });

window.addEventListener('keydown', (e) => {
  const d = DRIVE_KEYS[e.code];
  if (d) {
    e.preventDefault();
    if (!e.repeat) {
      /* Two taps of the same direction, near enough together, tucks him.
       * The first has already set him off, so the second is an *upgrade*
       * rather than a fresh start — which is why it feels immediate. */
      const now = performance.now();
      if (lastDriveTap.key === d && now - lastDriveTap.at < 340) {
        rollHeld = true;
        lastDriveTap = { key: '', at: -1e9 };
      } else {
        lastDriveTap = { key: d, at: now };
      }
    }
    held.add(d);
  }
  if (e.repeat) return;
  /* **Space is the hop.**  It used to stop him, which the keys now do by
   * being let go of — a stop key made sense when a click sent him somewhere
   * and you had no other way to change your mind. */
  /* Space is the hop — unless somebody is talking to him, in which case it
   * is the one interaction convention everybody already knows.  `advance`
   * says whether it did anything, and swallowing that is the whole point:
   * without it the same press finishes the line AND hops him away from the
   * animal saying it. */
  if (e.code === 'Space') { if (!dialogue.advance()) hog.jump(); e.preventDefault(); }
  if (e.code === 'Escape') { hog.stop(); held.clear(); rollHeld = false; }
  /* **E is the whole point of the game.**  Deliberately a key and not a walk
   * -into-it trigger: everything else in this world happens by being near it,
   * and leaving the planet is the one thing that should take a decision. */
  if (e.code === 'KeyE') tryBoard();
  if (e.code === 'KeyP') {
    setPlanetView(!planetView);
    hud.flash(planetView ? 'the whole of it · P to come back down' : 'back in the grass');
  }
  // two quiet toggles, for seeing what the ink and the grade actually do
  if (e.code === 'KeyO') pipeline.enabled.ink = !pipeline.enabled.ink;
  if (e.code === 'KeyG') pipeline.enabled.grade = !pipeline.enabled.grade;
  if (e.code === 'KeyM') {
    const m = audio.toggleMute();
    hud.flash(m === 'on' ? 'sound on' : m === 'quiet' ? 'just the weather' : 'sound off');
  }
  if (e.code === 'KeyC') {
    const on = document.body.classList.toggle('photo');
    if (!on) hud.flash('back to the panels');
  }
  if (e.code === 'KeyJ') {
    const LABELS = {
      thistle: 'found a golden thistle',
      berries: 'ate three autumn berries at once',
      hoglet: 'a hoglet found him',
      hoglet2: 'and then another one',
      boat: 'rode the boat across the lake',
      culvert: 'went under the road',
      rainbow: 'stood beneath a rainbow',
      storm: 'weathered a storm',
      winter: 'stood out in deep snow',
      owl: 'heard the owl in the wood',
      slept: 'slept a whole night in a burrow',
      everywhere: 'stood in every place there is',
      everyone: 'met everyone who lives in the wood',
    };
    hud.toggleJournal(Object.keys(game.state.flags).map((k) => LABELS[k]).filter(Boolean));
  }
  if (e.code === 'KeyN') {
    /* `N` names whichever hoglet is out there — the first until the second
     * arrives, and then the second, because the one you just met is the one
     * you want to name.  They shared a name before, which made the pair read
     * as one animal drawn twice. */
    if (hoglet2.state.live) {
      hoglet2Name = nextName(hoglet2Name, hogletName);
      localStorage.setItem('hedgepig.hoglet2', hoglet2Name);
      hud.flash(`and the little one answers to ${hoglet2Name}`);
    } else {
      hogletName = nextName(hogletName, hoglet2Name);
      localStorage.setItem('hedgepig.hoglet', hogletName);
      hud.flash(`the hoglet answers to ${hogletName} now`);
    }
  }
  if (e.code === 'KeyS' && document.body.classList.contains('photo') && import.meta.env?.DEV) {
    window.__shot?.(`photo-${Math.floor(acc * 10)}`, 1400, 800);
    hud.flash('kept, in .shots');
  }
});

const HOGLET_NAMES = ['Pip', 'Bramble', 'Conker', 'Sorrel', 'Moss', 'Teasel', 'Hazel', 'Dot'];
/** The next name round the list, skipping the one the other hoglet has. */
function nextName(cur, taken) {
  let i = HOGLET_NAMES.indexOf(cur);
  for (let k = 0; k < HOGLET_NAMES.length; k++) {
    i = (i + 1) % HOGLET_NAMES.length;
    if (HOGLET_NAMES[i] !== taken) return HOGLET_NAMES[i];
  }
  return cur;
}
let hogletName = localStorage.getItem('hedgepig.hoglet') || 'Pip';
let hoglet2Name = localStorage.getItem('hedgepig.hoglet2') || 'Teasel';

hud.onStart = () => {};
document.getElementById('start')?.addEventListener('click', () => hud.begin(), { once: true });

/* ---------------------------- the light rig ---------------------------- */
const _off = new THREE.Vector3();
const _origin = new THREE.Vector3();
const SUN_LOCAL = new THREE.Vector3();
const FILL_LOCAL = new THREE.Vector3(0.62, 0.36, -0.60);
const BOUNCE_LOCAL = new THREE.Vector3(0.14, -0.30, 0.55);

/** Seat a light so its direction stays fixed relative to the local surface. */
function seatLight(light, local, basis, origin, dist) {
  _off.set(0, 0, 0)
    .addScaledVector(basis.east, local.x * dist)
    .addScaledVector(basis.up, local.y * dist)
    .addScaledVector(basis.north, local.z * dist);
  light.target.position.copy(origin);
  light.position.copy(origin).add(_off);
  light.target.updateMatrixWorld();
}

/* ------------------------------ orbit labels ------------------------------ *
 * From orbit the planet becomes a map: each place gets its name, floating
 * over its centre, on the near side of the globe only. */
const orbitLabels = [];
{
  const hudEl = document.getElementById('hud');
  for (const c of CENTRES) {
    const div = document.createElement('div');
    div.textContent = PLACE[c.kind]?.name ?? '';
    div.style.cssText =
      'position:absolute;transform:translate(-50%,-50%);font-size:0.72rem;' +
      'color:#443e58;background:rgba(255,253,248,0.6);border-radius:0.5rem;' +
      'padding:0.06rem 0.4rem;display:none;white-space:nowrap;';
    hudEl?.appendChild(div);
    orbitLabels.push({ div, centre: c });
  }
}
const _lp = new THREE.Vector3();
function updateOrbitLabels(on) {
  for (const L of orbitLabels) {
    if (!on) { L.div.style.display = 'none'; continue; }
    positionAt(L.centre.x, 1.5, L.centre.z, _lp);
    // near side only: the label's surface point must face the camera
    const facing = _lp.clone().sub(CENTER).normalize()
      .dot(camera.position.clone().sub(CENTER).normalize());
    _lp.project(camera);
    const ok = facing > 0.15 && _lp.z < 1;
    L.div.style.display = ok ? 'block' : 'none';
    if (ok) {
      L.div.style.left = `${(_lp.x * 0.5 + 0.5) * window.innerWidth}px`;
      L.div.style.top = `${(-_lp.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }
}

/* --------------------------------- loop --------------------------------- */
const clock = new THREE.Clock();
let acc = 0;
let wetFor = 0;
let rollPuffT = 0;
let prevBallFx = 0;
let carryIn = 30;
let lapT = 0;
let boltIn = 20;
let thunderIn = -1;
let prevBlocked = 0;
let creakT = 0;
let dripT = 0;
let prevWetJ = 0;
let lanternAmt = 0;
const _lanternP = new THREE.Vector3();
const _lanternM = new THREE.Matrix4();

/* Rain on his quills: a scatter of glints over the mantle that light up in
 * the wet and dry off slowly after.  Children of his trunk, so they curl
 * when he curls. */
const glints = (() => {
  const N2 = 14;
  const pos = new Float32Array(N2 * 3);
  const grng = { s: 9901, next() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; } };
  let placed = 0;
  while (placed < N2) {
    const y = grng.next() * 2 - 1;
    const a = grng.next() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const u = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    if (u.dot(new THREE.Vector3(0.8, -0.6, 0).normalize()) > 0.1) continue;  // mantle only
    pos[placed * 3] = u.x * 0.134;
    pos[placed * 3 + 1] = u.y * 0.082;
    pos[placed * 3 + 2] = u.z * 0.091;
    placed++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.008, color: 0xeaf4ff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  pts.visible = false;
  hog.parts.trunk.add(pts);
  return pts;
})();
let glintAmt = 0;

/* The firefly lantern rig: three glowing motes and a PAINTED pool of warm
 * on the ground.  The first version used a real PointLight, and this file's
 * own lighting note says exactly why that was wrong: there is no light
 * source in this world but the sky, and a point light under the cel ramp
 * quantises into a huge banded dome — a searchlight, not a firefly.  A
 * lamp here is a colour, not a light. */
const flies = new THREE.Group();
for (let i = 0; i < 3; i++) {
  const f = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xe4f89a, transparent: true, opacity: 0, fog: false, depthWrite: false })
  );
  f.userData.noOutline = true;
  flies.add(f);
}
flies.visible = false;
scene.add(flies);
const lanternPool = new THREE.Mesh(
  new THREE.PlaneGeometry(0.55, 0.55).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    color: 0x8a8a58, map: blobTex(), transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  })
);
lanternPool.matrixAutoUpdate = false;
lanternPool.visible = false;
lanternPool.renderOrder = 3;
lanternPool.userData.noOutline = true;
scene.add(lanternPool);

/* The lightning is DOM: a white wash over everything for a tenth of a
 * second.  Cheaper than touching the lighting rig, and honester too — a
 * flash at the eye is what lightning does to a frame. */
const bolt = document.createElement('div');
bolt.style.cssText =
  'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity 90ms ease;z-index:5;';
document.body.appendChild(bolt);
const _rippleM = new THREE.Matrix4();
const _rippleS = new THREE.Vector3();

/* ---------------------------- the residents ---------------------------- *
 *
 * Four animals in the wood who live at fixed addresses and have opinions.
 * Walking up to one opens the panel; walking off closes it; standing there
 * gets you the next thing they have to say.
 *
 * Two things here are deliberate and neither is obvious:
 *
 *  - **What they are told is the two states merged.**  A line's condition may
 *    ask about the weather (`climate.state`) or about how he is doing
 *    (`game.state.hearts`, `.found`), and neither object knows the other
 *    exists.  Merged in place rather than spread fresh, because it is read
 *    on a frame that is already the busiest one there is.
 *  - **He keeps a resident once he has one, out to `talk + 0.45`.**  Leaving
 *    at the same radius he arrived at means a hedgehog snuffling on the spot
 *    crosses it and the panel blinks out mid-sentence.
 */
const _talkState = {};
let metResident = null;
let talkIn = 0;

/* One line every this long while he stands there.  Comfortably longer than
 * the longest line in the cast takes to type itself on (0.018 s a character
 * plus its punctuation, so about three seconds for the toad's worst), because
 * `open` replaces what is being said and replacing a line half-read is worse
 * than a silence. */
const TALK_GAP = 5.5;

/* The rim of the compass, for a resident's dot.  Twenty metres, not half a
 * lap: they all live inside one wood, so on the burrow's scale the four of
 * them collapsed into a single smudge in the middle of the ring and the whole
 * point of having bearings went with it.  Past this they simply sit on the
 * rim, which reads as "that way, and a long way" — which is true. */
const FOLK_FAR = 20;

function speakTo(c, state) {
  talkIn = TALK_GAP;
  Object.assign(_talkState, state, { hearts: game.state.hearts, found: game.state.found });
  dialogue.open(c.name, c.say(_talkState, hog));
  /* Ticked off on the ring, once, ever.  The toast is the only place the
   * count is ever spoken out loud — the compass itself stays wordless, which
   * is the rule the whole thing was built under. */
  if (game.meet(c.key)) {
    const left = characters.all.length - game.state.met.length;
    hud.flash(left
      ? `met ${c.name} — ${left} more of them out there`
      : `met ${c.name}. that is all four of them, and the wood knows you now`);
    if (!left) game.note('everyone');
  }
}

function meetResidents(dt, state) {
  talkIn -= dt;
  const busy = hog.under || hog.afloat;
  if (metResident) {
    if (busy || distance(hog.x, hog.z, metResident.x, metResident.z) > metResident.talk + 0.45) {
      metResident = null;
      dialogue.close();
      return;
    }
    // stand and listen and there is more of it
    if (talkIn <= 0) speakTo(metResident, state);
    return;
  }
  if (busy) return;
  const near = characters.nearest(hog.x, hog.z);
  if (near) { metResident = near; speakTo(near, state); }
}

/* ------------------------------- the aim -------------------------------- *
 *
 * There is a rocket in the mire and the point of the game is to get to it.
 * The burrow loop is still underneath — legs still advance, brambles still
 * thicken, he still sleeps at home after dark — but the *thing being aimed
 * at*, on the compass and in the readout, is the ship.  One goal at a time,
 * or a compass with two wedges on it is a compass you stop reading.
 */
const SHIP_REACH = 10.6;          // just outside the mount's own no-go
let boardPrompt = false;

function shipDistance() {
  return distance(hog.x, hog.z, PAD.x, PAD.z);
}

/** One way in, whichever thing asked — the key, or the thumb. */
function tryBoard() {
  if (mission.active || mission.onMars) return;
  if (shipDistance() >= SHIP_REACH) {
    hud.flash('the ship is in the mire, and it is the tallest thing in the world');
    return;
  }
  held.clear();
  rollHeld = false;
  hud.setPrompt('');
  touch.setAction('');
  mission.begin();
}

function offerCockpit(dt) {
  if (mission.active || mission.onMars) {
    if (boardPrompt) { boardPrompt = false; hud.setPrompt(''); touch.setAction(''); }
    return;
  }
  const near = shipDistance() < SHIP_REACH && !hog.under && !hog.afloat;
  if (near === boardPrompt) return;
  boardPrompt = near;
  /* Two ways of offering the same thing, because there are two ways of
   * taking it: a legend for the keyboard, a thumb-sized button for the
   * glass.  The button only exists once somebody has actually touched the
   * screen — see `touch.js`. */
  hud.setPrompt(near && !touch.touching ? '<kbd>E</kbd> climb aboard' : '');
  touch.setAction(near ? 'climb\naboard' : '');
  if (near) hud.flash('the hatch is open. it is a very long way up.');
}

function frame() {
  /* Armed first, not last.  Re-arming at the end means any exception
   * anywhere in the frame stops the loop permanently — the game freezes and
   * the only symptom is that nothing moves, which is a long way from the
   * line that threw.  Arming first costs nothing and turns a fatal bug into
   * a stutter and a console error. */
  requestAnimationFrame(frame);

  const raw = clock.getDelta();
  const dt = Math.min(raw, 1 / 20);
  acc += dt;
  /* Fed the **unclamped** delta: `dt` is capped at a twentieth of a second so
   * the physics cannot tunnel, and a scaler that only ever saw 50 ms would
   * never learn that the machine is doing 12 fps. */
  pipeline.adapt(raw * 1000);

  const state = climate.update(dt);

  hog.shiver = state.snow * 0.9;
  hog.night = state.night;
  hog.wet = state.wet;                 // rain darkens his coat
  hog.rainHurry = state.wet * 0.18;    // and hurries him along

  /* An autumn leaf worth carrying, every so often, while he is out walking. */
  carryIn -= dt;
  if (carryIn <= 0) {
    carryIn = 34 + Math.random() * 40;
    if (state.leafFall > 0.15 && hog.gait > 0.5 && hog.carry <= 0) hog.carry = 12 + Math.random() * 8;
  }

  /* Heavy rain carries the occasional distant storm: a flash, and its
   * thunder arriving late, the way thunder does. */
  if (state.wet > 0.55) {
    boltIn -= dt;
    if (boltIn <= 0) {
      boltIn = 24 + Math.random() * 40;
      bolt.style.opacity = '0.34';
      setTimeout(() => { bolt.style.opacity = '0'; }, 110);
      thunderIn = 1.2 + Math.random() * 2.2;
    }
  }
  if (thunderIn > 0) {
    thunderIn -= dt;
    if (thunderIn <= 0) { audio.thunder(); thunderIn = -1; }
  }

  /* Brushing into an autumn tree shakes leaves loose over him. */
  if (hog.blocked > 0.02 && prevBlocked === 0 && state.leafFall > 0.15 &&
      placeKindAt(hog.x, hog.z) === WOOD) {
    puffs.burst(hog.x, hog.y + 0.5, hog.z, { n: 6, up: -0.05, spread: 0.25, px: 30, color: 0xc98a45 });
  }
  prevBlocked = hog.blocked;

  /* The boat creaks under him, and the culvert drips over him. */
  creakT -= dt;
  if (hog.afloat && creakT <= 0) { creakT = 1.6 + Math.random() * 2.8; audio.creak(); }
  dripT -= dt;
  if (hog.under && dripT <= 0) { dripT = 0.9 + Math.random() * 1.6; audio.drip(); }

  /* Drinking: his nose down at the waterline is a nose in the water. */
  lapT -= dt;
  if (lapT <= 0 && (hog.anim?.face.nuzzleAmt || 0) > 0.75) {
    const cs = Math.max(0.08, Math.cos(hog.z / R));
    const nx = hog.x + (Math.cos(hog.hd) * 0.16) / cs;
    const nz = hog.z + Math.sin(hog.hd) * 0.16;
    if (waterDepthAt(nx, nz) > 0.004) {
      lapT = 3.5;
      audio.lap();
      critters.splash(nx, nz);
    }
  }
  /* A good soaking earns a shake-off when the rain stops. */
  if (state.wet > 0.35) wetFor += dt;
  else if (wetFor > 5 && state.wet < 0.08) { hog.shake = Math.max(hog.shake, 1.1); wetFor = 0; }
  /* **The flight owns everything while it is running.**  His legs, the game's
   * hazards and the chase camera are all switched off rather than fighting
   * it: a hedgehog is not walking anywhere from inside a rocket, and the two
   * traps in HANDOVER §10 are both what happens when something that ranges
   * off him keeps running while he is somewhere he cannot be. */
  const flying = mission.update(dt);
  game.state.goal = mission.onMars ? null : (mission.active ? undefined : PAD);
  if (flying) {
    hog.driveBy(0, 0, false);
    world.update(dt, hog, state);
    weather.update(dt, hog, camera, state);
    puffs.update(dt, state.night);
    hud.update(dt);
    pipeline.render(dt);
    return;
  }
  offerCockpit(dt);

  // the keys, read fresh each frame against wherever the camera has got to
  if (!planetView) driveHog(); else hog.driveBy(0, 0, false);
  hog.update(dt, acc);
  game.update(dt);
  world.update(dt, hog, state);
  weather.update(dt, hog, camera, state);
  /* **Not merely hidden — not run.**  Every one of these sets its own
   * `visible` from how far off him it is, so hiding the parent group and
   * letting the update carry on means the hoglet cheerfully switches itself
   * back on the next frame.  On Mars they do not exist. */
  if (!mission.onMars) {
    critters.update(dt, hog, state);
    characters.update(dt, hog, state);
    meetResidents(dt, state);
    dialogue.update(dt);
  }
  if (!mission.onMars && hoglet.update(dt, hog, game.state.leg >= 3, acc) === 'arrived') {
    hud.flash(`a hoglet has found him — ${hogletName}, and it will not be left behind`);
    game.note('hoglet');
  }
  const h1 = hoglet.state;
  Object.assign(hoglet1Leader, {
    x: h1.x, z: h1.z, hd: h1.hd, gait: h1.gait,
    speed: hog.speed, shiver: hog.shiver, night: hog.night, wet: hog.wet,
  });
  if (!mission.onMars
      && hoglet2.update(dt, hoglet1Leader, game.state.leg >= 6 && h1.live, acc) === 'arrived') {
    hud.flash(`another hoglet — ${hoglet2Name}, behind ${hogletName}, a whole procession`);
    game.note('hoglet2');
  }

  /* Firsts the game cannot see from where it stands. */
  if (hog.afloat) game.note('boat');
  if (hog.under) game.note('culvert');
  if (state.snow > 0.6) game.note('winter');
  if (prevWetJ > 0.4 && state.wet < 0.08 && state.night < 0.4) game.note('rainbow');
  prevWetJ = state.wet;

  /* The firefly lantern: at deep night a few of them take to him, and he
   * walks in his own small light.  One real point light — the only one in
   * the world besides the sun — and it is his. */
  const lanternOn = state.night > 0.72 && state.snow < 0.5;
  lanternAmt += ((lanternOn ? 1 : 0) - lanternAmt) * Math.min(1, 2 * dt);
  if (lanternAmt > 0.02) {
    const b = basisAt(hog.x, hog.z);
    positionAt(hog.x, hog.y + 0.28, hog.z, _lanternP);
    flies.visible = true;
    flies.children.forEach((f, i) => {
      const a = acc * (0.9 + i * 0.23) + i * 2.1;
      f.position.set(Math.cos(a) * 0.16, Math.sin(a * 1.7) * 0.07, Math.sin(a) * 0.16);
      f.material.opacity = lanternAmt * (0.5 + 0.5 * Math.sin(acc * 6 + i * 2.6));
    });
    flies.position.copy(_lanternP);
    flies.quaternion.setFromRotationMatrix(_lanternM.makeBasis(b.east, b.up, b.north));
    // the painted pool: faint, breathing with the flies, ON the ground
    _lanternM.makeBasis(b.east, b.up, b.north);
    _lanternM.setPosition(positionAt(hog.x, hog.y + 0.012, hog.z, _lanternP));
    lanternPool.matrix.copy(_lanternM);
    lanternPool.matrixWorldNeedsUpdate = true;
    lanternPool.visible = true;
    lanternPool.material.opacity = lanternAmt * (0.10 + 0.03 * Math.sin(acc * 5));
  } else {
    flies.visible = false;
    lanternPool.visible = false;
  }

  /* Photo mode drifts: a slow orbit for as long as the panels are away. */
  if (document.body.classList.contains('photo')) chase.yaw += dt * 0.045;

  /* Wet quills glint; the shine dries off over half a minute after. */
  glintAmt = Math.max(state.wet, glintAmt - dt / 32);
  glints.visible = glintAmt > 0.03 && !hog.under;
  if (glints.visible) {
    glints.material.opacity = glintAmt * (0.35 + 0.35 * Math.sin(acc * 7));
  }
  audio.update(dt, hog, state, world);

  /* The dust of the roll, and the thump of arriving out of it. */
  rollPuffT -= dt;
  if (hog.ball > 0.7 && hog.gait > 0.4 && rollPuffT <= 0) {
    rollPuffT = 0.09;
    puffs.burst(hog.x, hog.y + 0.01, hog.z, { n: 2, up: 0.12, spread: 0.15, px: 20, color: 0xc6b490 });
  }
  if (prevBallFx > 0.35 && hog.ball <= 0.35) {
    puffs.burst(hog.x, hog.y + 0.01, hog.z, { n: 6, up: 0.15, spread: 0.18, px: 22, color: 0xc9ba90 });
  }
  prevBallFx = hog.ball;
  puffs.update(dt, state.night);
  prints.update(dt);

  // the tap ripple spreading from the call
  if (rippleAt.t > 0) {
    rippleAt.t -= dt;
    const k = 1 - rippleAt.t / 0.55;
    const b = basisAt(rippleAt.x, rippleAt.z);
    _rippleM.makeBasis(b.east, b.up, b.north);
    _rippleM.setPosition(positionAt(rippleAt.x, world.heightAt(rippleAt.x, rippleAt.z) + 0.015, rippleAt.z, _origin));
    _rippleM.scale(_rippleS.setScalar(0.22 + k * 0.55));
    ripple.matrix.copy(_rippleM);
    ripple.matrixWorldNeedsUpdate = true;
    ripple.material.opacity = (1 - k) * 0.55;
    ripple.visible = true;
  } else {
    ripple.visible = false;
  }

  if (planetView) {
    orbit += dt * 0.10;
    orbitDir.set(Math.sin(orbit) * 0.8, 1.0, Math.cos(orbit) * 0.8).normalize();
    camera.position.copy(CENTER).addScaledVector(orbitDir, R * 3.1);
    camera.up.set(0, 1, 0);
    camera.lookAt(CENTER);
    updateOrbitLabels(true);
    sun.target.position.copy(CENTER);
    sun.position.copy(CENTER).add(new THREE.Vector3(-1.05, 0.95, 0.75).multiplyScalar(R * 2.2));
    sun.target.updateMatrixWorld();
    hemi.position.set(0, 1, 0);
    bounce.visible = false;
  } else {
    updateOrbitLabels(false);
    bounce.visible = true;
    chase.update(dt);
    const b = basisAt(hog.x, hog.z);
    positionAt(hog.x, 0, hog.z, _origin);
    SUN_LOCAL.copy(state.keyDir);
    seatLight(sun, SUN_LOCAL, b, _origin, 26);
    seatLight(fill, FILL_LOCAL, b, _origin, 14);
    seatLight(bounce, BOUNCE_LOCAL, b, _origin, 12);
    hemi.position.copy(b.up);
  }

  sky.setWet(state.wet);
  sky.update(dt, camera, planetView ? null : state, planetView ? null : basisAt(hog.x, hog.z));
  /* The compass, a few times a second rather than every frame — it is a
   * canvas redraw and nothing on it moves fast enough to notice. */
  compassIn -= dt;
  if (compassIn <= 0 && !planetView) {
    compassIn = 1 / 12;
    const b = basisAt(hog.x, hog.z);
    camera.getWorldDirection(_camFwd);
    const fe = _camFwd.dot(b.east), fn = _camFwd.dot(b.north);
    // the ring turns with the camera, because the keys do too
    const view = Math.hypot(fe, fn) > 1e-3 ? Math.atan2(fn, fe) : chase.yaw;
    const rel = (x, z) => wrapAng(bearing(hog.x, hog.z, x, z).angle - view);
    /* **The wedge points at the ship, not at the burrow.**  The burrow loop
     * is still running underneath and still advances legs; what changed is
     * what the game is *for*.  Two wedges on one ring is a ring nobody
     * reads, so there is one, and it is aimed at the thing you are trying
     * to reach.  On Mars there is nothing left to point at. */
    const goal = mission.onMars ? null : PAD;
    hud.setCompass({
      places: CENTRES.map((c) => ({ kind: c.kind, angle: rel(c.x, c.z) })),
      here: placeKindAt(hog.x, hog.z),
      home: goal ? {
        angle: rel(goal.x, goal.z),
        /* 1 at the rim, 0 in the middle.  Half a lap is as far as anything can
         * be on a planet you can walk round, so that is the rim. */
        near: clamp(distance(hog.x, hog.z, goal.x, goal.z) / (CIRC / 2), 0, 1),
      } : null,
      /* The residents are read off their live positions, not their addresses:
       * the robin is the one that moves, and a dot that stayed on its perch
       * while the bird itself hopped along beside you would be the one blip
       * on the ring you could prove wrong by looking up. */
      folk: characters.all.map((c) => ({
        angle: rel(c.x, c.z),
        near: clamp(distance(hog.x, hog.z, c.x, c.z) / FOLK_FAR, 0, 1),
        met: game.state.met.includes(c.key),
      })),
    });
  }
  hud.update(dt);

  pipeline.render(dt);
}
frame();

/* a little exposed for tuning from the console */
/* `driveHog` and `meetResidents` are on here for the same reason `__shot`
 * exists: a hidden tab has no rAF, so nothing that only ever runs inside
 * `frame()` can be exercised from a console — and the keys and the
 * conversation are exactly that. */
window.__hedgepig = { scene, camera, renderer, pipeline, world, hog, chase, climate, weather, game, sky, sun, fill, hemi, audio, critters, characters, dialogue, hud, puffs, prints, hoglet, mission, driveHog, meetResidents, THREE };

if (import.meta.env?.DEV) {
  /** Dev capture: render one frame at a fixed size and post it to the server. */
  window.__shot = async (name = 'shot', W = 1400, H = 800, opts = {}) => {
    if (opts.at) { hog.x = opts.at[0]; hog.z = opts.at[1]; hog.y = world.heightAt(hog.x, hog.z); }
    if (opts.hd !== undefined) hog.hd = opts.hd;
    if (opts.yaw !== undefined) chase.yaw = opts.yaw;
    if (opts.pitch !== undefined) chase.pitch = opts.pitch;
    if (opts.dist !== undefined) chase.dist = opts.dist;
    if (opts.day !== undefined) climate.state.dayT = opts.day * climate.DAY;
    if (opts.year !== undefined) climate.state.t = opts.year * climate.YEAR;
    if (opts.planet !== undefined) setPlanetView(opts.planet);
    if (opts.ink !== undefined) pipeline.enabled.ink = opts.ink;

    climate.update(0.0001);
    hog.update(0.0001, acc);
    world.update(0.0001, hog, climate.state);
    chase._seeded = false;
    if (!planetView) {
      chase.update(0.016);
      const b = basisAt(hog.x, hog.z);
      positionAt(hog.x, 0, hog.z, _origin);
      seatLight(sun, climate.state.keyDir, b, _origin, 26);
      seatLight(fill, FILL_LOCAL, b, _origin, 14);
      seatLight(bounce, BOUNCE_LOCAL, b, _origin, 12);
      hemi.position.copy(b.up);
    } else {
      orbit = opts.orbit ?? orbit;
      orbitDir.set(Math.sin(orbit) * 0.8, 1.0, Math.cos(orbit) * 0.8).normalize();
      camera.position.copy(CENTER).addScaledVector(orbitDir, R * (opts.dist || 3.1));
      camera.up.set(0, 1, 0);
      camera.lookAt(CENTER);
    }
    sky.update(0.0001, camera, planetView ? null : climate.state, planetView ? null : basisAt(hog.x, hog.z));

    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    pipeline.setSize(W, H);
    setOutlineResolution(pipeline.size.x, pipeline.size.y);
    pipeline.render(0);

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    off.getContext('2d').drawImage(canvas, 0, 0, W, H);
    const data = off.toDataURL('image/jpeg', 0.88);
    const r = await fetch('/__shot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    resize();
    return r.json();
  };
}
