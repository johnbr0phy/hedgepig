import * as THREE from 'three';
import { cel, flat } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { petalTex, blobTex } from '../core/textures.js';
import { rngKit, clamp, lerp, TAU, bake, trs, shadowify } from '../core/util.js';

/* ------------------------------------------------------------------ *
 * The parts everything else is made of.
 *
 * One rule runs through this file, and it is the reference build's best
 * idea: **a family of things should come from one parametric maker, not
 * from ten hand-built models.**  Their whole motor fleet came out of one
 * table of eight numbers per vehicle.  Here it is trees, which are the same
 * three parts at every size, and mushrooms, and fence.
 *
 * The second rule is about the ground.  Every prop is placed through
 * `heightAt`, never at y = 0, because the field rolls — and a fence post
 * standing 4 cm proud of a rise is the first thing the eye finds.
 * ------------------------------------------------------------------ */

const MAT = {
  bark: () => cel({ color: PAL.timberDark, bands: 3, tint: 0x63537f }),
  barkPale: () => cel({ color: PAL.timber, bands: 3, tint: 0x63537f }),
  canopy: () => cel({ color: PAL.bramble, bands: 3, tint: 0x4f5d84, flat: false, role: 'canopy' }),
  leaf: () => cel({ color: PAL.bramble, bands: 3, tint: 0x4f5d84, role: 'leaf' }),
  stone: () => cel({ color: PAL.stone, bands: 3, tint: 0x6a6690 }),
  soil: () => cel({ color: PAL.soil, bands: 3, tint: 0x62568a }),
  timber: () => cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 }),
  thorn: () => cel({ color: PAL.thorn, bands: 3, tint: 0x4a5a78 }),
  stoneDark: () => cel({ color: PAL.stoneDark, bands: 3, tint: 0x60618c }),
  metal: () => cel({ color: PAL.metal, bands: 3, tint: 0x5c688e }),
  paint: () => cel({ color: PAL.paint, bands: 'soft3', tint: 0x8f88ac, flat: false }),
};

/**
 * A tree.  Trunk, a couple of limbs, and two or three canopy lumps — the
 * canopy is deliberately a few big masses rather than many small ones,
 * because the cel ramp puts one flat band on each and that is what makes it
 * read as painted foliage instead of as a ball of noise.
 */
export function tree({
  seed = 1, h = 4.2, spread = 1.0, trunk = 0.16, lumps = 3, bare = false, lean = 0.06,
} = {}) {
  const rng = rngKit(seed * 7919);
  const g = new THREE.Group();

  const barkMat = rng.chance(0.5) ? MAT.bark() : MAT.barkPale();
  const tg = new THREE.CylinderGeometry(trunk * 0.62, trunk, h * 0.62, 7);
  tg.translate(0, h * 0.31, 0);
  const stem = new THREE.Mesh(tg, barkMat);
  g.add(stem);

  // two limbs, angled out and up
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, TAU);
    const lg = new THREE.CylinderGeometry(trunk * 0.18, trunk * 0.4, h * 0.34, 5);
    lg.translate(0, h * 0.17, 0);
    const limb = new THREE.Mesh(lg, barkMat);
    limb.position.set(0, h * 0.42, 0);
    limb.rotation.set(rng.range(0.35, 0.6), a, 0);
    g.add(limb);
  }

  if (!bare) {
    const canopyMat = MAT.canopy();
    for (let i = 0; i < lumps; i++) {
      const r = spread * rng.range(0.72, 1.05);
      const sg = new THREE.IcosahedronGeometry(r, 1);
      const lump = new THREE.Mesh(sg, canopyMat);
      const a = (i / lumps) * TAU + rng.range(-0.4, 0.4);
      const rad = i === 0 ? 0 : spread * rng.range(0.35, 0.7);
      lump.position.set(
        Math.cos(a) * rad,
        h * rng.range(0.62, 0.86) + (i === 0 ? spread * 0.25 : 0),
        Math.sin(a) * rad
      );
      lump.scale.y = rng.range(0.72, 0.94);
      g.add(lump);
    }
  }

  g.rotation.z = rng.range(-lean, lean);
  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/** A fallen log: one lying cylinder, one broken end, and a little moss. */
export function log({ seed = 3, len = 1.8, r = 0.16 } = {}) {
  const rng = rngKit(seed * 6131);
  const g = new THREE.Group();
  const bg = new THREE.CylinderGeometry(r, r * 0.92, len, 9);
  bg.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bg, MAT.bark());
  body.position.y = r;
  g.add(body);
  const capMat = cel({ color: 0xb59a72, bands: 3, tint: 0x63537f });
  for (const s of [-1, 1]) {
    const cg = new THREE.CircleGeometry(r * 0.95, 9);
    const cap = new THREE.Mesh(cg, capMat);
    cap.position.set((len / 2) * s, r, 0);
    cap.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(cap);
  }
  const moss = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.55, 8, 6, 0, TAU, 0, Math.PI / 2),
    MAT.leaf()
  );
  moss.position.set(rng.range(-len * 0.3, len * 0.3), r * 1.5, 0);
  moss.scale.set(1.6, 0.5, 1.2);
  g.add(moss);
  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/** A mushroom: cap, stem, and — if it wants one — spots. */
