import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { rngKit, clamp, damp, TAU } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { positionAt, basisAt } from '../planet.js';
import { rock, bale, fencePost, flowerClump } from '../props.js';

/* ------------------------------------------------------------------ *
 * The hen run and the farmyard.
 *
 * The only *built* places apart from the town, and they earn their keep by
 * being the only straight lines in a world of scattered things.  A fence is
 * a horizon you can read at a glance, which matters when the real horizon is
 * eleven metres away and curved.
 * ------------------------------------------------------------------ */

/** One hen: a body, a head that is not a separate mass, a comb, a beak. */
function hen(seed) {
  const rng = rngKit(seed * 3313);
  const g = new THREE.Group();
  const bodyMat = cel({
    color: rng.chance(0.6) ? PAL.hen : 0xb98a5a, bands: 'soft3', tint: 0x8a7fa8, flat: false,
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
  neck.add(new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), bodyMat));
  const comb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), combMat);
  comb.scale.set(0.5, 0.9, 0.35);
  comb.position.set(0.004, 0.045, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 5), beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.055, -0.004, 0);
  const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), combMat);
  wattle.position.set(0.035, -0.036, 0);
  neck.add(comb, beak, wattle);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 5), bodyMat);
  tail.position.set(-0.115, 0.16, 0);
  tail.rotation.z = 0.9;
  g.add(tail);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 4), beakMat);
    leg.position.set(0, 0.03, 0.035 * s);
    g.add(leg);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.neck = neck;
  return g;
}

