import * as THREE from 'three';
import { bake, rngKit, clamp, TAU } from './util.js';

/* ------------------------------------------------------------------ *
 * Clouds, in three dimensions, lit by the sun.
 *
 * They were flat cel quads that turned to face you: fine as painted
 * background, and completely inert — the same colour whether the sun was
 * behind them or over your shoulder, so the one thing a sky does in an
 * evening did not happen.
 *
 * **What was NOT built here, and why.**  The obvious answer is raymarched
 * volumetrics: march the view ray through a noise field, march a second ray
 * toward the sun at every sample, accumulate transmittance by Beer's law.
 * It is the right answer for a photoreal sky and it is the wrong answer for
 * this one, twice over.  It costs a nested loop per pixel — this frame is
 * already 500 draw calls and 22 ms, and the standard remedies (quarter-res
 * cloud pass, temporal upscaling) are a whole machinery this project does
 * not have.  And it would look *photoreal*, next to four-band toon ramps and
 * a screen-space ink pass: the handover's rule is that a change which makes
 * this read as generic 3D is wrong however clean the code is, and a
 * physically-integrated cloud over a hand-drawn meadow is exactly that.
 *
 * **What was taken is the lighting model, not the integration.**  Four terms
 * do nearly all the work of making a cloud read as a cloud, and every one of
 * them is available on ordinary geometry for a few instructions:
 *
 *  - **Forward scattering** (Henyey–Greenstein).  Water droplets scatter
 *    light strongly *forward*, so a cloud between you and the sun glows.
 *    This is the silver lining, and it is the single most evocative thing a
 *    cloud does.  `hg(mu, g)` with g ≈ 0.7, on the real phase function.
 *  - **Beer's law / thickness.**  Thin cloud passes light, thick cloud
 *    blocks it.  On a mesh the honest proxy is the silhouette: a face turned
 *    edge-on to you has a lot of cloud behind it, a face pointed at you has
 *    little.  So the glow lives at the *rim*, which is where it lives.
 *  - **The powder effect.**  Darkening just inside the lit edge, which is
 *    what gives a cumulus its cauliflower depth.  Not physical — the
 *    reference is candid that it is there for the look — and kept for the
 *    same reason.
 *  - **Sky above, ground below.**  A cloud's top takes the sky's colour and
 *    its base takes the haze off the land.  Two colours and a dot product.
 *
 * Quantised into bands like everything else, so what comes out is a painted
 * cloud that happens to know where the sun is.
 *
 * And the other direction: **a cloud crossing the sun dims the light.**  A
 * handful of dot products a frame, and it is the half of "clouds interact
 * with sunlight" that you feel rather than see.
 * ------------------------------------------------------------------ */

/** How much wider than a cloud its shadow-on-the-sun cone is tested. */
const SUN_REACH = 2.4;

