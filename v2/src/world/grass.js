import * as THREE from 'three';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { bladeTex } from '../core/textures.js';
import { rngKit, clamp, lerp, TAU } from '../core/util.js';
import { CIRC, PLACE_LEN, BAND, placeProp, hardAt } from './plan.js';
import { heightAt, waterDepthAt } from './terrain.js';

/* ------------------------------------------------------------------ *
 * The grass.
 *
 * v1's single most important idea was that **the camera looks across a flat
 * field from within the grass** — about 0.78 m of ground across a phone
 * screen — and that everything followed from it.  That idea does not
 * survive into three dimensions unchanged, because here the camera really
 * can move and depth really is depth.  What survives is the *scale*: he is
 * 26 cm long and 16 cm tall, and the grass reaches 33 cm, so he walks with
 * his back at the height of the stems and the camera has to look down into
 * the field to find him.  The first pass had blades at 0.55 m — true to a
 * real meadow, and it produced a green wall with a hedgehog somewhere
 * behind it.
 *
 * Three decisions carry the whole thing:
 *
 *  - **Chunks, not one field.**  250 instanced patches, each culled by
 *    distance in `update()`.  Instanced meshes take their bound from the
 *    source blade rather than the instance cloud, so three.js would either
 *    cull the entire meadow at once or none of it; doing it by hand is both
 *    cheaper and correct.
 *  - **Season is two uniforms, not a rebuild.**  v1's `SEA_LEN` and
 *    `SEA_DEN` become a length scale in the vertex shader and a live
 *    `instanceCount`, so the field lengthens into summer and thins into
 *    winter without touching a buffer.
 *  - **Wind is in the shader.**  Two sines phased off the instance's own
 *    position, weighted by height up the blade, so a gust crosses the field
 *    rather than every blade moving as one.
 * ------------------------------------------------------------------ */

const CHUNK_X = PLACE_LEN / 5;      // 6 m
const CHUNK_Z = 5.6;
const ROWS = Math.ceil((BAND + 1.5) * 2 / CHUNK_Z);
const COLS = Math.round(CIRC / CHUNK_X);

/** Tufts per square metre at full density. */
const DENSITY = 20;
/** What a dry tuft multiplies the season's green by: bleached, toward straw. */
const _DRY = new THREE.Color(1.55, 1.32, 0.72);
/** How far a chunk can be before it stops being drawn. */
const VIEW = 22;

/** One tuft: three crossed cards, bent forward, base at the origin. */
function tuftGeometry() {
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.030, 1, 1, 3);
    // bend: move the top forward so a blade arcs instead of standing rigid
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.5;              // 0 at base, 1 at tip
      pos.setY(v, y);
      pos.setZ(v, pos.getZ(v) + y * y * 0.16);
      pos.setX(v, pos.getX(v) * (1 - y * 0.35));
    }
    g.rotateY((i / 3) * Math.PI + 0.4);
    g.translate(0, 0, 0);
    cards.push(g);
  }
  const all = new THREE.BufferGeometry();
  const parts = cards.map((c) => c.attributes.position.array.length / 3);
  // simple manual merge: same attribute set on every card
  const total = parts.reduce((a, b) => a + b, 0);
  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  const U = new Float32Array(total * 2);
  const I = [];
  let off = 0;
  for (const c of cards) {
    const cp = c.attributes.position.array;
    const cn = c.attributes.normal.array;
    const cu = c.attributes.uv.array;
    P.set(cp, off * 3);
    N.set(cn, off * 3);
    U.set(cu, off * 2);
    const ci = c.index.array;
    for (let k = 0; k < ci.length; k++) I.push(ci[k] + off);
    off += cp.length / 3;
  }
  all.setAttribute('position', new THREE.BufferAttribute(P, 3));
  all.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  all.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  all.setIndex(I);
  cards.forEach((c) => c.dispose());
  return all;
}

/** Bolt wind and a season-driven length scale onto a cel material. */
function windPatch(mat, uniforms) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev?.(shader);
    shader.uniforms.uTime = uniforms.time;
    shader.uniforms.uWind = uniforms.wind;
    shader.uniforms.uLen = uniforms.len;
    shader.vertexShader = `
      uniform float uTime;
      uniform float uWind;
      uniform float uLen;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iSeed = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
        #else
          vec3 iSeed = vec3( 0.0 );
        #endif
        transformed.y *= uLen;
        float ph = iSeed.x * 0.9 + iSeed.z * 0.7 + iSeed.y * 0.3;
        float gust = sin( uTime * 1.15 + ph ) * 0.6 + sin( uTime * 2.7 + ph * 1.7 ) * 0.4;
        // weight by height up the blade: the root does not move
        float w = position.y * position.y;
        transformed.x += gust * uWind * w * 0.30;
        transformed.z += gust * uWind * w * 0.14;
      `
    );
  };
  const hex = mat.userData.shadowTint ? mat.userData.shadowTint.value.getHexString() : '0';
  mat.customProgramCacheKey = () => 'grassWind_' + hex;
  return mat;
}

