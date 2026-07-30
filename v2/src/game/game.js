import * as THREE from 'three';
import { cel, flat } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { rngKit, clamp, lerp, TAU } from '../core/util.js';
import { heightAt, waterDepthAt, walkableAt } from '../world/terrain.js';
import { basisAt, positionAt } from '../world/planet.js';
import {
  PLACE, ORDER, COUNT, PLACE_LEN, placeAt, placeStart, placeCentre, hardAt,
  wrapDelta, bandEdges, LAKE, ROAD, WOOD, MGARD, HENS, BGARD, TOWN, MIRE,
} from '../world/plan.js';
import { burrow as makeBurrow, mushroom, flowerClump, rock } from '../world/props.js';
import { HOG_SPD } from '../hog/hog.js';

/* ------------------------------------------------------------------ *
 * The game.
 *
 * v1's loop, kept whole: **tap and he walks there and stops.  Reach the
 * burrow at the end of the leg and the next leg starts, slightly faster and
 * thornier.  Three hearts, and a hit costs one.**
 *
 * Two hazards only, deliberately — thorns and cars — and both obey the rule
 * that made them work: everything ranges off *him*, never off the camera.
 * In v1 hazards were gathered from the visible band, and scrolling away
 * from him made him invincible; the `abandon` scenario existed to catch it.
 * Here the camera cannot be taken away from him at all, but the rule is
 * kept because it is the correct one and the next camera change will test
 * it again.
 *
 * And every tap sows something, before any of the early returns — v1's
 * hardest-won ordering.  Whatever you sow is the thing he walks to, so if
 * the sowing happens after a return, the mushroom garden and the wood and
 * the hen run all quietly stop steering him.
 * ------------------------------------------------------------------ */

const MAX_HEARTS = 3;
/** How far ahead the next burrow is dug, in places. */
const LEG_PLACES = 3;

