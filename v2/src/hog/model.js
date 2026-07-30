import * as THREE from 'three';
import { cel, flat } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { hullOutline } from '../core/outline.js';
import { rngKit, clamp, lerp, TAU } from '../core/util.js';
import { blobTex } from '../core/textures.js';

/* ------------------------------------------------------------------ *
 * The hedgepig.
 *
 * `assets/logo/hedgepig-logo-badge.jpg` is the character, and everything
 * here is read off it.  Two rounds of "rebuilt from a photograph" went past
 * that badge in v1 and both produced something that was not him, so the
 * rules it taught are carried over verbatim:
 *
 *  - **Two masses, not three.**  A dark spiny mantle over the back, and ONE
 *    cream mass that is face, chest and belly together.
 *  - **There is no head.**  Give him a separate pale head and he reads as a
 *    seal in a wig.  His features go straight onto the front of the one
 *    body, and his "head" is only where that body narrows.  In v1 this
 *    deleted a whole family of faults at once — a head sphere sat *inside*
 *    the body ellipsoid, which is the one case a painter's algorithm cannot
 *    sort, and it was why his face drew through his own flank.  Here the
 *    depth buffer would have sorted it happily; he still does not get a
 *    head, because the fault it really fixed was that he stopped looking
 *    like himself.
 *  - **The mantle reaches the ground at the rump**, and its front edge is a
 *    diagonal from the brow down behind the front leg.  As an ellipse it
 *    bulges across the middle of him and reads as a beetle.
 *  - **Dark, fine needles, only a few pale tips.**  Fat cream spikes read as
 *    petals and he becomes a chrysanthemum.
 *  - Needles **rake** toward the rump.  Dead radial is a sunburst.
 *  - The muzzle is pale; only the nose is dark.  A grey muzzle is a foreign
 *    object on a cream face.
 *  - The **cheek blush** is a surprising amount of the charm, and it hangs
 *    off the eye, not off the body, or it lands on the snout as a smear.
 *
 * The one rule that changes in 3D: **the face wins, and the coat keeps out
 * of a radius around it**.  In v1 that was a screen-space test done before
 * a single quill was drawn.  Here it is the same test in his own model
 * space, and it is still done first — see `faceKeepOut`.
 *
 * Model space: +x is his snout, +y up, +z across him, origin between his
 * feet.  He is 26 cm long, which is life size, and the meadow is built
 * around that number.
 * ------------------------------------------------------------------ */

export const HOG_LEN = 0.26;

const A = HOG_LEN / 2;          // half length, along the snout
const B = 0.079;                // half height
const C = 0.088;                // half width
const BODY_Y = 0.083;           // centre of the body above his feet

/** Front-and-down: the mantle is everything that is NOT within this cone. */
const FRONT = new THREE.Vector3(0.80, -0.60, 0).normalize();
/** How far round the front the bare cream reaches. Larger = more bare. */
const FRONT_CUT = 0.21;

