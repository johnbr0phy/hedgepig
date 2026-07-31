import * as THREE from 'three';
import { PAL } from '../core/palette.js';
import { starTex, petalTex } from '../core/textures.js';
import { rngKit, clamp, lerp, TAU } from '../core/util.js';
import { positionAt, basisAt } from './planet.js';
import { placeAmt, BGARD, WOOD, LAKE } from './plan.js';

/* ------------------------------------------------------------------ *
 * Weather, and the things that fly.
 *
 * Everything here is a point field in a box that follows the camera and
 * wraps at its edges, so a hundred particles cover an unbounded field.  v1
 * did the same and for the same reason, with one difference that matters:
 * there, screen-space entities carried no scroll term at all and were
 * *deliberately* not world-anchored.  Here they wrap in the camera's own
 * local frame, so walking round the planet does not drag the rain with you
 * in a way you can see.
 *
 * What falls is decided entirely by the season weights — v1's rule that
 * snow and night are times and not places, kept whole:
 *
 *   spring   petals, over the garden, and rain
 *   summer   motes, bees, butterflies
 *   autumn   leaves, and more rain
 *   winter   snow, and nothing flies at all
 *   night    fireflies, whatever the season
 * ------------------------------------------------------------------ */

const BOX = 9;            // half-extent of the wrapping box, in metres

/* Rain gets a tighter box and a lower ceiling than everything else: see
 * `RainField`.  Nine metres of cube put ninety per cent of the drops out of
 * frame, and rain you cannot see is not weather, it is a colour grade. */
const RAIN_BOX = 4.2;
const RAIN_TOP = 5.5;

class Field {
  constructor(scene, { count, size, color, tex, opacity = 0.9, gravity, drift, spin = 0, blend = THREE.NormalBlending }) {
    this.count = count;
    this.gravity = gravity;
    this.drift = drift;
    this.spin = spin;

    const pos = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size, map: tex, color, transparent: true, opacity,
      depthWrite: false, sizeAttenuation: true, fog: true, blending: blend,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.material = mat;
    this.array = pos;

    const rng = rngKit(count * 31 + 7);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rng.range(-BOX, BOX);
      pos[i * 3 + 1] = rng.range(-BOX * 0.4, BOX);
      pos[i * 3 + 2] = rng.range(-BOX, BOX);
      this.seed[i] = rng.range(0, TAU);
    }
    scene.add(this.points);
  }

  /** `amount` is 0..1; particles are simply not drawn beyond it. */
  set(amount) {
    const n = Math.floor(this.count * clamp(amount, 0, 1));
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
    this.active = n;
    return n;
  }

  /**
   * Advance and wrap.  The box is expressed in the camera's *local surface
   * frame* — up is the planet's up, not world +Y — so rain falls toward the
   * ground wherever on the globe you are standing.
   */
  update(dt, origin, basis, t) {
    const n = this.active | 0;
    if (!n) return;
    const p = this.array;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      p[k + 1] -= this.gravity * dt;
      p[k] += Math.sin(t * 0.9 + this.seed[i]) * this.drift * dt;
      p[k + 2] += Math.cos(t * 0.7 + this.seed[i] * 1.3) * this.drift * dt;
      // wrap: a particle that has fallen out of the box comes back in the top
      if (p[k + 1] < -BOX * 0.4) { p[k + 1] += BOX * 1.4; }
      if (p[k] > BOX) p[k] -= BOX * 2; else if (p[k] < -BOX) p[k] += BOX * 2;
      if (p[k + 2] > BOX) p[k + 2] -= BOX * 2; else if (p[k + 2] < -BOX) p[k + 2] += BOX * 2;
    }
    this.points.geometry.attributes.position.needsUpdate = true;

    // seat the whole field on the surface under the camera
    this.points.position.copy(origin);
    this.points.quaternion.setFromRotationMatrix(
      _m.makeBasis(basis.east, basis.up, basis.north)
    );
  }
}

