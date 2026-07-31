import * as THREE from 'three';
import { blobTex } from './textures.js';
import { rngKit } from './util.js';
import { positionAt, basisAt } from '../world/planet.js';

/* ------------------------------------------------------------------ *
 * Puffs: the little dusts of contact.
 *
 * `weather.js` owns everything that falls out of the sky, in a box pinned
 * to the camera, and that is right for rain and wrong for a footstep: a
 * footstep happens at a *place*, and its dust has to stay at that place
 * while he runs on and the camera swings.  So these are world-anchored —
 * spawned in flat coordinates, seated onto the planet once at birth, and
 * never moved again except by their own velocity.
 *
 * One pool, one draw call, a tiny shader so each puff can fade on its own
 * clock — `PointsMaterial` has one opacity for the lot, and a shared fade
 * makes every footstep flicker in sympathy with every other.
 * ------------------------------------------------------------------ */

const N = 64;

export function createPuffs(scene) {
  const rng = rngKit(3313);

  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);        // seconds left
  const span = new Float32Array(N);        // how long it had at birth
  const size = new Float32Array(N);
  const col = new Float32Array(N * 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('aSpan', new THREE.BufferAttribute(span, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTex: { value: blobTex() } },
    vertexShader: /* glsl */ `
      attribute float aLife, aSpan, aSize;
      attribute vec3 aCol;
      varying float vA;
      varying vec3 vCol;
      void main() {
        float t = aSpan > 0.0 ? aLife / aSpan : 0.0;      // 1 at birth, 0 at death
        vA = smoothstep( 0.0, 0.25, t ) * smoothstep( 1.05, 0.55, t );
        vCol = aCol;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        // puffs swell as they die
        gl_PointSize = aSize * ( 1.6 - t * 0.6 ) * ( 300.0 / -mv.z );
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      varying float vA;
      varying vec3 vCol;
      void main() {
        vec4 t = texture2D( uTex, gl_PointCoord );
        gl_FragColor = vec4( vCol, t.a * vA * 0.42 );
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  let head = 0;
  const _p = new THREE.Vector3();
  const _c = new THREE.Color();

  /**
   * A burst at flat (x, y, z).  `up` metres/second of rise, `spread` of
   * scatter, `px` of on-screen size, and a colour.
   */
  function burst(x, y, z, { n = 4, up = 0.10, spread = 0.10, px = 22, color = 0xcbb98e } = {}) {
    const b = basisAt(x, z);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      const k = head;
      head = (head + 1) % N;
      positionAt(x, y, z, _p);
      pos[k * 3] = _p.x + rng.range(-0.02, 0.02);
      pos[k * 3 + 1] = _p.y + rng.range(-0.02, 0.02);
      pos[k * 3 + 2] = _p.z + rng.range(-0.02, 0.02);
      const s = rng.range(0.4, 1);
      vel[k * 3] = b.up.x * up * s + b.east.x * rng.range(-spread, spread) + b.north.x * rng.range(-spread, spread);
      vel[k * 3 + 1] = b.up.y * up * s + b.east.y * rng.range(-spread, spread) + b.north.y * rng.range(-spread, spread);
      vel[k * 3 + 2] = b.up.z * up * s + b.east.z * rng.range(-spread, spread) + b.north.z * rng.range(-spread, spread);
      span[k] = life[k] = rng.range(0.35, 0.75);
      size[k] = px * rng.range(0.7, 1.3);
      col[k * 3] = _c.r; col[k * 3 + 1] = _c.g; col[k * 3 + 2] = _c.b;
    }
  }

  function update(dt) {
    let any = false;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt;
      const d = Math.exp(-2.6 * dt);       // drag: dust does not travel
      vel[i * 3] *= d; vel[i * 3 + 1] *= d; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    points.visible = any;
    if (any) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
      geo.attributes.aSpan.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aCol.needsUpdate = true;
    }
  }

  return { burst, update };
}

/* ------------------------------------------------------------------ *
 * Footprints.  Only where the ground would take one — snow and rain-soft
 * earth — spawned off the same footfall edge as the sound and the dust,
 * left where they were made, and gone by melting: they shrink away rather
 * than pop, which on snow is what actually happens to a print.
 * ------------------------------------------------------------------ */

const PRINTS = 48;

export function createPrints(scene) {
  const rng = rngKit(6607);
  const geo = new THREE.PlaneGeometry(0.034, 0.024).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.34, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, PRINTS);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.userData.noOutline = true;
  scene.add(mesh);

  const base = Array.from({ length: PRINTS }, () => new THREE.Matrix4());
  const life = new Float32Array(PRINTS);
  const span = new Float32Array(PRINTS);
  const _m = new THREE.Matrix4();
  const _r = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _c = new THREE.Color();
  const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let head = 0;
  let side = 1;
  for (let i = 0; i < PRINTS; i++) mesh.setMatrixAt(i, _zero);

  /** Stamp one print at his feet, alternating sides of his line. */
  function stamp(x, y, z, hd, color = 0x8890ae) {
    const k = head;
    head = (head + 1) % PRINTS;
    side = -side;
    const b = basisAt(x, z);
    _m.makeBasis(b.east, b.up, b.north);
    _m.setPosition(positionAt(x, y + 0.004, z, _p));
    _r.makeRotationY(-hd);
    _m.multiply(_r);
    _r.makeTranslation(0.02, 0, 0.05 * side);
    _m.multiply(_r);
    base[k].copy(_m);
    span[k] = life[k] = rng.range(9, 13);
    mesh.setColorAt(k, _c.set(color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function update(dt) {
    let any = false;
    for (let i = 0; i < PRINTS; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt;
      const t = Math.max(0, life[i] / span[i]);
      const s = Math.sqrt(t);               // melts fast at the end
      if (t <= 0) {
        mesh.setMatrixAt(i, _zero);
      } else {
        _r.makeScale(s, 1, s);
        _m.copy(base[i]).multiply(_r);
        mesh.setMatrixAt(i, _m);
      }
    }
    mesh.visible = any;
    if (any) mesh.instanceMatrix.needsUpdate = true;
  }

  return { stamp, update };
}
