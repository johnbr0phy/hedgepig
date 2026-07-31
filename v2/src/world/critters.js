import * as THREE from 'three';
import { flat, cel } from '../core/toon.js';
import { petalTex, wingTex, blobTex } from '../core/textures.js';
import { clamp, lerp, rngKit, TAU, wrapAng, damp } from '../core/util.js';
import { positionAt, basisAt } from './planet.js';
import { heightAt, waterDepthAt, lakeShore } from './terrain.js';
import { CENTRE, BGARD, WOOD, LAKE, LAKE_R, MIRE, HENS, TOWN, FARM, MEADOW, distance, bearing, offsetFrom, placeProp, hardAt, towards, R } from './plan.js';

/* ------------------------------------------------------------------ *
 * The things that fly, with wings this time.
 *
 * `weather.js` has named butterflies and bees since the first build and
 * they were only ever motes — points in the camera's box, which is what
 * rain wants and exactly what an *animal* does not: a mote cannot land on
 * anything, cannot flee from anything, and does not care where the garden
 * is.  These live in the world's own flat coordinates, like him.
 *
 * The rules, all v1's:
 *
 *  - **Everything ranges off him.**  A butterfly flees the hedgehog, not
 *    the camera.
 *  - **Anchored, not free.**  A critter with no anchor drifts off the
 *    playable band within a minute.
 *  - **The clock owns them.**  They fly in daylight, in the warm seasons,
 *    and not in the rain; winter grounds every one of them.  Nothing here
 *    checks the *place* to decide the weather — season and hour only.
 *
 * **And they stream.**  The first build read "anchored" as *anchored to the
 * butterfly garden*, and put seven butterflies and five bees within a few
 * metres of one place out of ten — on a planet where a lap is three hundred
 * metres and the horizon is eleven.  Nobody ever saw one.  Standing in the
 * garden itself at summer noon you got seven insects with 26 mm wings spread
 * over sixteen square metres, which is a handful of pixels each.
 *
 * The pool re-homes near *him* now, on ground that suits — the same idea as
 * the grass chunks, and off him rather than off the camera, so the invariant
 * holds.  A butterfly still belongs somewhere; it is just that "somewhere" is
 * anywhere with flowers in it rather than one disc.
 * ------------------------------------------------------------------ */

const BFLY_N = 22;
const BEE_N = 16;

/**
 * How much this ground is butterfly country: grassy, soft, not tarmac and not
 * water.  `dens` is the place's own grass density, which is already exactly
 * the right discriminator — meadow 1.25 and garden 1.15 against town 0.38.
 */
function meadowlyAt(x, z) {
  if (waterDepthAt(x, z) > 0) return 0;
  const hard = hardAt(x, z);
  if (hard > 0.35) return 0;
  return clamp(placeProp(x, z, 'dens') * (1 - hard), 0, 1.3) / 1.3;
}