export function mushroom({ seed = 5, h = 0.11, cap = 0.075, spotted = true, color = PAL.mushroomCap } = {}) {
  const rng = rngKit(seed * 3907);
  const g = new THREE.Group();
  const sg = new THREE.CylinderGeometry(cap * 0.22, cap * 0.3, h, 7);
  sg.translate(0, h / 2, 0);
  g.add(new THREE.Mesh(sg, cel({ color: PAL.mushroomStem, bands: 'soft3', tint: 0x8a7fa8, flat: false })));

  const cg = new THREE.SphereGeometry(cap, 12, 8, 0, TAU, 0, Math.PI * 0.52);
  const capMesh = new THREE.Mesh(cg, cel({ color, bands: 3, tint: 0x7a5a86, flat: false }));
  capMesh.position.y = h;
  capMesh.scale.y = rng.range(0.6, 0.86);
  g.add(capMesh);

  if (spotted) {
    const spot = cel({ color: 0xfdf6e6, bands: 'soft', tint: 0x9a8fae, flat: false });
    for (let i = 0; i < 4; i++) {
      const a = rng.range(0, TAU);
      const rr = cap * rng.range(0.3, 0.72);
      const s = new THREE.Mesh(new THREE.SphereGeometry(cap * rng.range(0.11, 0.18), 6, 5), spot);
      s.position.set(Math.cos(a) * rr, h + Math.sqrt(Math.max(0, cap * cap - rr * rr)) * 0.7, Math.sin(a) * rr);
      s.scale.y = 0.4;
      g.add(s);
    }
  }
  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/**
 * A bramble: the one thing in the world that hurts him on purpose.
 *
 * It has to read as dangerous at a glance and from any angle, so it is
 * spikes rather than leaves — a dozen dark thorns out of a low mass, with a
 * few berries so it is still a *plant* and not a trap.
 */
export function bramble({ seed = 9, r = 0.42 } = {}) {
  const rng = rngKit(seed * 8677);
  const g = new THREE.Group();

  const mass = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.72, 1), MAT.thorn());
  mass.position.y = r * 0.4;
  mass.scale.set(1.25, 0.62, 1.15);
  g.add(mass);

  const spikeGeo = new THREE.ConeGeometry(0.018, 1, 4);
  spikeGeo.translate(0, 0.5, 0);
  const spikeMat = cel({ color: 0x2a3a2c, bands: 3, tint: 0x4a5a78 });
  const n = 26;
  const im = new THREE.InstancedMesh(spikeGeo, spikeMat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const el = rng.range(0.1, 1.25);
    dir.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).normalize();
    q.setFromUnitVectors(up, dir);
    m.compose(
      new THREE.Vector3(dir.x * r * 0.5, r * 0.35 + dir.y * r * 0.3, dir.z * r * 0.5),
      q,
      new THREE.Vector3(1, rng.range(0.16, 0.34), 1)
    );
    im.setMatrixAt(i, m);
  }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = true;
  g.add(im);

  const berryMat = cel({ color: PAL.berry, bands: 3, tint: 0x6a4a80, flat: false });
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, TAU);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), berryMat);
    b.position.set(Math.cos(a) * r * 0.6, r * rng.range(0.4, 0.8), Math.sin(a) * r * 0.6);
    g.add(b);
  }
  return shadowify(g);
}

/** A clump of flowers: stems plus a flat head, merged into one mesh. */
export function flowerClump({ seed = 11, n = 7, color = PAL.bloomYellow, h = 0.16 } = {}) {
  const rng = rngKit(seed * 5501);
  const g = new THREE.Group();
  /* Its own role, not `leaf`: a stem is not a leaf, and sharing the role
   * turned every flower stem pumpkin-orange each autumn. */
  const stemMat = cel({ color: 0x6f9152, bands: 3, tint: 0x55668c, role: 'stem' });
  const headMat = flat({
    color, map: petalTex(), transparent: true, alphaTest: 0.35,
    side: THREE.DoubleSide, cache: false,
  });
  const stems = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(0, 0.13);
    const hh = h * rng.range(0.7, 1.3);
    const sg = new THREE.CylinderGeometry(0.004, 0.005, hh, 4);
    sg.translate(0, hh / 2, 0);
    stems.push({ geometry: sg, matrix: trs(Math.cos(a) * r, 0, Math.sin(a) * r) });

    const head = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.055), headMat);
    head.position.set(Math.cos(a) * r, hh, Math.sin(a) * r);
    head.rotation.x = -Math.PI / 2 + rng.range(-0.5, 0.5);
    head.rotation.z = rng.range(0, TAU);
    head.userData.noOutline = true;
    g.add(head);
  }
  const merged = bake(stems);
  if (merged) g.add(new THREE.Mesh(merged, stemMat));
  return g;
}

