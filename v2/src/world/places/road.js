import * as THREE from 'three';
import { cel, flat } from '../../core/toon.js';
import { PAL } from '../../core/palette.js';
import { signTex } from '../../core/textures.js';
import { rngKit, clamp, lerp, TAU, trs, bake, shadowify } from '../../core/util.js';
import { heightAt } from '../terrain.js';
import { positionAt, basisAt } from '../planet.js';
import { bandEdges, ROAD, TOWN, wrapDelta } from '../plan.js';
import { rock, fenceRun, flowerClump, scatter, log } from '../props.js';

/* ------------------------------------------------------------------ *
 * The road, and the town it leads to.
 *
 * The road is the only place in this world that can kill him, and v1's
 * reasoning about it is worth restating because it is the design:
 *
 *   A road band is unavoidable in x — it runs the full width of the field —
 *   and a car is longer than he can see.  Before the culvert existed, the
 *   test harness died to a car on every single crossing.  **Any hazard that
 *   cannot be dodged in x is not a hazard, it is a wall.**  So the tarmac
 *   gets a hedgehog tunnel at a fixed place, drawn as a mouth on each
 *   verge, and while he is under it he is immune, invisible, and leaves no
 *   prints.
 *
 * The balance is v1's too: strolling over the tarmac costs a hit about five
 * times in six, and the culvert is safe six times in six.  A road you can
 * amble across makes the tunnel pointless.
 * ------------------------------------------------------------------ */

/** Where the tunnel is. Deterministic, so it is learnable. */
export const CULVERT_Z = -2.4;

function car(seed) {
  const rng = rngKit(seed * 7717);
  const g = new THREE.Group();
  /* One parametric maker, as the reference did with its whole motor fleet:
   * six numbers and every car on the road is a different car. */
  const L = rng.range(1.5, 2.3);
  const W = rng.range(0.72, 0.86);
  const H = rng.range(0.44, 0.58);
  const cabF = rng.range(0.18, 0.34);
  const body = rng.pick([0xd8654f, 0x4f7fa8, 0xe0c05c, 0xe6e2d8, 0x5d7a55, 0x8f6aa0]);

  const paint = cel({ color: body, bands: 3, tint: 0x63537f, flat: false });
  const glassM = flat({ color: 0x9fc2cf, transparent: true, opacity: 0.7, cache: false });
  const tyre = cel({ color: 0x2c2a30, bands: 2, tint: 0x4a4058 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), paint);
  hull.position.y = H / 2 + 0.13;
  g.add(hull);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, H * 0.62, L * (0.5 - cabF * 0.4)), paint);
  cab.position.set(0, H + 0.13 + H * 0.28, -L * cabF * 0.5);
  g.add(cab);

  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(L * (0.44 - cabF * 0.3), H * 0.42), glassM);
    win.position.set((W * 0.451) * s, H + 0.13 + H * 0.3, -L * cabF * 0.5);
    win.rotation.y = Math.PI / 2 * s;
    g.add(win);
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.82, H * 0.44), glassM);
  screen.position.set(0, H + 0.13 + H * 0.3, -L * cabF * 0.5 + L * (0.25 - cabF * 0.2));
  screen.rotation.x = -0.28;
  g.add(screen);

  const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(W * 0.46 * sx, 0.14, L * 0.32 * sz);
      g.add(w);
    }
  }

  const lampM = flat({ color: 0xfff2c8, cache: false, role: 'headlamp' });
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.055, 8), lampM);
    lamp.position.set(W * 0.28 * s, H * 0.62, L * 0.5 + 0.005);
    g.add(lamp);
  }
  const tailM = flat({ color: 0x8a2f28, cache: false });
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.CircleGeometry(0.04, 8), tailM);
    t.position.set(W * 0.28 * s, H * 0.62, -L * 0.5 - 0.005);
    t.rotation.y = Math.PI;
    g.add(t);
  }

  shadowify(g);
  g.userData.size = { L, W };
  return g;
}

