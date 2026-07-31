import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { signTex } from '../../core/textures.js';
import { rngKit, lerp, sstep, bake, trs, shadowify, TAU } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { positionAt, basisAt } from '../planet.js';
import { CIRC, ROAD_HALF, roadPoint, roadAlong, roadOffset, bearing } from '../plan.js';
import {
  rock, flowerClump, drystone, gate, signpost, thistle, tussock, molehillProp,
  crate, bucket, lightPool,
} from '../props.js';

/* ------------------------------------------------------------------ *
 * The road, and the town it leads to.
 *
 * **The road is the one thing left in this world that cannot be walked
 * round.**  Everything else opened up when the bands went — the lake became
 * a lake you can stroll past, the places became discs you wander between —
 * but a road is a line by nature, so this one is the great circle through
 * the roadside and the town, and it goes all the way round the planet.
 *
 * That keeps v1's sharpest rule alive:
 *
 *   A car is longer than he can see, and before the culvert existed the test
 *   harness died to one on every single crossing.  **Any hazard that cannot
 *   be dodged is not a hazard, it is a wall.**  So the tarmac has a hedgehog
 *   tunnel under it at a fixed, findable place, and while he is under it he
 *   is immune, invisible, and leaves no prints.
 * ------------------------------------------------------------------ */

/** Where the tunnel is, in metres round the ring from the roadside's centre. */
export const CULVERT_ALONG = 0;

/* --------------------------- the road's frame --------------------------- *
 *
 * **Nothing that belongs to the road may be laid out in a place's (u, v).**
 * A place is a disc centred on a point of the ring and its east/north frame
 * is turned about 36° against the road — so the signpost authored at
 * `v = -(ROAD_HALF + 2.4)`, which reads as "two metres past the far kerb",
 * stood **2.15 m from the centreline**, in the carriageway, with the traffic
 * going through it.  The town had a cottage at 0.36 m and a cat asleep on a
 * wall at 1.59 m, and nobody had ever noticed, because cars despawn 36 m
 * either side of the culvert and none of them has ever reached the town.
 *
 * Everything road-shaped is placed in (along, across) from here on, which is
 * exact wherever on the planet it lands.
 */

/**
 * Seat a prop in the road's own frame: `along` metres round the ring from the
 * roadside's centre, `across` metres off the centreline.  With `turn` at zero
 * its +x runs the way the road goes and its +z faces the **near** side, which
 * is decreasing `across` — measured against `bearing`, not reasoned, because
 * the sign depends on how `makeBasis` consumes (east, up, north).
 *
 * Height comes from `heightAt` like everything else, so a prop rides whatever
 * the cutting's banks are doing without knowing they exist.
 */
function onRoad(obj, along, across, { lift = 0, turn = 0 } = {}) {
  const p = roadPoint(along, across);
  const ahead = roadPoint(along + 0.5, across);
  obj.position.set(p.x, heightAt(p.x, p.z) + lift, p.z);
  obj.rotation.y = -bearing(p.x, p.z, ahead.x, ahead.z).angle + turn;
  obj.userData.planetRigid = true;
  return p;
}

/**
 * The tarmac's own surface, as a lift above `heightAt` at `across` metres from
 * the centreline — and **every marking is laid through this**, so no line can
 * come adrift from the road it is painted on.
 *
 * There is no crown, and there cannot be one: he walks on `heightAt`, the
 * traffic seats at a fixed lift, and a road cambered a hand's width up the
 * middle would bury a 26 cm animal to the knees in it and float the cars at
 * the same time.  What a camber actually *gives* you at this size is the
 * shaded lip where the surface turns down into the gutter, and that costs
 * three centimetres at the very edge, where nothing stands.
 */
const TARMAC_Y = 0.02;
const tarmacLift = (across) =>
  TARMAC_Y - 0.03 * sstep(0.80, 1.0, Math.abs(across) / ROAD_HALF);

/* ------------------------------- the hedge ------------------------------- */

/**
 * Both hedge materials are made once and shared by every run on the planet,
 * so the static merge in `world/index.js` folds the whole lot into two
 * meshes.  A `role` implies `cache: false` in `cel` — ask it for a canopy
 * material per run and you get sixty materials and sixty draw calls.
 */
let _hedgeMat = null;
function hedgeMats() {
  if (!_hedgeMat) {
    _hedgeMat = {
      leaf: cel({ color: PAL.bramble, bands: 3, tint: 0x4f5d84, role: 'canopy' }),
      wood: cel({ color: PAL.timberDark, bands: 3, tint: 0x63537f }),
    };
  }
  return _hedgeMat;
}

/**
 * A run of hedge, `len` metres of it laid along +x.
 *
 * Built a run at a time and seated rigidly for the reason `fencePost` is: one
 * long mesh bent onto the sphere is squashed along longitude by
 * `cos(latitude)`.  The masses are icosahedra at **detail 0** on purpose — a
 * hedge that has met a flail is faceted, and the cel ramp puts one flat band
 * on each face, which is what makes it read as painted foliage rather than as
 * a green sausage.  The stems carry no role, so they stay woody when the
 * leaves turn; in winter they are all you can see of it.
 */
function hedgeRun({ seed = 1, len = 1.7, h = 1.15 } = {}) {
  const rng = rngKit(seed * 6947);
  const g = new THREE.Group();
  const mats = hedgeMats();

  const wood = [];
  for (let i = 0, n = rng.int(2, 3); i < n; i++) {
    const x = lerp(-len / 2, len / 2, (i + rng.range(0.25, 0.75)) / n);
    const sh = h * rng.range(0.45, 0.7);
    const st = new THREE.CylinderGeometry(0.016, 0.034, sh, 5);
    st.translate(0, sh / 2, 0);
    wood.push({
      geometry: st,
      matrix: trs(x, 0, rng.range(-0.1, 0.1), rng.range(-0.13, 0.13), 0, rng.range(-0.13, 0.13)),
    });
  }
  g.add(new THREE.Mesh(bake(wood), mats.wood));

  const leaf = [];
  const n = Math.max(3, Math.round(len / 0.44));
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n; i++) {
      const r = rng.range(0.29, 0.36);
      leaf.push({
        geometry: new THREE.IcosahedronGeometry(r, 0),
        matrix: trs(
          -len / 2 + ((i + 0.5) * len) / n + rng.range(-0.07, 0.07),
          h * (row ? 0.76 : 0.42) + rng.range(-0.05, 0.05),
          rng.range(-0.07, 0.07),
          rng.range(0, TAU), rng.range(0, TAU), 0,
          1, rng.range(0.86, 1.1), rng.range(0.9, 1.05)
        ),
      });
    }
  }
  g.add(new THREE.Mesh(bake(leaf), mats.leaf));
  return shadowify(g);
}

/* ------------------------- the small road things ------------------------- */

/** A milestone: the oldest thing on this road, and the only one that claims
 *  to know how far it is to anywhere. */
function milestone({ seed = 1, h = 0.5 } = {}) {
  const rng = rngKit(seed * 1783);
  const g = new THREE.Group();
  const w = 0.3, d = 0.15;

  const body = new THREE.BoxGeometry(w, h, d);
  body.translate(0, h / 2, 0);
  /* The rounded head is half a cylinder laid along the face: `rotateZ` sends
   * the kept half (x ≥ 0) to y ≥ 0 and the axis to x, which is the only
   * arrangement that puts the dome on top rather than down one side. */
  const cap = new THREE.CylinderGeometry(d / 2, d / 2, w, 10, 1, false, 0, Math.PI);
  cap.rotateZ(Math.PI / 2);
  cap.translate(0, h, 0);
  g.add(new THREE.Mesh(
    bake([{ geometry: body }, { geometry: cap }]),
    cel({ color: PAL.chalk, bands: 3, tint: 0x6a6690, flat: false })
  ));

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.185, 0.185),
    flat({
      map: signTex('2', { w: 96, h: 96, size: 56, bg: '#e7e1cd', fg: '#4a4552', border: false }),
      cache: false,
    })
  );
  face.position.set(0, h * 0.6, d / 2 + 0.004);
  g.add(face);

  // lichen, on the side the weather comes from
  const lichen = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.05, 0),
    cel({ color: 0x9aa778, bands: 2, tint: 0x6a6690 })
  );
  lichen.position.set(-w * 0.28, h * rng.range(0.45, 0.75), -d / 2);
  lichen.scale.set(1.4, 1.6, 0.35);
  g.add(lichen);
  return shadowify(g);
}