export function buildHog() {
  const root = new THREE.Group();
  root.name = 'hedgepig';

  /* --------------------------- the one cream mass -------------------------- */
  const creamMat = cel({
    color: PAL.hogCream,
    bands: 'soft3',            // high-key: his front must stay light in shade
    tint: 0x9a86a8,
    flat: false,
  });

  const bodyGeo = new THREE.SphereGeometry(1, 26, 18);
  bodyGeo.scale(A, B, C);
  const body = new THREE.Mesh(bodyGeo, creamMat);
  body.position.y = BODY_Y;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);
  hullOutline(body, { thickness: 0.0042 });

  /* The snout is not a head — it is where the one mass narrows.  Short, on
   * purpose: past about 1.25 times this and he is an anteater. */
  const snoutGeo = new THREE.SphereGeometry(1, 16, 12);
  snoutGeo.scale(0.062, 0.040, 0.044);
  const snout = new THREE.Mesh(snoutGeo, creamMat);
  snout.position.set(A * 0.92, BODY_Y - 0.006, 0);
  snout.castShadow = true;
  body.add(snout);

  /* ------------------------------ the face ------------------------------- */
  /* One group for everything that is a feature, so "looking about" can be a
   * damped yaw of the features across his front — which is what it has to be
   * for an animal with no neck. */
  const face = new THREE.Group();
  face.position.y = BODY_Y;
  root.add(face);

  const eyeMat = cel({ color: PAL.hogEye, bands: 2, tint: 0x4a4058, flat: false });
  const noseMat = cel({ color: PAL.hogNose, bands: 2, tint: 0x4a4058, flat: false });
  const blushMat = flat({ color: PAL.hogBlush, transparent: true, opacity: 0.5, depthWrite: false });

  /* High on the front and well forward.  The first pass had them at 0.030
   * and A*0.42, which is anatomically about right and reads as a face
   * printed low on a large cream balloon — the mass above the eyes becomes a
   * forehead, and a hedgehog does not have one. */
  const EYE = { x: A * 0.56, y: 0.044, z: C * 0.56 };
  const eyes = [];
  const blushes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 12, 10), eyeMat);
    e.position.set(EYE.x, EYE.y, EYE.z * s);
    face.add(e);
    eyes.push(e);

    // a catchlight, so the eye reads as wet rather than as a bead
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), flat({ color: 0xfffdf4 }));
    glint.position.set(0.008, 0.005, 0.004 * s);
    e.add(glint);
    e.userData.glint = glint;

    /* The blush hangs off the eye, not off the body.  Off the body it lands
     * on the snout and reads as a smear. */
    const bl = new THREE.Mesh(new THREE.CircleGeometry(0.019, 14), blushMat);
    bl.position.set(EYE.x - 0.022, EYE.y - 0.028, EYE.z * s * 1.02);
    bl.rotation.y = s * Math.PI * 0.5;
    bl.renderOrder = 3;
    face.add(bl);
    blushes.push(bl);
  }

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 12, 10), noseMat);
  nose.position.set(A * 1.03, -0.002, 0);
  face.add(nose);

  /* His mouth is three points on his own surface, bowed outward, so it is a
   * smile from every angle.  Derived any other way it inverts into a frown
   * somewhere — v1 shipped that frown once and it was the first thing seen. */
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const ang = lerp(-0.55, 0.55, t);
      const r = 0.030;
      pts.push(new THREE.Vector3(
        A * 0.90 + Math.cos(ang) * 0.004,
        -0.026 - Math.cos(ang * 1.6) * 0.006,
        Math.sin(ang) * r
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const mouth = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 12, 0.0022, 5, false),
      noseMat
    );
    face.add(mouth);
  }

  // whiskers: four fine lines, hung off the snout like everything else
  {
    const wmat = flat({ color: 0x6b5a4a, transparent: true, opacity: 0.55 });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const g = new THREE.CylinderGeometry(0.0008, 0.0004, 0.055, 3);
        g.translate(0, 0.0275, 0);
        const w = new THREE.Mesh(g, wmat);
        w.position.set(A * 0.96, -0.002 + i * 0.008, 0.012 * s);
        w.rotation.z = -Math.PI / 2 + 0.35;
        w.rotation.y = s * (0.5 + i * 0.28);
        w.userData.noOutline = true;
        face.add(w);
      }
    }
  }

  /* Ears: small, low, and at the mantle's front edge — on the badge they are
   * barely more than two notches in the coat line. */
  const earMat = cel({ color: PAL.hogCreamShade, bands: 'soft', tint: 0x8f7a9a, flat: false });
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.0135, 10, 8);
    g.scale(0.5, 1, 0.9);
    const ear = new THREE.Mesh(g, earMat);
    // low and at the coat's front edge — on the badge they are barely two
    // notches in the mantle line, and set high they read as a rabbit
    ear.position.set(A * 0.30, BODY_Y + 0.030, C * 0.72 * s);
    ear.rotation.z = -0.3;
    root.add(ear);
  }

  /* -------------------------------- the coat ------------------------------- */
  /* Needles are instanced cones.  Two meshes: the dark mass of them, and the
   * few with pale tips.  The proportion is the badge's — about one in five. */
  const rng = rngKit(1808);

  // eye keep-out, in model space, computed before a single quill is placed
  const faceKeepOut = eyes.map((e) => e.position.clone().add(new THREE.Vector3(0, BODY_Y, 0)));

  /* ---------------------------- the dark mantle ---------------------------- *
   * A second shell over the back, cut to exactly the region the needles root
   * in, in the needles' own brown.
   *
   * This is v1's hardest-won piece of the character and it took the same
   * wrong turn here that it took there: **needles nowhere near cover a
   * body.**  Six hundred of them still leave most of the surface showing,
   * and what shows through is cream — so he came out a cream ball with
   * spikes in it, which v1 named exactly: an artichoke, a chrysanthemum, a
   * sea urchin.  Everything between the needles has to be the *shadow*
   * between them, and it has to be **darker than the needles standing on
   * it**, or every gap in the coat reads as a bald patch.
   *
   * In two dimensions v1 faked this with an offset ellipse.  Here the true
   * region is available for free: keep the triangles whose centre is on the
   * mantle side of the same plane the quills test against, and the boundary
   * is a real plane section — a diagonal from the brow down behind the front
   * leg, which is what the badge shows and what an ellipse never gives. */
  {
    const shell = new THREE.SphereGeometry(1, 64, 44).toNonIndexed();
    const pos = shell.attributes.position;
    const keep = [];
    const cen = new THREE.Vector3();
    const va = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      cen.set(0, 0, 0);
      for (let e = 0; e < 3; e++) {
        va.fromBufferAttribute(pos, t + e);
        cen.add(va);
      }
      cen.multiplyScalar(1 / 3).normalize();
      // a hair inside the quills' own cut, so the cream edge is never a seam
      if (cen.dot(FRONT) > FRONT_CUT - 0.03) continue;
      /* **The face wins here too.**  The keep-out was applied to the needles
       * and not to the mass they stand on, so the coat's own edge ran
       * straight across his eye — which is worse than a quill through it,
       * because it is a hard line and it is always on the same side. */
      va.set(cen.x * A, cen.y * B + BODY_Y, cen.z * C);
      let onFace = false;
      for (const k of faceKeepOut) {
        if (va.distanceTo(k) < 0.042) { onFace = true; break; }
      }
      if (onFace) continue;
      for (let e = 0; e < 3; e++) {
        va.fromBufferAttribute(pos, t + e);
        keep.push(va.x, va.y, va.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    geo.computeVertexNormals();
    geo.scale(A * 1.012, B * 1.012, C * 1.012);
    const mantle = new THREE.Mesh(
      geo,
      cel({ color: PAL.hogQuill, bands: 3, tint: 0x574a70, flat: false, side: THREE.DoubleSide })
    );
    mantle.position.y = BODY_Y;
    mantle.castShadow = true;
    mantle.receiveShadow = true;
    mantle.userData.noOutline = true;
    root.add(mantle);
  }

  const quills = [];
  const N = 620;
  /* Fibonacci sphere: even coverage without clumps.  Random placement leaves
   * bald patches at this count and they read as mange. */
  const golden = Math.PI * (3 - Math.sqrt(5));
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const u = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);

    // only the mantle: everything outside the front-and-down cone
    if (u.dot(FRONT) > FRONT_CUT) continue;

    p.set(u.x * A, u.y * B, u.z * C);
    // ellipsoid normal, which is not the radial direction
    nrm.set(p.x / (A * A), p.y / (B * B), p.z / (C * C)).normalize();

    const world = p.clone().add(new THREE.Vector3(0, BODY_Y, 0));
    // the face wins: no quill within a radius of an eye.  The radius shrinks
    // as it goes round the side, where a generous zone leaves a bald patch.
    let blocked = false;
    for (const k of faceKeepOut) {
      const rad = 0.040 * (1 - clamp(Math.abs(world.z) / C, 0, 1) * 0.45);
      if (world.distanceTo(k) < rad) { blocked = true; break; }
    }
    if (blocked) continue;

    /* Rake toward the rump.  Dead radial is a sunburst; the badge's needles
     * all lie back along him.  Blended, not rotated: a fixed rotation about
     * one axis goes wrong on the flanks. */
    const dir = nrm.clone().addScaledVector(new THREE.Vector3(-1, 0.08, 0), 0.62).normalize();

    quills.push({
      pos: world.clone().addScaledVector(nrm, -0.004),   // rooted just under the skin
      dir,
      len: rng.range(0.024, 0.042) * (1 + 0.28 * clamp(-u.x, 0, 1)),   // longest at the rump
      tip: rng.chance(0.19),
    });
  }

  /* Fine, not fat.  The badge has about ninety hair-thin needles with only
   * a dozen or so pale tips; fat cream spikes read as petals and turn him
   * into a chrysanthemum.  2.6 mm at the root is a needle at this scale. */
  const quillGeo = new THREE.ConeGeometry(0.0026, 1, 4);
  quillGeo.translate(0, 0.5, 0);       // root at the origin, tip at +y

  /**
   * One instanced coat.  `from` and `span` cut a section out of the needle:
   * the dark pass draws the whole thing, the pale pass draws only the last
   * third of the ones that have a light tip, sitting exactly on top.
   */
  const mkCoat = (list, color, from, span) => {
    const mat = cel({ color, bands: 3, tint: 0x584a72, flat: true });
    const im = new THREE.InstancedMesh(quillGeo, mat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    const at = new THREE.Vector3();
    list.forEach((s, i) => {
      q.setFromUnitVectors(up, s.dir);
      // the cone tapers along its length, so a tip section has to be thinner
      const w = 1 - from * 0.72;
      sc.set(w, s.len * span, w);
      at.copy(s.pos).addScaledVector(s.dir, s.len * from);
      m.compose(at, q, sc);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    return im;
  };

  const coatDark = mkCoat(quills, PAL.hogQuill, 0, 1);
  root.add(coatDark);
  // a middle tone through a third of them, so the coat has depth rather than
  // being one flat brown mass with a light on it
  const coatMid = mkCoat(quills.filter((_, i) => i % 3 === 1), PAL.hogQuillLight, 0.10, 0.68);
  root.add(coatMid);
  // and the pale tips: the last third of about one needle in five
  const coatPale = mkCoat(quills.filter((q) => q.tip), PAL.hogQuillTip, 0.66, 0.36);
  root.add(coatPale);

  /* -------------------------------- the legs ------------------------------- */
  const legMat = cel({ color: PAL.hogCreamShade, bands: 'soft', tint: 0x8a7594, flat: false });
  const footMat = cel({ color: 0x9c7a52, bands: 2, tint: 0x6a5a7a, flat: false });
  const legs = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const leg = new THREE.Group();
      leg.position.set(A * 0.46 * sx, BODY_Y - 0.030, C * 0.62 * sz);
      const g = new THREE.CylinderGeometry(0.011, 0.010, 0.048, 6);
      g.translate(0, -0.024, 0);
      const shin = new THREE.Mesh(g, legMat);
      shin.castShadow = true;
      leg.add(shin);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 8, 6), footMat);
      foot.scale.set(1.3, 0.7, 1);
      foot.position.y = -0.048;
      leg.add(foot);
      leg.userData.phase = (sx > 0 ? 0 : Math.PI) + (sz > 0 ? 0 : Math.PI);
      root.add(leg);
      legs.push(leg);
    }
  }

  /* A painted contact shadow.  The real shadow map is doing its job, but at
   * this scale it is a smudge four pixels across; the blob is what actually
   * sits him on the ground. */
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(HOG_LEN * 1.5, HOG_LEN * 1.15),
    flat({
      color: 0x54486a, map: blobTex(), transparent: true, opacity: 0.32,
      depthWrite: false, fog: true, cache: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.006;
  shadow.userData.noOutline = true;
  shadow.renderOrder = 1;
  root.add(shadow);

  return {
    root, body, face, snout, nose, eyes, blushes, legs, shadow,
    coats: [coatDark, coatPale, coatMid],
    materials: { cream: creamMat, quill: coatDark.material },
    quillCount: quills.length,
  };
}