export function buildRoad(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:road';
  const rng = rngKit(ctx.slot * 907 + 31);
  const [ra, rb] = bandEdges(ROAD);
  const midX = (ra + rb) / 2;

  /* --- the tarmac: a strip following the ground, pole to pole --- */
  const tarMat = cel({ color: PAL.tarmac, bands: 3, tint: 0x5a5580, flat: false });
  {
    const nz = 90, nx = 10;
    const pos = [];
    const idx = [];
    for (let j = 0; j <= nz; j++) {
      const z = -36 + (j / nz) * 72;
      for (let i = 0; i <= nx; i++) {
        const x = lerp(ra, rb, i / nx);
        pos.push(x, heightAt(x, z) + 0.02, z);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tar = new THREE.Mesh(geo, tarMat);
    tar.receiveShadow = true;
    tar.userData.smoothNormals = true;
    tar.name = 'tarmac';
    g.add(tar);
    ctx.pickables.push(tar);
  }

  // centre line: dashes down the middle of the carriageway
  const lineMat = flat({ color: PAL.paint });
  const dashes = [];
  for (let j = -34; j < 34; j += 2.4) {
    dashes.push({
      geometry: new THREE.PlaneGeometry(0.16, 1.2),
      matrix: trs(midX, heightAt(midX, j) + 0.026, j, -Math.PI / 2, 0, Math.PI / 2),
    });
  }
  const line = new THREE.Mesh(bake(dashes), lineMat);
  line.userData.noOutline = true;
  g.add(line);

  /* --- the verges --- */
  for (const [edge, dir] of [[ra, -1], [rb, 1]]) {
    const kerb = [];
    for (let j = -34; j < 34; j += 1.2) {
      kerb.push({
        geometry: new THREE.BoxGeometry(0.16, 0.09, 1.2),
        matrix: trs(edge + 0.08 * dir, heightAt(edge, j) + 0.045, j + 0.6),
      });
    }
    const k = new THREE.Mesh(bake(kerb), cel({ color: PAL.chalk, bands: 3, tint: 0x6a6690 }));
    g.add(shadowify(k));
  }

  /* --- the culvert --- *
   * Two mouths and a dark throat.  He can only enter at a verge and only
   * near the mouth: you cannot wander into it from the middle of the
   * tarmac, which is what stops it being a get-out. */
  const stone = cel({ color: PAL.stoneDark, bands: 3, tint: 0x635e8c, flat: false });
  for (const [edge, dir] of [[ra, -1], [rb, 1]]) {
    const mouth = new THREE.Group();
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12, 1, false, 0, Math.PI),
      stone
    );
    arch.rotation.z = Math.PI / 2;
    arch.rotation.y = Math.PI / 2;
    mouth.add(arch);
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.27, 14, 0, Math.PI),
      flat({ color: 0x1e1926 })
    );
    hole.position.set(0.26 * dir, 0, 0);
    hole.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    mouth.add(hole);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 1.2), stone);
    wing.position.set(-0.02 * dir, 0.08, 0);
    mouth.add(wing);
    mouth.position.set(edge + 0.22 * dir, heightAt(edge, CULVERT_Z) + 0.02, CULVERT_Z);
    g.add(shadowify(mouth));

    // a stone or two, so the mouths read as somewhere rather than as a hole
    for (let i = 0; i < 3; i++) {
      const rx = edge + (0.55 + rng.range(0, 0.5)) * dir;
      const rz = CULVERT_Z + rng.range(-1, 1);
      const r = rock({ seed: 1700 + i + (dir > 0 ? 9 : 0), r: rng.range(0.1, 0.2) });
      r.position.set(rx, heightAt(rx, rz), rz);
      g.add(r);
    }
  }

  ctx.out.culvert = { z: CULVERT_Z, a: ra, b: rb };
  ctx.interactables.push({
    x: ra - 0.3, z: CULVERT_Z, label: 'the tunnel under the road',
    action: () => ctx.flash('it goes right under. safer than the tarmac.'),
  });
  ctx.interactables.push({
    x: rb + 0.3, z: CULVERT_Z, label: 'the tunnel under the road',
    action: () => ctx.flash('it goes right under. safer than the tarmac.'),
  });

  /* --- a signpost, pointing the way round --- */
  const post = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.5, 8), cel({ color: PAL.timber, bands: 3, tint: 0x6b5b86 }));
  pole.position.y = 0.75;
  post.add(pole);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.26, 0.04),
    flat({ map: signTex('the town  →', { w: 256, h: 74, size: 30 }), cache: false })
  );
  board.position.set(0.32, 1.32, 0);
  post.add(board);
  const px = ra - 1.6, pz = 3.2;
  post.position.set(px, heightAt(px, pz), pz);
  post.rotation.y = -0.2;
  g.add(shadowify(post));
  ctx.blockers.push({ x: px, z: pz, r: 0.16 });

  scatter(rng, { x0: ra - 6, x1: ra - 1.4, z0: -12, z1: 12, n: 10, minGap: 1.4 }, (x, z, i) =>
    flowerClump({ seed: 1800 + i, n: rng.int(3, 6), color: rng.pick([PAL.bloomWhite, PAL.bloomYellow]), h: 0.15 })
  ).forEach((p) => g.add(p.obj));

  root.add(g);

  /* ------------------------------ the traffic ----------------------------- */
  ctx.post.push((scene) => {
    const cars = [];
    const LANES = [lerp(ra, rb, 0.27), lerp(ra, rb, 0.73)];
    for (let i = 0; i < 6; i++) {
      const obj = car(i + 1);
      obj.matrixAutoUpdate = false;
      obj.visible = false;
      scene.add(obj);
      cars.push({
        obj,
        size: obj.userData.size,
        lane: i % 2,
        x: LANES[i % 2],
        z: 0,
        dir: i % 2 ? 1 : -1,
        speed: 0,
        wait: rng.range(0.4, 6),
        live: false,
      });
    }
    ctx.out.cars = cars;

    ctx.updaters.push((dt, hog, climate) => {
      for (const c of cars) {
        if (!c.live) {
          c.wait -= dt;
          if (c.wait > 0) continue;
          /* Spawn beyond the fog, never in view, and always from behind the
           * horizon — a car that fades up out of nothing thirty metres away
           * reads as a bug, not as traffic. */
          c.live = true;
          c.z = c.dir > 0 ? -30 : 30;
          c.speed = rng.range(3.4, 5.6);
          c.obj.visible = true;
        }
        c.z += c.dir * c.speed * dt;
        if ((c.dir > 0 && c.z > 30) || (c.dir < 0 && c.z < -30)) {
          c.live = false;
          c.obj.visible = false;
          // v1's traffic gap: 0.7 to 2.3 seconds, which is what makes the
          // tarmac cost a hit five times in six
          c.wait = rng.range(0.7, 2.3);
          continue;
        }
        const y = heightAt(c.x, c.z) + 0.02;
        const b = basisAt(c.x, c.z);
        const mm = new THREE.Matrix4().makeBasis(b.east, b.up, b.north);
        mm.setPosition(positionAt(c.x, y, c.z, new THREE.Vector3()));
        mm.multiply(new THREE.Matrix4().makeRotationY(c.dir > 0 ? 0 : Math.PI));
        c.obj.matrix.copy(mm);
        c.obj.matrixWorldNeedsUpdate = true;
      }
    });
  });

  return g;
}