/** A gully grating at the kerb.  Dead flat, deliberately: anything on the
 *  tarmac he could get *under* would turn the road from a hazard into the
 *  safest place on it. */
function grating({ w = 0.44, d = 0.3 } = {}) {
  const g = new THREE.Group();
  const rail = 0.035;
  const parts = [
    { geometry: new THREE.BoxGeometry(w, 0.03, rail), matrix: trs(0, 0.015, (d - rail) / 2) },
    { geometry: new THREE.BoxGeometry(w, 0.03, rail), matrix: trs(0, 0.015, -(d - rail) / 2) },
    { geometry: new THREE.BoxGeometry(rail, 0.03, d), matrix: trs((w - rail) / 2, 0.015, 0) },
    { geometry: new THREE.BoxGeometry(rail, 0.03, d), matrix: trs(-(w - rail) / 2, 0.015, 0) },
  ];
  for (let i = 0; i < 5; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.022, 0.02, d - rail * 2),
      matrix: trs(lerp(-w / 2 + 0.08, w / 2 - 0.08, i / 4), 0.012, 0),
    });
  }
  g.add(new THREE.Mesh(bake(parts), cel({ color: 0x55565e, bands: 3, tint: 0x5c688e })));

  const dark = new THREE.Mesh(
    new THREE.PlaneGeometry(w - rail * 2, d - rail * 2),
    flat({ color: 0x15121b })
  );
  dark.rotation.x = -Math.PI / 2;
  dark.position.y = -0.004;
  g.add(dark);
  return shadowify(g, false, true);
}

/**
 * A drinks can, lying down.  Two small ugly things a long way from anywhere
 * are the most reliable sign in the world that a road goes somewhere, and
 * this one is 11 cm long against a 26 cm hedgehog — nearly half of him, which
 * is exactly how big a can is when you are that size.
 */
function can({ seed = 1, color = 0xc4463c } = {}) {
  const g = new THREE.Group();
  const r = 0.032, h = 0.115;
  const metal = cel({ color: PAL.metal, bands: 3, tint: 0x5c688e });
  const shell = new THREE.CylinderGeometry(r, r, h * 0.72, 10);
  shell.rotateZ(Math.PI / 2);
  const s = new THREE.Mesh(shell, cel({ color, bands: 3, tint: 0x6a5a86, flat: false }));
  s.position.y = r;
  g.add(s);
  for (const sx of [-1, 1]) {
    const end = new THREE.CylinderGeometry(r * 0.84, r * 0.95, h * 0.14, 10);
    end.rotateZ(Math.PI / 2);
    const e = new THREE.Mesh(end, metal);
    e.position.set(sx * h * 0.43, r, 0);
    g.add(e);
  }
  return shadowify(g);
}

/** A bottle: body, shoulder, neck and lip, 24 cm of it.  Transparent, so it
 *  is kept out of the static merge — sort order is load-bearing there. */
function bottle({ seed = 1, color = 0x4a7548, opacity = 0.62 } = {}) {
  const g = new THREE.Group();
  const bh = 0.14, r = 0.036;
  const body = new THREE.CylinderGeometry(r, r * 0.94, bh, 10);
  body.translate(0, bh / 2, 0);
  const shoulder = new THREE.CylinderGeometry(0.015, r, 0.055, 10);
  shoulder.translate(0, bh + 0.0275, 0);
  const neck = new THREE.CylinderGeometry(0.015, 0.015, 0.05, 8);
  neck.translate(0, bh + 0.08, 0);
  const lip = new THREE.CylinderGeometry(0.018, 0.018, 0.014, 8);
  lip.translate(0, bh + 0.112, 0);
  g.add(new THREE.Mesh(
    bake([{ geometry: body }, { geometry: shoulder }, { geometry: neck }, { geometry: lip }]),
    cel({
      color, bands: 'soft3', tint: 0x5a6a9c, flat: false,
      transparent: true, opacity, cache: false,
    })
  ));
  g.userData.noMerge = true;
  return shadowify(g);
}

/* -------------------------------- the cars -------------------------------- */

function car(seed) {
  const rng = rngKit(seed * 7717);
  const g = new THREE.Group();
  /* One parametric maker, as the reference did with its whole motor fleet:
   * six numbers and every car on the road is a different one — at the size
   * cars actually are.  They were 2.0 × 0.8 m at first, which is a large
   * dog, and it did not look wrong next to a 26 cm hedgehog because nothing
   * does. */
  const L = rng.range(3.4, 4.4);
  const W = rng.range(1.55, 1.80);
  const H = rng.range(1.15, 1.45);
  const cabF = rng.range(0.18, 0.34);
  const body = rng.pick([0xd8654f, 0x4f7fa8, 0xe0c05c, 0xe6e2d8, 0x5d7a55, 0x8f6aa0]);

  const paint = cel({ color: body, bands: 3, tint: 0x63537f, flat: false });
  const glassM = flat({ color: 0x9fc2cf, transparent: true, opacity: 0.7, cache: false });
  const tyre = cel({ color: 0x2c2a30, bands: 2, tint: 0x4a4058 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), paint);
  hull.position.y = H / 2 + 0.30;
  g.add(hull);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, H * 0.62, L * (0.5 - cabF * 0.4)), paint);
  cab.position.set(0, H + 0.30 + H * 0.28, -L * cabF * 0.5);
  g.add(cab);

  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(L * (0.44 - cabF * 0.3), H * 0.42), glassM);
    win.position.set(W * 0.451 * s, H + 0.30 + H * 0.3, -L * cabF * 0.5);
    win.rotation.y = (Math.PI / 2) * s;
    g.add(win);
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.82, H * 0.44), glassM);
  screen.position.set(0, H + 0.30 + H * 0.3, -L * cabF * 0.5 + L * (0.25 - cabF * 0.2));
  screen.rotation.x = -0.28;
  g.add(screen);

  const wheelGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.20, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(W * 0.46 * sx, 0.30, L * 0.32 * sz);
      g.add(w);
    }
  }

  const lampM = flat({ color: 0xfff2c8, cache: false, role: 'headlamp' });
  const tailM = flat({ color: 0x8a2f28, cache: false });
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.10, 8), lampM);
    lamp.position.set(W * 0.30 * s, H * 0.62, L * 0.5 + 0.005);
    const t = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8), tailM);
    t.position.set(W * 0.30 * s, H * 0.62, -L * 0.5 - 0.005);
    t.rotation.y = Math.PI;
    g.add(lamp, t);
  }

  g.traverse((o) => {
    if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; }
  });
  g.userData.size = { L, W };
  return g;
}