/** Reeds at a water's edge: tall, thin, and always in a crowd. */
export function reeds({ seed = 13, n = 22, h = 0.32, r = 0.4 } = {}) {
  const rng = rngKit(seed * 4409);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0, r);
    const hh = h * rng.range(0.7, 1.25);
    const g = new THREE.CylinderGeometry(0.004, 0.008, hh, 4);
    g.translate(0, hh / 2, 0);
    parts.push({
      geometry: g,
      matrix: trs(Math.cos(a) * rr, 0, Math.sin(a) * rr, rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12)),
    });
  }
  const mesh = new THREE.Mesh(bake(parts), cel({ color: 0x7d8f52, bands: 3, tint: 0x556086, role: 'leaf' }));
  /* Not flat-shaded: a reed is four faces round and flat shading makes each
   * one a different band, so a bed of them strobes as you walk past. */
  mesh.material.flatShading = false;
  return shadowify(mesh, true, true);
}

/**
 * One fence post with its two rails running off to the next one.
 *
 * A fence used to be a single merged mesh spanning twenty metres, which was
 * fine along an equator and is not fine on an open globe: bent onto the
 * sphere, geometry is squashed along longitude by `cos(latitude)`.  Built
 * post by post and seated rigidly, every post stands up straight wherever it
 * is, and the rails only have to span the metre and a half between two of
 * them.
 */
export function fencePost({ seed = 17, h = 0.55, span = 0, ahead = 0 } = {}) {
  const rng = rngKit(seed * 2237);
  const g = new THREE.Group();
  const mat = MAT.timber();
  const hh = h * rng.range(0.94, 1.06);
  const pg = new THREE.BoxGeometry(0.07, hh, 0.07);
  pg.translate(0, hh / 2, 0);
  const post = new THREE.Mesh(pg, mat);
  post.rotation.y = rng.range(-0.08, 0.08);
  g.add(post);
  if (span > 0) {
    for (const rail of [0.62, 0.92]) {
      const rg = new THREE.BoxGeometry(span, 0.045, 0.03);
      rg.translate(span / 2, 0, 0);
      const r = new THREE.Mesh(rg, mat);
      r.position.y = h * rail;
      r.rotation.y = -ahead;
      g.add(r);
    }
  }
  return shadowify(g);
}

/** A rock, or a whole scree of them if you ask for more than one. */
export function rock({ seed = 19, r = 0.25 } = {}) {
  const rng = rngKit(seed * 1543);
  const geo = new THREE.IcosahedronGeometry(r, 0);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).multiplyScalar(rng.range(0.72, 1.22));
    pos.setXYZ(i, v.x, v.y * 0.7, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, MAT.stone());
  m.position.y = r * 0.42;
  m.rotation.y = rng.range(0, TAU);
  return shadowify(m);
}

/**
 * The burrow: the end of a leg, and the one thing in the world he is trying
 * to reach.  It has to be legible from a long way off in a field of grass,
 * so it is a pale mound with a dark mouth and a ring of stones — three
 * values, no detail, and it reads at any distance.
 */
export function burrow({ seed = 23 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 977);

  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 16, 10, 0, TAU, 0, Math.PI / 2),
    cel({ color: 0x8f7a54, bands: 3, tint: 0x63568c, flat: false })
  );
  mound.scale.set(1.2, 0.62, 1);
  g.add(mound);

  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 14, 10, 0, TAU, 0, Math.PI / 2),
    flat({ color: 0x241d2c })
  );
  mouth.scale.set(1.1, 0.9, 0.6);
  mouth.position.set(0.52, 0.02, 0);
  mouth.rotation.z = -0.25;
  g.add(mouth);

  for (let i = 0; i < 7; i++) {
    const a = rng.range(-1.1, 1.1);
    const r = rock({ seed: 100 + i, r: rng.range(0.05, 0.1) });
    r.position.set(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.66);
    g.add(r);
  }
  // a tuft over the door, so it looks lived in
  const tuft = flowerClump({ seed: 31, n: 5, color: PAL.bloomWhite, h: 0.13 });
  tuft.position.set(-0.1, 0.3, 0.22);
  g.add(tuft);

  return shadowify(g);
}

/** A hay bale — autumn only, as in v1. */
export function bale({ seed = 29, r = 0.42 } = {}) {
  const g = new THREE.CylinderGeometry(r, r, r * 1.5, 14);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, cel({ color: PAL.hay, bands: 3, tint: 0x7a6a8e }));
  m.position.y = r;
  m.rotation.y = (seed % 7) * 0.4;
  return shadowify(m);
}

