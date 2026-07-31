import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { rippleTex } from '../core/textures.js';
import { TAU, clamp, noise2 } from '../core/util.js';
import { R, CENTRE, LAKE, LAKE_R, PLACE, COUNT, placeWeights, lakeAt, offsetFrom, flatOf } from './plan.js';
import { CENTER, positionAt } from './planet.js';
import { heightAt, WATER_Y } from './terrain.js';

/* ------------------------------------------------------------------ *
 * The ground, which is now the globe.
 *
 * There used to be two surfaces: a graded grid over the walkable band, and a
 * bare sphere underneath it for everything you could see but not reach.
 * They had to agree to within 65 mm and the whole apparatus existed because
 * the world had an inside and an outside.  It does not any more, so there is
 * one surface: an icosphere, every vertex displaced by `heightAt`, coloured
 * by which place it belongs to.  It cannot disagree with itself.
 *
 * **Indexed, then displaced.**  `IcosahedronGeometry` comes back non-indexed
 * — 64 000 vertices for 21 000 triangles — and welding it first cuts that to
 * 10 800, which is a sixth of the `heightAt` calls and, more importantly,
 * gives `computeVertexNormals` shared vertices to average across.  Left
 * non-indexed, every vertex takes its own face's normal and the planet reads
 * as a golf ball under the toon ramp.
 * ------------------------------------------------------------------ */

/** 21 500 triangles, a 1.5 m facet, and a 3 mm sag against the true sphere. */
const DETAIL = 32;

const _c = new THREE.Color();
const _cb = new THREE.Color();

/** The mean of the ten place colours — see the note on relative colour below. */
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

export function buildGround(scene) {
  const group = new THREE.Group();
  group.name = 'ground';

  const geo = mergeVertices(new THREE.IcosahedronGeometry(R, DETAIL), 1e-4);
  const pos = geo.attributes.position;
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const flat = { x: 0, z: 0 };
  const cols = new Float32Array(pos.count * 3);
  const weights = new Float64Array(COUNT);

  for (let i = 0; i < pos.count; i++) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    flatOf(n, flat);
    const h = heightAt(flat.x, flat.z);
    p.copy(n).multiplyScalar(R + h).add(CENTER);
    pos.setXYZ(i, p.x, p.y, p.z);

    /* Vertex colour is **relative**: the material carries the season's real
     * ground colour and the vertices only say how this place differs from
     * the average one.  Authored the other way round — a soil colour in the
     * vertices and a soil colour on the material — the two multiply and the
     * whole world comes out very nearly black, which is what the first build
     * of this did. */
    placeWeights(flat.x, flat.z, weights);
    _c.setRGB(0, 0, 0);
    for (let k = 0; k < COUNT; k++) {
      if (weights[k] <= 0) continue;
      _cb.set(PLACE[k].ground);
      _c.r += _cb.r * weights[k];
      _c.g += _cb.g * weights[k];
      _c.b += _cb.b * weights[k];
    }
    /* A second signal at a smaller scale than a place: patches of moss in
     * the damp and dry bare soil, a few metres across.  Ten place colours
     * blended over a whole sphere average out to one olive wash; this is
     * the variation that makes the ground read as ground and not as paint.
     * And the places themselves pushed a little apart from their mean, so
     * crossing a boundary is something you can see underfoot. */
    _c.r = MEAN.r + (_c.r - MEAN.r) * 1.22;
    _c.g = MEAN.g + (_c.g - MEAN.g) * 1.22;
    _c.b = MEAN.b + (_c.b - MEAN.b) * 1.22;
    const moss = noise2(flat.x * 0.31, flat.z * 0.31, 401);         // damp green, ~3 m
    const soil = noise2(flat.x * 0.13 + 40, flat.z * 0.13, 977);    // dry pale, ~8 m
    const mossy = clamp((moss - 0.62) * 2.2, 0, 1) * 0.14;
    const dry = clamp((soil - 0.66) * 2.4, 0, 1) * 0.12;
    _c.r *= 1 - mossy * 0.5 + dry * 0.9;
    _c.g *= 1 + mossy * 0.25 + dry * 0.55;
    _c.b *= 1 - mossy * 0.4 + dry * 0.15;

    // damp and darken where the lake has soaked it
    const wet = clamp(lakeAt(flat.x, flat.z) * 1.5, 0, 1);
    cols[i * 3] = (_c.r / MEAN.r) * (1 - wet * 0.30);
    cols[i * 3 + 1] = (_c.g / MEAN.g) * (1 - wet * 0.20);
    cols[i * 3 + 2] = (_c.b / MEAN.b) * (1 - wet * 0.08);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = cel({
    color: 0xffffff,        // the season multiplies this; the place is in the vertices
    bands: 4,
    tint: 0x6b6392,
    flat: false,
    vertexColors: true,
    role: 'groundTint',
  });

  /* **Snow has to reach the vertex colours, not just the material.**
   *
   * The place tint lives in the vertices as a multiplier around white, which
   * is the rule that keeps the season's real colour on the material — and it
   * means whitening the material does not whiten the *hue*. Under deep snow
   * the material is very nearly white, so the vertex multiplier becomes the
   * only colour left in the ground; in sunlight the top toon band clips it
   * away and you cannot see it, and in **shadow** it is all there is. What
   * that produced was a white field with a bright green hedgehog-shaped hole
   * in it, and it read as a shading bug rather than as an unpainted tint.
   *
   * One uniform, one line of vertex shader: snow lerps the whole multiplier
   * to one. Rewriting 20 000 vertex colours per frame was the alternative. */
  const snowU = { value: 0 };
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    shader.uniforms.uSnow = snowU;
    shader.vertexShader = 'uniform float uSnow;\n' + shader.vertexShader.replace(
      '#include <color_vertex>',
      '#include <color_vertex>\n\tvColor = mix( vColor, vec3( 1.0 ), uSnow );'
    );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `ground|${prevKey ? prevKey() : ''}`;

  const land = new THREE.Mesh(geo, mat);
  land.receiveShadow = true;
  /* Must NOT cast: a closed sphere renders its far hemisphere into the
   * shadow map and drops the whole surface into its own shadow. */
  land.castShadow = false;
  land.frustumCulled = false;
  land.name = 'planetLand';
  group.add(land);

  scene.add(group);
  return {
    group, land, material: mat, chunks: [land],
    /** How much lying snow has covered the place tint over. */
    setSnow(v) { snowU.value = clamp(v, 0, 1); },
  };
}

