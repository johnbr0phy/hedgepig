import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { signTex } from '../../core/textures.js';
import { rngKit, clamp, lerp, TAU, trs, bake, shadowify, damp, wrapAng } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { positionAt, basisAt } from '../planet.js';
import { rock, bale, fenceRun, log, scatter, flowerClump } from '../props.js';

/* ------------------------------------------------------------------ *
 * The hen run and the farmyard.
 *
 * These two are the only *built* places on the ring apart from the town,
 * and they earn their keep by being the only straight lines in a world of
 * scattered things.  A fence is a horizon you can read at a glance, which
 * matters when the real horizon is eleven metres away and curved.
 * ------------------------------------------------------------------ */

/** One hen: a body, a head that is not a separate mass, a comb, a beak. */
function hen(seed) {
  const rng = rngKit(seed * 3313);
  const g = new THREE.Group();
  const white = rng.chance(0.6);
  const bodyMat = cel({
    color: white ? PAL.hen : 0xb98a5a, bands: 'soft3', tint: 0x8a7fa8, flat: false,
  });
  const combMat = cel({ color: PAL.henRed, bands: 2, tint: 0x7a5a86, flat: false });
  const beakMat = cel({ color: 0xe0a63e, bands: 2, tint: 0x7a6a8e, flat: false });

  const bg = new THREE.SphereGeometry(0.10, 12, 9);
  bg.scale(1.25, 1, 0.9);
  const body = new THREE.Mesh(bg, bodyMat);
  body.position.y = 0.115;
  g.add(body);

  const neck = new THREE.Group();
  neck.position.set(0.085, 0.16, 0);
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), bodyMat);
  neck.add(head);
  const comb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), combMat);
  comb.scale.set(0.5, 0.9, 0.35);
  comb.position.set(0.004, 0.045, 0);
  neck.add(comb);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 5), beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.055, -0.004, 0);
  neck.add(beak);
  const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), combMat);
  wattle.position.set(0.035, -0.036, 0);
  neck.add(wattle);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 5), bodyMat);
  tail.position.set(-0.115, 0.16, 0);
  tail.rotation.z = 0.9;
  g.add(tail);

  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 4), beakMat);
    leg.position.set(0, 0.03, 0.035 * s);
    g.add(leg);
  }

  shadowify(g);
  g.userData.neck = neck;
  return g;
}

