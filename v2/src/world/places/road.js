import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { signTex } from '../../core/textures.js';
import { rngKit, lerp } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { positionAt, basisAt } from '../planet.js';
import { CIRC, ROAD_HALF, roadPoint, bearing } from '../plan.js';
import { rock, flowerClump } from '../props.js';

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
   * flat box and then bent comes out squashed. */
  const ALONG = 220, ACROSS = 8;
  {
    const pos = [];
    const idx = [];
    const at = { x: 0, z: 0 };
    for (let i = 0; i <= ALONG; i++) {
      const s = (i / ALONG) * CIRC;
      for (let j = 0; j <= ACROSS; j++) {
        const t = lerp(-ROAD_HALF, ROAD_HALF, j / ACROSS);
        roadPoint(s, t, at);
        pos.push(at.x, heightAt(at.x, at.z) + 0.02, at.z);
      }
    }
    for (let i = 0; i < ALONG; i++) {
      for (let j = 0; j < ACROSS; j++) {
        const a = i * (ACROSS + 1) + j, b = a + 1;
        const c = a + ACROSS + 1, d = c + 1;
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

  /* --- centre line and kerbs, instanced so each piece sits on its own --- */
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const seat = (im, i, x, z, lift, yaw) => {
    const b = basisAt(x, z);
    fm.makeBasis(b.east, b.up, b.north);
    q.setFromRotationMatrix(fm);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    m.compose(positionAt(x, heightAt(x, z) + lift, z, new THREE.Vector3()), q, one);
    im.setMatrixAt(i, m);
  };

  const lineGeo = new THREE.PlaneGeometry(1.2, 0.16);
  lineGeo.rotateX(-Math.PI / 2);
  const lines = new THREE.InstancedMesh(lineGeo, flat({ color: PAL.paint }), 140);
  const kerbs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 0.09, 0.16),
    cel({ color: PAL.chalk, bands: 3, tint: 0x6a6690 }), 520
  );
  let nl = 0, nk = 0;
  for (let s = 0; s < CIRC && nl < 140; s += 2.4) {
    const p = roadPoint(s, 0);
    const ahead = roadPoint(s + 0.5, 0);
    seat(lines, nl++, p.x, p.z, 0.028, -bearing(p.x, p.z, ahead.x, ahead.z).angle);
  }
  for (let s = 0; s < CIRC && nk < 519; s += 1.2) {
    for (const side of [-1, 1]) {
      const p = roadPoint(s, side * (ROAD_HALF + 0.08));
      const ahead = roadPoint(s + 0.5, side * (ROAD_HALF + 0.08));
      seat(kerbs, nk++, p.x, p.z, 0.045, -bearing(p.x, p.z, ahead.x, ahead.z).angle);
    }
  }
  lines.count = nl;
  kerbs.count = nk;
  lines.instanceMatrix.needsUpdate = true;
  kerbs.instanceMatrix.needsUpdate = true;
  lines.userData.noOutline = true;
  kerbs.castShadow = true;
  kerbs.receiveShadow = true;
  g.add(lines, kerbs);

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

    const p = roadPoint(CULVERT_ALONG, side * (ROAD_HALF + 0.22));
    const ahead = roadPoint(CULVERT_ALONG + 0.5, side * (ROAD_HALF + 0.22));
    mouth.position.set(p.x, heightAt(p.x, p.z) + 0.02, p.z);
    mouth.rotation.y = -bearing(p.x, p.z, ahead.x, ahead.z).angle;
    mouth.userData.planetRigid = true;
    g.add(mouth);
    mouths.push({ x: p.x, z: p.z, side });

    ctx.interactables.push({
      x: p.x, z: p.z, label: 'the tunnel under the road',
      action: () => ctx.flash('it goes right under. safer than the tarmac.'),
    });
    for (let i = 0; i < 3; i++) {
      const rp = roadPoint(
        CULVERT_ALONG + rng.range(-1.4, 1.4),
        side * (ROAD_HALF + rng.range(0.7, 1.6))
      );
      const r = rock({ seed: 1700 + i + (side > 0 ? 9 : 0), r: rng.range(0.1, 0.2) });
      r.position.set(rp.x, heightAt(rp.x, rp.z), rp.z);
      r.userData.planetRigid = true;
      g.add(r);
    }
  }
  ctx.out.culvert = { along: CULVERT_ALONG, half: ROAD_HALF, mouths };

  /* --- a signpost --- */
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
  ctx.put(post, 2.5, -(ROAD_HALF + 2.4));
  post.rotation.y = -0.2;
  g.add(post);
  ctx.block(2.5, -(ROAD_HALF + 2.4), 0.2);

  ctx.scatter(rng, { n: 26, minGap: 1.5 }, (u, v, i) =>
    flowerClump({
      seed: 1800 + i, n: rng.int(3, 6),
      color: rng.pick([PAL.bloomWhite, PAL.bloomYellow]), h: 0.15,
    })
  ).forEach((p) => g.add(p.obj));

  root.add(g);

  /* ------------------------------ the traffic ----------------------------- */
  ctx.post.push((scene) => {
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
        speed: 0, wait: rng.range(0.4, 6), live: false, x: 0, z: 0,
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
          c.speed = rng.range(3.4, 5.6);
          /* Wandering within the lane, because pinned to a centreline two
           * 1.7 m cars sweep 3.4 m of a 9.6 m carriageway and the rest is a
           * safe corridor you can stroll up. */
          c.across = LANES[c.lane] + rng.range(-0.85, 0.85);
          c.obj.visible = true;
        }
        c.along += c.dir * c.speed * dt;
        if (Math.abs(c.along - CULVERT_ALONG) > 36) {
          c.live = false;
          c.obj.visible = false;
          // v1's traffic gap, which is what makes the open tarmac cost a heart
          c.wait = rng.range(0.5, 1.6);
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

/** The edge of town: paving, three cottages, a low wall, a lamp, and a cat. */
export function buildTown(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:town';
  const rng = rngKit(1009);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const fm = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const seat = (im, i, u, v, lift, yaw) => {
    const p = ctx.at(u, v);
    const b = basisAt(p.x, p.z);
    fm.makeBasis(b.east, b.up, b.north);
    q.setFromRotationMatrix(fm);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    m.compose(positionAt(p.x, heightAt(p.x, p.z) + lift, p.z, new THREE.Vector3()), q, one);
    im.setMatrixAt(i, m);
    return p;
  };

  /* --- paving, instanced so every slab stands on its own patch of ground --- */
  const slots = [];
  for (let u = -10; u <= 10; u += 0.9) {
    for (let v = -10; v <= 10; v += 0.9) {
      if (Math.hypot(u, v) > 10) continue;
      slots.push([u, v]);
    }
  }
  const pave = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.84, 0.06, 0.84),
    cel({ color: 0x9d9a92, bands: 3, tint: 0x635e8c, flat: false }),
    slots.length
  );
  slots.forEach(([u, v], i) => {
    seat(pave, i, u + rng.range(-0.02, 0.02), v + rng.range(-0.02, 0.02), 0.02, rng.range(-0.03, 0.03));
  });
  pave.instanceMatrix.needsUpdate = true;
  pave.receiveShadow = true;
  pave.name = 'paving';
  g.add(pave);

  /* --- three fronts, in an arc round the far side --- */
  const renderMat = cel({ color: PAL.render, bands: 3, tint: 0x6b6392, flat: false });
  const tileMat = cel({ color: PAL.tile, bands: 3, tint: 0x6b5b86 });
  const windowMat = flat({ color: 0x2b2130, cache: false, role: 'window' });
  const doorMat = cel({ color: 0x5b7a6a, bands: 3, tint: 0x6b5b86 });

  for (let i = 0; i < 3; i++) {
    const house = new THREE.Group();
    const W = rng.range(2.6, 3.6), H = rng.range(2.2, 3.0), D = 2.4;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), renderMat);
    wall.position.y = H / 2;
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
    house.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const a = -0.9 + i * 0.9;
    const u = Math.cos(a) * 8.5, v = Math.sin(a) * 8.5;
    ctx.put(house, u, v);
    house.rotation.y = -a + Math.PI;
    g.add(house);
    ctx.block(u, v, 1.9);
    ctx.interact(u * 0.72, v * 0.72, 'a front door', () => ctx.flash(rng.pick([
      'a radio, somewhere inside', 'nobody in', 'something is cooking',
    ])));
  }

  /* --- a low wall along the near side --- */
  const bricks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.6, 0.44, 0.24),
    cel({ color: PAL.stone, bands: 3, tint: 0x6a6690 }), 40
  );
  for (let i = 0; i < 40; i++) {
    const a = 1.6 + (i / 40) * 1.9;
    const u = Math.cos(a) * 8, v = Math.sin(a) * 8;
    seat(bricks, i, u, v, 0.22, -a + Math.PI / 2);
    if (i % 3 === 0) ctx.block(u, v, 0.4);
  }
  bricks.instanceMatrix.needsUpdate = true;
  bricks.castShadow = true;
  bricks.receiveShadow = true;
  g.add(bricks);

  /* --- the lamp: the only light in the world that is not the sky --- */
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
  const lp = ctx.put(lamp, -3.5, -3.5);
  g.add(lamp);
  ctx.block(-3.5, -3.5, 0.2);
  const glow = new THREE.PointLight(0xffd08a, 0, 7, 2);
  glow.position.copy(positionAt(lp.x, heightAt(lp.x, lp.z) + 2.5, lp.z, new THREE.Vector3()));
  ctx.out.lampLight = glow;
  root.add(glow);

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
  const cu = Math.cos(2.4) * 8, cv = Math.sin(2.4) * 8;
  ctx.put(cat, cu, cv);
  cat.position.y += 0.44;      // asleep on the wall
  cat.rotation.y = 2.1;
  g.add(cat);
  ctx.interact(cu * 0.86, cv * 0.86, 'the cat on the wall', ctx.lines(
    'one ear turns. that is all you get.',
    'the tail-tip counts him past: one (1) hedgehog',
    'a slow blink. in cat, that is a kindness.'
  ));
  ctx.out.cat = cat;

  /* The line above is now literally true: a hedgehog underneath is worth
   * one ear and a livelier tail, and precisely nothing else — a sleeping
   * cat's whole opinion of the world.  The cat is seated rigidly, but its
   * PARTS still animate locally under the seat. */
  {
    const catAt = ctx.at(cu, cv);
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