/** The edge of town: paving, three cottage fronts, a lamp, and a cat. */
export function buildTown(root, ctx) {
  const g = new THREE.Group();
  g.name = 'place:town';
  const rng = rngKit(ctx.slot * 1009 + 37);
  const [ta, tb] = bandEdges(TOWN);

  /* --- paving --- */
  const paveMat = cel({ color: 0x9d9a92, bands: 3, tint: 0x635e8c, flat: false });
  const slabs = [];
  for (let x = ta; x < tb; x += 0.9) {
    for (let z = -14; z < 14; z += 0.9) {
      const jx = x + rng.range(-0.02, 0.02);
      const jz = z + rng.range(-0.02, 0.02);
      slabs.push({
        geometry: new THREE.BoxGeometry(0.84, 0.06, 0.84),
        matrix: trs(jx, heightAt(jx, jz) + 0.02, jz, 0, rng.range(-0.02, 0.02), 0),
      });
    }
  }
  const pave = new THREE.Mesh(bake(slabs), paveMat);
  pave.receiveShadow = true;
  pave.name = 'paving';
  g.add(pave);
  ctx.pickables.push(pave);

  /* --- three fronts, on the far side, facing the walk --- */
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
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.34, 0.09, D * 0.66), tileMat);
      slab.position.set(0, H + 0.4, (D * 0.3) * s);
      slab.rotation.x = s * -0.58;
      house.add(slab);
    }
    for (let w = 0; w < 2; w++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.72), windowMat);
      win.position.set(-W * 0.24 + w * W * 0.48, H * 0.62, D / 2 + 0.012);
      house.add(win);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.04), renderMat);
      frame.position.set(win.position.x, win.position.y, D / 2 - 0.01);
      house.add(frame);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.56, 1.05, 0.06), doorMat);
    door.position.set(W * 0.06, 0.53, D / 2 + 0.01);
    house.add(door);

    const hx = lerp(ta + 2, tb - 2, i / 2);
    const hz = 8.2 + rng.range(-0.4, 0.4);
    house.position.set(hx, heightAt(hx, hz), hz);
    house.rotation.y = Math.PI + rng.range(-0.06, 0.06);
    g.add(shadowify(house));
    ctx.blockers.push({ x: hx, z: hz, hx: W * 0.55, hz: D * 0.6 });
    ctx.interactables.push({
      x: hx, z: hz - 1.6, label: 'a front door',
      action: () => ctx.flash(rng.pick([
        'a radio, somewhere inside',
        'nobody in',
        'something is cooking',
      ])),
    });
  }

  /* --- a low wall along the near side, which he can walk beside --- */
  const wallMat = cel({ color: PAL.stone, bands: 3, tint: 0x6a6690 });
  const bricks = [];
  for (let x = ta + 1; x < tb - 1; x += 0.62) {
    const z = -9;
    bricks.push({
      geometry: new THREE.BoxGeometry(0.6, 0.44, 0.24),
      matrix: trs(x, heightAt(x, z) + 0.22, z, 0, rng.range(-0.03, 0.03), 0),
    });
  }
  const wall = new THREE.Mesh(bake(bricks), wallMat);
  g.add(shadowify(wall));
  ctx.blockers.push({ x: (ta + tb) / 2, z: -9, hx: (tb - ta) / 2, hz: 0.16 });

  /* --- the lamp: the only light in the world that is not the sky --- */
  const lamp = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.6, 8), cel({ color: 0x3d4048, bands: 3, tint: 0x5f5e86 }));
  col.position.y = 1.3;
  lamp.add(col);
  const headM = flat({ color: 0x3a3d44, cache: false });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 8), headM);
  head.position.y = 2.72;
  lamp.add(head);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    flat({ color: 0x6a6858, cache: false, role: 'lamp' })
  );
  bulb.position.y = 2.5;
  lamp.add(bulb);
  const lx = lerp(ta, tb, 0.35), lz = -6.4;
  lamp.position.set(lx, heightAt(lx, lz), lz);
  g.add(shadowify(lamp));
  ctx.blockers.push({ x: lx, z: lz, r: 0.14 });

  const glow = new THREE.PointLight(0xffd08a, 0, 6, 2);
  glow.position.copy(positionAt(lx, heightAt(lx, lz) + 2.5, lz, new THREE.Vector3()));
  ctx.out.lampLight = glow;
  root.add(glow);

  /* --- the cat.  Every place like this has one, and it is always asleep. --- */
  const cat = new THREE.Group();
  const furMat = cel({ color: 0x4a4550, bands: 3, tint: 0x5f5286, flat: false });
  const cbody = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), furMat);
  cbody.scale.set(1.5, 0.72, 0.9);
  cbody.position.y = 0.12;
  cat.add(cbody);
  const chead = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 9), furMat);
  chead.position.set(0.2, 0.18, 0);
  cat.add(chead);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), furMat);
    ear.position.set(0.2, 0.26, 0.045 * s);
    cat.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 5, 14, Math.PI * 1.4), furMat);
  tail.position.set(-0.24, 0.1, 0.02);
  tail.rotation.set(Math.PI / 2, 0, 0.4);
  cat.add(tail);
  const catX = lerp(ta, tb, 0.62), catZ = -8.6;
  cat.position.set(catX, heightAt(catX, catZ) + 0.44, catZ);
  cat.rotation.y = 2.1;
  g.add(shadowify(cat));
  ctx.interactables.push({
    x: catX, z: catZ + 0.9, label: 'the cat on the wall',
    action: () => ctx.flash('one ear turns. that is all you get.'),
  });
  ctx.out.cat = cat;

  root.add(g);
  return g;
}
