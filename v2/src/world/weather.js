import * as THREE from 'three';
import { PAL } from '../core/palette.js';
import { starTex, petalTex } from '../core/textures.js';
import { rngKit, clamp, lerp, TAU } from '../core/util.js';
import { positionAt, basisAt, flatAt } from './planet.js';
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

const _m = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _flat = { x: 0, z: 0, y: 0 };

export function createWeather(scene) {
  const rain = new Field(scene, {
    count: 420, size: 0.055, color: 0xbcd6e8, tex: starTex(), opacity: 0.55,
    gravity: 9.5, drift: 0.5,
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
      const gardenPetals = placeAmt(hog.x, BGARD) * state.w[0];
      const woodLeaves = clamp(state.leafFall * (0.5 + placeAmt(hog.x, WOOD) * 0.8), 0, 1);

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
      for (const f of [rain, snow, leaves, petals, motes, flies]) {
        f.update(dt, _origin, b, t);
      }
    },
  };
}