export function buildRoad(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:road';
  const rng = rngKit(907);

  /* --- the tarmac: a strip right round the planet --- *
   * Its vertices are generated *through* the mapping, so the surface is
   * exactly right however far north it runs.  Only geometry authored as a
   * flat box and then bent comes out squashed.
   *
   * The cross-section is a hand-authored profile rather than an even
   * division, because the only part of a carriageway with any shape in it is
   * the last half-metre at the edge: three columns each side to carry the
   * turn-down, and almost nothing in the middle, which is flat because it is
   * flat. */
  const ALONG = 220;
  const XS = [-1, -0.94, -0.86, -0.64, -0.32, 0, 0.32, 0.64, 0.86, 0.94, 1];
  {
    const pos = [];
    const idx = [];
    const at = { x: 0, z: 0 };
    for (let i = 0; i <= ALONG; i++) {
      const s = (i / ALONG) * CIRC;
      for (let j = 0; j < XS.length; j++) {
        const t = XS[j] * ROAD_HALF;
        roadPoint(s, t, at);
        pos.push(at.x, heightAt(at.x, at.z) + tarmacLift(t), at.z);
      }
    }
    for (let i = 0; i < ALONG; i++) {
      for (let j = 0; j < XS.length - 1; j++) {
        const a = i * XS.length + j, b = a + 1;
        const c = a + XS.length, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tar = new THREE.Mesh(geo, cel({ color: PAL.tarmac, bands: 3, tint: 0x5a5580, flat: false }));
    tar.receiveShadow = true;
    tar.userData.smoothNormals = true;
    tar.name = 'tarmac';
    g.add(tar);
    ctx.pickables.push(tar);
  }

  /* --- markings, kerbs and wear, instanced so each piece sits on its own --- *
   *
   * **An instance is authored FLAT, like everything else here.**  This used
   * to seat each piece with `positionAt`/`basisAt` — that is, already on the
   * planet — and then `bakeToPlanet` mapped it a *second* time: it takes an
   * instance's position as flat (x, y, z), so a point already 47.7 m out came
   * back at `R + y`, which for a world y of -58 is ten metres from the centre
   * of the world.  The whole centre line and every kerbstone on the planet
   * have been buried inside it since the day they were written, which is
   * exactly why the road reads as having no markings: it has none.  The rule
   * is the same one the rigid props follow — author flat, let the bake bend
   * it once. */
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const seat = (im, i, x, z, lift, yaw, sc = one) => {
    m.compose(at.set(x, heightAt(x, z) + lift, z), q.setFromAxisAngle(up, yaw), sc);
    im.setMatrixAt(i, m);
  };
  /** Lay one instance flat on the tarmac at (along, across), facing the road. */
  const paintAt = (im, i, along, across, over, sc) => {
    const p = roadPoint(along, across);
    const ahead = roadPoint(along + 0.5, across);
    seat(im, i, p.x, p.z, tarmacLift(across) + over,
      -bearing(p.x, p.z, ahead.x, ahead.z).angle, sc);
  };

  const lineGeo = new THREE.PlaneGeometry(1.2, 0.16);
  lineGeo.rotateX(-Math.PI / 2);
  const lines = new THREE.InstancedMesh(lineGeo, flat({ color: PAL.paint }), 140);
  const kerbs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 0.09, 0.16),
    cel({ color: PAL.chalk, bands: 3, tint: 0x6a6690 }), 520
  );
  /* The solid edge line, a piece at a time so it follows the ring exactly.
   * Slightly longer than its own step, so consecutive pieces overlap and the
   * line reads as continuous instead of as very long dashes. */
  const edgeGeo = new THREE.PlaneGeometry(1.26, 0.10);
  edgeGeo.rotateX(-Math.PI / 2);
  const edges = new THREE.InstancedMesh(edgeGeo, flat({ color: PAL.paint }), 520);
  /* And the wear: four polished bands where the wheels actually run, which is
   * the one thing that tells you a road is used rather than drawn.  Laid the
   * way the farmyard's ruts are — barely-there transparency over whatever is
   * underneath, so it darkens the tarmac instead of painting on it. */
  const wearGeo = new THREE.PlaneGeometry(2.5, 0.62);
  wearGeo.rotateX(-Math.PI / 2);
  const wear = new THREE.InstancedMesh(
    wearGeo,
    cel({ color: 0x9d9ba4, bands: 2, tint: 0x5a5580, transparent: true, opacity: 0.20 }),
    560
  );
  const EDGE_ACROSS = ROAD_HALF - 0.45;
  const WEAR_ACROSS = [-3.3, -1.5, 1.5, 3.3];

  let nl = 0, nk = 0, ne = 0, nw = 0;
  for (let s = 0; s < CIRC && nl < 140; s += 2.4) {
    const p = roadPoint(s, 0);
    const ahead = roadPoint(s + 0.5, 0);
    seat(lines, nl++, p.x, p.z, tarmacLift(0) + 0.008,
      -bearing(p.x, p.z, ahead.x, ahead.z).angle);
  }
  for (let s = 0; s < CIRC && nk < 519; s += 1.2) {
    for (const side of [-1, 1]) {
      const p = roadPoint(s, side * (ROAD_HALF + 0.08));
      const ahead = roadPoint(s + 0.5, side * (ROAD_HALF + 0.08));
      seat(kerbs, nk++, p.x, p.z, 0.045, -bearing(p.x, p.z, ahead.x, ahead.z).angle);
      if (ne < 519) {
        paintAt(edges, ne++, s, side * EDGE_ACROSS, 0.008);
      }
    }
  }
  for (let s = 0; s < CIRC && nw < 556; s += 2.4) {
    for (const t of WEAR_ACROSS) paintAt(wear, nw++, s, t, 0.005);
  }
  lines.count = nl;
  kerbs.count = nk;
  edges.count = ne;
  wear.count = nw;
  for (const im of [lines, kerbs, edges, wear]) im.instanceMatrix.needsUpdate = true;
  lines.userData.noOutline = true;
  edges.userData.noOutline = true;
  wear.userData.noOutline = true;
  wear.receiveShadow = true;
  kerbs.castShadow = true;
  kerbs.receiveShadow = true;
  g.add(lines, kerbs, edges, wear);

  /* --- the culvert: two mouths and a dark throat --- */
  const stone = cel({ color: PAL.stoneDark, bands: 3, tint: 0x635e8c, flat: false });
  const mouths = [];
  for (const side of [-1, 1]) {
    const mouth = new THREE.Group();
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12, 1, false, 0, Math.PI), stone
    );
    arch.rotation.z = Math.PI / 2;
    arch.rotation.y = Math.PI / 2;
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.27, 14, 0, Math.PI), flat({ color: 0x1e1926 })
    );
    hole.position.set(0.26 * side, 0, 0);
    hole.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 1.2), stone);
    wing.position.set(-0.02 * side, 0.08, 0);
    mouth.add(arch, hole, wing);
    mouth.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const p = onRoad(mouth, CULVERT_ALONG, side * (ROAD_HALF + 0.22), { lift: 0.02 });
    g.add(mouth);
    mouths.push({ x: p.x, z: p.z, side });

    ctx.interactables.push({
      x: p.x, z: p.z, label: 'the tunnel under the road',
      action: () => ctx.flash('it goes right under. safer than the tarmac.'),
    });
    for (let i = 0; i < 3; i++) {
      const r = rock({ seed: 1700 + i + (side > 0 ? 9 : 0), r: rng.range(0.1, 0.2) });
      onRoad(r, CULVERT_ALONG + rng.range(-1.4, 1.4),
        side * (ROAD_HALF + rng.range(0.7, 1.6)));
      g.add(r);
    }
  }
  ctx.out.culvert = { along: CULVERT_ALONG, half: ROAD_HALF, mouths };

  /* ------------------------------- the verge ------------------------------ *
   *
   * **Mown, and that is the whole point of it.**  The council cuts a couple
   * of metres back from the kerb and leaves the rest, and that cut edge
   * running away round the planet is worth more to the road than any amount
   * of scatter: it is a straight line in a world of scattered things, and it
   * tells you at a glance which side of it you are standing on.  These blades
   * are a third the height of the meadow's and a shade paler and drier,
   * which is what a fortnight-old cut looks like.
   *
   * `grass.js` streams the meadow straight over the top of them, because it
   * refuses only *hard* ground and a verge is not hard.  So what you actually
   * get is a short dense mat with the odd tall stem standing in it — which is
   * also what a verge looks like a fortnight after the cut, and is the one
   * outcome here that is both cheap and true.
   */
  const VERGE_RUN = 27;
  const VERGE_N = 3000;
  const swardGeo = (() => {
    /* Three straight blades leaning apart, and no bend along their length:
     * a curve costs a mid vertex, which doubles the triangle count of the
     * whole verge — 36 000 against 18 000 — to buy a 17 mm bow in a 70 mm
     * blade that nothing can see.  The lean does the same job for nothing,
     * and it is how `reed` gets its shape too. */
    const blades = [];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.PlaneGeometry(0.018, 1, 1, 1);
      b.translate(0, 0.5, 0);
      blades.push({
        geometry: b,
        matrix: trs(0, 0, 0, 0, (i / 3) * Math.PI + 0.4, -(0.18 + i * 0.11)),
      });
    }
    return bake(blades);
  })();
  const sward = new THREE.InstancedMesh(
    swardGeo,
    cel({
      color: PAL.bramble, bands: 3, tint: 0x5d6a8c, flat: false,
      side: THREE.DoubleSide, vertexColors: true, role: 'grass',
    }),
    VERGE_N
  );
  sward.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(VERGE_N * 3), 3);
  {
    /* The multiplier rule, as in `grass.js`: the material carries the
     * season's real green and the instance colour only says how this tuft
     * differs from it.  An absolute colour here would multiply with that one
     * into something very nearly black. */
    const col = new THREE.Color();
    const dry = new THREE.Color(1.26, 1.2, 0.84);
    const sc = new THREE.Vector3();
    for (let i = 0; i < VERGE_N;) {
      const s = rng.range(-VERGE_RUN, VERGE_RUN);
      const fade = (Math.abs(s) - (VERGE_RUN - 6)) / 6;
      if (fade > 0 && rng.chance(fade)) continue;      // the mower gives up gradually
      const t = rng.sign() * rng.range(ROAD_HALF + 0.2, ROAD_HALF + 2.8);
      const p = roadPoint(s, t);
      sc.set(rng.range(0.8, 1.2), rng.range(0.055, 0.1), 1);
      seat(sward, i, p.x, p.z, -0.005, rng.range(0, TAU), sc);
      col.setRGB(1, 1, 1).lerp(dry, rng.range(0.1, 0.55)).multiplyScalar(rng.range(0.84, 1.12));
      sward.setColorAt(i, col);
      i++;
    }
    sward.instanceMatrix.needsUpdate = true;
    sward.instanceColor.needsUpdate = true;
    sward.castShadow = false;
    sward.receiveShadow = true;
    sward.userData.noOutline = true;
    g.add(sward);
    /* `bakeToPlanet` turns frustum culling off for every instanced mesh,
     * because the grass's bound comes from its source blade and streams.
     * This one never changes after the bake, so its instance bound is a real
     * world-space bound and three can be trusted with it again — which is
     * worth doing, since otherwise 2 400 tufts are drawn from the far side of
     * the planet. */
    ctx.post.push(() => {
      sward.frustumCulled = true;
      sward.computeBoundingSphere();
    });
  }

  /* ------------------------------- the banks ------------------------------ *
   *
   * The cutting has a bank either side now — `roadForm` in `terrain.js` — and
   * a hedge belongs on **top** of one, not part-way up it.  Where the top is
   * is *asked for* rather than written down: walk the cross-section at the
   * culvert and take the highest point on each side.  The two are not the
   * same distance out, and if that profile is ever retuned this follows it,
   * which a copied constant would not.
   */
  const bankCrest = (side) => {
    let best = ROAD_HALF + 3, bh = -Infinity;
    for (let t = ROAD_HALF + 1; t <= 18; t += 0.25) {
      const p = roadPoint(CULVERT_ALONG, side * t);
      const h = heightAt(p.x, p.z);
      if (h > bh) { bh = h; best = t; }
    }
    return side * best;
  };
  const CREST_L = bankCrest(-1), CREST_R = bankCrest(1);
  const crestOf = (side) => (side > 0 ? CREST_R : CREST_L);

  /* **The hedge is deliberately gappy.**  A continuous hedge either side of a
   * road he cannot cross is a pen fifty metres long, and v1's rule about
   * walls applies to scenery as hard as it does to hazards: he must always be
   * able to get off the road without walking to the end of it.  So it is laid
   * in runs with holes worn between them, wide open at the culvert where
   * everything crosses, and open again at the gateway. */
  const HEDGE_RUN = 26;
  const GATE_AT = 10.4;
  let hedgeSeed = 3100;
  for (const side of [-1, 1]) {
    const bank = crestOf(side);
    for (let s = -HEDGE_RUN; s <= HEDGE_RUN; s += 1.7) {
      if (Math.abs(s) < 2.8) continue;                            // the way to the culvert
      if (side > 0 && Math.abs(s - GATE_AT) < 1.5) continue;      // the gateway
      if (rng.chance(0.13)) continue;                             // and it is gappy anyway
      const h = hedgeRun({ seed: hedgeSeed++, len: 1.75, h: rng.range(1.0, 1.32) });
      onRoad(h, s, bank);
      g.add(h);
      /* Three small blockers to the run rather than one big one: overlapping
       * circles along the line are continuous, and each is a shade *under*
       * the depth of the plant, so nothing stops him a hand's breadth short
       * of a hedge he could see he was going to reach. */
      for (const d of [-0.55, 0, 0.55]) {
        const bp = roadPoint(s + d, bank);
        ctx.blockers.push({ x: bp.x, z: bp.z, r: 0.36 });
      }
    }
  }

  /* --- the field gate, hung in the gap --- */
  {
    const bank = crestOf(1);
    const fg = gate({ seed: 59, w: 1.8, h: 1.05 });
    onRoad(fg, GATE_AT, bank);
    g.add(fg);
    for (const d of [-0.7, 0, 0.7]) {
      const bp = roadPoint(GATE_AT + d, bank);
      ctx.blockers.push({ x: bp.x, z: bp.z, r: 0.4 });
    }
    const near = roadPoint(GATE_AT, bank - 1.0);
    ctx.interactables.push({
      x: near.x, z: near.z, label: 'the field gate',
      action: ctx.lines(
        'five bars, and the bottom one is exactly too low to get under',
        'the field beyond it is the same field. he checks anyway.',
        'somebody has wired the latch shut. somebody always has.'
      ),
    });
  }

  /* --- the milestone --- */
  {
    const ms = milestone({ seed: 5, h: 0.5 });
    const p = onRoad(ms, -9.4, -(ROAD_HALF + 1.5), { turn: Math.PI + 0.06 });
    g.add(ms);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.18 });
    ctx.interactables.push({
      x: p.x, z: p.z, label: 'the milestone',
      action: ctx.lines(
        'two of something. it does not say what, and it has stopped mattering',
        'the moss in the 2 is older than the road',
        'he leans on it. it has been leaned on before.'
      ),
    });
  }

  /* --- the sign, and a fingerpost further along --- *
   * The board post used to stand at the place's local `v = -(ROAD_HALF+2.4)`,
   * which put it 2.15 m from the centreline: in the carriageway, on the
   * traffic's line, and it had been there since the road was written. */
  const post = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 1.5, 8),
    cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 })
  );
  pole.position.y = 0.75;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.26, 0.04),
    flat({ map: signTex('the town  →', { w: 256, h: 74, size: 30 }), cache: false })
  );
  board.position.set(0.32, 1.32, 0);
  post.add(pole, board);
  post.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  {
    const p = onRoad(post, 4.2, -(ROAD_HALF + 1.9), { turn: Math.PI - 0.2 });
    g.add(post);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.2 });
  }
  {
    const fp = signpost({ seed: 61, h: 1.55, arms: 3 });
    const p = onRoad(fp, -15.5, ROAD_HALF + 1.7);
    g.add(fp);
    ctx.blockers.push({ x: p.x, z: p.z, r: 0.2 });
  }

  /* --- the drain, in the gutter --- */
  {
    const dr = grating({ w: 0.44, d: 0.3 });
    const across = -(ROAD_HALF - 0.28);
    const p = onRoad(dr, -3.2, across, { lift: tarmacLift(across) + 0.002 });
    g.add(dr);
    ctx.interactables.push({
      x: p.x, z: p.z, label: 'the drain',
      action: ctx.lines(
        'under there, water is going somewhere, slowly',
        'a sweet-wrapper is stuck in the bars, and has been all summer',
        'he says something into it. it says the same thing back, later.'
      ),
    });
  }

  /* --- litter: the gutter, the verge, and the long grass --- */
  {
    const gutter = -(ROAD_HALF - 0.35);
    const c1 = can({ seed: 3, color: 0xc4463c });
    const p = onRoad(c1, 5.4, gutter, {
      lift: tarmacLift(gutter), turn: rng.range(0, TAU),
    });
    g.add(c1);
    ctx.interactables.push({
      x: p.x, z: p.z, label: 'a can in the gutter',
      action: ctx.lines(
        'it smells of something sweet and wrong',
        'he gets his whole head in it. getting it out again takes a moment.',
        'it has been here long enough to have its own weather in it'
      ),
    });

    const c2 = can({ seed: 4, color: 0x3f7a4e });
    onRoad(c2, 13.2, 5.8, { turn: rng.range(0, TAU) });
    g.add(c2);

    const b1 = bottle({ seed: 5 });
    onRoad(b1, -7.5, 6.2, { lift: 0.036, turn: rng.range(0, TAU) });
    b1.rotation.z = Math.PI / 2;
    g.add(b1);

    const b2 = bottle({ seed: 6, color: 0x9a7f4a, opacity: 0.55 });
    onRoad(b2, 18.5, -6.1, { lift: 0.036, turn: rng.range(0, TAU) });
    b2.rotation.z = Math.PI / 2;
    g.add(b2);
  }

  /**
   * Scatter in the road's own frame, `from`..`to` metres either side of it,
   * with a minimum gap — `ctx.scatter` works in the place's disc and knows
   * nothing about where the tarmac is.
   */
  const roadScatter = (n, minGap, from, to, make) => {
    const placed = [];
    let guard = 0;
    while (placed.length < n && guard++ < n * 40) {
      const s = rng.range(-24, 24);
      const t = rng.sign() * rng.range(from, to);
      if (placed.some((p) => Math.hypot(p.s - s, p.t - t) < minGap)) continue;
      const obj = make(placed.length);
      if (!obj) continue;
      onRoad(obj, s, t, { turn: rng.range(0, TAU) });
      g.add(obj);
      placed.push({ s, t });
    }
    return placed;
  };

  /* Above the mown strip the bank is nobody's job, and what grows on a bank
   * nobody cuts is thistles.  The band is set off the crest rather than off
   * the kerb, so the rough ground stays *on* the slope wherever the slope is. */
  const ROUGH = (CREST_R - CREST_L) / 2;
  roadScatter(18, 2.0, ROAD_HALF + 3.4, ROUGH - 0.8, (i) =>
    thistle({ seed: 2400 + i, h: rng.range(0.42, 0.58) }));
  roadScatter(12, 2.6, ROAD_HALF + 4.0, ROUGH + 0.6, (i) =>
    tussock({ seed: 2500 + i, r: rng.range(0.24, 0.36) }));
  // and moles do not care that the verge is mown
  roadScatter(6, 3.0, ROAD_HALF + 0.5, ROAD_HALF + 2.4, (i) =>
    molehillProp({ seed: 2600 + i, r: rng.range(0.1, 0.15) }));

  ctx.scatter(rng, { n: 26, minGap: 1.5 }, (u, v, i) =>
    flowerClump({
      seed: 1800 + i, n: rng.int(3, 6),
      color: rng.pick([PAL.bloomWhite, PAL.bloomYellow]), h: 0.15,
    })
  ).forEach((p) => g.add(p.obj));

  root.add(g);

  /* ------------------------------ the traffic ----------------------------- */
  ctx.post.push((scene) => {
    /* **The traffic gets its own stream.**  It used to draw from the same
     * `rng` as the scenery, so every gap between cars — and therefore how
     * dangerous the road is — depended on how many flowers had been scattered
     * before it.  Adding a verge moved the harness's crossing rate from 7 in
     * 12 to 6, which reads as a balance change and is nothing of the sort.
     * The hazard's tuning must not be downstream of the decoration. */
    const trng = rngKit(6421);
    const cars = [];
    const LANES = [-ROAD_HALF * 0.5, ROAD_HALF * 0.5];
    for (let i = 0; i < 10; i++) {
      const obj = car(i + 1);
      obj.matrixAutoUpdate = false;
      obj.visible = false;
      scene.add(obj);
      cars.push({
        obj, size: obj.userData.size, lane: i % 2,
        across: LANES[i % 2], along: 0, dir: i % 2 ? 1 : -1,
        speed: 0, wait: trng.range(0.4, 6), live: false, x: 0, z: 0,
      });
    }
    ctx.out.cars = cars;

    const mm = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    ctx.updaters.push((dt) => {
      for (const c of cars) {
        if (!c.live) {
          c.wait -= dt;
          if (c.wait > 0) continue;
          /* Spawned beyond the fog and never in view: a car that fades up
           * out of nothing thirty metres away reads as a bug, not traffic. */
          c.live = true;
          c.along = CULVERT_ALONG - c.dir * 34;
          c.speed = trng.range(3.4, 5.6);
          /* Wandering within the lane, because pinned to a centreline two
           * 1.7 m cars sweep 3.4 m of a 9.6 m carriageway and the rest is a
           * safe corridor you can stroll up. */
          c.across = LANES[c.lane] + trng.range(-0.85, 0.85);
          c.obj.visible = true;
        }
        c.along += c.dir * c.speed * dt;
        if (Math.abs(c.along - CULVERT_ALONG) > 36) {
          c.live = false;
          c.obj.visible = false;
          // v1's traffic gap, which is what makes the open tarmac cost a heart
          c.wait = trng.range(0.5, 1.6);
          continue;
        }
        const p = roadPoint(c.along, c.across);
        const ahead = roadPoint(c.along + c.dir * 0.6, c.across);
        c.x = p.x; c.z = p.z;
        const b = basisAt(p.x, p.z);
        mm.makeBasis(b.east, b.up, b.north);
        mm.setPosition(positionAt(p.x, heightAt(p.x, p.z) + 0.02, p.z, pos));
        rot.makeRotationY(-bearing(p.x, p.z, ahead.x, ahead.z).angle + Math.PI / 2);
        mm.multiply(rot);
        c.obj.matrix.copy(mm);
        c.obj.matrixWorldNeedsUpdate = true;
      }
    });
  });

  return g;
}