/* ------------------------------------------------------------------ *
 * Rain, which is not a point field and never should have been.
 *
 * It was one: 420 round blobs in the same 18 m box everything else uses,
 * with the same sideways sine wobble.  Standing out in the heaviest weather
 * this world can make, **you could not see a single drop**, and three
 * separate things were stacked up to make that true.
 *
 *  - **The box is a cube and the camera is a cone.**  Counted at the frame:
 *    eleven of a hundred and five active drops were inside the frustum.  The
 *    other ninety-four were behind you, above you, or off to the side.  For
 *    snow that hardly matters, because snow drifts slowly and you read it
 *    from the few flakes near your face; for rain you need a *curtain*, and
 *    a curtain wants an order of magnitude more drops.
 *  - **A drop is a streak, and a point cannot be one.**  At 9.5 m/s a drop
 *    covers 16 cm in a frame and was being drawn as a 5.5 cm dot — so even
 *    the eleven you could theoretically see were strobing between positions
 *    a stride apart rather than drawing a line.  What reads as rain is the
 *    smear, and the smear is the whole of it.
 *  - **Rain does not wobble.**  The sine drift is right for a petal and
 *    wrong for water: real rain falls dead straight and the *wind* leans the
 *    entire field one way at once.  A field of independently wandering drops
 *    reads as midges.
 *
 * So rain is `LineSegments` now: one vertex where the drop is and one where
 * it was a frame and a half ago, which is a streak that automatically
 * foreshortens to a dot when you look straight up it.  Lines are always one
 * pixel wide in WebGL and that is exactly right here — a raindrop at four
 * metres IS about a pixel across, and it costs one draw call for the lot.
 * ------------------------------------------------------------------ */
class RainField {
  constructor(scene, { count, color, opacity, speed }) {
    this.count = count;
    this.speed = speed;
    this.active = 0;
    /* Two vertices a drop: the head, and the tail it has just come from. */
    const pos = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);
    this.array = pos;
    this.geo = geo;

    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, fog: true,
    });
    this.material = mat;
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    scene.add(this.lines);

    /* Seeded down a **shorter** box than the rest of the weather.  Rain you
     * can see is rain within a few metres of your eye; spreading it over the
     * full 18 m cube is what put ninety per cent of it out of frame. */
    const rng = rngKit(count * 17 + 3);
    this.head = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.head[i * 3] = rng.range(-RAIN_BOX, RAIN_BOX);
      this.head[i * 3 + 1] = rng.range(-1.2, RAIN_TOP);
      this.head[i * 3 + 2] = rng.range(-RAIN_BOX, RAIN_BOX);
    }
  }

  set(amount) {
    const n = Math.floor(this.count * clamp(amount, 0, 1));
    this.active = n;
    this.geo.setDrawRange(0, n * 2);
    this.lines.visible = n > 0;
    return n;
  }

  /**
   * `lean` is the wind, in metres per second sideways — applied to the whole
   * field at once rather than per drop, because that is what wind is.
   */
  update(dt, origin, basis, lean, leanZ) {
    const n = this.active | 0;
    if (!n) return;
    const h = this.head;
    const p = this.array;
    const fall = this.speed * dt;
    /* The streak is how far it goes in about a frame and a half.  Tied to
     * the real speed rather than a constant, so a heavier fall genuinely
     * draws longer lines instead of the same lines moving faster. */
    const sx = -lean / 30, sy = this.speed / 30, sz = -leanZ / 30;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      h[k + 1] -= fall;
      h[k] += lean * dt;
      h[k + 2] += leanZ * dt;
      if (h[k + 1] < -1.2) {
        h[k + 1] += RAIN_TOP + 1.2;
        // and re-drawn across the box, or a shower wears grooves in the air
        h[k] = ((h[k] + RAIN_BOX * 3) % (RAIN_BOX * 2)) - RAIN_BOX;
        h[k + 2] = ((h[k + 2] + RAIN_BOX * 3) % (RAIN_BOX * 2)) - RAIN_BOX;
      }
      if (h[k] > RAIN_BOX) h[k] -= RAIN_BOX * 2; else if (h[k] < -RAIN_BOX) h[k] += RAIN_BOX * 2;
      if (h[k + 2] > RAIN_BOX) h[k + 2] -= RAIN_BOX * 2; else if (h[k + 2] < -RAIN_BOX) h[k + 2] += RAIN_BOX * 2;

      const j = i * 6;
      p[j] = h[k]; p[j + 1] = h[k + 1]; p[j + 2] = h[k + 2];
      p[j + 3] = h[k] + sx; p[j + 4] = h[k + 1] + sy; p[j + 5] = h[k + 2] + sz;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.lines.position.copy(origin);
    this.lines.quaternion.setFromRotationMatrix(
      _m.makeBasis(basis.east, basis.up, basis.north)
    );
  }
}