/**
 * A stump: what is left where a tree went.
 *
 * Two things make it read as *cut* rather than as a cylinder someone dropped
 * on the field — roots flaring into the turf at the foot, and a flat pale
 * face on top with rings on it.  Everything else here is faceted, and that
 * one flat top is right precisely because a saw made it.
 */
export function stump({ seed = 37, r = 0.2, h = 0.3 } = {}) {
  const rng = rngKit(seed * 4211);
  const g = new THREE.Group();
  const bark = rng.chance(0.5) ? MAT.bark() : MAT.barkPale();

  const bg = new THREE.CylinderGeometry(r * 0.86, r, h, 8);
  bg.translate(0, h / 2, 0);
  const wood = [{ geometry: bg }];

  /* Roots are cones laid on their sides and nosed downward, so each one
   * disappears into the ground rather than ending in mid-air. */
  const nRoots = rng.int(4, 6);
  for (let i = 0; i < nRoots; i++) {
    const a = (i / nRoots) * TAU + rng.range(-0.3, 0.3);
    const len = r * rng.range(0.85, 1.45);
    const rg = new THREE.ConeGeometry(r * 0.34, len, 5);
    rg.rotateZ(-Math.PI / 2);          // lay it along +x, base at the trunk
    rg.translate(len / 2, 0, 0);
    wood.push({ geometry: rg, matrix: trs(0, r * 0.3, 0, 0, a, -rng.range(0.28, 0.48)) });
  }
  g.add(new THREE.Mesh(bake(wood), bark));

  // the cut: heartwood, two darker rings, and the split every stump has
  const heart = cel({ color: 0xb59a72, bands: 3, tint: 0x63537f, flat: false });
  const ring = cel({ color: 0x9a7f5c, bands: 3, tint: 0x63537f, flat: false });
  const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.86, 8), heart);
  face.rotation.x = -Math.PI / 2;
  face.position.y = h + 0.002;
  g.add(face);
  const grain = [];
  for (const t of [0.34, 0.66]) {
    const rr = r * 0.86 * t;
    const rgeo = new THREE.RingGeometry(rr * 0.86, rr, 8);
    rgeo.rotateX(-Math.PI / 2);
    grain.push({ geometry: rgeo, matrix: trs(0, h + 0.004, 0) });
  }
  grain.push({
    geometry: new THREE.BoxGeometry(r * rng.range(0.7, 1.3), 0.004, 0.012),
    matrix: trs(0, h + 0.004, 0, 0, rng.range(0, TAU), 0),
  });
  g.add(new THREE.Mesh(bake(grain), ring));

  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/**
 * A thistle: taller than any flower here, and the one plant that looks like
 * it would rather you did not.  Half a metre of grey-green stem, spines all
 * the way up, and a purple head — the only purple in the meadow, which is
 * why one of these carries a long view on its own.
 */
export function thistle({ seed = 41, h = 0.5 } = {}) {
  const rng = rngKit(seed * 3313);
  const g = new THREE.Group();
  const stemMat = cel({ color: 0x6d8a54, bands: 3, tint: 0x55668c, role: 'stem' });
  const leafMat = cel({ color: 0x7f9a5c, bands: 3, tint: 0x55668c, role: 'leaf' });

  const sh = h * 0.84;
  const sg = new THREE.CylinderGeometry(0.011, 0.019, sh, 5);
  sg.translate(0, sh / 2, 0);
  g.add(new THREE.Mesh(sg, stemMat));

  /* Spines, leaves and the cup are all one green thing, so they are baked
   * into one mesh — a weed is not worth twenty draw calls, and the season
   * material they share is per-plant, so the world's static merge cannot
   * fold them for us afterwards. */
  const green = [];
  for (let i = 0; i < 9; i++) {
    // spines up the stem: little cones, angled out and up, one to a side
    const y = sh * (0.18 + 0.08 * i);
    const a = i * 2.4 + rng.range(-0.4, 0.4);
    const spine = new THREE.ConeGeometry(0.005, 0.05, 3);
    spine.translate(0, 0.025, 0);
    green.push({
      geometry: spine,
      matrix: trs(Math.cos(a) * 0.012, y, -Math.sin(a) * 0.012, 0, a, -rng.range(0.7, 1.05)),
    });
  }
  // three ragged leaves low down, flattened cones rather than planes so they
  // keep a silhouette from every side
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng.range(-0.3, 0.3);
    const lf = new THREE.ConeGeometry(0.035, h * 0.34, 4);
    lf.translate(0, h * 0.17, 0);
    green.push({
      geometry: lf,
      matrix: trs(0, sh * rng.range(0.12, 0.3), 0, 0, a, -rng.range(0.85, 1.15), 1, 1, 0.3),
    });
  }
  // the head sits in a green cup, and the flower bursts out of the top of it
  green.push({ geometry: new THREE.ConeGeometry(0.042, 0.075, 6), matrix: trs(0, sh + 0.03, 0) });
  g.add(new THREE.Mesh(bake(green), leafMat));

  /* Not in PAL: nothing else in the world is this colour, and a named entry
   * for one plant would only invite something else to borrow it. */
  const headMat = cel({ color: 0x9c6fae, bands: 3, tint: 0x6a5a90, flat: false });
  const head = [{
    geometry: new THREE.IcosahedronGeometry(0.038, 0),
    matrix: trs(0, sh + 0.075, 0, 0, 0, 0, 1, 0.75, 1),
  }];
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, TAU);
    const len = rng.range(0.035, 0.06);
    const br = new THREE.ConeGeometry(0.004, len, 3);
    br.translate(0, len / 2, 0);
    head.push({
      geometry: br,
      matrix: trs(Math.cos(a) * 0.024, sh + 0.09, -Math.sin(a) * 0.024, 0, a, -rng.range(0.25, 0.7)),
    });
  }
  g.add(new THREE.Mesh(bake(head), headMat));

  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/**
 * One tapering blade, base at the origin, bending toward +z.
 *
 * Shared by `reed` and `tussock`.  It is a plane rather than a cylinder
 * because at this size a blade wants *width* — a four-sided stalk half a
 * centimetre thick is a hair, and a bed of hairs is fuzz.
 */
