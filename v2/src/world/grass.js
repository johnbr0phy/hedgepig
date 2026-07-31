import * as THREE from 'three';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { bladeTex } from '../core/textures.js';
import { mulberry32, clamp, lerp, TAU } from '../core/util.js';
import { R, CIRC, placeProp, hardAt, distance } from './plan.js';
import { heightAt, waterDepthAt } from './terrain.js';
import { positionAt, basisAt } from './planet.js';

/* ------------------------------------------------------------------ *
 * The meadow.
 *
 * The world has no walls now, so the grass has to cover a whole sphere —
 * 28 650 m², against the 7 800 m² of the old walkable band.  At the density
 * this wants that is close to a million tufts, which cannot be built up
 * front and should not be: you can only ever see twenty-two metres of it.
 *
 * So it **streams**.  A fixed pool of instanced patches is dealt out to the
 * cells nearest him and rebuilt as he walks, a couple of cells a frame so
 * that nothing hitches.  Each cell's contents are a pure function of its own
 * coordinates, so a patch you walk away from and come back to is the same
 * patch, blade for blade.
 *
 * The cells are **equal-area** — latitude rows, each holding as many columns
 * as its own circumference will take.  A plain lat/long grid would put
 * hundreds of slivers at the poles and enormous cells at the equator.
 *
 * Two things happen in the vertex shader, and between them they are most of
 * what makes it read as grass rather than as scenery:
 *
 *  - **wind**, two sines phased off each tuft's own position, so a gust
 *    crosses the field instead of every blade moving as one;
 *  - **him**, pushing it aside as he goes.  v1 fed his bulk and his nose
 *    into the blade solver every frame, and it is half of why that hedgehog
 *    felt like he was *in* the field rather than on top of it.
 * ------------------------------------------------------------------ */

/** Target cell size, in metres of arc. */
const CELL = 5.0;
/** How far grass is drawn. The fog closes well inside this. */
const VIEW = 21;
/** Tufts per square metre before the place's own weighting. */
const DENSITY = 26;
/** Per-patch capacity, and how many patches stay alive at once. */
const CAP = 900;
const POOL = 108;
/** Cells rebuilt per frame — the whole point of streaming is not to hitch. */
const BUILD_BUDGET = 2;

/* ----------------------------- the cell grid ----------------------------- */

const ROWS = Math.max(4, Math.round((Math.PI * R) / CELL));
const ROW_H = (Math.PI * R) / ROWS;
const COLS = [];
const ROW_Z = [];
for (let r = 0; r < ROWS; r++) {
  const lat = -Math.PI / 2 + ((r + 0.5) * Math.PI) / ROWS;
  ROW_Z.push(lat * R);
  COLS.push(Math.max(1, Math.round((CIRC * Math.cos(lat)) / CELL)));
}

const cellKey = (r, c) => r * 4096 + c;
const cellCentre = (r, c) => ({ x: ((c + 0.5) / COLS[r]) * CIRC, z: ROW_Z[r] });

/** One tuft: four crossed cards, bent forward, base at the origin. */
function tuftGeometry() {
  const cards = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(0.028, 1, 1, 3);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.5;                 // 0 at the base, 1 at the tip
      pos.setY(v, y);
      pos.setZ(v, pos.getZ(v) + y * y * 0.18);     // an arc, not a spike
      pos.setX(v, pos.getX(v) * (1 - y * 0.42));   // tapering to a point
    }
    g.rotateY((i / 4) * Math.PI + 0.35);
    cards.push(g);
  }
  const total = cards.reduce((a, c) => a + c.attributes.position.count, 0);
  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  const U = new Float32Array(total * 2);
  const I = [];
  let off = 0;
  for (const c of cards) {
    P.set(c.attributes.position.array, off * 3);
    N.set(c.attributes.normal.array, off * 3);
    U.set(c.attributes.uv.array, off * 2);
    for (const k of c.index.array) I.push(k + off);
    off += c.attributes.position.count;
  }
  const all = new THREE.BufferGeometry();
  all.setAttribute('position', new THREE.BufferAttribute(P, 3));
  all.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  all.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  all.setIndex(I);
  cards.forEach((c) => c.dispose());
  return all;
}