const _m = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _flat = { x: 0, z: 0, y: 0 };

export function createWeather(scene) {
  /* 2 200 streaks against the old 420 dots.  It sounds like a lot and is
   * two draw calls' worth of nothing: 4 400 vertices in one `LineSegments`,
   * against a frame that already pushes 1.9 M triangles.  The count is set
   * by what a downpour has to LOOK like, which is a curtain. */
  const rain = new RainField(scene, {
    count: 2600, color: 0xc4dcee, opacity: 0.6, speed: 11,
  });
  const snow = new Field(scene, {
    count: 380, size: 0.075, color: 0xfdfdff, tex: starTex(), opacity: 0.92,
    gravity: 0.55, drift: 0.55,
  });
  const leaves = new Field(scene, {
    count: 150, size: 0.09, color: 0xd08840, tex: petalTex(), opacity: 0.95,
    gravity: 0.65, drift: 1.05,
  });
  const petals = new Field(scene, {
    count: 170, size: 0.06, color: PAL.petal, tex: petalTex(), opacity: 0.9,
    gravity: 0.42, drift: 0.9,
  });
  const motes = new Field(scene, {
    count: 130, size: 0.035, color: 0xfff4d2, tex: starTex(), opacity: 0.5,
    gravity: -0.05, drift: 0.28, blend: THREE.AdditiveBlending,
  });
  const flies = new Field(scene, {
    count: 90, size: 0.075, color: 0xd8f08a, tex: starTex(), opacity: 0.95,
    gravity: -0.02, drift: 0.7, blend: THREE.AdditiveBlending,
  });

  let t = 0;

  return {
    fields: { rain, snow, leaves, petals, motes, flies },

    update(dt, hog, camera, state) {
      t += dt;

      const wet = state.wet;
      const gardenPetals = placeAmt(hog.x, hog.z, BGARD) * state.w[0];
      const woodLeaves = clamp(state.leafFall * (0.5 + placeAmt(hog.x, hog.z, WOOD) * 0.8), 0, 1);

      rain.set(wet * (1 - state.snowFall) * 0.9);
      snow.set(state.snowFall);
      leaves.set(woodLeaves);
      petals.set(gardenPetals * 0.85);
      motes.set((1 - state.night) * (state.w[1] + state.w[0] * 0.5) * (1 - state.snowFall) * 0.7);
      flies.set(clamp((state.night - 0.4) / 0.4, 0, 1) * (state.w[1] + state.w[0]) * 0.8);

      // fireflies pulse; nothing else does
      flies.material.opacity = 0.55 + 0.4 * Math.sin(t * 2.2);

      const b = basisAt(hog.x, hog.z);
      positionAt(hog.x, hog.y + 1.2, hog.z, _origin);
      for (const f of [snow, leaves, petals, motes, flies]) {
        f.update(dt, _origin, b, t);
      }
      /* The rain leans instead of wobbling, and the lean is the real wind —
       * gusting, so a squall visibly comes through rather than the whole
       * shower sitting at one angle for its duration. */
      const gust = (state.wind ?? 0.2) * (2.6 + Math.sin(t * 0.31) + 0.4 * Math.sin(t * 1.7));
      rain.update(dt, _origin, b, gust, gust * 0.42);
    },
  };
}
