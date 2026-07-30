import * as THREE from 'three';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { noise2, lerp, clamp } from '../core/util.js';
import { rippleTex } from '../core/textures.js';
import {
  PLACE_LEN, COUNT, ORDER, PLACE, LAKE, placeAt, lakeAt,
} from './plan.js';
import { heightAt, WATER_Y } from './terrain.js';

/* ------------------------------------------------------------------ *
 * The ground.
 *
 * One height field, sampled from `terrain.heightAt`, built as ten chunks —
 * one per place — so that the frustum can throw away the nine you are not
 * standing in.  It is a single material; the ten places differ by **vertex
 * colour**, crossfaded across their boundaries by the same `placeAt` blend
 * everything else uses.  That is the cheapest possible version of v1's
 * per-zone palette: no extra draw calls, and the edges fade rather than
 * snap, which was the thing v1 got right and had to keep getting right.
 *
 * Season is a multiply on top, driven through the material's `role`, so the
 * whole field can go from spring green to winter fawn without touching a
 * vertex.
 * ------------------------------------------------------------------ */

/** Grid spacing. 0.75 m across the field, which is about two hog-lengths. */
const STEP = 0.75;
/** How far out the graded grid reaches before the bare sphere takes over. */
const HALF_Z = 34;

const _cA = new THREE.Color();
const _cB = new THREE.Color();

/**
 * The mean of the ten place colours.
 *
 * Vertex colour here is **relative**, not absolute: the material carries the
 * season's real ground colour and the vertices only say how this place
 * differs from the average one.  Authored the other way round — a soil
 * colour in the vertices *and* a soil colour on the material — the two
 * multiply and the whole field comes out very nearly black, which is
 * exactly what the first build of this did.
 */
const MEAN = (() => {
  const m = new THREE.Color(0, 0, 0);
  const c = new THREE.Color();
  const list = Object.values(PLACE);
  for (const p of list) {
    c.set(p.ground);
    m.r += c.r / list.length;
    m.g += c.g / list.length;
    m.b += c.b / list.length;
  }
  return m;
})();

/** How this place's ground differs from the average, crossfaded at the edge. */
function groundColorAt(x, out = new THREE.Color()) {
  const m = placeAt(x);
  _cA.set(PLACE[m.a].ground);
  if (m.t) {
    _cB.set(PLACE[m.b].ground);
    _cA.lerp(_cB, m.t);
  }
  return out.setRGB(_cA.r / MEAN.r, _cA.g / MEAN.g, _cA.b / MEAN.b);
}

export function buildGround(parent) {
  const group = new THREE.Group();
  group.name = 'ground';

  const mat = cel({
    color: 0xffffff,      // season multiplies this; the colour is in the vertices
    bands: 3,
    tint: 0x6b6392,
    flat: false,
    vertexColors: true,
    role: 'groundTint',
  });

  const rows = Math.round((HALF_Z * 2) / STEP);
  const colsPer = Math.round(PLACE_LEN / STEP);
  const col = new THREE.Color();
  const chunks = [];

  for (let p = 0; p < COUNT; p++) {
    const x0 = p * PLACE_LEN;
    const nx = colsPer, nz = rows;
    const verts = (nx + 1) * (nz + 1);
    const pos = new Float32Array(verts * 3);
    const cols = new Float32Array(verts * 3);
    const idx = [];

    for (let j = 0; j <= nz; j++) {
      const z = -HALF_Z + j * STEP;
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * STEP;
        const k = (j * (nx + 1) + i) * 3;
        pos[k] = x;
        pos[k + 1] = heightAt(x, z);
        pos[k + 2] = z;

        groundColorAt(x, col);
        /* Mottling.  Without it the ground reads as a single flat wash under
         * the toon ramp, which is fine in a street and wrong in a field —
         * bare soil, moss and dead grass all show through at this scale.
         * Two octaves, deliberately coarse: fine noise vanishes into the
         * ink pass and costs the same. */
        const n = noise2(x * 0.31, z * 0.31, 17) * 0.7 + noise2(x * 1.1, z * 1.1, 91) * 0.3;
        const shade = 0.86 + n * 0.30;
        // wetter, darker ground toward the water and the mire's middle
        const wet = clamp(lakeAt(x) * 1.4, 0, 1);
        cols[k] = col.r * shade * (1 - wet * 0.35);
        cols[k + 1] = col.g * shade * (1 - wet * 0.22);
        cols[k + 2] = col.b * shade * (1 - wet * 0.10);
      }
    }

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + (nx + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    /* Smooth normals, and keep them through the bake.  The bake recomputes
     * normals from the bent faces by default, which on a 0.75 m grid is a
     * visible facet grid across a field that is meant to read as one soft
     * surface. */
    mesh.userData.smoothNormals = true;
    mesh.name = `ground:${PLACE[ORDER[p]].name}`;
    group.add(mesh);
    chunks.push(mesh);
  }

  parent.add(group);
  return { group, chunks, material: mat };
}

/* --------------------------------- water --------------------------------- */

/**
 * The lake surface: one flat sheet at `WATER_Y`, running the full width of
 * the field and out past it, with a scrolling ripple map.
 *
 * It is a **surface above the terrain, not a hole in it**.  The bed is dug
 * by `heightAt`, so the shoreline is simply wherever the bed crosses the
 * water level — a contour, not a piece of authored geometry, and it stays
 * correct however the bed is retuned.
 */
export function buildWater(parent) {
  const group = new THREE.Group();
  group.name = 'water';

  const tex = rippleTex();
  tex.repeat.set(6, 18);

  const mat = cel({
    color: PAL.water,
    bands: 2,
    tint: 0x59718f,
    flat: false,
    map: tex,
    transparent: true,
    opacity: 0.88,
    role: 'water',
  });
  mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;

  // wide enough to run off past the graded grid in both directions
  const geo = new THREE.PlaneGeometry(PLACE_LEN, HALF_Z * 2 + 8, 24, 40);
  geo.rotateX(-Math.PI / 2);
  const lakeSlot = ORDER.indexOf(LAKE);
  geo.translate(lakeSlot * PLACE_LEN + PLACE_LEN / 2, WATER_Y, 0);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.noShadow = true;
  mesh.userData.smoothNormals = true;
  mesh.renderOrder = 2;
  group.add(mesh);

  parent.add(group);

  return {
    group,
    material: mat,
    update(dt) {
      // the ripple map drifts; the sheet itself never moves
      tex.offset.y -= dt * 0.012;
      tex.offset.x += dt * 0.004;
    },
  };
}
