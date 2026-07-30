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
  const stemMat = cel({ color: 0x6f9152, bands: 3, tint: 0x55668c, role: 'leaf' });
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

/** A soft painted shadow, for props whose real shadow is too small to read. */
export function contactShadow(size = 0.6, opacity = 0.26) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    flat({ color: 0x54486a, map: blobTex(), transparent: true, opacity, depthWrite: false, cache: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.userData.noOutline = true;
  m.renderOrder = 1;
  return m;
}

export { MAT as PROP_MAT };
