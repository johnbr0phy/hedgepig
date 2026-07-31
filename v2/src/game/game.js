import * as THREE from 'three';
import { cel, flat } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { starTex, petalTex } from '../core/textures.js';
import { rngKit, clamp, lerp, TAU } from '../core/util.js';
import { heightAt, waterDepthAt, walkableAt, lakeShore } from '../world/terrain.js';
import { basisAt, positionAt } from '../world/planet.js';
import {
  PLACE, ORDER, COUNT, CENTRE, CENTRES, ROAD_HALF, R as R_PLANET,
  placeKindAt, placeAt, offsetFrom, distance, bearing, hardAt, towards,
  roadAlong, roadOffset, roadPoint,
  LAKE, ROAD, WOOD, MGARD, HENS, TOWN, MIRE, BGARD,
} from '../world/plan.js';
import { burrow as makeBurrow, mushroom, flowerClump, rock } from '../world/props.js';
import { HOG_SPD } from '../hog/hog.js';
import { CULVERT_ALONG } from '../world/places/road.js';

/* ------------------------------------------------------------------ *
 * The game.
 *
 * v1's loop, kept whole: **tap and he walks there and stops.  Reach the
 * burrow at the end of the leg and the next one starts, slightly faster and
 * thornier.  Three hearts, and a hit costs one.**
 *
 * Two hazards only, deliberately — brambles and cars — and both obey the
 * rule that made them work: everything ranges off *him*, never off the
 * camera.  And every tap sows something, before any of the early returns,
 * because whatever is sown is the thing he then walks to.
 * ------------------------------------------------------------------ */

const MAX_HEARTS = 3;
/** How many places along the ring the next burrow is dug. */
const LEG_PLACES = 3;

/** What you can sow, and what it comes up as. */
const BLOOMS = [
  PAL.bloomWhite, PAL.bloomYellow, PAL.petal, PAL.bloomBlue, PAL.bloomRed,
  0xe8a0d0, 0xa8e0c4, 0xf0c060, 0xd8f0a0, 0xc9a0f0,
];

