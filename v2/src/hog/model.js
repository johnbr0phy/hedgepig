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

/** His body's half-axes, exported so the harness can check features stay on it. */
export const HOG_BODY = { A: HOG_LEN / 2, B: 0.079, C: 0.088, BODY_Y: 0.083 };

const { A, B, C, BODY_Y } = HOG_BODY;   // length, height, width, and his height off the ground

/** Front-and-down: the mantle is everything that is NOT within this cone. */
const FRONT = new THREE.Vector3(0.80, -0.60, 0).normalize();
/** How far round the front the bare cream reaches. Larger = more bare. */
const FRONT_CUT = 0.21;

export function buildHog() {
  const root = new THREE.Group();
  root.name = 'hedgepig';

  /* --------------------------------- the trunk ------------------------------ *
   * Everything that IS his body — the cream mass, the dark mantle, the coats
   * of quills, and the ears — rides ONE group, centred on his middle.
   *
   * It was not one group, and that was the flashing: the walk bobbed and
   * swayed the cream body while the mantle and the quills stood still in
   * root space, and the mantle is only a millimetre proud of the skin it
   * covers — so twice a stride the body surfaced through its own coat as a
   * cream flash.  And the mantle, animated by nobody, stayed a rigid
   * ellipsoid while the tuck squashed the body into a sphere inside it.
   * Anything that shows his surface moves with his surface, structurally,
   * or the animation is a set of parts trying to agree by arithmetic. */
  const trunk = new THREE.Group();
  trunk.position.y = BODY_Y;
  root.add(trunk);

  /* --------------------------- the one cream mass -------------------------- */
  const creamMat = cel({
    color: PAL.hogCream,
    bands: 'soft3',            // high-key: his front must stay light in shade
    tint: 0x9a86a8,
    flat: false,
  });

  const bodyGeo = new THREE.SphereGeometry(1, 26, 18);
  bodyGeo.scale(A, B, C);
  /* The body's material is his own, NOT the shared cream: the tuck tints his
   * skin toward quill brown so the ball reads coated between the reserve
   * quills — the mantle's own rule, that a gap in a coat must be darker than
   * the needles standing in it or it reads as a bald patch.  Tinting the
   * cached cream would tint the snout and every other cream thing with it. */
  const body = new THREE.Mesh(bodyGeo, cel({
    color: PAL.hogCream, bands: 'soft3', tint: 0x9a86a8, flat: false, cache: false,
  }));
  body.castShadow = true;
  body.receiveShadow = true;
  trunk.add(body);
  hullOutline(body, { thickness: 0.0042 });

  /* The snout is not a head — it is where the one mass narrows.
   *
   * **Short.**  v1's rule is that past about 1.25 times this he is an
   * anteater, and the first pass here was 62 mm long against a 130 mm
   * half-body: it added 40 % to his length and merged with the body into one
   * long pale wedge, which is a tapir.  Every feature on his face is derived
   * from these five numbers now rather than guessed against them — which is
   * the lesson of the buried catchlight, learned three more times.
   *
   * Note the y: the snout is a **child of the body**, so this is relative to
   * the body's own centre and not to the ground. */
  const SNOUT = { x: A * 0.95, y: -0.013, rx: 0.038, ry: 0.028, rz: 0.030 };
  const snoutGeo = new THREE.SphereGeometry(1, 16, 12);
  snoutGeo.scale(SNOUT.rx, SNOUT.ry, SNOUT.rz);
  const snout = new THREE.Mesh(snoutGeo, creamMat);
  snout.position.set(SNOUT.x, SNOUT.y, 0);
  snout.castShadow = true;
  snout.userData.restY = SNOUT.y;

  /** Where the body's surface is, at a given height and distance forward. */
  const surfaceZ = (x, y) => {
    const t = 1 - (x / A) ** 2 - (y / B) ** 2;
    return C * Math.sqrt(Math.max(0.02, t));
  };

  /* ------------------------------ the face ------------------------------- */
  /* One group for everything that is a feature, so "looking about" can be a
   * damped yaw of the features across his front — which is what it has to be
   * for an animal with no neck. */
  const face = new THREE.Group();
  face.position.y = BODY_Y;
  root.add(face);
  /* The snout belongs to the face, not to the body: it is a feature, and the
   * nose, mouth and whiskers all sit on it, so it has to swing with them or
   * his nose leaves his snout behind.  The two groups share an origin — both
   * sit at BODY_Y — so nothing about its coordinates changes. */
  face.add(snout);

  const eyeMat = cel({ color: PAL.hogEye, bands: 2, tint: 0x4a4058, flat: false });
  const noseMat = cel({ color: PAL.hogNose, bands: 2, tint: 0x4a4058, flat: false });
  const blushMat = flat({ color: PAL.hogBlush, transparent: true, opacity: 0.55, depthWrite: false });

  /* Well forward, low, and **near the nose**.  At A*0.56 and y 0.044 they
   * sat halfway up the front of him and read as a face printed on a balloon;
   * everything appealing about a hedgehog's face is that the eyes crowd in
   * against the snout.  The z is *derived* from his surface at that spot —
   * placed by eye it was the buried-catchlight fault a third time, an eye
   * either sunk in his cheek or hanging beside it. */
  const EYE = { x: A * 0.74, y: 0.022, z: 0 };
  EYE.z = surfaceZ(EYE.x, EYE.y) - 0.004;
  const EYE_R = 0.014;
  const eyes = [];
  const blushes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 14, 11), eyeMat);
    e.position.set(EYE.x, EYE.y, EYE.z * s);
    face.add(e);
    eyes.push(e);

    /* A catchlight, so the eye reads as wet rather than as a bead — and it
     * has to sit **on** the eyeball.  Placed at (0.008, 0.005, 0.004) it was
     * 10.2 mm from the centre of a 14.5 mm sphere with a 4.2 mm radius of its
     * own: entirely inside it, invisible, and both eyes read as flat black
     * holes.  v1's handover is explicit that the catchlight is most of what
     * makes an eye look alive, and this was it not being there at all. */
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0044, 8, 6), flat({ color: 0xfffdf4 }));
    glint.position.set(0.55, 0.56, 0.62 * s).normalize().multiplyScalar(EYE_R * 0.96);
    e.add(glint);
    e.userData.glint = glint;

    // and a cool glint opposite it, so the eye has a wet far side too
    const wet = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 6, 5), flat({ color: 0xbcd0e8 }));
    wet.position.set(-0.2, -0.62, 0.75 * s).normalize().multiplyScalar(EYE_R * 0.96);
    e.add(wet);

    /* The blush hangs off the eye, not off the body.  Off the body it lands
     * on the snout and reads as a smear. */
    /* On the surface of his cheek, which is 80 mm out at that height — not
     * at the eye's own z of 49 mm, where the disc sat *inside* his head and
     * was never once visible.  Same fault as the catchlight, same fix. */
    const bx = EYE.x - 0.020;
    const by = EYE.y - 0.026;
    const bl = new THREE.Mesh(new THREE.CircleGeometry(0.020, 14), blushMat);
    bl.position.set(bx, by, (surfaceZ(bx, by) + 0.001) * s);
    bl.rotation.y = s * Math.PI * 0.5;
    bl.renderOrder = 3;
    face.add(bl);
    blushes.push(bl);
  }

  /* On the tip of the snout, derived from it.  Guessed independently it sat
   * at A × 1.03, which is 48 mm *behind* the tip of the snout it belongs to
   * — inside his face, and so he had no nose at all. */
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 12, 10), noseMat);
  nose.position.set(SNOUT.x + SNOUT.rx * 0.82, SNOUT.y + 0.004, 0);
  face.add(nose);

  /* His mouth is three points on his own surface, bowed outward, so it is a
   * smile from every angle.  Derived any other way it inverts into a frown
   * somewhere — v1 shipped that frown once and it was the first thing seen. */
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const ang = lerp(-0.55, 0.55, t);
      const r = SNOUT.rz * 0.78;
      pts.push(new THREE.Vector3(
        SNOUT.x + SNOUT.rx * 0.30 + Math.cos(ang) * 0.004,
        SNOUT.y - SNOUT.ry * 0.62 - Math.cos(ang * 1.6) * 0.005,
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

  // whiskers: four fine lines, hung off the snout like everything else —
  // kept in a list so a sniff can twitch them, because a nose that works
  // while the whiskers hang dead is half a sniff
  const whiskers = [];
  {
    const wmat = flat({ color: 0x6b5a4a, transparent: true, opacity: 0.55 });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const g = new THREE.CylinderGeometry(0.0008, 0.0004, 0.055, 3);
        g.translate(0, 0.0275, 0);
        const w = new THREE.Mesh(g, wmat);
        w.position.set(SNOUT.x + SNOUT.rx * 0.45, SNOUT.y + 0.004 + i * 0.007, SNOUT.rz * 0.4 * s);
        w.rotation.z = -Math.PI / 2 + 0.35;
        w.rotation.y = s * (0.5 + i * 0.28);
        w.userData.noOutline = true;
        w.userData.restZ = w.rotation.z;
        w.userData.ph = i * 2.1 + (s > 0 ? 0 : 1.3);
        face.add(w);
        whiskers.push(w);
      }
    }
  }

  /* Ears: small, low, and at the mantle's front edge — on the badge they are
   * barely more than two notches in the coat line. */
  const earMat = cel({ color: PAL.hogCreamShade, bands: 'soft', tint: 0x8f7a9a, flat: false });
  const ears = [];
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.0135, 10, 8);
    g.scale(0.5, 1, 0.9);
    const ear = new THREE.Mesh(g, earMat);
    // low and at the coat's front edge — on the badge they are barely two
    // notches in the mantle line, and set high they read as a rabbit.
    // Trunk children, in trunk space: they ride the bob with the coat.
    ear.position.set(A * 0.30, 0.030, C * 0.72 * s);
    ear.rotation.z = -0.3;
    trunk.add(ear);
    ears.push(ear);
  }

  /* -------------------------------- the coat ------------------------------- */
  /* Needles are instanced cones.  Two meshes: the dark mass of them, and the
   * few with pale tips.  The proportion is the badge's — about one in five. */
  const rng = rngKit(1808);

  /* The face keep-out, in model space, computed before a single quill is
   * placed — and it is the **brow line**, not two circles.
   *
   * Two circles is what it was, and between them the coat survived and came
   * down the middle of his forehead as a dark wedge: a widow's peak with a
   * point on it, right between his eyes, which is the single least appealing
   * shape you can put on an animal's face.  What has to be clear is the
   * whole band across his brow, so the test is distance to the *segment*
   * joining the two eyes rather than to either end of it. */
  const faceKeepOut = eyes.map((e) => e.position.clone().add(new THREE.Vector3(0, BODY_Y, 0)));
  const browA = faceKeepOut[0];
  const browB = faceKeepOut[1];
  const _seg = new THREE.Vector3();
  const _rel = new THREE.Vector3();
  /** Distance from `p` to the brow line joining the eyes. */
  const browDistance = (p) => {
    _seg.subVectors(browB, browA);
    const len2 = _seg.lengthSq() || 1;
    const t = clamp(_rel.subVectors(p, browA).dot(_seg) / len2, 0, 1);
    return p.distanceTo(_rel.copy(browA).addScaledVector(_seg, t));
  };

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
  let mantle;
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
      if (browDistance(va) < 0.040) continue;
      for (let e = 0; e < 3; e++) {
        va.fromBufferAttribute(pos, t + e);
        keep.push(va.x, va.y, va.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    geo.computeVertexNormals();
    geo.scale(A * 1.012, B * 1.012, C * 1.012);
    mantle = new THREE.Mesh(
      geo,
      cel({ color: PAL.hogQuill, bands: 3, tint: 0x574a70, flat: false, side: THREE.DoubleSide })
    );
    mantle.castShadow = true;
    mantle.receiveShadow = true;
    mantle.userData.noOutline = true;
    trunk.add(mantle);
  }

  const quills = [];
  /* The reserve coat, for the ball.  His front is bare cream by design — and
   * on the *ball* that bare front is a third of the surface, so the roll
   * read as an egg with a mohawk going end over end.  A real hedgehog's
   * orbicularis pulls the coat over everything as it curls, so these are the
   * quills for the cream region, held under the skin and grown out by the
   * tuck — `anim.js` scales them from nothing, and because that scaling is
   * toward his centre they literally emerge *through* the skin as he curls. */
  const tuckQuills = [];
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

    p.set(u.x * A, u.y * B, u.z * C);
    // ellipsoid normal, which is not the radial direction
    nrm.set(p.x / (A * A), p.y / (B * B), p.z / (C * C)).normalize();

    // inside the front-and-down cone: bare while he walks, coat when he curls
    if (u.dot(FRONT) > FRONT_CUT) {
      tuckQuills.push({
        pos: p.clone().addScaledVector(nrm, -0.004),
        dir: nrm.clone(),          // radial: a ball is the one shape that wants a sunburst
        len: rng.range(0.020, 0.032),
        tip: rng.chance(0.15),
      });
      continue;
    }

    const world = p.clone().add(new THREE.Vector3(0, BODY_Y, 0));
    // the face wins: no quill within a radius of an eye.  The radius shrinks
    // as it goes round the side, where a generous zone leaves a bald patch.
    /* The radius shrinks as it goes round the side, where a generous zone
     * leaves a bald patch round the one eye you can see. */
    const rad = 0.040 * (1 - clamp(Math.abs(world.z) / C, 0, 1) * 0.45);
    if (browDistance(world) < rad) continue;

    /* Rake toward the rump.  Dead radial is a sunburst; the badge's needles
     * all lie back along him.  Blended, not rotated: a fixed rotation about
     * one axis goes wrong on the flanks. */
    /* Rake, harder at the front.  A quill rooted on the brow has a normal
     * pointing forward, and a fixed rake does not turn it far enough — so a
     * dozen of them lay forward *over his face* like a fringe with spikes in
     * it.  The rake grows with how far forward the root is, and anything
     * still pointing forward after that is simply not planted. */
    const rake = 0.62 + 1.15 * clamp(u.x, 0, 1);
    const dir = nrm.clone().addScaledVector(new THREE.Vector3(-1, 0.10, 0), rake).normalize();
    if (dir.x > 0.06) continue;

    quills.push({
      // rooted just under the skin, in TRUNK space — body-centred, so the
      // one trunk transform squashes and rocks them with the skin they stand on
      pos: p.clone().addScaledVector(nrm, -0.004),
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
  trunk.add(coatDark);
  // a middle tone through a third of them, so the coat has depth rather than
  // being one flat brown mass with a light on it
  const coatMid = mkCoat(quills.filter((_, i) => i % 3 === 1), PAL.hogQuillLight, 0.10, 0.68);
  trunk.add(coatMid);
  // and the pale tips: the last third of about one needle in five
  const coatPale = mkCoat(quills.filter((q) => q.tip), PAL.hogQuillTip, 0.66, 0.36);
  trunk.add(coatPale);
  // the reserve coat over the cream, grown out by the tuck and never else
  const coatTuck = mkCoat(tuckQuills, PAL.hogQuill, 0, 1);
  coatTuck.scale.setScalar(0.0001);
  coatTuck.visible = false;
  trunk.add(coatTuck);

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
  /* **Not a child of him.**  It used to be, and then he learned to roll: the
   * spin is applied to his root, so his contact shadow rolled with him — a
   * flat disc turning edge-on through the ground, fighting the surface for
   * the same depth on every frame.  That was the flicker.  A shadow belongs
   * to the *ground*, not to the animal, so `hog.js` seats it separately with
   * the tangent frame and nothing else. */
  const shadowGeo = new THREE.PlaneGeometry(HOG_LEN * 1.5, HOG_LEN * 1.15);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(
    shadowGeo,
    flat({
      color: 0x54486a, map: blobTex(), transparent: true, opacity: 0.32,
      depthWrite: false, fog: true, cache: false,
    })
  );
  shadow.userData.noOutline = true;
  shadow.renderOrder = 1;
  shadow.matrixAutoUpdate = false;

  /* ------------------------------- looking ------------------------------- *
   * **The yaw is done in the body's own space, not in world space.**
   *
   * Rotating the face group about Y keeps every feature at a constant
   * distance from that axis — which is right for a sphere and wrong for
   * him.  He is 130 mm long and 88 mm wide, so as a feature swings toward
   * his flank the surface falls away beneath it and the feature is left
   * hanging in the air beside him.  His nose was the worst of it: it sits
   * 147 mm out on the snout and his side is only 73 mm out, so it flew a
   * full 70 mm clear of his cheek — which is what "his eyes leave his face"
   * looks like from outside.
   *
   * Scaling to a unit sphere, rotating there, and scaling back maps the
   * ellipsoid exactly onto itself, so a feature that starts on his surface
   * stays on it at every angle.  Each feature is *placed* by that map and
   * then turned rigidly, so nothing is stretched by it.
   */
  const lookParts = face.children.map((c) => ({
    obj: c,
    rest: c.position.clone(),
    restRotY: c.rotation.y,
  }));

  function setLook(yaw) {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const p of lookParts) {
      // into unit-sphere space, round, and back out again
      const ux = p.rest.x / A, uy = p.rest.y / B, uz = p.rest.z / C;
      p.obj.position.set((ux * cs + uz * sn) * A, uy * B, (-ux * sn + uz * cs) * C);
      p.obj.rotation.y = p.restRotY + yaw;
    }
  }

  return {
    root, trunk, body, mantle, face, snout, nose, eyes, ears, blushes, whiskers,
    legs, shadow, setLook, lookParts,
    coats: [coatDark, coatPale, coatMid],
    coatTuck,
    materials: { cream: creamMat, quill: coatDark.material },
    quillCount: quills.length,
  };
}
