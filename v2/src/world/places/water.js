import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { rippleTex } from '../../core/textures.js';
import { rngKit, clamp, lerp, TAU, trs, bake, shadowify, damp } from '../../core/util.js';
import { heightAt, waterDepthAt, shoreAt, WATER_Y } from '../terrain.js';
import { bandEdges, LAKE, wrapDelta } from '../plan.js';
import { positionAt, basisAt } from '../planet.js';
import { reeds, rock, log, flowerClump, scatter } from '../props.js';

/* ------------------------------------------------------------------ *
 * The lake, and the mire at its edge.
 *
 * The lake is v1's hardest rule made literal.  It runs the full width of
 * the field — here, right over both poles — so it is an **unavoidable
 * wall** for something that cannot stop, and v1's answer to that was never
 * "make it a hazard".  It was: give him a boat.  So there is a boat, moored
 * where the shoreline crosses the middle of the field, and it ferries him
 * and comes back for him.
 *
 * The shoreline itself is not authored.  The bed is dug by `heightAt` and
 * the water is a flat sheet at `WATER_Y`, so the edge is simply the contour
 * where one crosses the other — retune the bed and the shore follows on its
 * own, with no geometry to fix up.
 * ------------------------------------------------------------------ */

export function buildLake(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:lake';
  const rng = rngKit(ctx.slot * 503 + 17);
  const [wa, wb] = bandEdges(LAKE);

  /* --- reed beds, following the shoreline round rather than in a line --- */
  for (const side of [-1, 1]) {
    for (let i = 0; i < 26; i++) {
      const z = -13 + (i / 25) * 26 + rng.range(-0.4, 0.4);
      const sx = shoreAt(z, side);
      const x = sx + rng.range(-0.5, 0.35) * side * -1;
      const bed = reeds({ seed: 1000 + i * (side + 2), n: rng.int(12, 26), h: rng.range(0.26, 0.46), r: rng.range(0.25, 0.55) });
      bed.position.set(x, heightAt(x, z), z);
      g.add(bed);
    }
  }

  /* --- lily pads: flat discs sitting on the sheet, never under it --- */
  const padMat = cel({ color: 0x5f8f52, bands: 2, tint: 0x4f6a8c, flat: false, role: 'leaf' });
  const padGeo = new THREE.CircleGeometry(0.11, 12, 0.35, TAU - 0.7);
  padGeo.rotateX(-Math.PI / 2);
  const pads = new THREE.InstancedMesh(padGeo, padMat, 90);
  const m = new THREE.Matrix4();
  const padSpots = [];
  for (let i = 0; i < 90; i++) {
    const x = rng.range(wa + 1.2, wb - 1.2);
    const z = rng.range(-13, 13);
    m.compose(
      new THREE.Vector3(x, WATER_Y + 0.012, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, TAU), 0)),
      new THREE.Vector3(rng.range(0.7, 1.6), 1, rng.range(0.7, 1.6))
    );
    pads.setMatrixAt(i, m);
    padSpots.push({ x, z });
  }
  pads.instanceMatrix.needsUpdate = true;
  pads.userData.noOutline = true;
  g.add(pads);

  // a few flowers among them, because a lily pad without one is a leaf
  for (let i = 0; i < 7; i++) {
    const s = padSpots[Math.floor(rng.next() * padSpots.length)];
    const fl = flowerClump({ seed: 1100 + i, n: 3, color: PAL.bloomWhite, h: 0.05 });
    fl.position.set(s.x, WATER_Y + 0.02, s.z);
    g.add(fl);
  }

  /* --- the jetty, on the near shore, at the middle of the field --- */
  const jx = shoreAt(0, -1);
  const deck = [];
  for (let i = 0; i < 7; i++) {
    const px = jx - 1.1 + i * 0.26;
    deck.push({ geometry: new THREE.BoxGeometry(0.22, 0.05, 1.0), matrix: trs(px, WATER_Y + 0.12, 0) });
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const px = jx - 0.95 + i * 0.62;
      deck.push({ geometry: new THREE.BoxGeometry(0.07, 0.5, 0.07), matrix: trs(px, WATER_Y - 0.1, 0.42 * s) });
    }
  }
  const jetty = new THREE.Mesh(bake(deck), cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 }));
  g.add(shadowify(jetty));

  scatter(rng, { x0: wa - 6, x1: wa - 1, z0: -12, z1: 12, n: 8, minGap: 1.6, avoidWater: true }, (x, z, i) =>
    rock({ seed: 1200 + i, r: rng.range(0.14, 0.36) })
  ).forEach((p) => g.add(p.obj));

  const drift = log({ seed: 1301, len: 1.5, r: 0.13 });
  const dx = shoreAt(-6.5, 1) + 0.9;
  drift.position.set(dx, heightAt(dx, -6.5), -6.5);
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
    boat.add(hull);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.33, 0.022, 6, 18),
      cel({ color: PAL.timberDark, bands: 3, tint: 0x6b5b86 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.35, 0.8, 1);
    rim.position.y = 0.17;
    boat.add(rim);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.4), hullMat);
    seat.position.y = 0.15;
    boat.add(seat);
    shadowify(boat);
    scene.add(boat);
    boat.matrixAutoUpdate = false;

    const state = {
      mesh: boat,
      /** flat coordinates of the mooring on each shore, at the field's middle */
      moorA: { x: shoreAt(0, -1) - 0.18, z: 0 },
      moorB: { x: shoreAt(0, 1) + 0.18, z: 0 },
      side: -1,
      x: shoreAt(0, -1) - 0.18,
      z: 0,
      crossing: 0,
      bob: 0,
    };
    ctx.out.boat = state;

    ctx.updaters.push((dt, hog) => {
      state.bob += dt;
      const from = state.side < 0 ? state.moorA : state.moorB;
      const to = state.side < 0 ? state.moorB : state.moorA;

      if (state.crossing > 0) {
        state.crossing = Math.min(1, state.crossing + dt / 7.5);
        // ease in and out, so it leaves and arrives like a boat and not a lift
        const t = state.crossing * state.crossing * (3 - 2 * state.crossing);
        state.x = lerp(from.x, to.x, t);
        state.z = lerp(from.z, to.z, t);
        if (hog.afloat === state) {
          hog.x = state.x;
          hog.z = state.z;
          hog.hd = state.side < 0 ? 0 : Math.PI;
        }
        if (state.crossing >= 1) {
          state.crossing = 0;
          state.side *= -1;
          if (hog.afloat === state) {
            hog.afloat = null;
            // step off onto dry land, a little clear of the water
            const land = state.side < 0 ? state.moorA.x - 0.55 : state.moorB.x + 0.55;
            hog.x = land;
            hog.y = heightAt(hog.x, hog.z);
            ctx.flash('ashore, and shaking the lake off');
          }
        }
      } else {
        state.x = from.x;
        state.z = from.z;
      }

      const y = WATER_Y + 0.02 + Math.sin(state.bob * 1.6) * 0.012;
      const b = basisAt(state.x, state.z);
      const mm = new THREE.Matrix4().makeBasis(b.east, b.up, b.north);
      mm.setPosition(positionAt(state.x, y, state.z, new THREE.Vector3()));
      mm.multiply(new THREE.Matrix4().makeRotationZ(Math.sin(state.bob * 1.1) * 0.04));
      boat.matrix.copy(mm);
      boat.matrixWorldNeedsUpdate = true;
    });
  });

  return g;
}