export function buildHens(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:hens';
  const rng = rngKit(ctx.slot * 701 + 23);
  const { x0, x1, cx } = ctx;

  /* --- the run: wire on posts, three sides, open toward the walk --- */
  const postMat = cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 });
  const wireMat = flat({
    color: 0x9aa0a8, transparent: true, opacity: 0.30, side: THREE.DoubleSide, cache: false,
  });
  const RX0 = cx - 6, RX1 = cx + 6, RZ0 = -7.5, RZ1 = 5.5;

  const posts = [];
  const addRun = (ax, az, bx, bz) => {
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 1.5));
    for (let i = 0; i <= n; i++) {
      const x = lerp(ax, bx, i / n), z = lerp(az, bz, i / n);
      const y = heightAt(x, z);
      const pg = new THREE.BoxGeometry(0.07, 0.95, 0.07);
      pg.translate(0, 0.475, 0);
      posts.push({ geometry: pg, matrix: trs(x, y, z) });
    }
    // the wire itself: one translucent quad per span, which reads as mesh
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const len = Math.hypot(bx - ax, bz - az);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), wireMat);
    quad.position.set(mx, heightAt(mx, mz) + 0.45, mz);
    quad.rotation.y = -Math.atan2(bz - az, bx - ax);
    quad.userData.noOutline = true;
    quad.userData.noShadow = true;
    g.add(quad);
  };
  addRun(RX0, RZ0, RX1, RZ0);
  addRun(RX0, RZ1, RX1, RZ1);
  addRun(RX0, RZ0, RX0, RZ1);
  g.add(shadowify(new THREE.Mesh(bake(posts), postMat)));

  // the fence is a real obstacle on three sides; the fourth is how you get in
  ctx.blockers.push({ x: (RX0 + RX1) / 2, z: RZ0, hx: 6, hz: 0.12 });
  ctx.blockers.push({ x: (RX0 + RX1) / 2, z: RZ1, hx: 6, hz: 0.12 });
  ctx.blockers.push({ x: RX0, z: (RZ0 + RZ1) / 2, hx: 0.12, hz: 6.5 });

  /* --- the coop --- */
  const coop = new THREE.Group();
  const boardMat = cel({ color: 0xa4633f, bands: 3, tint: 0x6b5b86 });
  const roofMat = cel({ color: PAL.slate, bands: 3, tint: 0x5f5e86 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.1), boardMat);
  box.position.y = 0.45;
  coop.add(box);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 1.3), roofMat);
  roof.position.y = 0.94;
  roof.rotation.z = 0.14;
  coop.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.44), flat({ color: 0x2b2130 }));
  door.position.set(0.755, 0.28, 0);
  door.rotation.y = Math.PI / 2;
  coop.add(door);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.3), boardMat);
  ramp.position.set(1.08, 0.14, 0);
  ramp.rotation.z = -0.28;
  coop.add(ramp);
  const cxx = RX0 + 1.6, czz = RZ0 + 1.4;
  coop.position.set(cxx, heightAt(cxx, czz), czz);
  coop.rotation.y = -0.2;
  g.add(shadowify(coop));
  ctx.blockers.push({ x: cxx, z: czz, r: 1.0 });
  ctx.interactables.push({
    x: cxx + 1.3, z: czz, label: 'the coop',
    action: () => ctx.flash('warm, and full of grumbling'),
  });

  // scratched-over ground: straw and a few pecked stones
  const strawMat = cel({ color: PAL.straw, bands: 2, tint: 0x6f628e, side: THREE.DoubleSide });
  const strawGeo = new THREE.PlaneGeometry(0.13, 0.02);
  strawGeo.rotateX(-Math.PI / 2);
  const straw = new THREE.InstancedMesh(strawGeo, strawMat, 500);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 500; i++) {
    const x = rng.range(RX0, RX1), z = rng.range(RZ0, RZ1);
    m.compose(
      new THREE.Vector3(x, heightAt(x, z) + 0.01, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, TAU), 0)),
      new THREE.Vector3(rng.range(0.6, 1.5), 1, 1)
    );
    straw.setMatrixAt(i, m);
  }
  straw.instanceMatrix.needsUpdate = true;
  straw.userData.noOutline = true;
  g.add(straw);

  root.add(g);

  /* --- the hens themselves, after the bake so they can wander --- */
  ctx.post.push((scene) => {
    const flock = [];
    for (let i = 0; i < 5; i++) {
      const h = hen(i + 1);
      h.matrixAutoUpdate = false;
      scene.add(h);
      flock.push({
        obj: h,
        x: rng.range(RX0 + 1, RX1 - 1),
        z: rng.range(RZ0 + 1, RZ1 - 1),
        hd: rng.range(0, TAU),
        wait: rng.range(0, 3),
        peck: 0,
      });
    }
    ctx.out.hens = flock;

    ctx.updaters.push((dt, hog) => {
      for (const f of flock) {
        f.wait -= dt;
        if (f.wait <= 0) {
          f.wait = rng.range(1.4, 4.5);
          f.hd = rng.range(0, TAU);
          f.peck = rng.chance(0.6) ? 1.2 : 0;
        }
        if (f.peck > 0) {
          f.peck -= dt;
          f.obj.userData.neck.rotation.z = -1.0 * Math.abs(Math.sin(f.peck * 9));
        } else {
          f.obj.userData.neck.rotation.z = damp(f.obj.userData.neck.rotation.z, 0, 6, dt);
          const sp = 0.22 * dt;
          const nx = clamp(f.x + Math.cos(f.hd) * sp, RX0 + 0.6, RX1 - 0.6);
          const nz = clamp(f.z + Math.sin(f.hd) * sp, RZ0 + 0.6, RZ1 - 0.6);
          f.x = nx; f.z = nz;
        }
        const b = basisAt(f.x, f.z);
        const mm = new THREE.Matrix4().makeBasis(b.east, b.up, b.north);
        mm.setPosition(positionAt(f.x, heightAt(f.x, f.z), f.z, new THREE.Vector3()));
        mm.multiply(new THREE.Matrix4().makeRotationY(-f.hd));
        f.obj.matrix.copy(mm);
        f.obj.matrixWorldNeedsUpdate = true;
      }
    });
  });

  return g;
}

