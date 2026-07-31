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
import { placeAt, placeKindAt, PLACE, WOOD, CIRC, CENTRES } from './world/plan.js';
import { waterDepthAt } from './world/terrain.js';
import { blobTex } from './core/textures.js';
import { Hog } from './hog/hog.js';
import { createGame } from './game/game.js';
import { createAudio } from './core/audio.js';
import { createCritters } from './world/critters.js';
import { createPuffs, createPrints } from './core/puffs.js';
import { createHoglet } from './game/hoglet.js';

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
const puffs = createPuffs(scene);
const prints = createPrints(scene);
const hoglet = createHoglet(scene);
const hoglet2 = createHoglet(scene, { seed: 331, phase: 87.3 });
/* The second hoglet follows the FIRST — a train, each watching the one
 * ahead.  The adapter is mutated in place each frame; a hoglet is enough
 * of a hedgehog for another hoglet's purposes. */
const hoglet1Leader = { x: 0, z: 0, hd: 0, gait: 0, speed: 0.85, shiver: 0, night: 0, wet: 0 };
const game = createGame({ world, hog, hud, climate, audio });

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

chase.onCall = (x, z, roll) => {
  game.call(x, z, roll);
  rippleAt.x = x; rippleAt.z = z; rippleAt.t = 0.55;
};

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
hog.onSniff = () => audio.sniff();
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
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space') { hog.stop(); hud.flash('he stops where he is'); e.preventDefault(); }
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

function frame() {
  /* Armed first, not last.  Re-arming at the end means any exception
   * anywhere in the frame stops the loop permanently — the game freezes and
   * the only symptom is that nothing moves, which is a long way from the
   * line that threw.  Arming first costs nothing and turns a fatal bug into
   * a stutter and a console error. */
  requestAnimationFrame(frame);

  const dt = Math.min(clock.getDelta(), 1 / 20);
  acc += dt;

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
  hog.update(dt, acc);
  game.update(dt);
  world.update(dt, hog, state);
  weather.update(dt, hog, camera, state);
  critters.update(dt, hog, state);
  if (hoglet.update(dt, hog, game.state.leg >= 3, acc) === 'arrived') {
    hud.flash(`a hoglet has found him — ${hogletName}, and it will not be left behind`);
    game.note('hoglet');
  }
  const h1 = hoglet.state;
  Object.assign(hoglet1Leader, {
    x: h1.x, z: h1.z, hd: h1.hd, gait: h1.gait,
    speed: hog.speed, shiver: hog.shiver, night: hog.night, wet: hog.wet,
  });
  if (hoglet2.update(dt, hoglet1Leader, game.state.leg >= 6 && h1.live, acc) === 'arrived') {
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
  hud.update(dt);

  pipeline.render(dt);
}
frame();

/* a little exposed for tuning from the console */
window.__hedgepig = { scene, camera, renderer, pipeline, world, hog, chase, climate, weather, game, sky, sun, fill, hemi, audio, critters, puffs, prints, hoglet, THREE };

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