export function buildHens(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:hens';
  const rng = rngKit(701);

  /* --- the run: a ring of posts and wire, with a gap you can walk in by --- */
  const PEN = 6.5;
  const GAP = [1.9, 2.7];        // radians of the ring left open
  const wireMat = flat({
    color: 0x9aa0a8, transparent: true, opacity: 0.30, side: THREE.DoubleSide, cache: false,
  });
  const N = 26;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    if (a > GAP[0] && a < GAP[1]) continue;
    const u = Math.cos(a) * PEN, v = Math.sin(a) * PEN;
    const span = (TAU / N) * PEN;
    const p = fencePost({ seed: 900 + i, h: 0.95, span, ahead: 0 });
    ctx.put(p, u, v);
    p.rotation.y = -(a + Math.PI / 2);
    g.add(p);
    ctx.block(u, v, 0.55);

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(span, 0.9), wireMat);
    quad.position.y = 0.45;
    quad.userData.noOutline = true;
    quad.userData.noShadow = true;
    p.add(quad);
  }

  /* --- the coop --- */
  const coop = new THREE.Group();
  const boardMat = cel({ color: 0xa4633f, bands: 3, tint: 0x6b5b86 });
  const roofMat = cel({ color: PAL.slate, bands: 3, tint: 0x5f5e86 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.1), boardMat);
  box.position.y = 0.45;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 1.3), roofMat);
  roof.position.y = 0.94;
  roof.rotation.z = 0.14;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.44), flat({ color: 0x2b2130 }));
  door.position.set(0.755, 0.28, 0);
  door.rotation.y = Math.PI / 2;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.3), boardMat);
  ramp.position.set(1.08, 0.14, 0);
  ramp.rotation.z = -0.28;
  coop.add(box, roof, door, ramp);
  coop.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  ctx.put(coop, -3.2, 2.4);
  coop.rotation.y = -0.6;
  g.add(coop);
  ctx.block(-3.2, 2.4, 1.0);
  ctx.interact(-1.9, 2.4, 'the coop', () => ctx.flash('warm, and full of grumbling'));

  // scratched-over ground: straw, instanced and seated on the surface
  const strawMat = cel({ color: PAL.straw, bands: 2, tint: 0x6f628e, side: THREE.DoubleSide });
  const strawGeo = new THREE.PlaneGeometry(0.13, 0.02);
  strawGeo.rotateX(-Math.PI / 2);
  const straw = new THREE.InstancedMesh(strawGeo, strawMat, 900);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  for (let i = 0; i < 900; i++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * PEN;
    const p = ctx.at(Math.cos(a) * d, Math.sin(a) * d);
    const b = basisAt(p.x, p.z);
    fm.makeBasis(b.east, b.up, b.north);
    q.setFromRotationMatrix(fm);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TAU)));
    m.compose(
      positionAt(p.x, heightAt(p.x, p.z) + 0.01, p.z, new THREE.Vector3()),
      q,
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
    for (let i = 0; i < 6; i++) {
      const h = hen(i + 1);
      h.matrixAutoUpdate = false;
      scene.add(h);
      const a = rng.range(0, TAU), d = rng.range(0, PEN - 1);
      flock.push({
        obj: h, u: Math.cos(a) * d, v: Math.sin(a) * d,
        hd: rng.range(0, TAU), wait: rng.range(0, 3), peck: 0,
      });
    }
    ctx.out.hens = flock;

    const mm = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    ctx.updaters.push((dt, hog) => {
      for (const f of flock) {
        /* **A hedgehog in the run scatters the flock** — ranged off him, as
         * everything is.  A hen that ignores an animal barrelling through
         * her pen at ball speed is furniture with feathers. */
        const at = ctx.at(f.u, f.v);
        if (hog && !(f.flee > 0)) {
          const dx = hog.x - at.x, dz = hog.z - at.z;
          const d2 = dx * dx + dz * dz;
          const scare = 1.0 + (hog.ball || 0) * 0.8;
          if (d2 < scare * scare) {
            f.flee = 1.3;
            f.peck = 0;
            f.hd = Math.atan2(at.z - hog.z, at.x - hog.x) + rng.range(-0.4, 0.4);
            f.squawked = false;
          }
        }
        f.flee = Math.max(0, (f.flee || 0) - dt);
        if (f.flee > 0 && !f.squawked) { f.squawked = true; ctx.sound?.('squawk'); }

        f.wait -= dt;
        if (f.wait <= 0) {
          f.wait = rng.range(1.4, 4.5);
          f.hd = rng.range(0, TAU);
          f.peck = f.flee > 0 ? 0 : (rng.chance(0.6) ? 1.2 : 0);
        }
        if (f.peck > 0 && f.flee <= 0) {
          f.peck -= dt;
          f.obj.userData.neck.rotation.z = -1.0 * Math.abs(Math.sin(f.peck * 9));
        } else {
          // a fleeing hen runs neck-up, four times her strolling pace
          f.obj.userData.neck.rotation.z = damp(f.obj.userData.neck.rotation.z, f.flee > 0 ? 0.35 : 0, 6, dt);
          const sp = (f.flee > 0 ? 0.95 : 0.22) * dt;
          let nu = f.u + Math.cos(f.hd) * sp;
          let nv = f.v + Math.sin(f.hd) * sp;
          if (Math.hypot(nu, nv) > PEN - 0.7) { f.hd += Math.PI; }
          else { f.u = nu; f.v = nv; }
        }
        const p = ctx.at(f.u, f.v);
        const b = basisAt(p.x, p.z);
        mm.makeBasis(b.east, b.up, b.north);
        // a fleeing hen bounces; a strolling one only bobs with her step
        const hop = f.flee > 0 ? Math.abs(Math.sin(f.flee * 22)) * 0.03 : 0;
        mm.setPosition(positionAt(p.x, heightAt(p.x, p.z) + hop, p.z, pos));
        rot.makeRotationY(-f.hd);
        mm.multiply(rot);
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
  const rng = rngKit(809);

  /* --- the barn.  The one thing you can see from a place away, which is
   * deliberate: with an eleven-metre horizon, exactly one landmark tall
   * enough to break it is worth more than ten that are not. --- */
  const barn = new THREE.Group();
  const wallMat = cel({ color: 0xb2603f, bands: 3, tint: 0x6b5b86 });
  const roofMat = cel({ color: PAL.slate, bands: 3, tint: 0x5f5e86 });
  const gableMat = cel({ color: 0xa2553a, bands: 3, tint: 0x6b5b86 });
  const W = 5.2, D = 3.6, H = 2.6;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
  walls.position.y = H / 2;
  barn.add(walls);

  /* A pitched roof from two slabs rather than a prism: the ink pass finds the
   * ridge on its own, and a prism's end caps read as cardboard.  `s * +angle`
   * — rotating about +x by a negative angle lifts the *far* edge, and both
   * slabs then meet low in the middle, which is a valley and not a roof. */
  for (const s of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.1, D * 0.68), roofMat);
    slab.position.set(0, H + 0.42, (D * 0.28) * s);
    slab.rotation.x = s * 0.62;
    barn.add(slab);
  }
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
  barn.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  ctx.put(barn, -1.5, 4.5);
  barn.rotation.y = 0.3;
  g.add(barn);
  ctx.block(-1.5, 4.5, 2.6);
  ctx.interact(-1.5, 2.0, 'the barn door', () => ctx.flash('it smells of hay and old rain'));

  // bales stacked against the barn, and a few loose
  for (let i = 0; i < 6; i++) {
    const b = bale({ seed: 60 + i, r: 0.42 });
    const u = 2.4 + (i % 3) * 0.95, v = 4.0 + Math.floor(i / 3) * 0.9;
    ctx.put(b, u, v);
    if (i > 2) b.position.y += 0.84;
    g.add(b);
    if (i <= 2) ctx.block(u, v, 0.5);
  }

  /* --- the trough --- */
  const trough = new THREE.Group();
  const tMat = cel({ color: PAL.stoneDark, bands: 3, tint: 0x635e8c });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.6), tMat);
  shell.position.y = 0.21;
  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(1.44, 0.46),
    cel({ color: PAL.water, bands: 2, tint: 0x59718f, flat: false, role: 'water' })
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = 0.37;
  trough.add(shell, surf);
  trough.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  ctx.put(trough, 4.5, -2.5);
  g.add(trough);
  ctx.block(4.5, -2.5, 0.8);
  ctx.interact(4.5, -3.4, 'the trough', () => ctx.flash('he drinks for a long time'));

  /* --- ruts: two dark bands worn across the yard --- */
  const rutMat = cel({ color: 0x4f4233, bands: 2, tint: 0x5f5286, transparent: true, opacity: 0.5 });
  const rutGeo = new THREE.PlaneGeometry(0.9, 0.26);
  rutGeo.rotateX(-Math.PI / 2);
  const ruts = new THREE.InstancedMesh(rutGeo, rutMat, 120);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  let k = 0;
  for (const side of [-0.55, 0.55]) {
    for (let i = 0; i < 60; i++) {
      const u = -16 + i * 0.55;
      const v = side + Math.sin(u * 0.15) * 1.2;
      const p = ctx.at(u, v);
      const b = basisAt(p.x, p.z);
      fm.makeBasis(b.east, b.up, b.north);
      q.setFromRotationMatrix(fm);
      m.compose(
        positionAt(p.x, heightAt(p.x, p.z) + 0.012, p.z, new THREE.Vector3()),
        q, new THREE.Vector3(1, 1, 1)
      );
      ruts.setMatrixAt(k++, m);
    }
  }
  ruts.count = k;
  ruts.instanceMatrix.needsUpdate = true;
  ruts.receiveShadow = true;
  ruts.userData.noOutline = true;
  g.add(ruts);

  ctx.scatter(rng, { n: 20, minGap: 1.4, inner: 8 }, (u, v, i) =>
    flowerClump({
      seed: 1600 + i, n: rng.int(3, 7),
      color: rng.pick([PAL.bloomYellow, PAL.bloomWhite]), h: 0.14,
    })
  ).forEach((p) => g.add(p.obj));

  ctx.scatter(rng, { n: 8, minGap: 3, inner: 10 }, (u, v, i) =>
    rock({ seed: 1700 + i, r: rng.range(0.14, 0.3) })
  ).forEach((p) => g.add(p.obj));

  root.add(g);
  return g;
}