/* --------------------------- the town's fittings --------------------------- */

/** A galvanised dustbin, lid never quite back on straight. */
function dustbin({ seed = 1 } = {}) {
  const rng = rngKit(seed * 1487);
  const g = new THREE.Group();
  const metal = cel({ color: PAL.metal, bands: 3, tint: 0x5c688e });
  const h = 0.6, r = 0.21;

  const parts = [];
  const body = new THREE.CylinderGeometry(r, r * 0.84, h, 12);
  body.translate(0, h / 2, 0);
  parts.push({ geometry: body });
  // two swaged ribs, because a bin without them is a bucket
  for (const t of [0.32, 0.64]) {
    const rib = new THREE.TorusGeometry(lerp(r * 0.84, r, t) + 0.006, 0.009, 4, 12);
    rib.rotateX(Math.PI / 2);
    rib.translate(0, h * t, 0);
    parts.push({ geometry: rib });
  }
  for (const s of [-1, 1]) {
    const hd = new THREE.TorusGeometry(0.045, 0.008, 3, 8, Math.PI);
    hd.rotateY(Math.PI / 2);
    parts.push({ geometry: hd, matrix: trs(s * r * 0.92, h * 0.62, 0, 0, 0, s * Math.PI / 2) });
  }
  g.add(new THREE.Mesh(bake(parts), metal));

  const lid = new THREE.Group();
  const dome = new THREE.CylinderGeometry(r * 0.72, r * 1.06, 0.07, 12);
  dome.translate(0, 0.035, 0);
  lid.add(new THREE.Mesh(dome, metal));
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 3, 10, Math.PI), metal);
  grip.position.y = 0.07;
  lid.add(grip);
  lid.position.set(rng.range(-0.02, 0.02), h, rng.range(-0.02, 0.02));
  lid.rotation.z = rng.range(-0.09, 0.09);
  g.add(lid);

  return shadowify(g);
}