export function buildGrass(parent) {
  const group = new THREE.Group();
  group.name = 'grass';

  const uniforms = {
    time: { value: 0 },
    wind: { value: 0.16 },
    len: { value: 1 },
  };

  const mat = cel({
    color: PAL.bramble,
    bands: 3,
    tint: 0x5d6a8c,
    flat: false,
    map: bladeTex(),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    role: 'grass',
  });
  windPatch(mat, uniforms);

  const geo = tuftGeometry();
  const rng = rngKit(4242);
  const chunks = [];

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const base = new THREE.Color();

  for (let cx = 0; cx < COLS; cx++) {
    for (let cz = 0; cz < ROWS; cz++) {
      const x0 = cx * CHUNK_X;
      const z0 = -(BAND + 1.5) + cz * CHUNK_Z;

      // how many tufts this chunk could hold, sampled at its middle
      const midX = x0 + CHUNK_X / 2;
      const dens = placeProp(midX, 'dens');
      const max = Math.round(CHUNK_X * CHUNK_Z * DENSITY * clamp(dens + 0.12, 0, 1.2));
      if (max < 4) continue;

      const list = [];
      for (let i = 0; i < max; i++) {
        const x = x0 + rng.next() * CHUNK_X;
        const z = z0 + rng.next() * CHUNK_Z;
        // nothing grows on tarmac, paving or under water
        if (hardAt(x) > 0.45 || waterDepthAt(x, z) > 0) continue;
        const y = heightAt(x, z);
        const lenScale = placeProp(x, 'len');
        const dry = placeProp(x, 'dry');
        const h = rng.range(0.10, 0.30) * lerp(0.7, 1.15, lenScale);

        pos.set(x, y - 0.01, z);
        q.setFromAxisAngle(up, rng.range(0, TAU));
        scl.set(rng.range(0.8, 1.25), h, rng.range(0.8, 1.25));
        m.compose(pos, q, scl);

        /* Instance colour is a **multiplier around white**, not a colour.
         * The material carries the season's green and this only says how
         * this tuft differs from it — lighter, darker, or bleached toward
         * straw where the place is dry.  Put an absolute green here as well
         * and the two multiply into something nearly black. */
        base.setRGB(1, 1, 1).lerp(_DRY, dry * rng.range(0.3, 0.9));
        col.copy(base).multiplyScalar(rng.range(0.78, 1.22));
        list.push({ m: m.clone(), c: col.clone() });
      }
      if (!list.length) continue;

      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, it.c);
      });
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = true;
      im.userData.maxCount = list.length;
      im.userData.cx = midX;
      im.userData.cz = z0 + CHUNK_Z / 2;
      im.frustumCulled = false;
      group.add(im);
      chunks.push(im);
    }
  }

  parent.add(group);

  let blades = chunks.reduce((a, c) => a + c.userData.maxCount, 0);

  return {
    group,
    chunks,
    material: mat,
    uniforms,
    blades,

    /** Season: `len` lengthens the blade, `den` thins the field. */
    setSeason(len, den) {
      uniforms.len.value = len;
      for (const c of chunks) {
        /* Clamped to what was actually allocated.  Summer's density weight
         * is 1.06 — v1's `SEA_DEN`, where it multiplied a spawn count — and
         * setting `count` past the length of the instance buffer does not
         * draw 6 % more grass, it draws **no grass at all**.  The field
         * simply was not there in summer and nothing was logged. */
        const max = c.userData.maxCount;
        c.count = clamp(Math.floor(max * den), 1, max);
      }
    },

    setWind(w) { uniforms.wind.value = w; },

    /**
     * Distance culling, done by hand.  Everything past `VIEW` is switched
     * off; the fog closes at 24 m, so nothing switches off in sight.
     */
    update(dt, hogX, hogZ) {
      uniforms.time.value += dt;
      for (const c of chunks) {
        const dx = Math.abs(((c.userData.cx - hogX + CIRC * 1.5) % CIRC) - CIRC / 2);
        const dz = c.userData.cz - hogZ;
        c.visible = dx * dx + dz * dz < VIEW * VIEW;
      }
    },
  };
}