export function createGame({ world, hog, hud, climate, audio = null }) {
  const rng = rngKit(90210);
  const scene = world.root.parent;

  const state = {
    hearts: MAX_HEARTS,
    leg: 1,
    thornDensity: 0.18,
    burrow: { x: 0, z: 0, kind: 0 },
    invuln: 0,
    sown: 0,
    found: 0,                  // golden thistles, ever
    sleeping: false,           // in the burrow, night on fast-forward
    maxHearts: MAX_HEARTS,     // 4 while the berries last, else 3
    berriesEaten: 0,
    rings: [],                 // where the thistle rings were planted, ever
    flags: {},                 // the journal of firsts
    visited: [],               // place kinds he has stood in, ever
  };

  /* ------------------------------ persistence ------------------------------ *
   * The world remembers you were there — the backlog's oldest complaint
   * about both builds.  A save is a handful of numbers, written at quiet
   * moments; the harness runs in Node where there is no localStorage, and
   * the guard means it simply never persists there. */
  const store = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  let saveT = 6;
  let wasArrived = true;
  function save() {
    if (!store) return;
    try {
      store.setItem('hedgepig.save', JSON.stringify({
        leg: state.leg, hearts: state.hearts, walked: hog.walked, found: state.found,
        x: hog.x, z: hog.z, hd: hog.hd,
        rings: state.rings, flags: state.flags, visited: state.visited,
      }));
    } catch { /* a full or refused store is not worth a crash */ }
  }
  if (store) {
    try {
      const s = JSON.parse(store.getItem('hedgepig.save') || 'null');
      if (s && Number.isFinite(s.x)) {
        state.leg = Math.max(1, s.leg | 0);
        state.hearts = clamp(s.hearts ?? MAX_HEARTS, 1, MAX_HEARTS);
        state.found = s.found | 0;
        state.thornDensity = Math.min(0.88, 0.18 + state.leg * 0.11);
        hog.walked = s.walked || 0;
        hog.speed = HOG_SPD * (1 + 0.08 * (state.leg - 1));
        if (walkableAt(s.x, s.z) && !world.blockedAt?.(s.x, s.z)) {
          hog.x = s.x; hog.z = s.z; hog.hd = s.hd || 0;
          hog.y = heightAt(s.x, s.z);
        }
        state.rings = Array.isArray(s.rings) ? s.rings : [];
        state.flags = s.flags && typeof s.flags === 'object' ? s.flags : {};
        state.visited = Array.isArray(s.visited) ? s.visited : [];
      }
    } catch { /* an unreadable save is a fresh start, not an error */ }
  }

  world.setFlash?.((m) => hud.flash(m));

  /** A first, for the journal.  Quietly: no toast, no chime — you find out
   *  when you open the book. */
  function note(flag) {
    if (!state.flags[flag]) {
      state.flags[flag] = true;
      save();
    }
  }

  const _q = new THREE.Quaternion();
  const _fm = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _sc = new THREE.Vector3();

  /** Seat an object on the surface at (x, z), facing `yaw`. */
  function seat(obj, x, z, y = heightAt(x, z), yaw = 0, scale = 1) {
    const b = basisAt(x, z);
    _fm.makeBasis(b.east, b.up, b.north);
    _q.setFromRotationMatrix(_fm);
    if (yaw) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    positionAt(x, y, z, _p);
    _sc.setScalar(scale);
    _m.compose(_p, _q, _sc);
    obj.matrix.copy(_m);
    obj.matrixWorldNeedsUpdate = true;
  }

  /* ------------------------------- the burrow ------------------------------ */
  const burrowObj = makeBurrow({ seed: 3 });
  burrowObj.matrixAutoUpdate = false;
  scene.add(burrowObj);

  /** Dig the next burrow a few places along the ring from where he is. */
  function placeBurrow() {
    const here = ORDER.indexOf(placeKindAt(hog.x, hog.z));
    const kind = ORDER[(here + LEG_PLACES) % COUNT];
    let x = 0, z = 0, ok = false;
    for (let i = 0; i < 300 && !ok; i++) {
      const a = rng.range(0, TAU);
      const d = Math.sqrt(rng.next()) * 12;
      const p = offsetFrom(CENTRE[kind], Math.cos(a) * d, Math.sin(a) * d);
      x = p.x; z = p.z;
      ok = walkableAt(x, z) && hardAt(x, z) < 0.2 && !world.blockedAt(x, z);
    }
    state.burrow = { x, z, kind };
    seat(burrowObj, x, z, heightAt(x, z), rng.range(0, TAU));
  }
  placeBurrow();

  /* --------------------------- the golden thistle -------------------------- *
   * One per leg, off the straight line, never announced.  Found, it plants a
   * ring of flowers that is NOT in the recycling pool: the one thing in the
   * world that stays.  A reason to wander an open planet, at the price of a
   * detour — quiet, not a quest log. */
  const thistle = { obj: null, x: 0, z: 0, live: false };
  function placeThistle() {
    if (thistle.obj) {
      scene.remove(thistle.obj);
      thistle.obj.traverse((o) => o.geometry?.dispose?.());
    }
    const here = ORDER.indexOf(placeKindAt(hog.x, hog.z));
    const kind = ORDER[(here + 1 + rng.int(0, 1)) % COUNT];
    let x = 0, z = 0, ok = false;
    for (let i = 0; i < 200 && !ok; i++) {
      const a = rng.range(0, TAU);
      const d = 3 + Math.sqrt(rng.next()) * 9;
      const p = offsetFrom(CENTRE[kind], Math.cos(a) * d, Math.sin(a) * d);
      x = p.x; z = p.z;
      ok = walkableAt(x, z) && hardAt(x, z) < 0.2 && !world.blockedAt(x, z);
    }
    const obj = flowerClump({ seed: 71 + state.leg, n: 3, color: 0xf2c53d, h: 0.34 });
    obj.matrixAutoUpdate = false;
    scene.add(obj);
    seat(obj, x, z, heightAt(x, z), rng.range(0, TAU));
    thistle.obj = obj; thistle.x = x; thistle.z = z; thistle.live = true;
  }
  placeThistle();

  /* ------------------------------ berry bushes ------------------------------ *
   * Autumn only.  Three berries eaten in one leg is a fourth heart until the
   * burrow — the season giving something back for its shorter days. */
  const bushes = [];
  {
    const bushMat = cel({ color: 0x3e5e3a, bands: 3, tint: 0x4a5578, flat: false });
    const berryMat = cel({ color: 0xc23a3a, bands: 2, tint: 0x7a4a66, flat: false });
    const brng = rngKit(6210);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bushMat);
      blob.scale.y = 0.75;
      blob.position.y = 0.14;
      blob.castShadow = true;
      g.add(blob);
      const berries = [];
      for (let b = 0; b < 5; b++) {
        const bm = new THREE.Mesh(new THREE.SphereGeometry(0.020, 8, 6), berryMat);
        const a = brng.range(0, TAU);
        bm.position.set(Math.cos(a) * 0.18, 0.14 + brng.range(-0.05, 0.12), Math.sin(a) * 0.18);
        g.add(bm);
        berries.push(bm);
      }
      g.matrixAutoUpdate = false;
      g.visible = false;
      scene.add(g);
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 200 && !ok; tries++) {
        const a = brng.range(0, TAU);
        const d = 3 + Math.sqrt(brng.next()) * 9;
        const kind = [WOOD, MGARD, BGARD][i % 3];
        const p = offsetFrom(CENTRE[kind], Math.cos(a) * d, Math.sin(a) * d);
        x = p.x; z = p.z;
        ok = walkableAt(x, z) && hardAt(x, z) < 0.2 && !world.blockedAt(x, z);
      }
      seat(g, x, z, heightAt(x, z), brng.range(0, TAU));
      bushes.push({ obj: g, x, z, berries, left: 5 });
    }
  }

  function updateBerries() {
    const autumn = (climate.state.w?.[2] || 0) > 0.3;
    for (const b of bushes) {
      b.obj.visible = autumn;
      if (!autumn) continue;
      if (b.left > 0 && distance(hog.x, hog.z, b.x, b.z) < 0.55 && hog.gait < 0.3) {
        b.left--;
        b.berries[b.left].visible = false;
        state.berriesEaten++;
        hog.onNom?.('berry');
        if (state.berriesEaten === 3 && state.maxHearts === MAX_HEARTS) {
          state.maxHearts = MAX_HEARTS + 1;
          state.hearts = Math.min(state.maxHearts, state.hearts + 1);
          hud.setHearts(state.hearts, state.maxHearts);
          hud.flash('three berries down — he feels twice his size');
          note('berries');
        }
      }
    }
  }

  /** A permanent ring of five clumps at (x, z) — seeded by ordinal, so a
   *  reloaded save regrows exactly the rings it earned. */
  function plantRing(x, z, ordinal) {
    const rr = rngKit(4400 + ordinal * 13);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rr.range(-0.3, 0.3);
      const f = flowerClump({
        seed: 500 + ordinal * 7 + i, n: rr.int(4, 7),
        color: rr.pick(BLOOMS), h: rr.range(0.14, 0.24),
      });
      f.matrixAutoUpdate = false;
      scene.add(f);
      const fx = x + (Math.cos(a) * 0.4) / Math.max(0.08, Math.cos(z / 47.746));
      const fz = z + Math.sin(a) * 0.4;
      seat(f, fx, fz, heightAt(fx, fz), rr.range(0, TAU));
    }
  }

  /** And, once he has five, a path of flowers from the previous ring to the
   *  new one: the walked world knitting itself together behind him. */
  function plantTrail(a, b, ordinal) {
    const rr = rngKit(7100 + ordinal * 17);
    const steps = Math.min(24, Math.max(2, Math.floor(distance(a.x, a.z, b.x, b.z) / 1.4)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cs = Math.max(0.08, Math.cos(lerp(a.z, b.z, t) / 47.746));
      const fx = lerp(a.x, b.x, t) + rr.range(-0.5, 0.5) / cs;
      const fz = lerp(a.z, b.z, t) + rr.range(-0.5, 0.5);
      if (!walkableAt(fx, fz) || world.blockedAt?.(fx, fz)) continue;
      const f = flowerClump({
        seed: 800 + ordinal * 29 + i, n: rr.int(2, 4),
        color: rr.pick(BLOOMS), h: rr.range(0.10, 0.18),
      });
      f.matrixAutoUpdate = false;
      scene.add(f);
      seat(f, fx, fz, heightAt(fx, fz), rr.range(0, TAU));
    }
  }

  // regrow everything a previous session earned
  state.rings.forEach((r, i) => {
    plantRing(r.x, r.z, i + 1);
    if (i > 0 && i + 1 >= 5) plantTrail(state.rings[i - 1], r, i + 1);
  });

  function checkThistle() {
    if (!thistle.live) return;
    if (distance(hog.x, hog.z, thistle.x, thistle.z) > 0.5) return;
    thistle.live = false;
    state.found++;
    audio?.home();
    hud.flash(state.found === 1
      ? 'a golden thistle — the meadow will remember this spot'
      : `a golden thistle — ${state.found} remembered`);
    state.rings.push({ x: thistle.x, z: thistle.z });
    plantRing(thistle.x, thistle.z, state.rings.length);
    if (state.rings.length >= 5) {
      plantTrail(state.rings[state.rings.length - 2], state.rings[state.rings.length - 1], state.rings.length);
      if (state.rings.length === 5) hud.flash('five remembered — and now they reach for one another');
    }
    note('thistle');
    if (thistle.obj) scene.remove(thistle.obj);
    thistle.obj = null;
    save();
  }

  /* --------------------------------- sowing -------------------------------- */
  /* A pool of what you have sown, recycled oldest first.  Everything here is
   * built after the bake, so each one is seated by hand — and each one
   * **grows**, because a flower that simply appears is a flower nobody
   * planted. */
  const POOL = 26;
  const sown = [];

  const sparkleMat = flat({
    color: 0xfff0b0, map: starTex(), transparent: true, opacity: 0.95,
    depthWrite: false, cache: false,
  });
  sparkleMat.blending = THREE.AdditiveBlending;

  function sparkleFor(colour) {
    const N = 18;
    const pos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.055, map: starTex(), color: colour, transparent: true,
      opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 8;
    const seeds = [];
    for (let i = 0; i < N; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(0.04, 0.20);
      seeds.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        rise: rng.range(0.16, 0.44), spin: rng.range(-2, 2), phase: rng.range(0, TAU),
      });
    }
    return { pts, geo, seeds, N };
  }

  function sowKinds(x, z) {
    const kind = placeKindAt(x, z);
    const s = climate.state;
    /* v1's routing, in v1's order: **place first, then season, then hour.**
     * A mushroom garden in the snow still grows mushrooms; the meadow after
     * dark gives fireflies. */
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

  function makeSown(kind) {
    switch (kind) {
      case 'mushroom': {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const mm = mushroom({
            seed: 4000 + state.sown * 3 + i,
            h: rng.range(0.07, 0.13), cap: rng.range(0.05, 0.08),
          });
          mm.position.set(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12));
          g.add(mm);
        }
        return { obj: g, tint: 0xffd9a0 };
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
        const nose = new THREE.Mesh(
          new THREE.ConeGeometry(0.012, 0.05, 5),
          cel({ color: 0xe08a3c, bands: 2, tint: 0x7a6a8e })
        );
        nose.rotation.z = -Math.PI / 2;
        nose.position.set(0.09, 0.245, 0);
        g.add(nose);
        return { obj: g, tint: 0xdff0ff };
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
        return { obj: g, tint: 0xfff0d0 };
      }
      case 'leaves': {
        /* ON the ground, rounded, and nearly flat.  Bare quads hung at
         * random angles up to 14 cm in the air read as a rendering glitch
         * orbiting the hedgehog, not as leaves — a fallen leaf lies down. */
        const g = new THREE.Group();
        const leafMat = cel({
          color: 0xc98a45, bands: 2, tint: 0x6a5a86, side: THREE.DoubleSide, role: 'leaf',
          map: petalTex(), alphaTest: 0.35,
        });
        for (let i = 0; i < 11; i++) {
          const l = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.07), leafMat);
          const a = rng.range(0, TAU), r = rng.range(0.05, 0.3);
          l.position.set(Math.cos(a) * r, 0.008 + rng.range(0, 0.03), Math.sin(a) * r);
          l.rotation.set(-Math.PI / 2 + rng.range(-0.45, 0.45), rng.range(0, TAU), 0);
          l.userData.noOutline = true;
          g.add(l);
        }
        return { obj: g, tint: 0xe8a860 };
      }
      case 'stone':
        return { obj: rock({ seed: 5000 + state.sown, r: rng.range(0.08, 0.16) }), tint: 0xc8d0e0 };
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
        return { obj: g, tint: kind === 'dust' ? 0xe8dcc0 : 0xc0e090 };
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
        return { obj: g, tint: 0xd8f08a };
      }
      default: {
        const colour = rng.pick(BLOOMS);
        return {
          obj: flowerClump({
            seed: 6000 + state.sown,
            n: rng.int(5, 10),
            color: colour,
            h: rng.range(0.13, 0.26),
          }),
          tint: colour,
        };
      }
    }
  }

  /**
   * What you sow that he cannot then walk through, and how wide it is.
   *
   * Everything else on the list is grass-height or flatter and he goes over
   * it, which is right: a flower that stopped him would be an obstacle
   * course. These two are waist-high on a hedgehog and were being **stood
   * inside** — you sow a snowman at his feet, it grows around him, and he
   * settles into an idle in the middle of it. The radius is a shade under
   * the silhouette, the same allowance the brambles get, because being
   * stopped by something that looked like a miss is the unfairness nobody
   * forgives.
   */
  const SOLID = { snowman: 0.135, stone: 0.115 };

  /**
   * Sow at (x, z).  Runs on **every** call, before any early return, because
   * whatever is sown is the thing he then walks to — put this lower down and
   * the mushroom garden, the wood and the hen run quietly stop steering him.
   *
   * Returns where it actually went, which is not always where you tapped: a
   * solid thing is pushed clear of him first.  `blockedAt`'s escape rule
   * means sowing one on top of him could not trap him even so, but he would
   * still be standing inside a snowman, and the fix for that is to not put
   * it there.
   */
  function sow(x, z) {
    const kind = sowKinds(x, z);
    const solid = SOLID[kind] || 0;
    if (solid) {
      const clear = solid + 0.16;             // his own half-width, and a little air
      const d = distance(hog.x, hog.z, x, z);
      if (d < clear) {
        if (d > 1e-3) {
          const p = towards(hog.x, hog.z, x, z, clear);
          x = p.x; z = p.z;
        } else {
          // tapped on his own feet: it goes where he is looking
          x += (Math.cos(hog.hd) * clear) / Math.max(0.08, Math.cos(hog.z / R_PLANET));
          z += Math.sin(hog.hd) * clear;
        }
      }
      if (!walkableAt(x, z)) return { kind, x, z, solid: 0 };
    }

    const { obj, tint } = makeSown(kind);
    obj.matrixAutoUpdate = false;
    scene.add(obj);

    const sparkle = sparkleFor(tint);
    scene.add(sparkle.pts);

    const rec = {
      obj, kind, x, z, tint,
      yaw: rng.range(0, TAU),
      y: heightAt(x, z),
      grow: 0, age: 0, sparkle,
    };
    seat(obj, x, z, rec.y, rec.yaw, 0.001);
    if (solid) rec.blocker = world.addBlocker(x, z, solid);
    sown.push(rec);
    state.sown++;
    audio?.sow(kind);

    if (sown.length > POOL) {
      const old = sown.shift();
      scene.remove(old.obj);
      scene.remove(old.sparkle.pts);
      if (old.blocker) world.removeBlocker(old.blocker);
      old.obj.traverse((o) => o.geometry?.dispose?.());
      old.sparkle.geo.dispose();
      old.sparkle.pts.material.dispose();
    }
    return { kind, x, z, solid };
  }

  /** Grow what has been sown, and let the sparkle go up and out. */
  function growSown(dt) {
    for (const s of sown) {
      s.age += dt;
      if (s.grow < 1) {
        s.grow = Math.min(1, s.grow + dt / 0.62);
        /* An overshoot, so it springs up rather than inflating: this is the
         * one place in the world with any bounce in it, and it is what makes
         * sowing feel like something you did rather than something that
         * happened. */
        const t = s.grow;
        const e = t < 1 ? 1 - Math.pow(2, -9 * t) * Math.cos(t * 13) : 1;
        seat(s.obj, s.x, s.z, s.y, s.yaw, Math.max(0.001, e));
      }

      const sp = s.sparkle;
      if (sp.pts.visible) {
        const t = clamp(s.age / 1.5, 0, 1);
        const b = basisAt(s.x, s.z);
        const arr = sp.geo.attributes.position.array;
        for (let i = 0; i < sp.N; i++) {
          const sd = sp.seeds[i];
          const spread = 1 + t * 1.7;
          const local = new THREE.Vector3()
            .addScaledVector(b.east, sd.x * spread + Math.sin(s.age * 6 + sd.phase) * 0.02)
            .addScaledVector(b.north, sd.z * spread + Math.cos(s.age * 5 + sd.phase) * 0.02)
            .addScaledVector(b.up, 0.03 + sd.rise * t);
          positionAt(s.x, s.y, s.z, _p).add(local);
          arr[i * 3] = _p.x; arr[i * 3 + 1] = _p.y; arr[i * 3 + 2] = _p.z;
        }
        sp.geo.attributes.position.needsUpdate = true;
        sp.pts.material.opacity = Math.sin(Math.min(1, t) * Math.PI) * 0.95;
        sp.pts.material.size = 0.055 * (1 - t * 0.5);
        if (t >= 1) sp.pts.visible = false;
      }

      if (s.obj.userData.flies) {
        s.obj.children.forEach((c) => {
          c.position.y += Math.sin(s.age * 2 + c.userData.bob) * dt * 0.06;
        });
        seat(s.obj, s.x, s.z, s.y, s.yaw, 1);
      }
    }
  }

  /* -------------------------------- the call ------------------------------- */
  function call(x, z, roll = false) {
    /* Sown on **every** call, before any early return, because whatever is
     * sown is the thing he then walks to.  The one exception is the second
     * tap of a double: the first already sowed here, and two flowers in one
     * spot is not a reward, it is a stutter. */
    if (!roll) {
      const s = sow(x, z);
      /* He walks to what he sowed — but a solid thing is somewhere he cannot
       * stand, and a target inside a blocker is a target he presses into for
       * 1.1 s and abandons.  Stop him at its edge instead, which is also
       * simply what you want to watch: he walks up to the snowman. */
      if (s.solid) {
        const p = towards(s.x, s.z, hog.x, hog.z, s.solid + 0.13);
        x = p.x; z = p.z;
      }
    }
    if (!walkableAt(x, z)) {
      /* Called into the water: he goes as close as he can, which is what a
       * hedgehog would do and is far better than nothing happening. */
      const b = bearing(CENTRE[LAKE].x, CENTRE[LAKE].z, x, z);
      const shore = lakeShore(Math.atan2(b.north, b.east));
      const out = offsetFrom(CENTRE[LAKE],
        Math.cos(Math.atan2(b.north, b.east)) * (shore.d + 0.6),
        Math.sin(Math.atan2(b.north, b.east)) * (shore.d + 0.6));
      // refused: he goes to the edge and balks there, rather than wiggling
      hog.callTo(out.x, out.z, roll, true);
      return;
    }
    hog.callTo(x, z, roll);
  }

  /* ------------------------------- the hazards ----------------------------- */
  function checkThorns() {
    const thorns = world.out.thorns || [];
    for (const t of thorns) {
      if (!t.live) continue;
      const d = distance(hog.x, hog.z, t.x, t.z);
      if (d < t.r + 0.09) { wound(t.x, t.z, 'thorns'); return; }
    }
  }

  function checkCars() {
    const cars = world.out.cars || [];
    if (!cars.length) return;
    const across = roadOffset(hog.x, hog.z);
    if (Math.abs(across) > ROAD_HALF + 1) return;      // not on the road at all
    const along = roadAlong(hog.x, hog.z);
    for (const c of cars) {
      if (!c.live) continue;
      /* Measured in the road's own frame, which is exact all the way round
       * the planet — hitboxes match the car you can see, as v1 insisted:
       * `len*.46 x wid*.54`.  A hitbox bigger than the art is the one
       * unfairness nobody forgives. */
      if (Math.abs(along - c.along) < c.size.L * 0.46 + 0.08 &&
          Math.abs(across - c.across) < c.size.W * 0.54 + 0.08) {
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
    audio?.hurt();
    hud.setHearts(Math.max(0, state.hearts), state.maxHearts);
    hud.flash(what === 'thorns' ? 'ow — brambles' : 'a car! back to the verge');

    if (state.hearts <= 0) {
      /* He has had enough.  Not a death screen: v1 never had one, and a
       * hedgehog in a meadow does not lose.  The leg resets and he carries
       * on, which costs progress and nothing else. */
      state.hearts = MAX_HEARTS;
      state.maxHearts = MAX_HEARTS;
      state.berriesEaten = 0;
      state.leg = 1;
      state.thornDensity = 0.18;
      hog.speed = HOG_SPD;
      applyThorns();
      hud.setHearts(state.hearts, state.maxHearts);
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
    const across = roadOffset(hog.x, hog.z);
    const along = roadAlong(hog.x, hog.z);

    if (!hog.under) {
      if (Math.abs(along - cv.along) > 0.6) return;
      if (Math.abs(Math.abs(across) - cv.half) > 0.45) return;
      // only from a verge, and only when he is heading into the road
      const mid = roadPoint(cv.along, 0);
      const toward = bearing(hog.x, hog.z, mid.x, mid.z).angle;
      if (Math.cos(hog.hd - toward) > 0.25) enterCulvert();
      return;
    }

    // under: hold him on the tunnel's line and let him out at either end
    const p = roadPoint(cv.along, across);
    hog.x = lerp(hog.x, p.x, 1 - Math.exp(-8 * dt));
    hog.z = lerp(hog.z, p.z, 1 - Math.exp(-8 * dt));
    if (Math.abs(across) > cv.half + 0.3) {
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
    if (distance(hog.x, hog.z, b.x, b.z) < 0.45) {
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
    const near = world.nearest(hog.x, hog.z, 0.8);
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
    const kind = placeKindAt(hog.x, hog.z);
    /* Everywhere, once: standing in all ten places across one save plants
     * one impossible flower at the very beginning of the world. */
    if (!state.visited.includes(kind)) {
      state.visited.push(kind);
      if (state.visited.length === COUNT && !state.flags.everywhere) {
        note('everywhere');
        plantRing(3, 0, 99);
        hud.flash('he has stood in every place there is — the start of the world blooms for it');
      }
    }
    const s = climate.state;
    const glyph = s.snowFall > 0.3 ? '❄' : s.wet > 0.35 ? '🌧' : s.night > 0.5 ? '🌙' : '☀';
    let weather = `${glyph} ${s.season} · ${s.hour}`;
    if (s.snowFall > 0.3) weather += ' · snow';
    else if (s.wet > 0.35) weather += ' · rain';
    hud.setPlace(PLACE[kind].name, weather);
    const d = distance(hog.x, hog.z, state.burrow.x, state.burrow.z);
    hud.setStatus(state.leg, hog.walked, ` · burrow ${d.toFixed(0)} m`);
  }

  hud.setHearts(state.hearts, state.maxHearts);

  /* ---------------------------------- loop --------------------------------- */
  function update(dt) {
    if (state.invuln > 0) state.invuln -= dt;

    culvert(dt);
    boat();
    if (!hog.under && !hog.afloat) {
      checkThorns();
      checkCars();
    }
    touch(dt);
    growSown(dt);

    if (distance(hog.x, hog.z, state.burrow.x, state.burrow.z) < 0.55) {
      state.leg++;
      /* Faster and thornier, as v1: the only difficulty curve there is, and
       * it is enough because the world keeps changing underneath it. */
      hog.speed = HOG_SPD * (1 + 0.08 * (state.leg - 1));
      state.thornDensity = Math.min(0.88, 0.18 + state.leg * 0.11);
      applyThorns();
      /* The leg's berry bonus expires at the door: back to three hearts,
       * topped up one, and the bushes quietly restock for next time. */
      state.maxHearts = MAX_HEARTS;
      state.berriesEaten = 0;
      for (const b of bushes) { b.left = 5; b.berries.forEach((bm) => { bm.visible = true; }); }
      state.hearts = Math.min(state.maxHearts, state.hearts + 1);
      if (climate.state.night > 0.5) note('slept');
      audio?.home();
      hud.setHearts(state.hearts, state.maxHearts);
      hud.flash(`home. leg ${state.leg} — and the brambles are thicker`);
      hog.stop();
      /* Home after dark means BED.  He goes in, and the night is wound
       * forward under him — visibly, sun and stars sweeping — until dawn
       * lets him out yawning.  Not a fade to black: the whole point of a
       * planet with a working sky is that you get to watch it. */
      if (climate.state.night > 0.5) {
        state.sleeping = true;
        hog.under = true;
        hud.flash('and he sleeps there until morning');
      }
      placeBurrow();
      placeThistle();
      save();
    }

    if (state.sleeping) {
      climate.state.dayT += dt * 46;         // the night on fast-forward
      const dp = (climate.state.dayT / climate.DAY) % 1;
      if (climate.state.night < 0.12 && dp > 0.7 && dp < 0.98) {
        state.sleeping = false;
        hog.under = false;
        if (hog.anim) hog.anim.face.yawn = 1;   // out he comes, mid-yawn
        hud.flash('morning');
      }
    }

    /* Arriving at something worth eating gets a nibble, not just a sniff.
     * The edge is watched here because the game knows what was sown; how it
     * looks and sounds is the caller's business, through the same kind of
     * hook the footfalls use. */
    if (!wasArrived && hog.arrived) {
      for (const s of sown) {
        if ((s.kind === 'mushroom' || s.kind === 'egg') &&
            distance(hog.x, hog.z, s.x, s.z) < 0.5) {
          hog.onNom?.(s.kind);
          break;
        }
      }
    }
    wasArrived = hog.arrived;

    checkThistle();
    updateBerries();
    saveT -= dt;
    if (saveT <= 0) { saveT = 6; save(); }

    readouts(dt);
  }

  return { state, call, update, placeBurrow, burrowObj, sown, note };
}