/**
 * A bicycle, leaning.  Built in the xy plane — wheels are toruses and a torus
 * lies in xy — so the whole machine is flat in z and the lean is a rotation
 * about its own x, which is the axis a bicycle actually falls over on.
 */
function bicycle({ seed = 1, color = 0x3f6f8c, lean = 0.22 } = {}) {
  const rng = rngKit(seed * 1621);
  /* The lean lives on an *inner* group.  Euler order is XYZ, so setting
   * `rotation.x` on the thing whose `rotation.y` the seating owns applies the
   * tilt about the ground's east rather than about the bicycle's own length,
   * and it falls forwards or sideways depending which way it happens to be
   * pointing.  One group of nesting and it always falls onto the wall. */
  const outer = new THREE.Group();
  const g = new THREE.Group();
  outer.add(g);
  const frameMat = cel({ color, bands: 3, tint: 0x5a5286, flat: false });
  const rubber = cel({ color: 0x2c2a30, bands: 2, tint: 0x4a4058 });
  const metal = cel({ color: PAL.metal, bands: 3, tint: 0x5c688e });

  const WH = 0.32;                      // a 26" wheel, and it is bigger than he is
  const RH = [-0.52, WH], FH = [0.52, WH];
  const BB = [-0.12, 0.27], ST = [-0.3, 0.85], HT = [0.32, 0.9];

  const tubes = [];
  const tube = (a, b, r) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    tubes.push({
      geometry: new THREE.CylinderGeometry(r, r, len, 6),
      matrix: trs((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, 0, 0, Math.atan2(-dx, dy)),
    });
  };
  tube(BB, ST, 0.016); tube(ST, HT, 0.015); tube(BB, HT, 0.017);
  tube(RH, BB, 0.011); tube(RH, ST, 0.010); tube(HT, FH, 0.012);
  // the bars, across the frame rather than in it
  const bars = new THREE.CylinderGeometry(0.011, 0.011, 0.4, 6);
  bars.rotateX(Math.PI / 2);
  tubes.push({ geometry: bars, matrix: trs(HT[0] + 0.04, HT[1] + 0.07, 0) });
  g.add(new THREE.Mesh(bake(tubes), frameMat));

  const spokes = [];
  for (const hub of [RH, FH]) {
    spokes.push({
      geometry: new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8),
      matrix: trs(hub[0], hub[1], 0, Math.PI / 2, 0, 0),
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      spokes.push({
        geometry: new THREE.CylinderGeometry(0.004, 0.004, WH * 1.9, 4),
        matrix: trs(hub[0], hub[1], 0, 0, 0, a),
      });
    }
  }
  const crank = new THREE.CylinderGeometry(0.008, 0.008, 0.24, 6);
  crank.rotateX(Math.PI / 2);
  spokes.push({ geometry: crank, matrix: trs(BB[0], BB[1], 0) });
  g.add(new THREE.Mesh(bake(spokes), metal));

  const dark = [];
  for (const hub of [RH, FH]) {
    const tyre = new THREE.TorusGeometry(WH, 0.018, 5, 16);
    dark.push({ geometry: tyre, matrix: trs(hub[0], hub[1], 0) });
  }
  dark.push({
    geometry: new THREE.BoxGeometry(0.22, 0.045, 0.09),
    matrix: trs(ST[0] - 0.02, ST[1] + 0.05, 0, 0, 0, -0.1),
  });
  for (const s of [-1, 1]) {
    dark.push({
      geometry: new THREE.BoxGeometry(0.085, 0.016, 0.045),
      matrix: trs(BB[0] + s * 0.1, BB[1] - s * 0.04, s * 0.12),
    });
  }
  g.add(new THREE.Mesh(bake(dark), rubber));

  g.rotation.x = lean + rng.range(-0.02, 0.02);
  return shadowify(outer);
}