export function createGame({ world, hog, hud, climate }) {
  const rng = rngKit(90210);
  const scene = world.root.parent;

  const state = {
    hearts: MAX_HEARTS,
    leg: 1,
    thornDensity: 0.18,
    burrow: { x: 0, z: 0, slot: 0 },
    invuln: 0,
    lastHit: '',
    sown: 0,
  };

  world.setFlash?.((m) => hud.flash(m));

  /* ------------------------------- the burrow ------------------------------ */
  const burrowObj = makeBurrow({ seed: 3 });
  burrowObj.matrixAutoUpdate = false;
  scene.add(burrowObj);

  function seat(obj, x, z, y = heightAt(x, z), yaw = 0) {
    const b = basisAt(x, z);
    const m = new THREE.Matrix4().makeBasis(b.east, b.up, b.north);
    m.setPosition(positionAt(x, y, z, new THREE.Vector3()));
    if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(-yaw));
    obj.matrix.copy(m);
    obj.matrixWorldNeedsUpdate = true;
  }

  /** Dig the next burrow a few places along the ring from where he is. */
  function placeBurrow() {
    const here = placeAt(hog.x).i;
    const slot = (here + LEG_PLACES) % COUNT;
    // somewhere in that place that is not water, tarmac, or inside something
    let x = 0, z = 0, ok = false;
    for (let i = 0; i < 200 && !ok; i++) {
      x = placeStart(slot) + rng.range(3, PLACE_LEN - 3);
      z = rng.range(-8, 8);
      ok = walkableAt(x, z) && hardAt(x) < 0.2 && !world.blockedAt(x, z);
    }
    state.burrow = { x, z, slot };
    seat(burrowObj, x, z, heightAt(x, z), rng.range(0, TAU));
  }
  placeBurrow();

  /* --------------------------------- sowing -------------------------------- */
  /* A pool of things you have sown, recycled oldest-first.  They are built
   * after the bake, so each one is seated by hand. */
  const POOL = 22;
  const sown = [];

  function sowKinds(x, z) {
    const m = placeAt(x);
    const kind = m.t > 0.5 ? m.b : m.a;
    const s = climate.state;

    /* v1's routing, in v1's order: **place first, then season, then hour.**
     * The order is the whole character of it — a mushroom garden in the snow
     * still grows mushrooms, but the meadow after dark gives fireflies. */
    if (kind === MGARD) return 'mushroom';
    if (kind === WOOD) return 'leaves';
    if (kind === HENS) return 'egg';
    if (kind === MIRE) return 'stone';
    if (kind === LAKE) return 'reed';
    if (s.snow > 0.52) return 'snowman';
    if (s.night > 0.5) return 'firefly';
    if (kind === ROAD || kind === TOWN) return 'dust';
    return 'flower';
  }

  function makeSown(kind, x, z) {
    switch (kind) {
      case 'mushroom': {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const mm = mushroom({ seed: 4000 + state.sown * 3 + i, h: rng.range(0.07, 0.13), cap: rng.range(0.05, 0.08) });
          mm.position.set(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12));
          g.add(mm);
        }
        return g;
      }
      case 'snowman': {
        const g = new THREE.Group();
        const snowMat = cel({ color: 0xf2f7fb, bands: 'soft3', tint: 0x8f9ac4, flat: false });
        const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 9), snowMat);
        b1.position.y = 0.10;
        const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 9), snowMat);
        b2.position.y = 0.24;
        g.add(b1, b2);
        const eyeMat = flat({ color: 0x30283a });
        for (const s of [-1, 1]) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), eyeMat);
          e.position.set(0.055, 0.26, 0.022 * s);
          g.add(e);
        }
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 5), cel({ color: 0xe08a3c, bands: 2, tint: 0x7a6a8e }));
        nose.rotation.z = -Math.PI / 2;
        nose.position.set(0.09, 0.245, 0);
        g.add(nose);
        return g;
      }
      case 'egg': {
        const g = new THREE.Group();
        const eggMat = cel({ color: 0xf0e4cc, bands: 'soft3', tint: 0x8a7fa8, flat: false });
        for (let i = 0; i < 2; i++) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), eggMat);
          e.scale.y = 1.35;
          e.position.set(rng.range(-0.07, 0.07), 0.045, rng.range(-0.07, 0.07));
          e.rotation.z = rng.range(-0.4, 0.4);
          g.add(e);
        }
        return g;
      }
      case 'leaves': {
        const g = new THREE.Group();
        const leafMat = cel({ color: 0xc98a45, bands: 2, tint: 0x6a5a86, side: THREE.DoubleSide, role: 'leaf' });
        for (let i = 0; i < 9; i++) {
          const l = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.07), leafMat);
          const a = rng.range(0, TAU);
          const r = rng.range(0.05, 0.3);
          l.position.set(Math.cos(a) * r, 0.02 + rng.range(0, 0.1), Math.sin(a) * r);
          l.rotation.set(rng.range(-1, 1), rng.range(0, TAU), rng.range(-1, 1));
          g.add(l);
        }
        return g;
      }
      case 'stone':
        return rock({ seed: 5000 + state.sown, r: rng.range(0.08, 0.16) });
      case 'reed':
      case 'dust': {
        const g = new THREE.Group();
        const mat = flat({
          color: kind === 'dust' ? 0xd8c9a8 : 0x9fb46a,
          transparent: true, opacity: 0.5, cache: false,
        });
        for (let i = 0; i < 7; i++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat);
          p.position.set(rng.range(-0.2, 0.2), rng.range(0.02, 0.2), rng.range(-0.2, 0.2));
          g.add(p);
        }
        return g;
      }
      case 'firefly': {
        const g = new THREE.Group();
        const mat = flat({ color: 0xd8f08a, transparent: true, opacity: 0.9, cache: false });
        for (let i = 0; i < 5; i++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), mat);
          p.position.set(rng.range(-0.25, 0.25), rng.range(0.08, 0.4), rng.range(-0.25, 0.25));
          p.userData.bob = rng.range(0, TAU);
          g.add(p);
        }
        g.userData.flies = true;
        return g;
      }
      default: {
        return flowerClump({
          seed: 6000 + state.sown,
          n: rng.int(4, 8),
          color: rng.pick([PAL.bloomWhite, PAL.bloomYellow, PAL.petal, PAL.bloomBlue]),
          h: rng.range(0.12, 0.24),
        });
      }
    }
  }

  /**
   * Sow at (x, z).  This runs on **every** call, before any early return,
   * because whatever is sown is the thing he then walks to.
   */
  function sow(x, z) {
    const kind = sowKinds(x, z);
    const obj = makeSown(kind, x, z);
    obj.matrixAutoUpdate = false;
    scene.add(obj);
    seat(obj, x, z, heightAt(x, z), rng.range(0, TAU));
    sown.push({ obj, kind, x, z, age: 0 });
    state.sown++;
    if (sown.length > POOL) {
      const old = sown.shift();
      scene.remove(old.obj);
      old.obj.traverse((o) => o.geometry?.dispose?.());
    }
    return kind;
  }

  /* -------------------------------- the call ------------------------------- */
  function call(x, z) {
    sow(x, z);                      // first line, always — see above
    if (!walkableAt(x, z)) {
      /* Called into the water or off the edge: he goes as close as he can,
       * which is what a hedgehog would do, and is far better than nothing
       * happening at all. */
      const zz = clamp(z, -12.6, 12.6);
      let xx = x;
      if (waterDepthAt(x, zz) > 0) {
        const [a, b] = bandEdges(LAKE);
        xx = Math.abs(wrapDelta(x, a)) < Math.abs(wrapDelta(x, b)) ? a - 0.8 : b + 0.8;
      }
      hog.callTo(xx, zz);
      return;
    }
    hog.callTo(x, z);
  }

  /* ------------------------------- the hazards ----------------------------- */
  function checkThorns(dt) {
    const thorns = world.out.thorns || [];
    for (const t of thorns) {
      if (!t.live) continue;
      const dx = wrapDelta(hog.x, t.x);
      if (Math.abs(dx) > 1.2) continue;          // cheap reject, off *him*
      const dz = hog.z - t.z;
      if (dx * dx + dz * dz < (t.r + 0.09) ** 2) {
        wound(t.x, t.z, 'thorns');
        return;
      }
    }
  }

  function checkCars() {
    const cars = world.out.cars || [];
    for (const c of cars) {
      if (!c.live) continue;
      const dz = c.z - hog.z;
      if (Math.abs(dz) > 2.2) continue;
      const dx = wrapDelta(hog.x, c.x);
      /* Hitboxes match the car you can see — v1's `len*.46 x wid*.54`.
       * A hitbox bigger than the art is the one unfairness nobody forgives. */
      if (Math.abs(dx) < c.size.W * 0.54 + 0.08 && Math.abs(dz) < c.size.L * 0.46 + 0.08) {
        wound(c.x, c.z, 'the road');
        return;
      }
    }
  }

  function wound(x, z, what) {
    if (state.invuln > 0 || hog.under || hog.afloat) return;
    if (!hog.hit(x, z)) return;
    state.invuln = 1.6;
    state.hearts--;
    hud.setHearts(Math.max(0, state.hearts));
    hud.flash(what === 'thorns' ? 'ow — brambles' : 'a car! back to the verge');

    if (state.hearts <= 0) {
      /* He has had enough.  Not a death screen: v1 never had one, and a
       * hedgehog in a meadow does not lose.  The leg resets and he carries
       * on, which costs progress and nothing else. */
      state.hearts = MAX_HEARTS;
      state.leg = 1;
      state.thornDensity = 0.18;
      hog.speed = HOG_SPD;
      applyThorns();
      hud.setHearts(state.hearts);
      hud.flash('he has had enough for today — but he is all right');
      placeBurrow();
    }
  }

  /** Live brambles: v1's `.18 + leg*.11`, capped at .88. */
  function applyThorns() {
    const thorns = world.out.thorns || [];
    const n = Math.floor(thorns.length * clamp(state.thornDensity, 0, 0.88));
    thorns.forEach((t, i) => {
      t.live = i < n;
      t.obj.visible = t.live;
    });
  }
  applyThorns();

  /* ------------------------------- the culvert ----------------------------- */
  function culvert(dt) {
    const cv = world.out.culvert;
    if (!cv) return;
    const nearZ = Math.abs(hog.z - cv.z) < 0.55;

    if (!hog.under) {
      if (!nearZ) return;
      const atA = Math.abs(wrapDelta(hog.x, cv.a)) < 0.32;
      const atB = Math.abs(wrapDelta(hog.x, cv.b)) < 0.32;
      // only from a verge, and only heading into the road
      if (atA && Math.cos(hog.hd) > 0.2) enterCulvert();
      else if (atB && Math.cos(hog.hd) < -0.2) enterCulvert();
      return;
    }

    // under: hold him on the tunnel's line and let him out at either end
    hog.z = lerp(hog.z, cv.z, 1 - Math.exp(-10 * dt));
    const out = wrapDelta(hog.x, cv.a) < -0.28 || wrapDelta(hog.x, cv.b) > 0.28;
    if (out) {
      hog.under = false;
      hud.flash('out the other side, and dry');
    }
  }

  function enterCulvert() {
    hog.under = true;
    hud.flash('under the road');
  }

  /* --------------------------------- the boat ------------------------------ */
  function boat() {
    const b = world.out.boat;
    if (!b || hog.afloat || b.crossing > 0) return;
    const d = Math.hypot(wrapDelta(hog.x, b.x), hog.z - b.z);
    if (d < 0.42) {
      hog.afloat = b;
      hog.stop();
      b.crossing = 0.001;
      hud.flash('aboard — mind the reeds');
    }
  }

  /* ------------------------------ interactables ---------------------------- */
  let lastTouched = null;
  let touchCool = 0;
  function touch(dt) {
    touchCool -= dt;
    const near = world.nearest(hog.x, hog.z, 0.75);
    if (!near) { lastTouched = null; return; }
    if (near === lastTouched || touchCool > 0) return;
    lastTouched = near;
    touchCool = 2.4;
    near.action?.();
  }

  /* ----------------------------------- HUD --------------------------------- */
  let hudT = 0;
  function readouts(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.25;

    const m = placeAt(hog.x);
    const kind = m.t > 0.5 ? m.b : m.a;
    const s = climate.state;
    let weather = `${s.season} · ${s.hour}`;
    if (s.snowFall > 0.3) weather += ' · snow';
    else if (s.wet > 0.35) weather += ' · rain';

    hud.setPlace(PLACE[kind].name, weather);
    const dx = Math.abs(wrapDelta(state.burrow.x, hog.x));
    const dz = state.burrow.z - hog.z;
    const d = Math.hypot(dx, dz);
    hud.setStatus(state.leg, hog.walked, ` · burrow ${d.toFixed(0)} m`);
  }

  hud.setHearts(state.hearts);

  /* ---------------------------------- loop --------------------------------- */
  function update(dt) {
    if (state.invuln > 0) state.invuln -= dt;

    culvert(dt);
    boat();
    if (!hog.under && !hog.afloat) {
      checkThorns(dt);
      checkCars();
    }
    touch(dt);

    // the sown things settle in, and the fireflies drift
    for (const s of sown) {
      s.age += dt;
      if (s.obj.userData.flies) {
        s.obj.children.forEach((c, i) => {
          c.position.y += Math.sin(s.age * 2 + c.userData.bob) * dt * 0.06;
        });
      }
    }

    /* arriving at the burrow: the end of the leg */
    const dx = wrapDelta(state.burrow.x, hog.x);
    const dz = state.burrow.z - hog.z;
    if (dx * dx + dz * dz < 0.55 * 0.55) {
      state.leg++;
      /* Faster and thornier, as v1: the only difficulty curve there is, and
       * it is enough because the world keeps changing underneath it. */
      hog.speed = HOG_SPD * (1 + 0.08 * (state.leg - 1));
      state.thornDensity = Math.min(0.88, 0.18 + state.leg * 0.11);
      applyThorns();
      state.hearts = Math.min(MAX_HEARTS, state.hearts + 1);
      hud.setHearts(state.hearts);
      hud.flash(`home. leg ${state.leg} — and the brambles are thicker`);
      hog.stop();
      placeBurrow();
    }

    readouts(dt);
  }

  return { state, call, update, placeBurrow, burrowObj };
}