/** Wind, a season length scale, and him — bolted onto a cel material. */
function windPatch(mat, u) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev?.(shader);
    Object.assign(shader.uniforms, {
      uTime: u.time, uWind: u.wind, uLen: u.len, uHog: u.hog, uHogR: u.hogR,
      uTrail: u.trail,
    });
    shader.vertexShader = `
      uniform float uTime;
      uniform float uWind;
      uniform float uLen;
      uniform vec3  uHog;
      uniform float uHogR;
      uniform vec4  uTrail[16];
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        /* Instances are placed in world space, so column three of the
         * instance matrix is the tuft's own position on the planet — which
         * is both the phase seed for the wind and what we measure him
         * against. */
        vec3 root = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );

        transformed.y *= uLen;
        float up = position.y * position.y;          // the root never moves

        float ph = root.x * 0.9 + root.z * 0.7 + root.y * 0.3;
        float gust = sin( uTime * 1.15 + ph ) * 0.6 + sin( uTime * 2.7 + ph * 1.7 ) * 0.4;
        transformed.x += gust * uWind * up * 0.30;
        transformed.z += gust * uWind * up * 0.14;

        /* He pushes it aside.  Measured in world space and then brought back
         * into the tuft's own frame, because every blade on a sphere stands
         * in a different direction. */
        vec3 ex = normalize( vec3( instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2] ) );
        vec3 ez = normalize( vec3( instanceMatrix[2][0], instanceMatrix[2][1], instanceMatrix[2][2] ) );
        vec3 away = root - uHog;
        float d = length( away );
        if ( d < uHogR ) {
          float k = 1.0 - d / uHogR;
          k = k * k * ( 3.0 - 2.0 * k );
          vec3 dir = normalize( away + vec3( 1e-5 ) );
          transformed.x += dot( dir, ex ) * k * up * 0.45;
          transformed.z += dot( dir, ez ) * k * up * 0.45;
          transformed.y -= k * up * 0.30 * transformed.y;      // and flattens it
        }

        /* And the grass REMEMBERS him: a wake of recently-walked-over spots,
         * each still half-bent and slowly standing back up.  Only the
         * STRONGEST marker bends a given blade — markers overlap wherever he
         * lingers, and summing them folded blades through the ground into
         * little green diamonds lying all around him. */
        float bk = 0.0;
        vec3 bdir = vec3( 0.0 );
        for ( int i = 0; i < 16; i++ ) {
          float tw = uTrail[i].w;
          if ( tw <= 0.0 ) continue;
          vec3 taway = root - uTrail[i].xyz;
          float td = length( taway );
          if ( td < 0.26 ) {
            float tk = ( 1.0 - td / 0.26 );
            tk = tk * tk * tw;
            if ( tk > bk ) { bk = tk; bdir = normalize( taway + vec3( 1e-5 ) ); }
          }
        }
        if ( bk > 0.0 ) {
          transformed.x += dot( bdir, ex ) * bk * up * 0.34;
          transformed.z += dot( bdir, ez ) * bk * up * 0.34;
          transformed.y -= bk * up * 0.38 * transformed.y;
        }
      `
    );
  };
  const hex = mat.userData.shadowTint ? mat.userData.shadowTint.value.getHexString() : '0';
  mat.customProgramCacheKey = () => 'grassWindPush_' + hex;
  return mat;
}