/**
 * A washing line: two posts, a line with a sag in it, and cloth as thin
 * boxes.  **No cloth simulation** — at this size what sells washing is that
 * no two things on the line hang at the same angle or the same height, which
 * is four numbers per garment and no solver at all.
 */
function washingLine({ seed = 1, span = 3.4, h = 1.5 } = {}) {
  const rng = rngKit(seed * 1229);
  const g = new THREE.Group();
  const timber = cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });
  const cord = cel({ color: 0xd8cfb8, bands: 2, tint: 0x6f628e });

  const sag = 0.13;
  const yAt = (x) => h - sag * (1 - (2 * x / span) ** 2);

  for (const s of [-1, 1]) {
    const ph = h + 0.06;
    const pg = new THREE.BoxGeometry(0.06, ph, 0.06);
    pg.translate(0, ph / 2, 0);
    const p = new THREE.Mesh(pg, timber);
    p.position.x = (s * span) / 2;
    p.rotation.y = rng.range(-0.06, 0.06);
    g.add(p);
    // a stay, or the post would have gone over years ago
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, ph * 0.8), timber);
    st.position.set((s * span) / 2, ph * 0.4, s * 0.22);
    st.rotation.x = s * 0.5;
    g.add(st);
  }

  const line = [];
  const SEG = 8;
  for (let i = 0; i < SEG; i++) {
    const x0 = -span / 2 + (i * span) / SEG;
    const x1 = x0 + span / SEG;
    const y0 = yAt(x0), y1 = yAt(x1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    line.push({
      geometry: new THREE.BoxGeometry(len, 0.012, 0.012),
      matrix: trs((x0 + x1) / 2, (y0 + y1) / 2, 0, 0, 0, Math.atan2(y1 - y0, x1 - x0)),
    });
  }
  g.add(new THREE.Mesh(bake(line), cord));

  const CLOTH = [0xf2ece0, 0xd6e0ea, 0xd8a49c, 0xe8dcbc, 0xa8b6c6];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x = lerp(-span * 0.38, span * 0.38, i / (n - 1)) + rng.range(-0.06, 0.06);
    const w = rng.range(0.26, 0.42);
    const hh = rng.range(0.28, 0.48);
    const top = yAt(x) - 0.012;
    const cl = new THREE.Mesh(
      new THREE.BoxGeometry(w, hh, 0.012),
      cel({ color: CLOTH[i % CLOTH.length], bands: 'soft3', tint: 0x7a74a0, flat: false })
    );
    cl.position.set(x, top - hh / 2, 0);
    cl.rotation.z = rng.range(-0.09, 0.09);
    cl.rotation.y = rng.range(-0.25, 0.25);
    g.add(cl);
    for (const s of [-1, 1]) {
      const peg = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.05, 0.02), timber);
      peg.position.set(x + s * w * 0.4, top, 0);
      g.add(peg);
    }
  }

  return shadowify(g);
}

/** The street lamp.  Only one of them carries a real light — see below. */
function lampPost() {
  const lamp = new THREE.Group();
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 2.6, 8),
    cel({ color: 0x3d4048, bands: 3, tint: 0x5f5e86 })
  );
  col.position.y = 1.3;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 8), flat({ color: 0x3a3d44, cache: false }));
  head.position.y = 2.72;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    flat({ color: 0x6a6858, cache: false, role: 'lamp' })
  );
  bulb.position.y = 2.5;
  lamp.add(col, head, bulb);
  lamp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return lamp;
}