export function createCritters(scene, hooks = {}) {
  const rng = rngKit(4104);
  const root = new THREE.Group();
  root.name = 'critters';
  scene.add(root);

  const _m = new THREE.Matrix4();
  const _b = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _r = new THREE.Matrix4();

  /** Seat a critter at flat (x, y, z) facing `yaw`, scaled by `s`. */
  function seat(obj, x, y, z, yaw, s = 1) {
    const b = basisAt(x, z);
    _b.makeBasis(b.east, b.up, b.north);
    _b.setPosition(positionAt(x, y, z, _p));
    _r.makeRotationY(-yaw);
    _b.multiply(_r);
    if (s !== 1) {
      _r.makeScale(s, s, s);
      _b.multiply(_r);
    }
    obj.matrix.copy(_b);
    obj.matrixWorldNeedsUpdate = true;
  }

  /* ------------------------------ butterflies ------------------------------ */
  /* Three of the seven used to be near-white, which against this world's pale
   * horizon is an invisible butterfly.  One white is charming; three is a
   * third of the population you cannot see. */
  const BFLY_COLORS = [0xf0a03c, 0xf5d24c, 0x7f9fe0, 0xe07ab8, 0xf5f2e6, 0xd05a44, 0xa8d060];
  const bflies = [];
  for (let i = 0; i < BFLY_N; i++) {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    /* Petal-shaped wings, not quads: a bare plane seen edge-on is a
     * rectangle, and the ink pass dutifully boxes it — a butterfly with
     * drafting lines round her wings.  The petal texture rounds the
     * silhouette and the ink follows that instead. */
    const mat = flat({
      color: BFLY_COLORS[i % BFLY_COLORS.length], map: wingTex(),
      alphaTest: 0.4, side: THREE.DoubleSide, cache: false,
    });
    const wings = [];
    for (const s of [-1, 1]) {
      /* 23 mm a side, so 46 mm across — a small white is about 45 mm, so
       * this is honest rather than generous, and the old pair were under half
       * life size on an animal already the size of your thumbnail.
       *
       * Built lying flat and hinged **at the body**, so the flap is one
       * rotation about the fore-aft axis and looks like a butterfly rather
       * than like two planes disagreeing. */
      const wg = new THREE.PlaneGeometry(0.023, 0.040);
      wg.rotateX(-Math.PI / 2);             // into the ground plane
      if (s < 0) wg.scale(-1, 1, 1);        // mirrored, so both tips lead
      wg.translate(0.0115 * s, 0, 0);       // inner edge on the body line
      const w = new THREE.Mesh(wg, mat);
      w.userData.side = s;
      w.userData.noOutline = true;
      g.add(w);
      wings.push(w);
    }
    const home = offsetFrom(CENTRE[BGARD], rng.range(-8, 8), rng.range(-8, 8));
    const b = {
      obj: g, wings,
      x: home.x, z: home.z, y: 0.4,
      hd: rng.range(0, TAU),
      home, flee: 0,
      wobble: rng.range(0, TAU),
      flap: rng.range(4, 6),
      /* Her own tolerance for a poor day.  Without it every butterfly shares
       * one threshold and the whole species blinks on and off together — a
       * shower took every insect off the planet at the same instant. */
      hardy: rng.range(0.14, 0.66),
      out: 0,                                // eased presence, 0 hidden – 1 flying
    };
    root.add(g);
    bflies.push(b);
  }

  /* --------------------------------- bees --------------------------------- */
  const bees = [];
  {
    const body = cel({ color: 0xe8c25c, bands: 2, tint: 0x6a5a3a, flat: true, cache: false });
    for (let i = 0; i < BEE_N; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const bl = new THREE.Mesh(new THREE.SphereGeometry(0.011, 7, 5), body);
      bl.scale.set(1.45, 1, 1);
      const wingMat = flat({ color: 0xdfe8f0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, cache: false });
      wingMat.depthWrite = false;           // a blur, not a pane of glass
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.020, 0.011), wingMat);
      wing.position.y = 0.009;
      wing.rotation.x = -Math.PI / 2;
      bl.userData.noOutline = wing.userData.noOutline = true;
      g.add(bl, wing);
      const b = {
        obj: g, wing,
        anchor: offsetFrom(CENTRE[BGARD], rng.range(-6, 6), rng.range(-6, 6)),
        ang: rng.range(0, TAU),
        rad: rng.range(0.2, 0.5),
        speed: rng.range(1.6, 2.6),
        bob: rng.range(0, TAU),
        hardy: rng.range(0.12, 0.60),
        out: 0,
      };
      root.add(g);
      bees.push(b);
    }
  }

  /* --------------------------------- birds --------------------------------- */
  const birds = [];
  {
    const dark = flat({ color: 0x4a4458, side: THREE.DoubleSide, cache: false });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const bodyG = new THREE.ConeGeometry(0.02, 0.09, 5);
      bodyG.rotateZ(-Math.PI / 2);          // nose along +x
      const bd = new THREE.Mesh(bodyG, dark);
      const wings = [];
      for (const s of [-1, 1]) {
        const wgeo = new THREE.PlaneGeometry(0.10, 0.035);
        wgeo.translate(0.05, 0, 0);
        const w = new THREE.Mesh(wgeo, dark);
        w.rotation.x = -Math.PI / 2;
        w.rotation.y = s > 0 ? 0 : Math.PI;
        w.position.z = 0;
        w.userData.side = s;
        g.add(w);
        wings.push(w);
      }
      bd.userData.noOutline = true;
      g.add(bd);
      g.visible = false;
      root.add(g);
      birds.push({ obj: g, wings, live: false, x: 0, z: 0, y: 5, hd: 0, t: 0 });
    }
  }
  let birdWait = 6;

  /* ------------------------------ water rings ------------------------------ *
   * A shared pool, spent by frogs going in and fish coming up. */
  const rings = [];
  {
    const mat = flat({ color: 0xe4f0f2, transparent: true, opacity: 0, side: THREE.DoubleSide, cache: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 30).rotateX(-Math.PI / 2), mat.clone());
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.renderOrder = 4;
      m.userData.noOutline = true;
      root.add(m);
      rings.push({ obj: m, t: 0, x: 0, z: 0, y: 0 });
    }
  }
  function splash(x, z) {
    const r = rings.find((r) => r.t <= 0);
    if (!r) return;
    r.t = 0.9;
    r.x = x; r.z = z;
    r.y = heightAt(x, z) + waterDepthAt(x, z) + 0.01;
  }

  /* --------------------------------- frogs --------------------------------- */
  const frogs = [];
  {
    const green = cel({ color: 0x7da84f, bands: 2, tint: 0x4e6a52, flat: false, cache: false });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), green);
      body.scale.set(1.25, 0.85, 1);
      body.position.y = 0.022;
      const eyeMat = flat({ color: 0x2b2130, cache: false });
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 5), eyeMat);
        e.position.set(0.024, 0.042, 0.012 * s);
        g.add(e);
      }
      g.add(body);
      root.add(g);
      const ang = rng.range(0, TAU);
      frogs.push({ obj: g, ang, sit: null, hop: 0, wait: 0, from: null, to: null });
    }
  }
  /** Where a frog sits: just up the bank from the waterline at its angle. */
  function frogSeat(f) {
    const sh = lakeShore(f.ang);
    const c = CENTRE[LAKE];
    const d = sh.d + 0.35;
    const out = offsetFrom(c, Math.cos(f.ang) * d, Math.sin(f.ang) * d);
    f.sit = { x: out.x, z: out.z };
    const inWater = offsetFrom(c, Math.cos(f.ang) * (sh.d - 0.9), Math.sin(f.ang) * (sh.d - 0.9));
    f.to = { x: inWater.x, z: inWater.z };
  }

  /* ---------------------------------- owl ---------------------------------- */
  const owl = { hootIn: 9, blink: 0, blinkIn: 4 };
  {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const glow = new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
    });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), glow);
      e.position.z = 0.042 * s;
      g.add(e);
    }
    root.add(g);
    owl.obj = g;
    const at = offsetFrom(CENTRE[WOOD], 1.8, -2.3);
    owl.x = at.x; owl.z = at.z;
    // below the canopy line, where two lit points read as something IN the tree
    owl.y = heightAt(at.x, at.z) + 1.45;
  }

  let fishWait = 8;

  /* -------------------------------- squirrel ------------------------------- *
   * On the ground at the foot of a wood tree until he gets close, then a
   * spiral straight up the trunk and gone into the canopy. */
  const squirrel = { wait: 0, climb: -1 };
  {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const fur = cel({ color: 0x8a5a38, bands: 2, tint: 0x6a4e6e, flat: false, cache: false });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.030, 9, 7), fur);
    body.scale.set(1.2, 1, 0.85);
    body.position.y = 0.028;
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), fur);
    tail.scale.set(0.6, 1.5, 0.6);
    tail.position.set(-0.038, 0.05, 0);
    tail.rotation.z = 0.5;
    g.add(body, tail);
    root.add(g);
    squirrel.obj = g;
    const at = offsetFrom(CENTRE[WOOD], -2.1, 2.6);
    squirrel.x = at.x; squirrel.z = at.z;
  }

  /* ---------------------------------- mice --------------------------------- */
  const mice = [];
  {
    const grey = cel({ color: 0x9a8f88, bands: 2, tint: 0x6a5e72, flat: false, cache: false });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), grey);
      body.scale.set(1.5, 0.9, 1);
      body.position.y = 0.013;
      g.add(body);
      g.visible = false;
      root.add(g);
      const at = offsetFrom(CENTRE[HENS], rng.range(-3, 3), rng.range(-3, 3));
      mice.push({ obj: g, x: at.x, z: at.z, hd: 0, dash: 0, cool: rng.range(0, 4) });
    }
  }

  /* ------------------------------- dragonflies ----------------------------- */
  const dflies = [];
  {
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0028, 0.0018, 0.042, 5).rotateZ(Math.PI / 2),
        cel({ color: 0x58b8c8, bands: 2, tint: 0x4a6a8e, flat: true, cache: false })
      );
      const wmat = flat({ color: 0xe8f2f6, transparent: true, opacity: 0.4, side: THREE.DoubleSide, cache: false });
      wmat.depthWrite = false;
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.008), wmat);
        w.rotation.x = -Math.PI / 2;
        w.position.set(0.004, 0.004, 0.012 * s);
        g.add(w);
      }
      g.add(body);
      root.add(g);
      const at = offsetFrom(CENTRE[MIRE], rng.range(-4, 4), rng.range(-4, 4));
      dflies.push({
        obj: g, x: at.x, z: at.z, tx: at.x, tz: at.z,
        dart: 0, wait: rng.range(1, 3), bob: rng.range(0, TAU), out: 0,
      });
    }
  }

  /* --------------------------------- snails -------------------------------- */
  const snails = [];
  {
    const shellMat = cel({ color: 0x9a7a52, bands: 2, tint: 0x6a5a72, flat: false, cache: false });
    const bodyMat = cel({ color: 0xb8a888, bands: 2, tint: 0x7a6a82, flat: false, cache: false });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.014, 9, 7), shellMat);
      shell.position.set(-0.004, 0.014, 0);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), bodyMat);
      foot.scale.set(2.2, 0.5, 0.8);
      foot.position.y = 0.004;
      g.add(shell, foot);
      g.visible = false;
      root.add(g);
      const at = offsetFrom(CENTRE[BGARD], rng.range(-5, 5), rng.range(-5, 5));
      snails.push({ obj: g, x: at.x, z: at.z, hd: rng.range(0, TAU), damp: 0 });
    }
  }

  /* ---------------------------------- moths -------------------------------- *
   * The butterflies' night shift, round the town lamp. */
  const moths = [];
  {
    const mat = flat({ color: 0xd8d2c2, map: petalTex(), alphaTest: 0.4, side: THREE.DoubleSide, cache: false });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const wings = [];
      for (const s of [-1, 1]) {
        const wg = new THREE.PlaneGeometry(0.018, 0.022);
        wg.translate(0, 0.011, 0);
        const w = new THREE.Mesh(wg, mat);
        w.rotation.x = -Math.PI / 2;
        w.userData.side = s;
        g.add(w);
        wings.push(w);
      }
      root.add(g);
      const lamp = offsetFrom(CENTRE[TOWN], 1.5, -1);
      moths.push({
        obj: g, wings, cx: lamp.x, cz: lamp.z,
        ang: rng.range(0, TAU), rad: rng.range(0.15, 0.4),
        h: rng.range(0.6, 1.1), spd: rng.range(1.8, 3.2), out: 0,
      });
    }
  }

  /* ---------------------------------- ducks -------------------------------- */
  const ducks = [];
  {
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const drake = i === 0;
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 10, 8),
        cel({ color: drake ? 0x8a7a5c : 0x9a8468, bands: 2, tint: 0x6a5e7e, flat: false, cache: false })
      );
      body.scale.set(1.5, 0.8, 1);
      body.position.y = 0.03;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.026, 9, 7),
        cel({ color: drake ? 0x3a7a52 : 0x8a7458, bands: 2, tint: 0x4e5a7e, flat: false, cache: false })
      );
      head.position.set(0.07, 0.085, 0);
      const bill = new THREE.Mesh(
        new THREE.ConeGeometry(0.011, 0.028, 5).rotateZ(-Math.PI / 2),
        cel({ color: 0xd8a04a, bands: 2, tint: 0x7a6a5e, flat: true, cache: false })
      );
      bill.position.set(0.098, 0.08, 0);
      // an inner group, so the dabble can tip the whole duck nose-first
      const inner = new THREE.Group();
      inner.add(body, head, bill);
      g.add(inner);
      root.add(g);
      ducks.push({
        obj: g, inner, ang: rng.range(0, TAU), rad: rng.range(3.5, 6.5),
        spd: rng.range(0.04, 0.07) * rng.sign(), bob: rng.range(0, TAU),
        dabble: 0, dabbleIn: rng.range(4, 9), wake: rng.range(2, 4),
      });
    }
  }

  /* ------------------------------ the spiderweb ----------------------------- *
   * Strung between two hen-run posts, with dew that catches the dawn. */
  const web = { dew: null };
  {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(235,240,245,0.55)';
    x.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      x.beginPath();
      x.moveTo(64, 64);
      x.lineTo(64 + Math.cos((i / 10) * TAU) * 62, 64 + Math.sin((i / 10) * TAU) * 62);
      x.stroke();
    }
    for (let r = 10; r < 62; r += 9) {
      x.beginPath();
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * TAU;
        const rr = r * (1 + 0.03 * Math.sin(a * 5));
        x[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
      }
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    m.matrixAutoUpdate = false;
    m.userData.noOutline = true;
    m.renderOrder = 3;
    root.add(m);
    // between two posts on the hen-run ring (radius 6.5, TAU/26 apart)
    const a0 = 0.06, a1 = 0.06 + TAU / 26;
    const mid = (a0 + a1) / 2;
    const at = offsetFrom(CENTRE[HENS], Math.cos(mid) * 6.5, Math.sin(mid) * 6.5);
    seat(m, at.x, heightAt(at.x, at.z) + 0.48, at.z, -(mid + Math.PI / 2), 1);
    web.obj = m;

    const dewGeo = new THREE.BufferGeometry();
    const dp = new Float32Array(8 * 3);
    const wrng = rngKit(881);
    for (let i = 0; i < 8; i++) {
      const a = wrng.range(0, TAU), r = wrng.range(0.04, 0.24);
      dp[i * 3] = Math.cos(a) * r; dp[i * 3 + 1] = Math.sin(a) * r; dp[i * 3 + 2] = 0.002;
    }
    dewGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    const dew = new THREE.Points(dewGeo, new THREE.PointsMaterial({
      size: 0.012, color: 0xfff8e0, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    m.add(dew);
    web.dew = dew;
  }

  /* -------------------------------- swallows ------------------------------- */
  const swallows = [];
  {
    const dark = flat({ color: 0x3a3648, side: THREE.DoubleSide, cache: false });
    const barnAt = offsetFrom(CENTRE[FARM], -1.5, 4.5);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const bodyG = new THREE.ConeGeometry(0.013, 0.06, 5).rotateZ(-Math.PI / 2);
      const bd = new THREE.Mesh(bodyG, dark);
      const wings = [];
      for (const s of [-1, 1]) {
        const wgeo = new THREE.PlaneGeometry(0.07, 0.022);
        wgeo.translate(0.035, 0, 0);
        const w = new THREE.Mesh(wgeo, dark);
        w.rotation.x = -Math.PI / 2;
        w.rotation.y = s > 0 ? 0 : Math.PI;
        w.userData.side = s;
        g.add(w);
        wings.push(w);
      }
      g.add(bd);
      root.add(g);
      swallows.push({
        obj: g, wings, cx: barnAt.x, cz: barnAt.z,
        ph: (i / 3) * TAU, out: 0,
      });
    }
  }

  /* -------------------------------- molehills ------------------------------ *
   * They appear over time — the meadow has residents with their own works. */
  const molehills = [];
  {
    const dirt = cel({ color: 0x5a4a3c, bands: 2, tint: 0x4e4258, flat: true, cache: false });
    const pink = cel({ color: 0xd8a090, bands: 2, tint: 0x8a6a7a, flat: false, cache: false });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const mound = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.055, 9), dirt);
      mound.position.y = 0.02;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 7, 6), pink);
      nose.position.y = 0.01;
      nose.visible = false;
      g.add(mound, nose);
      g.visible = false;
      root.add(g);
      const at = offsetFrom(CENTRE[MEADOW], rng.range(-8, 8), rng.range(-8, 8));
      molehills.push({ obj: g, nose, x: at.x, z: at.z, at: (i + 1) * 200, poke: 0, pokeIn: rng.range(20, 60) });
    }
  }
  let lived = 0;

  /* ------------------------------- ground fog ------------------------------ *
   * Low over the mire at dawn, gone by mid-morning. */
  const fogs = [];
  {
    const mat = flat({ color: 0xdfe6ea, map: blobTex(), transparent: true, opacity: 0, depthWrite: false, cache: false });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.4).rotateX(-Math.PI / 2), mat.clone());
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.renderOrder = 6;
      m.userData.noOutline = true;
      root.add(m);
      const at = offsetFrom(CENTRE[MIRE], rng.range(-5, 5), rng.range(-4, 4));
      fogs.push({ obj: m, x: at.x, z: at.z, ph: rng.range(0, TAU) });
    }
  }

  /* -------------------------------- puddles -------------------------------- */
  const puddles = [];
  {
    const mat = flat({ color: 0x9fb4c4, transparent: true, opacity: 0.5, depthWrite: false, cache: false });
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.35, 18).rotateX(-Math.PI / 2), mat.clone());
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.renderOrder = 2;
      m.userData.noOutline = true;
      root.add(m);
      puddles.push({ obj: m, t: 0 });
    }
  }
  let prevWet = 0;

  /* --------------------------------- update -------------------------------- */

  /**
   * Find somewhere near him for a critter to belong, or null if here will not
   * do at all — a road, a lake, a town.  Ranged off *him*, never the camera:
   * that is the invariant, and the streaming does not get to bend it.
   *
   * Eight tries and then give up. A critter that cannot be placed simply
   * stays where it is and stays hidden, which is right: there are no
   * butterflies over tarmac.
   */
  function nearbySpot(hog, near, far) {
    for (let i = 0; i < 8; i++) {
      const a = rng.range(0, TAU);
      const d = near + Math.sqrt(rng.next()) * (far - near);
      const cs = Math.max(0.08, Math.cos(hog.z / R));
      const x = hog.x + (Math.cos(a) * d) / cs;
      const z = hog.z + Math.sin(a) * d;
      if (meadowlyAt(x, z) > 0.45) return { x, z };
    }
    return null;
  }

  function update(dt, hog, state) {
    /* Whether anything should be on the wing at all: day, warm, dry.
     *
     * **A ramp, not a cliff.**  This was a hard `flying > 0.25` test against
     * a product of four factors, so a passing shower or the first week of
     * autumn took every insect off the planet at once.  Autumn counts for
     * something now, and rain thins them rather than ending them. */
    const season = state.w
      ? state.w[1] + state.w[0] * 0.85 + state.w[2] * 0.45
      : 1;
    const flying = clamp(season, 0, 1)
      * (1 - clamp(state.night * 1.15, 0, 1))
      * (1 - clamp(state.wet * 0.8, 0, 0.85))
      * (1 - state.snow);

    for (const b of bflies) {
      /* **Streaming.**  Re-home a butterfly that is nowhere near him — but
       * only while it is invisible, or it teleports in front of you.  This is
       * what makes them exist at all: seven of them pinned to one 16 m square
       * on a 300 m lap meant nobody had ever seen one. */
      if (b.out < 0.03 && distance(hog.x, hog.z, b.x, b.z) > 13) {
        const spot = nearbySpot(hog, 2.5, 11);
        if (spot) {
          b.home = spot;
          b.x = spot.x; b.z = spot.z;
          b.hd = rng.range(0, TAU);
        }
      }
      /* **Culled by distance off him**, exactly as the grass chunks are — and
       * this is what makes the re-homing above ever run.  Without it a
       * butterfly on a fine summer day never fades, so it never qualifies to
       * be moved, so it stays where it was built for the whole game: the pool
       * streamed in principle and never once in practice.
       *
       * 14 m is past the horizon anyway.  From a camera 1.2 m up on a 47.75 m
       * planet you can see 11. */
      const away = distance(hog.x, hog.z, b.x, b.z);
      const here = meadowlyAt(b.x, b.z);
      const up = flying > b.hardy && here > 0.3 && away < 14;
      b.out = damp(b.out, up ? Math.min(1, flying * 1.6) : 0, 1.5, dt);
      b.obj.visible = b.out > 0.02;
      if (!b.obj.visible) continue;

      const toHog = distance(hog.x, hog.z, b.x, b.z);
      if (toHog < 0.75 && b.flee <= 0) b.flee = 1.4;
      if (b.flee > 0) b.flee -= dt;

      /* Wandering: a slow heading wobble, straight home if too far out, and
       * hard away from the hedgehog while fleeing. */
      let want = b.hd + Math.sin(state ? (b.wobble += dt * 1.7) : 0) * 0.9 * dt * 30;
      const fromHome = distance(b.home.x, b.home.z, b.x, b.z);
      if (fromHome > 7) want = bearing(b.x, b.z, b.home.x, b.home.z).angle;
      if (b.flee > 0) want = bearing(hog.x, hog.z, b.x, b.z).angle + Math.sin(b.wobble * 3) * 0.4;
      b.hd = wrapAng(b.hd + clamp(wrapAng(want - b.hd), -3.4 * dt, 3.4 * dt));

      const spd = (b.flee > 0 ? 1.1 : 0.34) * b.out;
      const cs = Math.max(0.08, Math.cos(b.z / R));
      b.x += (Math.cos(b.hd) * spd * dt) / cs;
      b.z += Math.sin(b.hd) * spd * dt;
      // a lilting height: butterflies do not fly level and are wrong if they do
      const ground = heightAt(b.x, b.z);
      b.y = ground + 0.32 + Math.sin(b.wobble * 1.3) * 0.14 + (b.flee > 0 ? 0.2 : 0);

      /* The flap is a rotation about the body's own axis — wings up, wings
       * down — not a yaw, which only slid them sideways past each other. */
      const flap = Math.sin(b.wobble * (b.flee > 0 ? 3.2 : 1.9) * b.flap);
      for (const w of b.wings) w.rotation.z = w.userData.side * (0.30 + flap * 0.80);
      seat(b.obj, b.x, b.y, b.z, b.hd + Math.PI / 2, b.out);
    }

    for (const b of bees) {
      // the same streaming: a bee works whatever flowers are where he is
      if (b.out < 0.03 && distance(hog.x, hog.z, b.anchor.x, b.anchor.z) > 12) {
        const spot = nearbySpot(hog, 1.6, 9);
        if (spot) b.anchor = spot;
      }
      const hereB = meadowlyAt(b.anchor.x, b.anchor.z);
      const awayB = distance(hog.x, hog.z, b.anchor.x, b.anchor.z);
      const upB = flying > b.hardy && hereB > 0.3 && awayB < 14;
      b.out = damp(b.out, upB ? Math.min(1, flying * 1.6) : 0, 1.5, dt);
      b.obj.visible = b.out > 0.02;
      if (!b.obj.visible) continue;
      b.ang += dt * b.speed;
      b.bob += dt * 7;
      const x = b.anchor.x + Math.cos(b.ang) * b.rad;
      const z = b.anchor.z + Math.sin(b.ang) * b.rad;
      /* Clear of the canopy.  At 0.16 they worked *inside* 0.10–0.33 m grass
       * and were hidden by it even when they were right in front of you. */
      const y = heightAt(x, z) + 0.26 + Math.sin(b.bob) * 0.06;
      b.wing.rotation.z = Math.sin(b.bob * 9) * 0.9;
      seat(b.obj, x, y, z, -b.ang, b.out);
    }

    /* Birds: an occasional flyover, straight across his sky.  Spawned off
     * HIM — a bird spawned off the camera is v1's invincibility bug wearing
     * feathers. */
    birdWait -= dt;
    if (birdWait <= 0) {
      // one every seven to twenty seconds, not every sixteen to forty-two
      birdWait = 7 + rng.range(0, 13);
      if (flying > 0.15) {
        const b = birds.find((x) => !x.live);
        if (b) {
          b.live = true;
          b.t = 0;
          b.hd = rng.range(0, TAU);
          const from = bearing(hog.x, hog.z, hog.x + Math.cos(b.hd + Math.PI), hog.z + Math.sin(b.hd + Math.PI));
          const cs = Math.max(0.08, Math.cos(hog.z / R));
          b.x = hog.x + (Math.cos(b.hd + Math.PI) * 14) / cs;
          b.z = hog.z + Math.sin(b.hd + Math.PI) * 14;
          b.y = 3.4 + rng.range(0, 2.2);
          b.obj.visible = true;
        }
      }
    }
    for (const b of birds) {
      if (!b.live) continue;
      b.t += dt;
      const cs = Math.max(0.08, Math.cos(b.z / R));
      b.x += (Math.cos(b.hd) * 3.1 * dt) / cs;
      b.z += Math.sin(b.hd) * 3.1 * dt;
      const flap = Math.sin(b.t * 9);
      for (const w of b.wings) w.rotation.z = w.userData.side * flap * 0.55;
      seat(b.obj, b.x, b.y + Math.sin(b.t * 2.2) * 0.2, b.z, b.hd);
      if (b.t > 10 || distance(hog.x, hog.z, b.x, b.z) > 26) {
        b.live = false;
        b.obj.visible = false;
      }
    }

    /* ------------------------------- the frogs ------------------------------- *
     * Sat at the waterline until he comes too close, then one long hop in —
     * a plop, a ring, and a wait on the bottom until he has gone. */
    for (const f of frogs) {
      if (!f.sit) frogSeat(f);
      if (f.hop > 0) {
        f.hop -= dt;
        const t = 1 - Math.max(0, f.hop) / 0.55;
        const x = lerp(f.sit.x, f.to.x, t);
        const z = lerp(f.sit.z, f.to.z, t);
        const y = heightAt(x, z) + Math.sin(t * Math.PI) * 0.22;
        seat(f.obj, x, y, z, f.ang + Math.PI, 1);
        if (f.hop <= 0) {
          f.obj.visible = false;
          f.wait = 9 + rng.range(0, 12);
          splash(f.to.x, f.to.z);
          hooks.plip?.();
        }
      } else if (!f.obj.visible) {
        f.wait -= dt;
        if (f.wait <= 0 && distance(hog.x, hog.z, f.sit.x, f.sit.z) > 3) {
          f.obj.visible = true;
          f.ang += rng.range(-0.5, 0.5);       // he comes back up somewhere else
          frogSeat(f);
        }
      } else {
        seat(f.obj, f.sit.x, heightAt(f.sit.x, f.sit.z), f.sit.z, f.ang + Math.PI, 1);
        if (distance(hog.x, hog.z, f.sit.x, f.sit.z) < 1.1) f.hop = 0.55;
      }
    }

    /* ------------------------------- the rings ------------------------------- */
    for (const r of rings) {
      if (r.t <= 0) { r.obj.visible = false; continue; }
      r.t -= dt;
      const k = 1 - r.t / 0.9;
      seat(r.obj, r.x, r.y, r.z, 0, 0.15 + k * 0.85);
      r.obj.material.opacity = (1 - k) * 0.5;
      r.obj.visible = true;
    }

    /* And a fish comes up for a fly, when he is near enough to notice. */
    fishWait -= dt;
    if (fishWait <= 0) {
      fishWait = 7 + rng.range(0, 10);
      const toLake = distance(hog.x, hog.z, CENTRE[LAKE].x, CENTRE[LAKE].z);
      if (toLake < LAKE_R + 12 && state.snow < 0.4) {
        const a = rng.range(0, TAU);
        const d = Math.sqrt(rng.next()) * LAKE_R * 0.7;
        const p = offsetFrom(CENTRE[LAKE], Math.cos(a) * d, Math.sin(a) * d);
        splash(p.x, p.z);
        if (toLake < LAKE_R + 6) hooks.plip?.();
      }
    }

    /* ------------------------------ the squirrel ----------------------------- */
    {
      const s = squirrel;
      if (s.climb >= 0) {
        s.climb += dt / 0.9;
        const k = Math.min(1, s.climb);
        // a spiral up the trunk: height with a wind around it
        const a = k * 7;
        seat(s.obj, s.x + Math.cos(a) * 0.07, heightAt(s.x, s.z) + k * 1.7, s.z + Math.sin(a) * 0.07, a + Math.PI / 2, 1 - k * 0.25);
        if (k >= 1) { s.climb = -1; s.obj.visible = false; s.wait = 12 + rng.range(0, 14); }
      } else if (!s.obj.visible) {
        s.wait -= dt;
        if (s.wait <= 0 && distance(hog.x, hog.z, s.x, s.z) > 4) {
          s.obj.visible = true;
        }
      } else {
        seat(s.obj, s.x, heightAt(s.x, s.z), s.z, Math.sin(state.t ?? 0) * 0.2, 1);
        if (distance(hog.x, hog.z, s.x, s.z) < 2.2) s.climb = 0;
      }
    }

    /* -------------------------------- the mice ------------------------------- */
    for (const m of mice) {
      m.cool -= dt;
      if (m.dash > 0) {
        m.dash -= dt;
        const cs = Math.max(0.08, Math.cos(m.z / R));
        m.x += (Math.cos(m.hd) * 1.4 * dt) / cs;
        m.z += Math.sin(m.hd) * 1.4 * dt;
        seat(m.obj, m.x, heightAt(m.x, m.z), m.z, m.hd, 1);
        if (m.dash <= 0) { m.obj.visible = false; m.cool = 8 + rng.range(0, 8); }
      } else if (!m.obj.visible && m.cool <= 0 && distance(hog.x, hog.z, m.x, m.z) < 1.3) {
        // out of the straw and away from him, squeaking distance be damned
        m.obj.visible = true;
        m.hd = bearing(hog.x, hog.z, m.x, m.z).angle + rng.range(-0.5, 0.5);
        m.dash = 0.9;
      }
    }

    /* ----------------------------- the dragonflies --------------------------- */
    for (const d of dflies) {
      d.out = damp(d.out, flying > 0.25 ? 1 : 0, 1.5, dt);
      d.obj.visible = d.out > 0.02;
      if (!d.obj.visible) continue;
      d.bob += dt * 9;
      if (d.dart > 0) {
        d.dart -= dt;
        const k = 1 - Math.max(0, d.dart) / 0.28;
        d.x = lerp(d.fx, d.tx, k);
        d.z = lerp(d.fz, d.tz, k);
      } else {
        d.wait -= dt;
        if (d.wait <= 0) {
          d.wait = 1.2 + rng.range(0, 2.2);
          d.dart = 0.28;
          d.fx = d.x; d.fz = d.z;
          const at = offsetFrom(CENTRE[MIRE], rng.range(-4.5, 4.5), rng.range(-4.5, 4.5));
          d.tx = at.x; d.tz = at.z;
        }
      }
      const hov = Math.sin(d.bob) * 0.03;
      seat(d.obj, d.x, heightAt(d.x, d.z) + 0.34 + hov, d.z,
        d.dart > 0 ? bearing(d.fx, d.fz, d.tx, d.tz).angle : d.bob * 0.2, d.out);
    }

    /* -------------------------------- the snails ------------------------------ *
     * Out in the rain, and for a lingering while after it. */
    for (const sn of snails) {
      sn.damp = clamp(sn.damp + (state.wet > 0.25 ? dt / 4 : -dt / 45), 0, 1);
      sn.obj.visible = sn.damp > 0.25 && state.snow < 0.3;
      if (!sn.obj.visible) continue;
      sn.hd += Math.sin((state.t ?? 0) * 0.3 + sn.x) * 0.15 * dt;
      const cs = Math.max(0.08, Math.cos(sn.z / R));
      sn.x += (Math.cos(sn.hd) * 0.012 * dt) / cs;
      sn.z += Math.sin(sn.hd) * 0.012 * dt;
      seat(sn.obj, sn.x, heightAt(sn.x, sn.z), sn.z, sn.hd, 1);
    }

    /* -------------------------------- the moths ------------------------------ */
    for (const mo of moths) {
      mo.out = damp(mo.out, state.night > 0.5 && state.snow < 0.5 && state.wet < 0.5 ? 1 : 0, 1.5, dt);
      mo.obj.visible = mo.out > 0.02;
      if (!mo.obj.visible) continue;
      mo.ang += dt * mo.spd;
      const x = mo.cx + Math.cos(mo.ang) * mo.rad;
      const z = mo.cz + Math.sin(mo.ang * 1.3) * mo.rad;
      const y = heightAt(x, z) + mo.h + Math.sin(mo.ang * 2.2) * 0.08;
      const flap = Math.sin((state.t ?? 0) * 30 + mo.ang);
      for (const w of mo.wings) w.rotation.y = w.userData.side * (0.5 + flap * 0.8);
      seat(mo.obj, x, y, z, mo.ang + Math.PI / 2, mo.out);
    }

    /* -------------------------------- the ducks ------------------------------ */
    for (const du of ducks) {
      du.obj.visible = state.snow < 0.5;
      if (!du.obj.visible) continue;
      du.ang += dt * du.spd;
      du.bob += dt * 1.8;
      const x = CENTRE[LAKE].x + Math.cos(du.ang) * du.rad / Math.max(0.08, Math.cos(CENTRE[LAKE].z / R));
      const z = CENTRE[LAKE].z + Math.sin(du.ang) * du.rad;
      const y = heightAt(x, z) + waterDepthAt(x, z) + Math.sin(du.bob) * 0.006;
      du.dabbleIn -= dt;
      if (du.dabbleIn <= 0) { du.dabble = 1.4; du.dabbleIn = 6 + rng.range(0, 9); }
      if (du.dabble > 0) du.dabble -= dt;
      const tip = du.dabble > 0 ? Math.sin(Math.min(1, (1.4 - du.dabble) / 1.4) * Math.PI) * 0.6 : 0;
      du.inner.rotation.z = -tip;
      du.wake -= dt;
      if (du.wake <= 0) { du.wake = 2.5 + rng.range(0, 2); splash(x, z); }
      seat(du.obj, x, y, z, du.ang + (du.spd > 0 ? Math.PI / 2 : -Math.PI / 2), 1);
    }

    /* ------------------------------ the ground fog --------------------------- */
    {
      const dp = state.dayPhase ?? 0;
      const dawn = dp > 0.70 && dp < 0.97 ? Math.sin(((dp - 0.70) / 0.27) * Math.PI) : 0;
      for (const f of fogs) {
        f.obj.visible = dawn > 0.03 && state.snow < 0.6;
        if (!f.obj.visible) continue;
        f.obj.material.opacity = dawn * 0.26;
        const drift = Math.sin((state.t ?? 0) * 0.05 + f.ph) * 0.8;
        seat(f.obj, f.x + drift, heightAt(f.x, f.z) + 0.22, f.z, f.ph, 1 + Math.sin((state.t ?? 0) * 0.08 + f.ph) * 0.1);
      }
    }

    /* -------------------------------- puddles -------------------------------- *
     * Rain that has just stopped leaves standing water near him, and the
     * ground drinks it over a minute or two. */
    if (prevWet > 0.4 && state.wet < 0.1) {
      for (const p of puddles) {
        for (let tries = 0; tries < 12; tries++) {
          const a = rng.range(0, TAU);
          const d = 1.5 + Math.sqrt(rng.next()) * 5;
          const cs = Math.max(0.08, Math.cos(hog.z / R));
          const px = hog.x + (Math.cos(a) * d) / cs;
          const pz = hog.z + Math.sin(a) * d;
          if (waterDepthAt(px, pz) === 0) {
            p.t = 100;
            p.x = px; p.z = pz;
            break;
          }
        }
      }
    }
    prevWet = state.wet;
    for (const p of puddles) {
      if (p.t <= 0) { p.obj.visible = false; continue; }
      p.t -= dt;
      const k = Math.min(1, p.t / 100);
      p.obj.visible = true;
      p.obj.material.opacity = 0.42 * k;
      seat(p.obj, p.x, heightAt(p.x, p.z) + 0.008, p.z, 0, 0.4 + k * 0.6);
    }

    /* ------------------------------ the web's dew ---------------------------- *
     * Lit at dawn, dry by mid-morning, and never in the rain. */
    if (web.dew) {
      const dp = state.dayPhase ?? 0;
      const dawn = dp > 0.72 && dp < 0.95 ? Math.sin(((dp - 0.72) / 0.23) * Math.PI) : 0;
      web.dew.material.opacity = dawn * (1 - state.wet) * 0.9;
    }

    /* ------------------------------- the swallows ---------------------------- *
     * Out of the barn at dusk and dawn, cutting loops nothing else in this
     * sky can cut. */
    const duskish = state.night > 0.12 && state.night < 0.6 ? 1 : 0;
    for (const sw of swallows) {
      sw.out = damp(sw.out, duskish * (1 - state.wet) * (1 - state.snow), 1.2, dt);
      sw.obj.visible = sw.out > 0.02;
      if (!sw.obj.visible) continue;
      const tt = (state.t ?? 0) * 0.9 + sw.ph;
      const x = sw.cx + Math.cos(tt) * 3.2 + Math.cos(tt * 2.3) * 0.8;
      const z = sw.cz + Math.sin(tt * 1.4) * 2.6;
      const y = heightAt(sw.cx, sw.cz) + 2.4 + Math.sin(tt * 1.9) * 0.9;
      const flap = Math.sin(tt * 14);
      for (const w of sw.wings) w.rotation.z = w.userData.side * flap * 0.5;
      // aim along the direction of travel, cheaply: one step ahead
      const hd = Math.atan2(
        Math.sin((tt + 0.05) * 1.4) * 2.6 - (z - sw.cz),
        Math.cos(tt + 0.05) * 3.2 + Math.cos((tt + 0.05) * 2.3) * 0.8 - (x - sw.cx)
      );
      seat(sw.obj, x, y, z, hd, sw.out);
    }

    /* ------------------------------ the molehills ---------------------------- */
    lived += dt;
    for (const mh of molehills) {
      if (!mh.obj.visible) {
        if (lived > mh.at) {
          mh.obj.visible = true;
          seat(mh.obj, mh.x, heightAt(mh.x, mh.z), mh.z, 0, 1);
        }
        continue;
      }
      mh.pokeIn -= dt;
      if (mh.pokeIn <= 0) { mh.poke = 1.4; mh.pokeIn = 30 + rng.range(0, 50); }
      if (mh.poke > 0) {
        mh.poke -= dt;
        const k = Math.sin(Math.min(1, (1.4 - mh.poke) / 1.4) * Math.PI);
        mh.nose.visible = k > 0.05;
        mh.nose.position.y = 0.02 + k * 0.045;
      } else {
        mh.nose.visible = false;
      }
    }

    /* ------------------------------- the owl -------------------------------- *
     * Two lit eyes in the dark of the wood, blinking, and now and then the
     * only voice the night has. */
    const owlOn = state.night > 0.6 && state.snow < 0.7;
    owl.obj.visible = owlOn;
    if (owlOn) {
      owl.blinkIn -= dt;
      if (owl.blinkIn <= 0) { owl.blink = 0.16; owl.blinkIn = 2.5 + rng.range(0, 5); }
      if (owl.blink > 0) owl.blink -= dt;
      const open = owl.blink > 0 ? 0.1 : 1;
      owl.obj.children.forEach((e) => e.scale.set(1, open, 1));
      seat(owl.obj, owl.x, owl.y, owl.z, 0, 1);
      owl.hootIn -= dt;
      if (owl.hootIn <= 0) {
        owl.hootIn = 14 + rng.range(0, 22);
        if (distance(hog.x, hog.z, owl.x, owl.z) < 24) hooks.hoot?.();
      }
    }
  }

  return {
    update, splash, bflies, bees, birds, frogs, rings, owl,
    squirrel, mice, dflies, snails, moths, ducks, swallows, molehills, web,
  };
}