function bladeGeo(w, h, curve = 0.1) {
  const g = new THREE.PlaneGeometry(w, h, 1, 4);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = clamp(p.getY(i) / h, 0, 1);       // 0 at the base, 1 at the tip
    p.setX(i, p.getX(i) * (1 - t * 0.92));
    p.setZ(i, p.getZ(i) + curve * t * t * h);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A reed clump for a water margin: broad blades and a bulrush or two.
 *
 * `reeds` above is a *bed* — a wide thin scatter you look across, and the
 * right thing for the far shore.  This is one clump you look at, tight
 * enough to stand at a pond's lip or beside a plank bridge, and tall enough
 * that he can go behind it and be gone.
 */
export function reed({ seed = 43, h = 0.5, n = 9 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 2699);

  const blades = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0, 0.055);
    const hh = h * rng.range(0.6, 1.15);
    const lean = rng.range(0.05, 0.22);
    /* Ry sends +x to (cos a, 0, -sin a) and the euler's z term is applied
     * first, so a negative z leans the blade out along that same direction —
     * which is the one the clump is standing on. */
    blades.push({
      geometry: bladeGeo(0.024, hh, rng.range(-0.16, 0.16)),
      matrix: trs(Math.cos(a) * rr, 0, -Math.sin(a) * rr, 0, a, -lean),
    });
  }
  const bladeMesh = new THREE.Mesh(
    bake(blades),
    cel({ color: 0x7d8f52, bands: 3, tint: 0x556086, side: THREE.DoubleSide, role: 'leaf' })
  );
  // same reason as `reeds`: flat shading makes each face its own band and a
  // clump of them strobes as you walk past
  bladeMesh.material.flatShading = false;
  g.add(bladeMesh);

  // the bulrushes: two brown velvet heads, above the blades so they read
  const spikes = [];
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0.01, 0.04);
    const sh = h * rng.range(1.0, 1.2);
    const st = new THREE.CylinderGeometry(0.005, 0.007, sh, 4);
    st.translate(0, sh / 2, 0);
    const head = new THREE.CylinderGeometry(0.013, 0.013, 0.08, 6);
    head.translate(0, sh - 0.02, 0);
    const at = trs(Math.cos(a) * rr, 0, -Math.sin(a) * rr, 0, a, -rng.range(0.02, 0.1));
    spikes.push({ geometry: st, matrix: at }, { geometry: head, matrix: at });
  }
  g.add(new THREE.Mesh(bake(spikes), cel({ color: 0x6a4a30, bands: 3, tint: 0x5a4a7a })));

  return shadowify(g);
}

/**
 * A tussock: a hummock of coarse grass, for bog and rough ground.
 *
 * The base is last year's growth, dead and straw-pale, and only the crown is
 * this year's — so the thing keeps a warm foot in summer and does not go
 * entirely grey in winter with the rest of the field.  It is what tells you
 * the ground under it is wet.
 */
export function tussock({ seed = 47, r = 0.3 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 1993);

  const mound = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r * 0.6, 1),
    cel({ color: 0x9c8a5e, bands: 3, tint: 0x6a6090 })
  );
  mound.scale.set(1.35, 0.5, 1.35);
  mound.position.y = r * 0.1;
  g.add(mound);

  const blades = [];
  const n = Math.round(26 * (r / 0.3));
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU);
    const rr = r * rng.range(0, 0.62);
    const hh = r * rng.range(0.55, 1.15);
    // the further out it sits, the further over it flops
    const lean = 0.25 + (rr / r) * rng.range(0.8, 1.5);
    blades.push({
      geometry: bladeGeo(0.02, hh, rng.range(-0.12, 0.12)),
      matrix: trs(Math.cos(a) * rr, r * 0.22, -Math.sin(a) * rr, 0, a, -lean),
    });
  }
  const crown = new THREE.Mesh(
    bake(blades),
    cel({ color: 0x86a055, bands: 3, tint: 0x556086, side: THREE.DoubleSide, role: 'grass' })
  );
  crown.material.flatShading = false;
  g.add(crown);

  return shadowify(g);
}

