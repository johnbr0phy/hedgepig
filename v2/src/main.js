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
import { placeAt, PLACE, CIRC } from './world/plan.js';
import { Hog } from './hog/hog.js';
import { createGame } from './game/game.js';

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
const climate = createClimate({ scene, sun, fill, bounce, hemi, sky, grass: world.grass, pipeline });
const game = createGame({ world, hog, hud, climate });

chase.onCall = (x, z) => game.call(x, z);

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
});

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

/* --------------------------------- loop --------------------------------- */
const clock = new THREE.Clock();
let acc = 0;

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
  hog.update(dt, acc);
  game.update(dt);
  world.update(dt, hog, state);
  weather.update(dt, hog, camera, state);

  if (planetView) {
    orbit += dt * 0.10;
    orbitDir.set(Math.sin(orbit) * 0.8, 1.0, Math.cos(orbit) * 0.8).normalize();
    camera.position.copy(CENTER).addScaledVector(orbitDir, R * 3.1);
    camera.up.set(0, 1, 0);
    camera.lookAt(CENTER);
    sun.target.position.copy(CENTER);
    sun.position.copy(CENTER).add(new THREE.Vector3(-1.05, 0.95, 0.75).multiplyScalar(R * 2.2));
    sun.target.updateMatrixWorld();
    hemi.position.set(0, 1, 0);
    bounce.visible = false;
  } else {
    bounce.visible = true;
    chase.update(dt);
    const b = basisAt(hog.x, hog.z);
    positionAt(hog.x, 0, hog.z, _origin);
    SUN_LOCAL.copy(state.sunDir);
    seatLight(sun, SUN_LOCAL, b, _origin, 26);
    seatLight(fill, FILL_LOCAL, b, _origin, 14);
    seatLight(bounce, BOUNCE_LOCAL, b, _origin, 12);
    hemi.position.copy(b.up);
  }

  sky.update(dt, camera, planetView ? null : state.sunDir);
  hud.update(dt);

  pipeline.render(dt);
}
frame();

/* a little exposed for tuning from the console */
window.__hedgepig = { scene, camera, renderer, pipeline, world, hog, chase, climate, weather, game, sky, sun, fill, hemi, THREE };

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
      seatLight(sun, climate.state.sunDir, b, _origin, 26);
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
    sky.update(0.0001, camera, planetView ? null : climate.state.sunDir);

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
