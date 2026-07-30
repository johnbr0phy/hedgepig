import * as THREE from 'three';
import { PAL } from './palette.js';

/* ------------------------------------------------------------------ *
 * Cel shading.
 *
 * Everything visible uses MeshToonMaterial with a hand-authored ramp, so
 * direct light is quantised into 2–4 flat bands instead of falling off
 * smoothly.  On top of that the toon BRDF is patched so the darker bands are
 * *tinted* toward a cool violet rather than being a darker version of the
 * base colour.  That hue shift in shade is most of what separates "anime
 * cel" from "low-poly 3D", and it is the one thing to keep if anything here
 * ever has to be simplified.
 *
 * The one addition over a straight port: a **role registry**.  v1 recomputed
 * every colour from the season inside the draw call; here a material can
 * declare that it is grass, or foliage, or water, and `season.js` re-tints
 * the whole world once a frame by walking that registry.  It is the same
 * idea, moved out of the inner loop.
 * ------------------------------------------------------------------ */

const RAMPS = {
  2: [96, 255],
  3: [92, 178, 255],
  4: [80, 142, 202, 255],
  5: [74, 124, 172, 214, 255],
  // high-key ramps, for pale masses that must stay light on the shadow side:
  // blossom, snow, and the hedgepig's cream front
  soft: [180, 255],
  soft3: [172, 214, 255],
};

const rampCache = new Map();

export function gradientMap(bands = 3) {
  if (rampCache.has(bands)) return rampCache.get(bands);
  const stops = RAMPS[bands] || RAMPS[3];
  const data = new Uint8Array(stops.length * 4);
  for (let i = 0; i < stops.length; i++) {
    data[i * 4 + 0] = stops[i];
    data[i * 4 + 1] = stops[i];
    data[i * 4 + 2] = stops[i];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(bands, tex);
  return tex;
}

const TOON_CHUNK = 'lights_toon_pars_fragment';
const TOON_LINE =
  'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;';
const TOON_PATCH = `
	vec3 celBand = getGradientIrradiance( geometryNormal, directLight.direction );
	vec3 irradiance = celBand * mix( uShadowTint, vec3( 1.0 ), celBand ) * directLight.color;`;

let patchAvailable = false;
let patchedChunk = '';
{
  const src = THREE.ShaderChunk[TOON_CHUNK];
  if (src && src.includes(TOON_LINE)) {
    patchedChunk = 'uniform vec3 uShadowTint;\n' + src.replace(TOON_LINE, TOON_PATCH);
    patchAvailable = true;
  }
}

/** Tint the shadow side of a toon material toward a cool hue. */
function applyShadowTint(mat, tint) {
  if (!patchAvailable) return mat;
  const uni = { value: new THREE.Color(tint) };
  mat.userData.shadowTint = uni;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = uni;
    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <${TOON_CHUNK}>`,
      patchedChunk
    );
  };
  const hex = new THREE.Color(tint).getHexString();
  mat.customProgramCacheKey = () => 'celTint_' + hex;
  return mat;
}

const matCache = new Map();

/**
 * Cel material factory.  Results are cached by parameter signature so the
 * whole meadow ends up sharing a couple of dozen shader programs.
 *
 * Pass `role` to have `season.js` drive the colour; a role always implies
 * `cache: false`, because two call sites sharing one material would then
 * fight over its colour.
 */
export function cel(opts = {}) {
  const {
    color = 0xffffff,
    bands = 3,
    tint = 0x6b5f8e,
    flat: flatShading = true,
    map = null,
    emissive = null,
    emissiveIntensity = 1,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
    alphaTest = 0,
    depthWrite = null,
    fog = true,
    alphaMap = null,
    vertexColors = false,
    role = null,
    cache = true,
  } = opts;

  const cacheable = cache && !map && !alphaMap && !role;
  const key = cacheable
    ? [color, bands, tint, flatShading, emissive, emissiveIntensity, transparent,
       opacity, side, alphaTest, depthWrite, fog, vertexColors].join('|')
    : null;
  if (key && matCache.has(key)) return matCache.get(key);

  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(bands),
    map,
    alphaMap,
    transparent,
    opacity,
    side,
    alphaTest,
    fog,
    vertexColors,
    emissive: emissive === null ? 0x000000 : emissive,
    emissiveIntensity,
  });
  /* Assigned rather than passed in.  `MeshToonMaterial` does not declare
   * `flatShading`, so handing it to the constructor gets it dropped with a
   * warning — three hundred of them on this world's material set.  The
   * renderer reads `material.flatShading` directly when it builds the
   * program, so setting it here does work, and faceting is not optional for
   * this look: it is what makes a rock read as carved rather than inflated. */
  mat.flatShading = flatShading === true;
  if (depthWrite !== null) mat.depthWrite = depthWrite;
  applyShadowTint(mat, tint);
  if (key) matCache.set(key, mat);
  if (role) registerRole(mat, role);
  return mat;
}

const flatCache = new Map();

/** Unlit flat colour — sky, distant silhouettes, glowing windows, water film. */
export function flat(opts = {}) {
  const {
    color = 0xffffff,
    map = null,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
    alphaTest = 0,
    depthWrite = null,
    fog = true,
    role = null,
    cache = true,
    toneMapped = true,
  } = opts;
  const cacheable = cache && !map && !role;
  const key = cacheable
    ? [color, transparent, opacity, side, alphaTest, depthWrite, fog, toneMapped].join('|')
    : null;
  if (key && flatCache.has(key)) return flatCache.get(key);
  const mat = new THREE.MeshBasicMaterial({
    color, map, transparent, opacity, side, alphaTest, fog, toneMapped,
  });
  if (depthWrite !== null) mat.depthWrite = depthWrite;
  if (key) flatCache.set(key, mat);
  if (role) registerRole(mat, role);
  return mat;
}

/* ------------------------------ the registry ------------------------------ */

/** role -> [materials].  Small: about a dozen roles across the whole world. */
const roles = new Map();

export function registerRole(mat, role) {
  mat.userData.role = role;
  if (!roles.has(role)) roles.set(role, []);
  roles.get(role).push(mat);
  return mat;
}

/**
 * Re-tint the world.  `colors` is {role: hexOrColor}; unknown roles are
 * ignored so the season table and the material set can drift apart safely.
 *
 * `emissive` roles (lit windows, fireflies) are handled by the same call
 * with a `role:emissive` prefix so night can bring them up without a second
 * mechanism.
 */
const _c = new THREE.Color();
export function applyPalette(colors) {
  for (const key in colors) {
    const list = roles.get(key);
    if (!list) continue;
    const v = colors[key];
    if (v && v.isColor) _c.copy(v); else _c.set(v);
    for (const m of list) m.color.copy(_c);
  }
}

/** Every material carrying `role`, for anything the palette cannot express. */
export function materialsWithRole(role) {
  return roles.get(role) || [];
}

/** Push a new shadow tint into every cel material at once — night does this. */
export function setShadowTint(hex) {
  const c = new THREE.Color(hex);
  for (const list of roles.values()) {
    for (const m of list) m.userData.shadowTint?.value.copy(c);
  }
  for (const m of matCache.values()) m.userData.shadowTint?.value.copy(c);
}

/** Shorthands used all over the world builders. */
export const MAT = {
  get ink() { return flat({ color: PAL.ink, fog: false }); },
};