/**
 * A short run of drystone wall, centred on the origin and running along +x
 * so it can be laid like fence — a run at a time, seated rigidly, rather
 * than one long mesh that the sphere would squash.
 *
 * Unmortared means gappy and slumped: courses of loose stones with the odd
 * hole through, one dip where it has settled, and coping stones stood on
 * edge along the top.  A tidy wall reads as a wall from a kit.
 */
export function drystone({ seed = 53, len = 2.0, h = 0.55 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 1907);
  const light = [];
  const dark = [];

  const thickBase = 0.34;
  const thickTop = 0.2;
  /* `h` is the finished height including the coping, because that is the
   * number the caller can see; the courses only run to the shoulder. */
  const body = Math.max(0.16, h - 0.13);
  const dipAt = rng.range(-len * 0.3, len * 0.3);
  const dipW = len * rng.range(0.2, 0.4);
  const dipD = rng.range(0.08, 0.26);
  const topAt = (x) => body * (1 - dipD * Math.exp(-(((x - dipAt) / dipW) ** 2)));

  const courseH = 0.11;
  const courses = Math.max(2, Math.floor(body / courseH));
  for (let c = 0; c < courses; c++) {
    const y = c * courseH;
    const t = lerp(thickBase, thickTop, clamp(y / body, 0, 1));
    let x = -len / 2;
    while (x < len / 2 - 0.05) {
      const w = Math.min(rng.range(0.13, 0.28), len / 2 - x);
      const sh = courseH * rng.range(0.8, 0.97);
      if (w > 0.07 && y + sh <= topAt(x + w / 2)) {
        (rng.chance(0.5) ? light : dark).push({
          geometry: new THREE.BoxGeometry(w * 0.94, sh, t * rng.range(0.84, 1.0)),
          matrix: trs(
            x + w / 2, y + sh / 2, rng.range(-0.02, 0.02),
            rng.range(-0.05, 0.05), rng.range(-0.1, 0.1), rng.range(-0.05, 0.05)
          ),
        });
      }
      // every so often a stone is simply missing, and you can see through
      x += w + (rng.chance(0.16) ? rng.range(0.02, 0.05) : 0.005);
    }
  }

  // coping: stones on edge, leaning on each other, and only where the wall
  // has not slumped away underneath them
  let x = -len / 2;
  while (x < len / 2 - 0.06) {
    const w = rng.range(0.07, 0.11);
    const top = topAt(x + w / 2);
    if (top > body * 0.78) {
      (rng.chance(0.5) ? light : dark).push({
        geometry: new THREE.BoxGeometry(w * 0.9, 0.13, thickTop * 0.92),
        matrix: trs(x + w / 2, top + 0.06, 0, 0, rng.range(-0.08, 0.08), rng.sign() * rng.range(0.06, 0.16)),
      });
    }
    x += w + 0.006;
  }

  const a = bake(light);
  if (a) g.add(new THREE.Mesh(a, MAT.stone()));
  const b = bake(dark);
  if (b) g.add(new THREE.Mesh(b, MAT.stoneDark()));
  return shadowify(g);
}

/**
 * A five-bar field gate, with a post each side.
 *
 * The brace runs from the bottom of the hanging stile to the top of the
 * head — the only diagonal that stops a gate from folding into a
 * parallelogram — and the leaf droops a degree or two off it anyway,
 * because every gate that has ever hung in a field does.
 */
export function gate({ seed = 59, w = 1.8, h = 1.05 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 1361);
  const timber = MAT.timber();

  // the two posts, heavier than a fence post because a gate hangs off one
  for (const s of [-1, 1]) {
    const ph = h * 1.18;
    const pg = new THREE.BoxGeometry(0.11, ph, 0.11);
    pg.translate(0, ph / 2, 0);
    const p = new THREE.Mesh(pg, timber);
    p.position.x = s * (w / 2 + 0.07);
    p.rotation.y = rng.range(-0.06, 0.06);
    g.add(p);
  }

  const leaf = new THREE.Group();
  const bw = w - 0.04;
  const lo = h * 0.22;
  const hi = h * 0.96;
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.055, 0.03), timber);
    bar.position.y = lerp(lo, hi, i / 4);
    leaf.add(bar);
  }
  for (const s of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.07, hi - lo + 0.055, 0.036), timber);
    st.position.set(s * (bw / 2 - 0.035), (lo + hi) / 2, 0);
    leaf.add(st);
  }
  const dx = bw - 0.07;
  const dy = hi - lo;
  const brace = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy), 0.05, 0.028), timber);
  brace.position.set(0, (lo + hi) / 2, -0.032);
  brace.rotation.z = Math.atan2(dy, dx);
  leaf.add(brace);

  const metal = MAT.metal();
  for (const y of [lo + 0.06, hi - 0.06]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.028, 0.046), metal);
    strap.position.set(-bw / 2 + 0.07, y, 0.032);
    leaf.add(strap);
  }
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.024, 0.03), metal);
  latch.position.set(bw / 2 - 0.03, lerp(lo, hi, 0.5), 0.036);
  leaf.add(latch);

  leaf.rotation.z = -rng.range(0.012, 0.032);   // the far end always sags
  g.add(leaf);
  return shadowify(g);
}

