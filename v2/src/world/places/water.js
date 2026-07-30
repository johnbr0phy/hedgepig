import * as THREE from 'three';
import { cel } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { rippleTex } from '../../core/textures.js';
import { rngKit, lerp, TAU } from '../../core/util.js';
import { heightAt, waterDepthAt, lakeShore, WATER_Y } from '../terrain.js';
import { CENTRE, LAKE, LAKE_R, offsetFrom, distance } from '../plan.js';
import { positionAt, basisAt } from '../planet.js';
import { reeds, rock, log, flowerClump } from '../props.js';

/* ------------------------------------------------------------------ *
 * The lake, and the mire at its edge.
 *
 * In the banded world the lake ran the full width of the field and was
 * therefore an **unavoidable wall**, which is what earned it the boat.  With
 * the world open it is a disc you can walk round — so the boat stays as the
 * *short* way over rather than the only way, which is a better thing for a
 * boat to be.
 *
 * The shoreline is not authored.  The bed is dug by `heightAt` and the water
 * is a flat sheet at `WATER_Y`, so the edge is simply the contour where one
 * crosses the other: retune the bed and the shore follows on its own.
 * ------------------------------------------------------------------ */

export function buildLake(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:lake';
  const rng = rngKit(503);

  /* --- reed beds, following the shoreline all the way round it --- */
  const RING = 54;
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * TAU + rng.range(-0.03, 0.03);
    const shore = lakeShore(a);
    const bed = reeds({
      seed: 1000 + i,
      n: rng.int(12, 26),
      h: rng.range(0.26, 0.46),
      r: rng.range(0.25, 0.55),
    });
    // a little outside the water, so they stand in the wet rather than in it
    const d = shore.d + rng.range(0.15, 1.1);
    ctx.put(bed, Math.cos(a) * d, Math.sin(a) * d);
    g.add(bed);
  }

  /* --- lily pads: flat discs sitting on the sheet, never under it --- */
  const padMat = cel({ color: 0x5f8f52, bands: 2, tint: 0x4f6a8c, flat: false, role: 'leaf' });
  const padGeo = new THREE.CircleGeometry(0.11, 12, 0.35, TAU - 0.7);
  padGeo.rotateX(-Math.PI / 2);
  const PADS = 110;
  const pads = new THREE.InstancedMesh(padGeo, padMat, PADS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  const padSpots = [];
  let np = 0;
  for (let i = 0; i < PADS * 3 && np < PADS; i++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * (LAKE_R - 2.5);
    const p = ctx.at(Math.cos(a) * d, Math.sin(a) * d);
    if (waterDepthAt(p.x, p.z) < 0.2) continue;
    const b = basisAt(p.x, p.z);
    fm.makeBasis(b.east, b.up, b.north);
    q.setFromRotationMatrix(fm);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TAU)));
    m.compose(
      positionAt(p.x, WATER_Y + 0.012, p.z, new THREE.Vector3()),
      q,
      new THREE.Vector3(rng.range(0.7, 1.6), 1, rng.range(0.7, 1.6))
    );
    pads.setMatrixAt(np++, m);
    padSpots.push({ u: Math.cos(a) * d, v: Math.sin(a) * d });
  }
  pads.count = np;
  pads.instanceMatrix.needsUpdate = true;
  pads.userData.noOutline = true;
  g.add(pads);

  // a few flowers among them, because a lily pad without one is a leaf
  for (let i = 0; i < 9 && padSpots.length; i++) {
    const s = padSpots[Math.floor(rng.next() * padSpots.length)];
    const fl = flowerClump({ seed: 1100 + i, n: 3, color: PAL.bloomWhite, h: 0.05 });
    const p = ctx.at(s.u, s.v);
    fl.position.set(p.x, WATER_Y + 0.02, p.z);
    fl.userData.planetRigid = true;
    g.add(fl);
  }

  /* --- the jetty, on the near shore --- */
  const jetty = new THREE.Group();
  const timber = cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });
  for (let i = 0; i < 7; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 1.0), timber);
    plank.position.set(-0.8 + i * 0.26, 0.12, 0);
    jetty.add(plank);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const pile = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), timber);
      pile.position.set(-0.7 + i * 0.62, -0.1, 0.42 * s);
      jetty.add(pile);
    }
  }
  const shoreA = lakeShore(0);
  ctx.put(jetty, Math.cos(0) * (shoreA.d - 0.5), 0);
  jetty.position.y = WATER_Y + 0.12;
  g.add(jetty);

  ctx.scatter(rng, { n: 14, minGap: 1.8, inner: LAKE_R + 1 }, (u, v, i) =>
    rock({ seed: 1200 + i, r: rng.range(0.14, 0.36) })
  ).forEach((p) => g.add(p.obj));

  const drift = log({ seed: 1301, len: 1.5, r: 0.13 });
  const sh = lakeShore(2.4);
  ctx.put(drift, Math.cos(2.4) * (sh.d + 0.7), Math.sin(2.4) * (sh.d + 0.7));
  g.add(drift);

  root.add(g);

  /* --------------------------- the boat, after the bake -------------------- */
  ctx.post.push((scene) => {
    const boat = new THREE.Group();
    const hullMat = cel({ color: 0xb5754a, bands: 3, tint: 0x6b5b86, flat: false });
    const hullGeo = new THREE.SphereGeometry(0.34, 14, 10, 0, TAU, 0, Math.PI / 2);
    hullGeo.scale(1.35, 0.55, 0.8);
    hullGeo.rotateX(Math.PI);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.16;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.33, 0.022, 6, 18),
      cel({ color: PAL.timberDark, bands: 3, tint: 0x6b5b86 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.35, 0.8, 1);
    rim.position.y = 0.17;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.26), hullMat);
    seat.position.y = 0.10;
    boat.add(hull, rim, seat);
    scene.add(boat);
    boat.matrixAutoUpdate = false;

    /* Moored just off two opposite shores.  Straight across is 27 m of
     * water against about 42 m of walking round, so the boat is worth
     * taking without being the only way. */
    const near = lakeShore(0);
    const far = lakeShore(Math.PI);
    const moorA = ctx.at(near.d - 0.35, 0);
    const moorB = ctx.at(-(far.d - 0.35), 0);
    const landA = ctx.at(near.d + 0.7, 0);
    const landB = ctx.at(-(far.d + 0.7), 0);

    const state = {
      mesh: boat, moorA, moorB, landA, landB,
      side: -1, x: moorA.x, z: moorA.z, crossing: 0, bob: 0,
    };
    ctx.out.boat = state;

    const mm = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    ctx.updaters.push((dt, hog) => {
      state.bob += dt;
      const from = state.side < 0 ? state.moorA : state.moorB;
      const to = state.side < 0 ? state.moorB : state.moorA;

      if (state.crossing > 0) {
        state.crossing = Math.min(1, state.crossing + dt / 9);
        // ease in and out, so it leaves and arrives like a boat, not a lift
        const t = state.crossing * state.crossing * (3 - 2 * state.crossing);
        // across the lake along its own diameter, through the centre
        const u = lerp(near.d - 0.35, -(far.d - 0.35), state.side < 0 ? t : 1 - t);
        const p = ctx.at(u, 0);
        state.x = p.x; state.z = p.z;
        if (hog.afloat === state) { hog.x = p.x; hog.z = p.z; }
        if (state.crossing >= 1) {
          state.crossing = 0;
          state.side *= -1;
          if (hog.afloat === state) {
            hog.afloat = null;
            const land = state.side < 0 ? state.landA : state.landB;
            hog.x = land.x; hog.z = land.z;
            hog.y = heightAt(hog.x, hog.z);
            ctx.flash('ashore, and shaking the lake off');
          }
        }
      } else {
        state.x = from.x; state.z = from.z;
      }

      const y = WATER_Y + 0.02 + Math.sin(state.bob * 1.6) * 0.012;
      const b = basisAt(state.x, state.z);
      mm.makeBasis(b.east, b.up, b.north);
      mm.setPosition(positionAt(state.x, y, state.z, pos));
      rot.makeRotationZ(Math.sin(state.bob * 1.1) * 0.04);
      mm.multiply(rot);
      boat.matrix.copy(mm);
      boat.matrixWorldNeedsUpdate = true;
    });
  });

  return g;
}

