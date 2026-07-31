import * as THREE from 'three';
import { flat, cel } from '../core/toon.js';
import { clamp, lerp, rngKit, TAU, wrapAng, damp } from '../core/util.js';
import { positionAt, basisAt } from './planet.js';
import { heightAt, waterDepthAt, lakeShore } from './terrain.js';
import { CENTRE, BGARD, WOOD, LAKE, LAKE_R, distance, bearing, offsetFrom, R } from './plan.js';

/* ------------------------------------------------------------------ *
 * The things that fly, with wings this time.
 *
 * `weather.js` has named butterflies and bees since the first build and
 * they were only ever motes — points in the camera's box, which is what
 * rain wants and exactly what an *animal* does not: a mote cannot land on
 * anything, cannot flee from anything, and does not care where the garden
 * is.  These live in the world's own flat coordinates, like him.
 *
 * The rules, all v1's:
 *
 *  - **Everything ranges off him.**  A butterfly flees the hedgehog, not
 *    the camera.
 *  - **Anchored, not free.**  Butterflies belong to the butterfly garden
 *    and to whatever has just been sown; bees belong to flowers.  A critter
 *    with no anchor drifts off the playable band within a minute.
 *  - **The clock owns them.**  They fly in daylight, in the warm seasons,
 *    and not in the rain; winter grounds every one of them.  Nothing here
 *    checks the *place* to decide the weather — season and hour only.
 * ------------------------------------------------------------------ */

const BFLY_N = 7;
const BEE_N = 5;