/**
 * A fingerpost.  Arms are thin painted boxes with a point on the end, set at
 * different heights and pointing different ways — no lettering, because at
 * the size he sees one from, the shape of the thing is the whole message and
 * a texture would only be a smudge.
 */
export function signpost({ seed = 61, h = 1.5, arms = 2 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 1231);
  const paint = MAT.paint();

  const pg = new THREE.CylinderGeometry(0.042, 0.055, h, 8);
  pg.translate(0, h / 2, 0);
  g.add(new THREE.Mesh(pg, paint));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), paint);
  cap.position.y = h + 0.015;
  cap.scale.y = 0.85;
  g.add(cap);

  const spread = rng.range(0, TAU);
  for (let i = 0; i < arms; i++) {
    const a = spread + (i / Math.max(1, arms)) * TAU + rng.range(-0.35, 0.35);
    const y = h - 0.1 - i * 0.17;
    const len = rng.range(0.36, 0.46);
    const arm = new THREE.Group();
    const bg = new THREE.BoxGeometry(len, 0.078, 0.022);
    bg.translate(len / 2 + 0.04, 0, 0);
    arm.add(new THREE.Mesh(bg, paint));
    // the finger: a four-sided point, laid along the arm
    const tip = new THREE.ConeGeometry(0.055, 0.075, 4);
    tip.rotateZ(-Math.PI / 2);
    tip.rotateX(Math.PI / 4);
    tip.translate(len + 0.075, 0, 0);
    const point = new THREE.Mesh(tip, paint);
    point.scale.z = 0.28;              // as thin as the arm it finishes
    arm.add(point);
    arm.position.y = y;
    arm.rotation.y = a;
    g.add(arm);
  }
  g.rotation.y = rng.range(-0.1, 0.1);
  return shadowify(g);
}

/**
 * A stone water trough.  Built from five slabs rather than one scaled box so
 * it is genuinely hollow — he can stand at the end of it and see water in
 * it, which a solid block with a painted top can never do.  The water
 * carries the `water` role, so it ices over in winter with the lake.
 */
export function trough({ seed = 67, len = 1.0 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 1109);
  const wid = 0.4;
  const h = 0.32;
  const wall = 0.06;

  const parts = [
    { geometry: new THREE.BoxGeometry(len, wall, wid), matrix: trs(0, wall / 2, 0) },
    { geometry: new THREE.BoxGeometry(len, h - wall, wall), matrix: trs(0, (h + wall) / 2, (wid - wall) / 2) },
    { geometry: new THREE.BoxGeometry(len, h - wall, wall), matrix: trs(0, (h + wall) / 2, -(wid - wall) / 2) },
    { geometry: new THREE.BoxGeometry(wall, h - wall, wid - wall * 2), matrix: trs((len - wall) / 2, (h + wall) / 2, 0) },
    { geometry: new THREE.BoxGeometry(wall, h - wall, wid - wall * 2), matrix: trs(-(len - wall) / 2, (h + wall) / 2, 0) },
  ];
  g.add(new THREE.Mesh(bake(parts), MAT.stone()));

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(len - wall * 2, wid - wall * 2),
    cel({ color: PAL.water, bands: 'soft3', tint: 0x5a6a9c, flat: false, role: 'water' })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = h - 0.055;
  g.add(water);

  // moss at the foot of the shaded end, so it looks like it has stood there
  const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), MAT.leaf());
  moss.position.set(rng.sign() * len * 0.4, 0.02, rng.sign() * wid * 0.5);
  moss.scale.set(1.2, 0.35, 0.9);
  g.add(moss);

  return shadowify(g);
}

/** A slatted wooden crate — the gaps are the whole point, so it is built as
 *  four corner posts with boards across, not a box with lines drawn on it. */