const CLOUD_SHADER = {
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vFrom;      // camera -> fragment, world space
    varying float vUp;       // 0 at the base of this cloud, 1 at the top
    uniform float uSpan;
    void main() {
      vec4 wp = modelMatrix * vec4( position, 1.0 );
      vN = normalize( mat3( modelMatrix ) * normal );
      vFrom = wp.xyz - cameraPosition;
      vUp = clamp( position.y / uSpan + 0.5, 0.0, 1.0 );
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uSun;        // toward the sun, world space
    uniform vec3 uLit;        // the sunlit face
    uniform vec3 uShade;      // the face turned away
    uniform vec3 uBase;       // the underside, off the land
    uniform vec3 uGlow;       // the colour of the light coming through
    uniform float uSilver;    // how much forward scatter to allow
    uniform float uBands;
    varying vec3 vN;
    varying vec3 vFrom;
    varying float vUp;

    void main() {
      vec3 N = normalize( vN );
      vec3 V = normalize( -vFrom );          // fragment -> camera

      /* Henyey-Greenstein, on the real phase function.  mu is 1 when you are
       * looking straight down the sun's own direction — that is, when the
       * cloud is between you and it. */
      float mu = dot( -V, uSun );
      const float g = 0.72;
      const float gg = g * g;
      float hg = ( 1.0 - gg ) / pow( max( 1.0 + gg - 2.0 * g * mu, 1e-3 ), 1.5 );
      hg = clamp( hg * 0.32, 0.0, 3.0 );

      /* Beer, by proxy.  A face turned edge-on to you has a great deal of
       * cloud behind it; one pointed at you has almost none.  So thickness is
       * the silhouette, and the light that survives is the thin part. */
      float edge = 1.0 - abs( dot( N, V ) );
      float thin = pow( edge, 2.2 );

      // the lit side, quantised — a painted cloud, not an integrated one
      float ndl = dot( N, uSun ) * 0.5 + 0.5;
      float lit = smoothstep( 0.30, 0.72, ndl );
      lit = floor( lit * uBands + 0.5 ) / uBands;

      vec3 col = mix( uShade, uLit, lit );
      // sky on top, land underneath
      col = mix( uBase, col, smoothstep( 0.0, 0.45, vUp ) );

      /* The powder effect: darken just *inside* the lit edge.  Physically
       * indefensible and it is what gives a cumulus its cauliflower. */
      float powder = 1.0 - exp( -4.0 * ( 1.0 - edge ) );
      col *= mix( 1.0, 0.82 + 0.18 * powder, lit );

      // and the silver lining, only where it is thin AND backlit
      col += uGlow * thin * hg * uSilver;

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

/**
 * One cloud: a handful of blobs baked into a single geometry.  Low-poly and
 * faceted on purpose — the trees in this world are built the same way, and a
 * smooth cloud beside a faceted oak is the thing that reads as two art
 * directions in one frame.
 */
function cloudGeometry(rng, span) {
  const parts = [];
  const lobes = 5 + Math.floor(rng.next() * 4);
  for (let i = 0; i < lobes; i++) {
    const t = i / (lobes - 1);
    const r = span * (0.30 + Math.sin(t * Math.PI) * rng.range(0.22, 0.40));
    const g = new THREE.IcosahedronGeometry(r, 1);
    const m = new THREE.Matrix4();
    m.makeTranslation(
      span * (t - 0.5) * 1.55 + rng.range(-0.06, 0.06) * span,
      rng.range(-0.10, 0.16) * span + Math.sin(t * Math.PI) * span * 0.10,
      rng.range(-0.22, 0.22) * span
    );
    // squashed: a cumulus is wide and flat-bottomed, never a ball
    m.scale(new THREE.Vector3(1.15, 0.62, 0.9));
    parts.push({ geometry: g, matrix: m });
    g.dispose?.();
  }
  const baked = bake(parts);
  baked.computeVertexNormals();
  return baked;
}

/**
 * `count` clouds on rings around the camera.  `radius` is the sky dome's, so
 * they sit comfortably inside it.
 */
export function buildClouds(parent, radius, count = 26) {
  const rng = rngKit(7781);
  const group = new THREE.Group();
  group.name = 'clouds';

  const mat = new THREE.ShaderMaterial({
    ...CLOUD_SHADER,
    fog: false,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uLit: { value: new THREE.Color(0xfffdf6) },
      uShade: { value: new THREE.Color(0xdfe0ee) },
      uBase: { value: new THREE.Color(0xc9cede) },
      uGlow: { value: new THREE.Color(0xffd9a2) },
      uSilver: { value: 0.55 },
      uBands: { value: 3.0 },
      uSpan: { value: 1.0 },
    },
  });

  const clouds = [];
  for (let i = 0; i < count; i++) {
    /* Small enough that several fit in the sky.  One cloud filling half the
     * frame reads as a wall, which is exactly what the flat ones did before
     * they were shrunk — see the note in HANDOVER. */
    const span = rng.range(16, 34);
    const geo = cloudGeometry(rng, span);
    const m = mat.clone();
    m.uniforms = THREE.UniformsUtils.clone(mat.uniforms);
    m.uniforms.uSpan.value = span;
    const mesh = new THREE.Mesh(geo, m);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.renderOrder = -9;
    mesh.userData.noOutline = true;
    mesh.userData.noMerge = true;
    group.add(mesh);
    /* **Placed on a dome, not on a ring.**  A ring of clouds at 8° to 36°
     * elevation is a band round the skyline with nothing over your head — so
     * near noon the sun is above every cloud there is, and the "a cloud goes
     * over and the meadow dims" effect can only ever happen at dawn and dusk.
     * Measured, it happened zero per cent of the time.
     *
     * Weighted low all the same, because on this planet you spend most of
     * your time looking *down* and a sky full of clouds directly overhead is
     * a sky you never see. */
    const el = 0.13 + Math.pow(rng.next(), 1.7) * 1.15;      // 7° to 74°
    clouds.push({
      mesh, mat: m, span, el,
      ang: rng.range(0, TAU),
      dist: rng.range(radius * 0.58, radius * 0.98),
      drift: rng.range(0.004, 0.013) * (rng.next() < 0.5 ? -1 : 1),
      bob: rng.range(0, TAU),
      spin: rng.range(0, TAU),
      /* Its own angular size from the middle, worked out once: this is what
       * the sun-occlusion test needs and it does not change. */
      half: 0,
    });
  }
  for (const c of clouds) c.half = Math.atan((c.span * 0.62) / c.dist);

  parent.add(group);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  let t = 0;

  return {
    group, clouds,

    /**
     * Colours for the hour.  `sun` is in the sky group's own frame — which is
     * his tangent frame — and is turned into world space here, because the
     * shader works in world space and the group is rotated.
     */
    setColors({ sun, quaternion, lit, shade, base, glow, silver = 0.55, opacity = 1 }) {
      _dir.copy(sun).normalize();
      if (quaternion) _dir.applyQuaternion(quaternion);
      for (const c of clouds) {
        const u = c.mat.uniforms;
        u.uSun.value.copy(_dir);
        if (lit) u.uLit.value.set(lit);
        if (shade) u.uShade.value.set(shade);
        if (base) u.uBase.value.set(base);
        if (glow) u.uGlow.value.set(glow);
        u.uSilver.value = silver;
        c.mesh.visible = opacity > 0.02;
      }
    },

    update(dt) {
      t += dt;
      for (const c of clouds) {
        c.ang += dt * c.drift;
        const ce = Math.cos(c.el), se = Math.sin(c.el);
        _p.set(
          Math.cos(c.ang) * ce * c.dist,
          se * c.dist + Math.sin(t * 0.05 + c.bob) * c.span * 0.06,
          Math.sin(c.ang) * ce * c.dist
        );
        /* Turned to lie along its own ring, and nothing else.  These are
         * solid, so there is no billboarding to do — which is the whole
         * reason for building them, and the reason a cloud now looks
         * different from the far side than it did from this one. */
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -c.ang + c.spin);
        _m.compose(_p, _q, _s);
        c.mesh.matrix.copy(_m);
        c.mesh.matrixWorldNeedsUpdate = true;
      }
    },

    /**
     * How much cloud is between him and the sun, 0 to 1.
     *
     * A handful of dot products, and it is the half of "clouds interact with
     * sunlight" that you feel rather than see: the meadow dims for a few
     * seconds as one goes over, and the shadow tint comes up with it.
     *
     * `sun` is in the group's frame, which is the frame the cloud positions
     * are already in, so no conversion is needed here at all.
     */
    sunOcclusion(sun) {
      _dir.copy(sun).normalize();
      let cover = 0;
      for (const c of clouds) {
        if (!c.mesh.visible) continue;
        const p = c.mesh.matrix;
        _p.set(p.elements[12], p.elements[13], p.elements[14]).normalize();
        const ang = Math.acos(clamp(_p.dot(_dir), -1, 1));
        /* Tested against a **wider** cone than the cloud's own, falling off
         * from the middle.  Measured at the true radius the sun is behind
         * something about one per cent of the time, which is honest for a
         * fair-weather sky and means the effect never once happens while you
         * are watching.  The wider cone counts the near-misses too — the edge
         * of a cloud does take the edge off the light — and brings it to
         * something you meet every half minute or so. */
        const reach = c.half * SUN_REACH;
        if (ang < reach) {
          const k = 1 - ang / reach;
          cover += k * k * (0.35 + 0.65 * (ang < c.half ? 1 : 0));
        }
      }
      return clamp(cover, 0, 1);
    },
  };
}