/* --------------------------------- water --------------------------------- */

/**
 * The lake: a disc of water laid over the dish `heightAt` digs for it.
 *
 * It is a **surface above the terrain, not a hole in it** — the shoreline is
 * simply where the bed crosses `WATER_Y`, a contour rather than a piece of
 * authored geometry, so retuning the bed moves the shore on its own.
 */
export function buildWater(parent) {
  const group = new THREE.Group();
  group.name = 'water';

  const tex = rippleTex();
  tex.repeat.set(5, 5);

  const mat = cel({
    color: PAL.water,
    bands: 2,
    tint: 0x59718f,
    flat: false,
    map: tex,
    transparent: true,
    opacity: 0.9,
    role: 'water',
  });
  mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;

  /* A polar grid over the lake's own centre, laid out with the exponential
   * map so it stays a circle on the sphere rather than on the page. */
  const RINGS = 12, SEG = 40, RAD = LAKE_R + 1.5;
  const verts = [];
  const uvs = [];
  const idx = [];
  const at = { x: 0, z: 0 };
  for (let r = 0; r <= RINGS; r++) {
    const d = (r / RINGS) * RAD;
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * TAU;
      offsetFrom(CENTRE[LAKE], Math.cos(a) * d, Math.sin(a) * d, at);
      verts.push(at.x, WATER_Y, at.z);
      uvs.push(0.5 + Math.cos(a) * (d / RAD) * 0.5, 0.5 + Math.sin(a) * (d / RAD) * 0.5);
    }
  }
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = r * SEG + s;
      const b = r * SEG + ((s + 1) % SEG);
      const c = (r + 1) * SEG + s;
      const d = (r + 1) * SEG + ((s + 1) % SEG);
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

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