export function crate({ seed = 71, s = 0.4 } = {}) {
  const rng = rngKit(seed * 1063);
  const parts = [];
  const post = 0.035;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pg = new THREE.BoxGeometry(post, s, post);
      pg.translate(0, s / 2, 0);
      parts.push({ geometry: pg, matrix: trs(sx * (s / 2 - post / 2), 0, sz * (s / 2 - post / 2)) });
    }
  }
  const slats = 3;
  for (let i = 0; i < slats; i++) {
    const y = s * (0.14 + (0.72 * i) / (slats - 1));
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(s, 0.055, 0.016),
        matrix: trs(0, y, sz * (s / 2 - 0.008), 0, 0, rng.range(-0.012, 0.012)),
      });
      parts.push({
        geometry: new THREE.BoxGeometry(0.016, 0.055, s),
        matrix: trs(sz * (s / 2 - 0.008), y, 0, rng.range(-0.012, 0.012), 0, 0),
      });
    }
  }
  parts.push({
    geometry: new THREE.BoxGeometry(s * 0.94, 0.018, s * 0.94),
    matrix: trs(0, 0.009, 0),
  });
  const m = new THREE.Mesh(bake(parts), MAT.timber());
  m.rotation.y = rng.range(0, TAU);
  return shadowify(m);
}

/** A galvanised pail: open at the top, with a rim band and a wire handle. */
export function bucket({ seed = 73, r = 0.12, h = 0.18 } = {}) {
  const g = new THREE.Group();
  const rng = rngKit(seed * 1013);
  const metal = MAT.metal();

  /* Open-ended and double-sided: you look down into a bucket, and a pail
   * whose inside is missing is a paper cone. */
  const bg = new THREE.CylinderGeometry(r, r * 0.76, h, 9, 1, true);
  bg.translate(0, h / 2, 0);
  g.add(new THREE.Mesh(bg, cel({ color: PAL.metal, bands: 3, tint: 0x5c688e, side: THREE.DoubleSide })));

  const floor = new THREE.Mesh(new THREE.CircleGeometry(r * 0.76, 9), metal);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  g.add(floor);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 4, 9), metal);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = h - 0.006;
  g.add(rim);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(r * 0.92, 0.007, 3, 9, Math.PI), metal);
  handle.position.y = h - 0.01;
  handle.rotation.y = rng.range(-0.5, 0.5);
  g.add(handle);

  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/** One weathered board, lying flat: boardwalks, a patched gate, a plank over
 *  a ditch.  It bows along its length, because a board that has been out in
 *  the rain for a winter is never straight again. */
export function plank({ seed = 79, len = 1.2, w = 0.18 } = {}) {
  const rng = rngKit(seed * 977);
  const g = new THREE.Group();
  const th = 0.032;

  const bg = new THREE.BoxGeometry(len, th, w, 6, 1, 2);
  const bow = rng.range(-0.018, 0.018);
  const twist = rng.range(-0.02, 0.02);
  const p = bg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) / len) * 2;              // -1 at one end, +1 at the other
    p.setY(i, p.getY(i) + bow * (1 - t * t) + twist * t * (p.getZ(i) / w) * 2);
  }
  bg.computeVertexNormals();
  bg.translate(0, th / 2, 0);
  g.add(new THREE.Mesh(bg, MAT.timber()));

  // four nail heads, proud enough to catch the ink pass at close range
  const nail = MAT.metal();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 6), nail);
      n.position.set(sx * (len / 2 - 0.05), th + 0.001 + bow * 0.3, sz * (w / 2 - 0.04));
      g.add(n);
    }
  }
  g.rotation.y = rng.range(-0.04, 0.04);
  return shadowify(g);
}

/** A molehill: a cone of fine tilled soil with the crumbs still round it.
 *  `critters.js` has the live one that rises and has a nose in it; this is
 *  the cold version, for scattering across a field that has had moles in it
 *  for years. */
export function molehillProp({ seed = 83, r = 0.12 } = {}) {
  const rng = rngKit(seed * 941);
  const g = new THREE.Group();
  const soil = MAT.soil();

  const cg = new THREE.ConeGeometry(r, r * 0.55, 9);
  cg.translate(0, r * 0.275, 0);
  const p = cg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = rng.range(0.86, 1.16);
    p.setX(i, p.getX(i) * s);
    p.setZ(i, p.getZ(i) * s);
  }
  cg.computeVertexNormals();
  g.add(new THREE.Mesh(cg, soil));

  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, TAU);
    const rr = r * rng.range(0.9, 1.4);
    const crumb = new THREE.Mesh(new THREE.IcosahedronGeometry(r * rng.range(0.08, 0.16), 0), soil);
    crumb.position.set(Math.cos(a) * rr, r * 0.03, Math.sin(a) * rr);
    crumb.scale.y = 0.6;
    g.add(crumb);
  }
  g.rotation.y = rng.range(0, TAU);
  return shadowify(g);
}

/* `contactShadow` and the `PROP_MAT` re-export lived here since the disc
 * rebuild with no callers at all — deleted, as the backlog's debt list asks. */