export function createCritters(scene, hooks = {}) {
  const rng = rngKit(4104);
  const root = new THREE.Group();
  root.name = 'critters';
  scene.add(root);

  const _m = new THREE.Matrix4();
  const _b = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _r = new THREE.Matrix4();

  /** Seat a critter at flat (x, y, z) facing `yaw`, scaled by `s`. */
  function seat(obj, x, y, z, yaw, s = 1) {
    const b = basisAt(x, z);
    _b.makeBasis(b.east, b.up, b.north);
    _b.setPosition(positionAt(x, y, z, _p));
    _r.makeRotationY(-yaw);
    _b.multiply(_r);
    if (s !== 1) {
      _r.makeScale(s, s, s);
      _b.multiply(_r);
    }
    obj.matrix.copy(_b);
    obj.matrixWorldNeedsUpdate = true;
  }

  /* ------------------------------ butterflies ------------------------------ */
  const BFLY_COLORS = [0xf5f2e6, 0xf0c95c, 0x9db7e8, 0xe8a0d0, 0xf5f2e6, 0xd8ecf0, 0xf0c95c];
  const bflies = [];
  for (let i = 0; i < BFLY_N; i++) {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const mat = flat({ color: BFLY_COLORS[i % BFLY_COLORS.length], side: THREE.DoubleSide, cache: false });
    const wings = [];
    for (const s of [-1, 1]) {
      const wg = new THREE.PlaneGeometry(0.026, 0.032);
      wg.translate(0, 0.016, 0);            // hinge at the body
      const w = new THREE.Mesh(wg, mat);
      w.rotation.x = -Math.PI / 2;          // lying flat, hinged along the body
      w.rotation.z = 0;
      w.position.z = 0.001 * s;
      w.userData.side = s;
      w.userData.noOutline = true;
      g.add(w);
      wings.push(w);
    }
    const home = offsetFrom(CENTRE[BGARD], rng.range(-8, 8), rng.range(-8, 8));
    const b = {
      obj: g, wings,
      x: home.x, z: home.z, y: 0.4,
      hd: rng.range(0, TAU),
      home, flee: 0,
      wobble: rng.range(0, TAU),
      flap: rng.range(4, 6),
      out: 0,                                // eased presence, 0 hidden – 1 flying
    };
    root.add(g);
    bflies.push(b);
  }

  /* --------------------------------- bees --------------------------------- */
  const bees = [];
  {
    const body = cel({ color: 0xe8c25c, bands: 2, tint: 0x6a5a3a, flat: true, cache: false });
    for (let i = 0; i < BEE_N; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const bl = new THREE.Mesh(new THREE.SphereGeometry(0.007, 7, 5), body);
      bl.scale.set(1.35, 1, 1);
      const wing = new THREE.Mesh(
        new THREE.PlaneGeometry(0.012, 0.007),
        flat({ color: 0xdfe8f0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, cache: false })
      );
      wing.position.y = 0.006;
      wing.rotation.x = -Math.PI / 2;
      bl.userData.noOutline = wing.userData.noOutline = true;
      g.add(bl, wing);
      const b = {
        obj: g, wing,
        anchor: offsetFrom(CENTRE[BGARD], rng.range(-6, 6), rng.range(-6, 6)),
        ang: rng.range(0, TAU),
        rad: rng.range(0.2, 0.5),
        speed: rng.range(1.6, 2.6),
        bob: rng.range(0, TAU),
        out: 0,
      };
      root.add(g);
      bees.push(b);
    }
  }

  /* --------------------------------- birds --------------------------------- */
  const birds = [];
  {
    const dark = flat({ color: 0x4a4458, side: THREE.DoubleSide, cache: false });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const bodyG = new THREE.ConeGeometry(0.02, 0.09, 5);
      bodyG.rotateZ(-Math.PI / 2);          // nose along +x
      const bd = new THREE.Mesh(bodyG, dark);
      const wings = [];
      for (const s of [-1, 1]) {
        const wgeo = new THREE.PlaneGeometry(0.10, 0.035);
        wgeo.translate(0.05, 0, 0);
        const w = new THREE.Mesh(wgeo, dark);
        w.rotation.x = -Math.PI / 2;
        w.rotation.y = s > 0 ? 0 : Math.PI;
        w.position.z = 0;
        w.userData.side = s;
        g.add(w);
        wings.push(w);
      }
      bd.userData.noOutline = true;
      g.add(bd);
      g.visible = false;
      root.add(g);
      birds.push({ obj: g, wings, live: false, x: 0, z: 0, y: 5, hd: 0, t: 0 });
    }
  }
  let birdWait = 12;

  /* ------------------------------ water rings ------------------------------ *
   * A shared pool, spent by frogs going in and fish coming up. */
  const rings = [];
  {
    const mat = flat({ color: 0xe4f0f2, transparent: true, opacity: 0, side: THREE.DoubleSide, cache: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 30).rotateX(-Math.PI / 2), mat.clone());
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.renderOrder = 4;
      m.userData.noOutline = true;
      root.add(m);
      rings.push({ obj: m, t: 0, x: 0, z: 0, y: 0 });
    }
  }
  function splash(x, z) {
    const r = rings.find((r) => r.t <= 0);
    if (!r) return;
    r.t = 0.9;
    r.x = x; r.z = z;
    r.y = heightAt(x, z) + waterDepthAt(x, z) + 0.01;
  }

  /* --------------------------------- frogs --------------------------------- */
  const frogs = [];
  {
    const green = cel({ color: 0x7da84f, bands: 2, tint: 0x4e6a52, flat: false, cache: false });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), green);
      body.scale.set(1.25, 0.85, 1);
      body.position.y = 0.022;
      const eyeMat = flat({ color: 0x2b2130, cache: false });
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 5), eyeMat);
        e.position.set(0.024, 0.042, 0.012 * s);
        g.add(e);
      }
      g.add(body);
      root.add(g);
      const ang = rng.range(0, TAU);
      frogs.push({ obj: g, ang, sit: null, hop: 0, wait: 0, from: null, to: null });
    }
  }
  /** Where a frog sits: just up the bank from the waterline at its angle. */
  function frogSeat(f) {
    const sh = lakeShore(f.ang);
    const c = CENTRE[LAKE];
    const d = sh.d + 0.35;
    const out = offsetFrom(c, Math.cos(f.ang) * d, Math.sin(f.ang) * d);
    f.sit = { x: out.x, z: out.z };
    const inWater = offsetFrom(c, Math.cos(f.ang) * (sh.d - 0.9), Math.sin(f.ang) * (sh.d - 0.9));
    f.to = { x: inWater.x, z: inWater.z };
  }

  /* ---------------------------------- owl ---------------------------------- */
  const owl = { hootIn: 9, blink: 0, blinkIn: 4 };
  {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const glow = new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
    });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), glow);
      e.position.z = 0.042 * s;
      g.add(e);
    }
    root.add(g);
    owl.obj = g;
    const at = offsetFrom(CENTRE[WOOD], 1.8, -2.3);
    owl.x = at.x; owl.z = at.z;
    // below the canopy line, where two lit points read as something IN the tree
    owl.y = heightAt(at.x, at.z) + 1.45;
  }

  let fishWait = 8;

  /* --------------------------------- update -------------------------------- */

  function update(dt, hog, state) {
    /* Whether anything should be on the wing at all: day, warm, dry. */
    const season = state.w ? state.w[1] + state.w[0] * 0.6 : 1;    // summer + some spring
    const flying = clamp(season, 0, 1) * (1 - state.night) * (1 - clamp(state.wet * 2, 0, 1)) * (1 - state.snow);

    for (const b of bflies) {
      b.out = damp(b.out, flying > 0.25 ? 1 : 0, 1.5, dt);
      b.obj.visible = b.out > 0.02;
      if (!b.obj.visible) continue;

      const toHog = distance(hog.x, hog.z, b.x, b.z);
      if (toHog < 0.75 && b.flee <= 0) b.flee = 1.4;
      if (b.flee > 0) b.flee -= dt;

      /* Wandering: a slow heading wobble, straight home if too far out, and
       * hard away from the hedgehog while fleeing. */
      let want = b.hd + Math.sin(state ? (b.wobble += dt * 1.7) : 0) * 0.9 * dt * 30;
      const fromHome = distance(b.home.x, b.home.z, b.x, b.z);
      if (fromHome > 7) want = bearing(b.x, b.z, b.home.x, b.home.z).angle;
      if (b.flee > 0) want = bearing(hog.x, hog.z, b.x, b.z).angle + Math.sin(b.wobble * 3) * 0.4;
      b.hd = wrapAng(b.hd + clamp(wrapAng(want - b.hd), -3.4 * dt, 3.4 * dt));

      const spd = (b.flee > 0 ? 1.1 : 0.34) * b.out;
      const cs = Math.max(0.08, Math.cos(b.z / R));
      b.x += (Math.cos(b.hd) * spd * dt) / cs;
      b.z += Math.sin(b.hd) * spd * dt;
      // a lilting height: butterflies do not fly level and are wrong if they do
      const ground = heightAt(b.x, b.z);
      b.y = ground + 0.32 + Math.sin(b.wobble * 1.3) * 0.14 + (b.flee > 0 ? 0.2 : 0);

      const flap = Math.sin(b.wobble * (b.flee > 0 ? 3.2 : 1.9) * b.flap);
      for (const w of b.wings) w.rotation.y = w.userData.side * (0.5 + flap * 0.75);
      seat(b.obj, b.x, b.y, b.z, b.hd + Math.PI / 2, b.out);
    }

    for (const b of bees) {
      b.out = damp(b.out, flying > 0.25 ? 1 : 0, 1.5, dt);
      b.obj.visible = b.out > 0.02;
      if (!b.obj.visible) continue;
      b.ang += dt * b.speed;
      b.bob += dt * 7;
      const x = b.anchor.x + Math.cos(b.ang) * b.rad;
      const z = b.anchor.z + Math.sin(b.ang) * b.rad;
      const y = heightAt(x, z) + 0.16 + Math.sin(b.bob) * 0.05;
      b.wing.rotation.z = Math.sin(b.bob * 9) * 0.9;
      seat(b.obj, x, y, z, -b.ang, b.out);
    }

    /* Birds: an occasional flyover, straight across his sky.  Spawned off
     * HIM — a bird spawned off the camera is v1's invincibility bug wearing
     * feathers. */
    birdWait -= dt;
    if (birdWait <= 0) {
      birdWait = 16 + rng.range(0, 26);
      if (flying > 0.2) {
        const b = birds.find((x) => !x.live);
        if (b) {
          b.live = true;
          b.t = 0;
          b.hd = rng.range(0, TAU);
          const from = bearing(hog.x, hog.z, hog.x + Math.cos(b.hd + Math.PI), hog.z + Math.sin(b.hd + Math.PI));
          const cs = Math.max(0.08, Math.cos(hog.z / R));
          b.x = hog.x + (Math.cos(b.hd + Math.PI) * 14) / cs;
          b.z = hog.z + Math.sin(b.hd + Math.PI) * 14;
          b.y = 3.4 + rng.range(0, 2.2);
          b.obj.visible = true;
        }
      }
    }
    for (const b of birds) {
      if (!b.live) continue;
      b.t += dt;
      const cs = Math.max(0.08, Math.cos(b.z / R));
      b.x += (Math.cos(b.hd) * 3.1 * dt) / cs;
      b.z += Math.sin(b.hd) * 3.1 * dt;
      const flap = Math.sin(b.t * 9);
      for (const w of b.wings) w.rotation.z = w.userData.side * flap * 0.55;
      seat(b.obj, b.x, b.y + Math.sin(b.t * 2.2) * 0.2, b.z, b.hd);
      if (b.t > 10 || distance(hog.x, hog.z, b.x, b.z) > 26) {
        b.live = false;
        b.obj.visible = false;
      }
    }

    /* ------------------------------- the frogs ------------------------------- *
     * Sat at the waterline until he comes too close, then one long hop in —
     * a plop, a ring, and a wait on the bottom until he has gone. */
    for (const f of frogs) {
      if (!f.sit) frogSeat(f);
      if (f.hop > 0) {
        f.hop -= dt;
        const t = 1 - Math.max(0, f.hop) / 0.55;
        const x = lerp(f.sit.x, f.to.x, t);
        const z = lerp(f.sit.z, f.to.z, t);
        const y = heightAt(x, z) + Math.sin(t * Math.PI) * 0.22;
        seat(f.obj, x, y, z, f.ang + Math.PI, 1);
        if (f.hop <= 0) {
          f.obj.visible = false;
          f.wait = 9 + rng.range(0, 12);
          splash(f.to.x, f.to.z);
          hooks.plip?.();
        }
      } else if (!f.obj.visible) {
        f.wait -= dt;
        if (f.wait <= 0 && distance(hog.x, hog.z, f.sit.x, f.sit.z) > 3) {
          f.obj.visible = true;
          f.ang += rng.range(-0.5, 0.5);       // he comes back up somewhere else
          frogSeat(f);
        }
      } else {
        seat(f.obj, f.sit.x, heightAt(f.sit.x, f.sit.z), f.sit.z, f.ang + Math.PI, 1);
        if (distance(hog.x, hog.z, f.sit.x, f.sit.z) < 1.1) f.hop = 0.55;
      }
    }

    /* ------------------------------- the rings ------------------------------- */
    for (const r of rings) {
      if (r.t <= 0) { r.obj.visible = false; continue; }
      r.t -= dt;
      const k = 1 - r.t / 0.9;
      seat(r.obj, r.x, r.y, r.z, 0, 0.15 + k * 0.85);
      r.obj.material.opacity = (1 - k) * 0.5;
      r.obj.visible = true;
    }

    /* And a fish comes up for a fly, when he is near enough to notice. */
    fishWait -= dt;
    if (fishWait <= 0) {
      fishWait = 7 + rng.range(0, 10);
      const toLake = distance(hog.x, hog.z, CENTRE[LAKE].x, CENTRE[LAKE].z);
      if (toLake < LAKE_R + 12 && state.snow < 0.4) {
        const a = rng.range(0, TAU);
        const d = Math.sqrt(rng.next()) * LAKE_R * 0.7;
        const p = offsetFrom(CENTRE[LAKE], Math.cos(a) * d, Math.sin(a) * d);
        splash(p.x, p.z);
        if (toLake < LAKE_R + 6) hooks.plip?.();
      }
    }

    /* ------------------------------- the owl -------------------------------- *
     * Two lit eyes in the dark of the wood, blinking, and now and then the
     * only voice the night has. */
    const owlOn = state.night > 0.6 && state.snow < 0.7;
    owl.obj.visible = owlOn;
    if (owlOn) {
      owl.blinkIn -= dt;
      if (owl.blinkIn <= 0) { owl.blink = 0.16; owl.blinkIn = 2.5 + rng.range(0, 5); }
      if (owl.blink > 0) owl.blink -= dt;
      const open = owl.blink > 0 ? 0.1 : 1;
      owl.obj.children.forEach((e) => e.scale.set(1, open, 1));
      seat(owl.obj, owl.x, owl.y, owl.z, 0, 1);
      owl.hootIn -= dt;
      if (owl.hootIn <= 0) {
        owl.hootIn = 14 + rng.range(0, 22);
        if (distance(hog.x, hog.z, owl.x, owl.z) < 24) hooks.hoot?.();
      }
    }
  }

  return { update, bflies, bees, birds, frogs, rings, owl };
}