/**
 * The mire.
 *
 * The place between the lake and the hens, and the only one that is
 * unpleasant underfoot.  Puddles rather than water: they are flat discs at
 * ground level with no depth to them, so he walks straight through and only
 * the sound of it changes — v1 was clear that a hazard has to be dodgeable
 * in x or it is just a wall, and a mire you cannot cross is a wall with mud
 * on it.
 */
export function buildMire(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:mire';
  const rng = rngKit(ctx.slot * 601 + 19);
  const { x0, x1, cx } = ctx;

  const puddleMat = cel({
    color: 0x5c6f74, bands: 2, tint: 0x4d5e84, flat: false,
    map: rippleTex(), transparent: true, opacity: 0.82, role: 'water',
  });
  puddleMat.map.repeat.set(2, 2);
  puddleMat.map.wrapS = puddleMat.map.wrapT = THREE.RepeatWrapping;

  for (let i = 0; i < 22; i++) {
    const x = rng.range(x0 + 1.5, x1 - 1.5);
    const z = rng.range(-11, 11);
    const r = rng.range(0.3, 1.15);
    const geo = new THREE.CircleGeometry(r, 16);
    geo.rotateX(-Math.PI / 2);
    const p = new THREE.Mesh(geo, puddleMat);
    p.position.set(x, heightAt(x, z) + 0.014, z);
    p.scale.set(1, 1, rng.range(0.6, 1.3));
    p.rotation.y = rng.range(0, TAU);
    p.userData.noOutline = true;
    p.receiveShadow = true;
    g.add(p);
  }

  // rushes, in the wet
  scatter(rng, { x0: x0 + 1, x1: x1 - 1, z0: -12, z1: 12, n: 30, minGap: 0.8 }, (x, z, i) =>
    reeds({ seed: 1400 + i, n: rng.int(8, 18), h: rng.range(0.18, 0.34), r: rng.range(0.16, 0.4) })
  ).forEach((p) => g.add(p.obj));

  // mud mounds and old branches
  scatter(rng, { x0: x0 + 2, x1: x1 - 2, z0: -11, z1: 11, n: 9, minGap: 2 }, (x, z, i) => {
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(rng.range(0.2, 0.4), 8, 6, 0, TAU, 0, Math.PI / 2),
      cel({ color: PAL.mud, bands: 3, tint: 0x5f5286, flat: false })
    );
    mound.scale.y = rng.range(0.3, 0.55);
    return shadowify(mound);
  }).forEach((p) => g.add(p.obj));

  /* Stepping stones across the middle: the one dry line through the place,
   * and the only navigation this world asks of you. */
  for (let i = 0; i < 9; i++) {
    const x = cx - 5 + i * 1.25;
    const z = Math.sin(i * 0.8) * 1.4;
    const s = rock({ seed: 1500 + i, r: rng.range(0.22, 0.32) });
    s.position.set(x, heightAt(x, z) + 0.02, z);
    s.scale.y = 0.5;
    g.add(s);
  }

  root.add(g);
  return g;
}