/** The farmyard: a barn, a trough, bales, and the ruts of something heavy. */
export function buildFarm(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:farm';
  const rng = rngKit(ctx.slot * 809 + 29);
  const { x0, x1, cx } = ctx;

  /* --- the barn.  The one thing on the ring you can see from two places
   * away, which is deliberate: on a planet with an eleven-metre horizon,
   * exactly one landmark tall enough to break it is worth more than ten
   * that are not. --- */
  const barn = new THREE.Group();
  const wallMat = cel({ color: 0xb2603f, bands: 3, tint: 0x6b5b86 });
  const roofMat = cel({ color: PAL.slate, bands: 3, tint: 0x5f5e86 });
  const W = 5.2, D = 3.6, H = 2.6;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
  walls.position.y = H / 2;
  barn.add(walls);

  // a pitched roof, made from two slabs rather than a prism: the ink pass
  // finds the ridge on its own and a prism's end caps read as cardboard
  for (const s of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.1, D * 0.62), roofMat);
    slab.position.set(0, H + 0.46, (D * 0.28) * s);
    slab.rotation.x = s * -0.62;
    barn.add(slab);
  }
  const gableMat = cel({ color: 0xa2553a, bands: 3, tint: 0x6b5b86 });
  for (const s of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, 0.95); tri.closePath();
    const gab = new THREE.Mesh(new THREE.ShapeGeometry(tri), gableMat);
    gab.position.set((W / 2) * s, H, 0);
    gab.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    barn.add(gab);
  }

  const opening = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), flat({ color: 0x261e2e }));
  opening.position.set(0, 0.95, D / 2 + 0.01);
  barn.add(opening);

  const bx = cx - 1.5, bz = -7.5;
  barn.position.set(bx, heightAt(bx, bz), bz);
  barn.rotation.y = 0.06;
  g.add(shadowify(barn));
  ctx.blockers.push({ x: bx, z: bz, hx: 2.7, hz: 1.9 });
  ctx.interactables.push({
    x: bx, z: bz + 2.2, label: 'the barn door',
    action: () => ctx.flash('it smells of hay and old rain'),
  });

  // bales stacked against the barn, and a few loose
  for (let i = 0; i < 6; i++) {
    const x = bx + 3.4 + (i % 3) * 0.95;
    const z = bz + 0.4 + Math.floor(i / 3) * 0.9;
    const b = bale({ seed: 60 + i, r: 0.42 });
    b.position.set(x, heightAt(x, z) + (i > 2 ? 0.84 : 0), z);
    g.add(b);
    if (i <= 2) ctx.blockers.push({ x, z, r: 0.5 });
  }

  /* --- the trough --- */
  const trough = new THREE.Group();
  const tMat = cel({ color: PAL.stoneDark, bands: 3, tint: 0x635e8c });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.6), tMat);
  shell.position.y = 0.21;
  trough.add(shell);
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(1.44, 0.46),
    cel({ color: PAL.water, bands: 2, tint: 0x59718f, flat: false, role: 'water' })
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = 0.37;
  trough.add(surf);
  const tx = cx + 4.5, tz = 1.5;
  trough.position.set(tx, heightAt(tx, tz), tz);
  g.add(shadowify(trough));
  ctx.blockers.push({ x: tx, z: tz, hx: 0.85, hz: 0.35 });
  ctx.interactables.push({
    x: tx, z: tz + 0.8, label: 'the trough',
    action: () => ctx.flash('he drinks for a long time'),
  });

  /* --- ruts: two dark bands across the yard, drawn on the ground --- */
  const rutMat = cel({ color: 0x4f4233, bands: 2, tint: 0x5f5286, transparent: true, opacity: 0.55 });
  for (const s of [-1, 1]) {
    const rut = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.28), rutMat);
    rut.rotation.x = -Math.PI / 2;
    rut.position.set(cx, heightAt(cx, 4 + s * 0.5) + 0.012, 4 + s * 0.5);
    rut.userData.noOutline = true;
    rut.receiveShadow = true;
    g.add(rut);
  }

  g.add(fenceRun({ x0: x0 + 2, x1: x1 - 2, z: 10.5, seed: 71 }));

  scatter(rng, { x0: x0 + 2, x1: x1 - 2, z0: 5.5, z1: 9.5, n: 12, minGap: 1.1 }, (x, z, i) =>
    flowerClump({ seed: 1600 + i, n: rng.int(3, 7), color: rng.pick([PAL.bloomYellow, PAL.bloomWhite]), h: 0.14 })
  ).forEach((p) => g.add(p.obj));

  root.add(g);
  return g;
}