/** The edge of town: a street, three fronts on it, their gardens, and a cat. */
export function buildTown(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:town';
  const rng = rngKit(1009);

  /* ------------------------------ the street ------------------------------ *
   *
   * **The road runs through this place.**  It is the great circle through the
   * roadside and the town, and the town's centre is exactly on it — so the
   * only sane way to lay a town out here is against the road's own bearing,
   * which is what `onRoad` does for everything below.
   *
   * It was not, before.  The three fronts were an arc centred on the place's
   * local `a = 0`, and the arc crossed the carriageway: the first cottage
   * stood 0.36 m from the centreline, the low wall crossed at 2.17 m, and the
   * cat was asleep on the wall in the middle of the road.  Nothing ever hit
   * them because the traffic despawns 36 m either side of the culvert and the
   * town is 53 m away, which is exactly why it survived so long.
   */
  const ALONG0 = roadAlong(ctx.centre.x, ctx.centre.z);
  /** `s` metres along the street from the middle of town, `q` metres across
   *  it — negative on the terrace side, positive on the cat's side. */
  const street = (s, q) => roadPoint(ALONG0 + s, q);
  const put = (obj, s, q, opts) => {
    const p = onRoad(obj, ALONG0 + s, q, opts);
    g.add(obj);
    return p;
  };
  const block = (s, q, r) => {
    const p = street(s, q);
    ctx.blockers.push({ x: p.x, z: p.z, r });
    return p;
  };
  const talk = (s, q, label, action) => {
    const p = street(s, q);
    ctx.interactables.push({ x: p.x, z: p.z, label, action });
    return p;
  };

  /* **The street climbs, and the terrace has to stand where it does not.**
   * `townForm` steps the ground up twice *along* the road — 0.80 m over four
   * metres and then another 0.45 — and a house is a rigid box, so one
   * standing across a riser floats a third of a metre at one corner.  The
   * measured shelf runs sixteen metres from the middle of town, and the three
   * fronts stand on it; the road climbing away past the last of them is the
   * view from the terrace, which is a better use of a hill than levelling it. */
  const FRONT_Q = -8.4;                 // where the house fronts stand
  const HOUSE_Q = FRONT_Q - 1.2;        // ... and therefore their centres
  const WALL_Q = -6.7;                  // the garden walls, 1.9 m back from the kerb
  const HOUSE_S = [-0.6, 4.2, 9.0];

  /* Flat, and bent once by the bake — see the road's own note above.  Every
   * paving slab in this town was seated onto the planet twice and has been
   * lying in a heap somewhere under it ever since. */
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const seat = (im, i, p, lift, yaw) => {
    m.compose(at.set(p.x, heightAt(p.x, p.z) + lift, p.z), q.setFromAxisAngle(up, yaw), one);
    im.setMatrixAt(i, m);
    return p;
  };

  /* --- paving, instanced so every slab stands on its own patch of ground --- *
   * With the road crossing the disc, the slabs have to know about it: they
   * sit 5 cm proud of the ground and the tarmac only 2, so a full disc of
   * them came up *through* the carriageway from kerb to kerb.  The front
   * gardens are left unpaved for the same sort of reason — a garden on
   * pavement is a yard. */
  const slots = [];
  for (let u = -10; u <= 10; u += 0.9) {
    for (let v = -10; v <= 10; v += 0.9) {
      if (Math.hypot(u, v) > 10) continue;
      const p = ctx.at(u, v);
      const off = roadOffset(p.x, p.z);
      if (Math.abs(off) < ROAD_HALF + 0.32) continue;
      if (off < WALL_Q + 0.3) continue;
      slots.push([u, v]);
    }
  }
  const pave = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.84, 0.06, 0.84),
    cel({ color: 0x9d9a92, bands: 3, tint: 0x635e8c, flat: false }),
    slots.length
  );
  slots.forEach(([u, v], i) => {
    seat(pave, i, ctx.at(u + rng.range(-0.02, 0.02), v + rng.range(-0.02, 0.02)),
      0.02, rng.range(-0.03, 0.03));
  });
  pave.instanceMatrix.needsUpdate = true;
  pave.receiveShadow = true;
  pave.name = 'paving';
  g.add(pave);

  /* --- three fronts, in a terrace along the street --- */
  const renderMat = cel({ color: PAL.render, bands: 3, tint: 0x6b6392, flat: false });
  const tileMat = cel({ color: PAL.tile, bands: 3, tint: 0x6b5b86 });
  const windowMat = flat({ color: 0x2b2130, cache: false, role: 'window' });
  const doorMat = cel({ color: 0x5b7a6a, bands: 3, tint: 0x6b5b86 });
  const stepMat = cel({ color: PAL.stone, bands: 3, tint: 0x6a6690, flat: false });

  for (let i = 0; i < 3; i++) {
    const house = new THREE.Group();
    const W = rng.range(2.6, 3.6), H = rng.range(2.2, 3.0), D = 2.4;
    /* Half a metre of it is below the ground, and that is not detail: the
     * street climbs, a rigid box seated at one height cannot, and a house
     * whose near corner is 0.3 m off its own front garden is the first thing
     * the eye finds.  Everything else on the house is still measured off `H`,
     * so the visible building is exactly the size it was. */
    const FOOT = 0.5;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(W, H + FOOT, D), renderMat);
    wall.position.y = (H - FOOT) / 2;
    house.add(wall);
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.34, 0.09, D * 0.7), tileMat);
      slab.position.set(0, H + 0.36, D * 0.3 * s);
      slab.rotation.x = s * 0.58;      // ridge up, eaves down — see the barn
      house.add(slab);
    }
    for (let w = 0; w < 2; w++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.72), windowMat);
      win.position.set(-W * 0.24 + w * W * 0.48, H * 0.62, D / 2 + 0.012);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.04), renderMat);
      frame.position.set(win.position.x, win.position.y, D / 2 - 0.01);
      house.add(win, frame);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.56, 1.05, 0.06), doorMat);
    door.position.set(W * 0.06, 0.53, D / 2 + 0.01);
    house.add(door);

    /* The doorstep, and what is standing on it.  Both are children of the
     * house, so they follow it wherever it is put and cannot drift from the
     * door they belong to. */
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.11, 0.36), stepMat);
    step.position.set(W * 0.06, 0.055, D / 2 + 0.19);
    house.add(step);
    if (i !== 1) {
      const milk = bottle({ seed: 40 + i, color: 0xeae4d2, opacity: 0.78 });
      milk.scale.setScalar(0.8);
      milk.position.set(W * 0.06 + (i ? 0.24 : -0.26), 0.11, D / 2 + 0.19);
      house.add(milk);
    }
    house.traverse((o) => {
      if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; }
    });

    /* `turn: π` faces it across the street: with no turn a prop's +z looks at
     * the *near* side, and the terrace stands on the far one. */
    put(house, HOUSE_S[i], HOUSE_Q, { turn: Math.PI });
    /* The light out of the front windows, on the path in front of them.  Only
     * one pool a house rather than one a window: two overlapping additive
     * discs 1.4 m apart read as one brighter patch anyway, and this is meant
     * to be the suggestion of a lit room, not a spotlight. */
    {
      const pool = lightPool({ r: 1.5, role: 'windowPool' });
      put(pool, HOUSE_S[i], FRONT_Q + 0.5);
      g.add(pool);
    }
    // two blockers to a front, so the corners of a 3.6 m house are covered
    // without a circle that reaches a metre out into its own garden
    for (const d of [-0.7, 0.7]) block(HOUSE_S[i] + d, HOUSE_Q, 1.4);
    talk(HOUSE_S[i], FRONT_Q + 0.75, 'a front door', () => ctx.flash(rng.pick([
      'a radio, somewhere inside', 'nobody in', 'something is cooking',
    ])));
  }

  /* --- the garden walls, and a gate to each front --- *
   * Two of drystone and one of hedge, because three identical gardens is a
   * housing estate and this is the edge of a town. */
  for (let i = 0; i < 3; i++) {
    const s0 = HOUSE_S[i];
    for (const side of [-1, 1]) {
      // from the gatepost out to halfway to the neighbour
      const from = s0 + side * 0.72;
      const to = s0 + side * 2.55;
      const n = 2;
      for (let k = 0; k < n; k++) {
        const s = lerp(from, to, (k + 0.5) / n);
        const len = Math.abs(to - from) / n;
        if (i === 2) {
          const h = hedgeRun({ seed: 3400 + i * 10 + k + (side > 0 ? 5 : 0), len: len * 0.98, h: 0.9 });
          put(h, s, WALL_Q);
        } else {
          const w = drystone({ seed: 3300 + i * 10 + k + (side > 0 ? 5 : 0), len: len * 0.98, h: 0.55 });
          put(w, s, WALL_Q);
        }
        block(s - len * 0.25, WALL_Q, 0.34);
        block(s + len * 0.25, WALL_Q, 0.34);
      }
    }
    /* **The gate stands open, and only its posts are solid.**  Shut and
     * blocked it walls the garden off completely — and the front door he is
     * meant to be able to reach is 1.7 m inside it, which `world.nearest`
     * gives him 0.8 m for.  A garden with an unreachable door in it is three
     * lines of flavour text nobody will ever see, and it would have looked
     * exactly like a garden.  Swinging the leaf back on its hinge post costs
     * one nested group and leaves a 0.9 m gateway, which for a 26 cm animal
     * is a gateway. */
    const gt = gate({ seed: 300 + i, w: 1.0, h: 0.95 });
    const leaf = gt.children.find((c) => c.isGroup);
    if (leaf) {
      const hinge = new THREE.Group();
      hinge.position.x = -0.48;
      hinge.rotation.y = -1.15;
      leaf.position.x = 0.48;
      gt.add(hinge);
      hinge.add(leaf);
    }
    put(gt, s0, WALL_Q);
    block(s0 - 0.57, WALL_Q, 0.13);
    block(s0 + 0.57, WALL_Q, 0.13);

    // and a path up it, because a front garden with no path is a lawn
    for (let k = 0; k < 3; k++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.4), stepMat);
      slab.castShadow = false;
      slab.receiveShadow = true;
      put(slab, s0, lerp(WALL_Q, FRONT_Q + 0.34, (k + 0.5) / 3), { lift: 0.02 });
      slab.rotation.y += rng.range(-0.05, 0.05);
    }

    talk(s0, WALL_Q + 0.7, 'a garden gate', ctx.lines(
      'it has been painted four times and never sanded once',
      'the latch is stiff. it always was.',
      'from here the door looks a long way off'
    ));

    // and something in the garden, so it is somebody's
    for (let k = 0; k < 3; k++) {
      const fl = flowerClump({
        seed: 3500 + i * 7 + k, n: rng.int(4, 8),
        color: rng.pick([PAL.petal, PAL.bloomRed, PAL.bloomYellow, PAL.bloomWhite]),
        h: rng.range(0.16, 0.3),
      });
      put(fl, s0 + rng.range(-1.5, 1.5), lerp(WALL_Q, FRONT_Q, rng.range(0.3, 0.85)));
    }
  }

  /* --- the things left out on the pavement --- */
  {
    const bin = dustbin({ seed: 7 });
    put(bin, HOUSE_S[0] - 1.5, WALL_Q + 0.55, { turn: rng.range(0, TAU) });
    block(HOUSE_S[0] - 1.5, WALL_Q + 0.55, 0.24);
    talk(HOUSE_S[0] - 1.5, WALL_Q + 1.1, 'the bin', ctx.lines(
      'the smell alone is a full evening out',
      'he can get the lid off. he has thought about it since.',
      'something under it moves, and thinks better of it'
    ));

    /* Leaning, which is the only way a bicycle ever stands: it is built flat
     * in z and tipped about its own x, and it is put a hand's breadth off the
     * wall so the lean brings the bars onto it. */
    const bike = bicycle({ seed: 9, color: 0x3f6f8c, lean: 0.24 });
    put(bike, HOUSE_S[2] + 1.9, WALL_Q + 0.3);
    block(HOUSE_S[2] + 1.9, WALL_Q + 0.42, 0.4);
    talk(HOUSE_S[2] + 1.9, WALL_Q + 0.95, 'a bicycle', ctx.lines(
      'the back tyre is flat, and has been since spring',
      'a spider has taken the whole of the front wheel',
      'he can walk between the spokes. he does.'
    ));

    const cr = crate({ seed: 71, s: 0.4 });
    put(cr, HOUSE_S[1] + 2.6, WALL_Q + 0.48);
    block(HOUSE_S[1] + 2.6, WALL_Q + 0.48, 0.22);
  }

  /* --- washing, out the back --- */
  {
    const line = washingLine({ seed: 3, span: 3.6, h: 1.5 });
    put(line, 4.4, HOUSE_Q - 2.8);
    block(4.4 - 1.8, HOUSE_Q - 2.8, 0.14);
    block(4.4 + 1.8, HOUSE_Q - 2.8, 0.14);
    talk(4.4, HOUSE_Q - 2.2, 'the washing', ctx.lines(
      'four shirts and a tablecloth, none of them dry',
      'the tablecloth touches the grass. somebody will be cross.',
      'he walks the whole length of it in the shade of it'
    ));

    const pail = bucket({ seed: 73, r: 0.11, h: 0.16 });
    put(pail, 2.3, HOUSE_Q - 2.4);
  }

  /* --- a low wall along the near side, and the cat asleep on it --- */
  const bricks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.6, 0.44, 0.24),
    cel({ color: PAL.stone, bands: 3, tint: 0x6a6690 }), 40
  );
  const WALL2_Q = 6.4;
  for (let i = 0; i < 40; i++) {
    const s = lerp(-2.5, 13, i / 39);
    const p = street(s, WALL2_Q);
    const ahead = street(s + 0.5, WALL2_Q);
    seat(bricks, i, p, 0.22, -bearing(p.x, p.z, ahead.x, ahead.z).angle);
    // every second brick, or the gaps between the no-gos are wide enough
    // to walk through a wall
    if (i % 2 === 0) ctx.blockers.push({ x: p.x, z: p.z, r: 0.45 });
  }
  bricks.instanceMatrix.needsUpdate = true;
  bricks.castShadow = true;
  bricks.receiveShadow = true;
  g.add(bricks);

  /* --- the lamps: the only light in the world that is not the sky --- *
   * Two of them, on opposite pavements and off against each other, because
   * one lamp is a prop and two are a street.  Only the first carries a real
   * point light; the second is lit the cheap way, by its `lamp` role. */
  const lampA = lampPost();
  const lp = put(lampA, -2.4, -5.6);
  block(-2.4, -5.6, 0.2);
  /* **This light had never once been on.**  It was built at intensity 0,
   * stashed in `ctx.out.lampLight`, and nothing in the entire codebase ever
   * read it back — so the comment above, which says one lamp carries a real
   * light, described a lamp that carried a dead one.  It is driven off `lit`
   * now, which is the same dusk ramp that warms the bulb itself. */
  const glow = new THREE.PointLight(0xffd08a, 0, 7, 2);
  glow.position.copy(positionAt(lp.x, heightAt(lp.x, lp.z) + 2.5, lp.z, new THREE.Vector3()));
  ctx.out.lampLight = glow;
  root.add(glow);
  ctx.updaters.push((dt, hog, state) => {
    /* The third argument is the climate **state**, not the climate — the
     * parameter is called `climate` where the updaters are run, and the
     * seasonal hooks beside it read `s.w[0]` straight off it.  2.6 is what it
     * takes to read as a lamp against a night sky this world deliberately
     * never lets go fully black. */
    glow.intensity = (state?.lit ?? 0) * 2.6;
  });

  const lampB = lampPost();
  put(lampB, 8.2, 5.6);
  block(8.2, 5.6, 0.2);

  /* --- and the pools they throw --- *
   * The point light is one object and cannot be afforded twice, so the second
   * lamp and every window get a *painted* pool instead — see `lightPool`.
   * They switch on their own colour through the role registry, so they cannot
   * come on at a different hour from the bulbs above them. */
  for (const [u, v] of [[-2.4, -5.6], [8.2, 5.6]]) {
    const pool = lightPool({ r: 2.4, role: 'lampPool' });
    put(pool, u, v);
    g.add(pool);
  }

  /* --- the cat.  Every place like this has one, and it is always asleep. --- */
  const cat = new THREE.Group();
  const furMat = cel({ color: 0x4a4550, bands: 3, tint: 0x5f5286, flat: false });
  const cbody = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), furMat);
  cbody.scale.set(1.5, 0.72, 0.9);
  cbody.position.y = 0.12;
  const chead = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 9), furMat);
  chead.position.set(0.2, 0.18, 0);
  cat.add(cbody, chead);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), furMat);
    ear.position.set(0.2, 0.26, 0.045 * s);
    cat.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 5, 14, Math.PI * 1.4), furMat);
  tail.position.set(-0.24, 0.1, 0.02);
  tail.rotation.set(Math.PI / 2, 0, 0.4);
  cat.add(tail);
  cat.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  cat.userData.noMerge = true;        // her tail and ear animate in place
  const CAT_S = 4.4;
  const catAt = put(cat, CAT_S, WALL2_Q, { lift: 0.44, turn: -0.6 });   // asleep on the wall
  ctx.interactables.push({
    ...street(CAT_S, WALL2_Q - 0.7),
    label: 'the cat on the wall',
    action: ctx.lines(
      'one ear turns. that is all you get.',
      'the tail-tip counts him past: one (1) hedgehog',
      'a slow blink. in cat, that is a kindness.'
    ),
  });
  ctx.out.cat = cat;

  /* The line above is now literally true: a hedgehog underneath is worth
   * one ear and a livelier tail, and precisely nothing else — a sleeping
   * cat's whole opinion of the world.  The cat is seated rigidly, but its
   * PARTS still animate locally under the seat. */
  {
    const ears = cat.children.filter((c) => c.geometry?.type === 'ConeGeometry');
    let watch = 0, ct = 0;
    ctx.updaters.push((dt, hog) => {
      if (!hog) return;
      ct += dt;
      const dx = hog.x - catAt.x, dz = hog.z - catAt.z;
      watch += (((dx * dx + dz * dz < 2.6) ? 1 : 0) - watch) * Math.min(1, 3 * dt);
      tail.rotation.z = 0.4 + Math.sin(ct * (1.4 + watch * 4.5)) * (0.05 + watch * 0.28);
      if (ears[0]) ears[0].rotation.y = watch * 0.6;
    });
  }

  root.add(g);
  return g;
}