export function buildGrass(parent) {
  const group = new THREE.Group();
  group.name = 'grass';

  const uniforms = {
    time: { value: 0 },
    wind: { value: 0.16 },
    len: { value: 1 },
    hog: { value: new THREE.Vector3(1e6, 1e6, 1e6) },
    hogR: { value: 0.34 },
    trail: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
  let seasonDen = 1;

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

  const patches = [];
  for (let i = 0; i < POOL; i++) {
    const im = new THREE.InstancedMesh(geo, mat, CAP);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = true;
    im.visible = false;
    im.userData.key = -1;
    im.userData.full = 0;
    group.add(im);
    patches.push(im);
  }
  parent.add(group);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _spin = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _fm = new THREE.Matrix4();
  const _col = new THREE.Color();
  const _dry = new THREE.Color(1.55, 1.32, 0.72);

  /** How many of a patch's tufts are drawn, given the season. */
  const trim = (im) => {
    im.count = clamp(Math.round(im.userData.full * seasonDen), im.userData.full ? 1 : 0, im.userData.full);
    im.visible = im.count > 0;
  };

  /** Fill one patch with the tufts belonging to cell (r, c). */
  function fill(im, r, c) {
    const rng = mulberry32((cellKey(r, c) * 2654435761) >>> 0);
    const cols = COLS[r];
    const x0 = (c / cols) * CIRC;
    const dx = CIRC / cols;
    const z0 = ROW_Z[r] - ROW_H / 2;
    const lat = ROW_Z[r] / R;
    const area = dx * Math.max(0.02, Math.cos(lat)) * ROW_H;

    const want = Math.min(CAP, Math.round(area * DENSITY * 1.35));
    let k = 0;
    for (let i = 0; i < want && k < CAP; i++) {
      const x = x0 + rng() * dx;
      const z = z0 + rng() * ROW_H;
      if (hardAt(x, z) > 0.45) continue;
      if (waterDepthAt(x, z) > 0) continue;

      // thin by place: the meadow is thick, the farmyard is scratched bare
      const dens = placeProp(x, z, 'dens');
      if (rng() > clamp(dens, 0, 1.3) / 1.3) continue;

      const y = heightAt(x, z) - 0.01;
      const lenScale = placeProp(x, z, 'len');
      const dry = placeProp(x, z, 'dry');
      const h = (0.10 + rng() * 0.22) * lerp(0.7, 1.15, lenScale);

      const b = basisAt(x, z);
      _fm.makeBasis(b.east, b.up, b.north);
      _q.setFromRotationMatrix(_fm);
      _spin.setFromAxisAngle(_up, rng() * TAU);
      _q.multiply(_spin);
      positionAt(x, y, z, _p);
      _s.set(0.8 + rng() * 0.5, h, 0.8 + rng() * 0.5);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);

      /* Instance colour is a **multiplier around white**, not a colour: the
       * material carries the season's green and this only says how this tuft
       * differs from it.  An absolute green here would multiply with that one
       * into something very nearly black. */
      _col.setRGB(1, 1, 1).lerp(_dry, dry * (0.3 + rng() * 0.6));
      _col.multiplyScalar(0.78 + rng() * 0.44);
      im.setColorAt(k, _col);
      k++;
    }
    im.userData.full = k;
    im.userData.key = cellKey(r, c);
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    trim(im);
  }

  /* ----------------------------- the streaming ----------------------------- */
  const live = new Map();
  let queue = [];
  let lastX = 1e9, lastZ = 1e9;
  let trailX = 1e9, trailZ = 1e9, trailHead = 0;
  let blades = 0;

  function reseat(px, pz) {
    const wanted = [];
    for (let r = 0; r < ROWS; r++) {
      if (Math.abs(ROW_Z[r] - pz) > VIEW + CELL) continue;
      for (let c = 0; c < COLS[r]; c++) {
        const q = cellCentre(r, c);
        const d = distance(px, pz, q.x, q.z);
        if (d > VIEW + CELL * 0.75) continue;
        wanted.push({ r, c, key: cellKey(r, c), d });
      }
    }
    const keep = new Set(wanted.map((w) => w.key));
    for (const [key, im] of [...live]) {
      if (!keep.has(key)) {
        im.visible = false;
        im.count = 0;
        im.userData.key = -1;
        im.userData.full = 0;
        live.delete(key);
      }
    }
    // nearest first, so what appears next to him appears first
    queue = wanted.filter((w) => !live.has(w.key)).sort((a, b) => a.d - b.d);
  }

  function service(budget) {
    let done = 0;
    while (queue.length && done < budget) {
      const w = queue.shift();
      if (live.has(w.key)) continue;
      const im = patches.find((m) => m.userData.key === -1);
      if (!im) break;                    // pool exhausted; it catches up next frame
      fill(im, w.r, w.c);
      live.set(w.key, im);
      done++;
    }
    if (done) {
      blades = 0;
      for (const im of live.values()) blades += im.count;
    }
  }

  const _hogWorld = new THREE.Vector3();

  return {
    group,
    material: mat,
    uniforms,
    cells: { ROWS, CELL, POOL, CAP, VIEW },
    get chunks() { return [...live.values()]; },
    get blades() { return blades; },
    get liveCells() { return live.size; },
    get pending() { return queue.length; },

    /** Season: `len` lengthens the blade, `den` thins the field. */
    setSeason(len, den) {
      uniforms.len.value = len;
      seasonDen = clamp(den, 0.05, 1);
      for (const im of live.values()) trim(im);
    },

    setWind(w) { uniforms.wind.value = w; },

    /** Fill everything in view at once — for a screenshot, or for a test. */
    prime(x, z) {
      reseat(x, z);
      service(queue.length + 1);
      lastX = x; lastZ = z;
    },

    update(dt, hogX, hogZ, hogY = 0) {
      uniforms.time.value += dt;
      positionAt(hogX, hogY + 0.05, hogZ, _hogWorld);
      uniforms.hog.value.copy(_hogWorld);

      /* The wake: drop a marker every third of a metre of HIS ground (not
       * per second — a standing hedgehog lays no trail), and let every
       * marker stand back up over ten seconds. */
      const trail = uniforms.trail.value;
      for (const t of trail) if (t.w > 0) t.w = Math.max(0, t.w - dt / 10);
      if (distance(hogX, hogZ, trailX, trailZ) > 0.32) {
        trailX = hogX; trailZ = hogZ;
        const slot = trail[trailHead];
        trailHead = (trailHead + 1) % trail.length;
        slot.set(_hogWorld.x, _hogWorld.y, _hogWorld.z, 1);
      }

      if (distance(hogX, hogZ, lastX, lastZ) > CELL * 0.35) {
        reseat(hogX, hogZ);
        lastX = hogX; lastZ = hogZ;
      }
      service(BUILD_BUDGET);
    },
  };
}