/**
 * The mire.
 *
 * The only place that is unpleasant underfoot.  Puddles rather than water:
 * flat discs at ground level with no depth to them, so he walks straight
 * through and only the sound of it changes.
 */
export function buildMire(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:mire';
  const rng = rngKit(601);

  const puddleMat = cel({
    color: 0x5c6f74, bands: 2, tint: 0x4d5e84, flat: false,
    map: rippleTex(), transparent: true, opacity: 0.85, role: 'water',
  });
  puddleMat.map.repeat.set(2, 2);
  puddleMat.map.wrapS = puddleMat.map.wrapT = THREE.RepeatWrapping;

  ctx.scatter(rng, { n: 34, minGap: 1.4 }, (u, v, i) => {
    const r = rng.range(0.3, 1.15);
    const geo = new THREE.CircleGeometry(r, 16);
    geo.rotateX(-Math.PI / 2);
    const p = new THREE.Mesh(geo, puddleMat);
    p.position.y = 0.014;
    p.scale.set(1, 1, rng.range(0.6, 1.3));
    p.rotation.y = rng.range(0, TAU);
    p.userData.noOutline = true;
    p.receiveShadow = true;
    const holder = new THREE.Group();
    holder.add(p);
    return holder;
  }).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 52, minGap: 0.9 }, (u, v, i) =>
    reeds({ seed: 1400 + i, n: rng.int(8, 18), h: rng.range(0.18, 0.34), r: rng.range(0.16, 0.4) })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 16, minGap: 2.2 }, (u, v, i) => {
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(rng.range(0.2, 0.4), 8, 6, 0, TAU, 0, Math.PI / 2),
      cel({ color: PAL.mud, bands: 3, tint: 0x5f5286, flat: false })
    );
    mound.scale.y = rng.range(0.3, 0.55);
    mound.castShadow = true;
    return mound;
  }).forEach((p) => g.add(p.obj));

  /* Stepping stones across the middle: the one dry line through the place,
   * and the only navigation this world asks of you. */
  for (let i = 0; i < 11; i++) {
    const u = -7 + i * 1.4;
    const v = Math.sin(i * 0.8) * 1.5;
    const s = rock({ seed: 1500 + i, r: rng.range(0.22, 0.32) });
    s.scale.y = 0.5;
    ctx.put(s, u, v);
    g.add(s);
  }

  root.add(g);
  return g;
}
