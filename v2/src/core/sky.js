import * as THREE from 'three';
import { PAL } from './palette.js';
import { flat } from './toon.js';
import { starTex } from './textures.js';
import { buildClouds } from './clouds.js';
import { rngKit, clamp } from './util.js';

/* ------------------------------------------------------------------ *
 * The sky.
 *
 * A three-stop painted gradient dome, a handful of flat cel clouds, one
 * disc that is the sun by day and the moon by night, and stars that come up
 * with the dark.  The faint banding in the gradient is deliberate: it reads
 * as airbrushed background art rather than as a physical sky.
 *
 * On a planet this small the sky is most of the frame — the horizon from a
 * camera 1.2 m up is barely 11 m away — so this file earns more of the look
 * than it would in a world with buildings in it.
 * ------------------------------------------------------------------ */

export function buildSky(scene, radius = 300) {
  const group = new THREE.Group();
  group.name = 'sky';

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: true,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(PAL.skyTop) },
      uMid: { value: new THREE.Color(PAL.skyMid) },
      uHaze: { value: new THREE.Color(PAL.skyHaze) },
      uBands: { value: 26.0 },
      /* The sky's *bearing*.  Without these three the dome is a function of
       * height alone and every sunset looks identical whichever way you turn,
       * which is the single largest thing that was missing from it. */
      uGlow: { value: new THREE.Color(0xffab5e) },
      uCounter: { value: new THREE.Color(0xd0b6c8) },
      uGlowAmt: { value: 0 },
      uSunFlat: { value: new THREE.Vector3(0, 0, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        /* **Object space, not world space.**  This read the world offset
         * from the camera and then took its y, which is elevation above
         * the *world* horizontal — and on a planet the world horizontal is
         * only the horizon at one single point on the surface.  Everywhere
         * else the whole sky gradient was tilted against the skyline, by up
         * to ninety degrees, which arrives as a hard cream wall with blue
         * down one side of it and reads as a rendering fault.  The group is
         * rotated into his own tangent frame now, so the dome's own +Y *is*
         * up and the bands are level wherever he stands. */
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHaze, uGlow, uCounter;
      uniform float uBands, uGlowAmt;
      uniform vec3 uSunFlat;
      varying vec3 vWorld;

      void main() {
        vec3 dir = normalize( vWorld );
        float h = dir.y;
        // soft quantisation: mostly smooth, with a faint painted step
        float t = clamp( h * 1.15 + 0.02, 0.0, 1.0 );
        float q = floor( t * uBands ) / uBands;
        t = mix( t, q, 0.35 );

        /* The haze band is tight — 0 to 0.14 rather than 0 to 0.30.  On a
         * planet with an eleven-metre horizon the camera looks *down*, so
         * the only sky in frame is the first few degrees above the ground;
         * a generous haze band means the sky is never blue at all. */
        vec3 col = mix( uHaze, uMid, smoothstep( 0.0, 0.14, t ) );
        col = mix( col, uTop, smoothstep( 0.16, 0.78, t ) );
        col = mix( col, uHaze, smoothstep( 0.12, -0.05, h ) * 0.6 );

        /* The glow.  It hugs the skyline — an exponential rather than a
         * smoothstep, so it has no upper edge to read as a band — and it
         * leans hard toward the sun's bearing: gold where the sun is, the
         * cooler counter-glow behind you.  The forward lobe is tight
         * (a high power) because a wide one is just an orange sky, and an
         * orange sky is a filter, not a sunset. */
        float toward = dot( normalize( vec3( dir.x, 0.0, dir.z ) ), uSunFlat ) * 0.5 + 0.5;
        float band = exp( -max( h, 0.0 ) * 5.5 );
        vec3 warm = mix( uCounter, uGlow, pow( toward, 2.2 ) );
        col = mix( col, warm, clamp( uGlowAmt * band, 0.0, 1.0 ) );
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  group.add(dome);

  /* --- the two lights in the sky ---
   *
   * They were **one disc** with a rule that flipped it to the anti-solar
   * point whenever the sun went below the horizon.  Two things were wrong
   * with that and one of them hid the other: the sun's direction was clamped
   * to stay above the horizon at all times, so the flip never once fired and
   * the "moon" was only ever the sun in a colder colour, in the sun's own
   * place; and even had it fired, one disc means sun and moon can never
   * share a sky, which they do most evenings of the real world.
   *
   * They are separate objects now, each simply drawn where it is, each fading
   * out as it goes under, and its phase and its position are the *same
   * number* — see `moonDirAt`.
   *
   * **The sun is a disc and the moon is a ball**, and the asymmetry is the
   * point rather than an oversight.  The sun has to be drawn unlit — a lit
   * sphere shows a terminator, and a sun with a terminator is a crescent —
   * and an unlit sphere four degrees across is pixel-for-pixel the disc it
   * would replace, so it would be triangles for nothing.  The moon is the
   * opposite case: its whole character is that it *is* lit, from one side,
   * by something else in the same sky. */
  const discMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Color(0xfff6de) },
      uOpacity: { value: 0.95 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float disc = 1.0 - smoothstep( 0.86, 0.98, length( c ) );
        gl_FragColor = vec4( uColor, disc * uOpacity );
      }
    `,
  });

  /* ------------------------------- the moon ------------------------------- *
   *
   * A real ball, lit by the real sun, and **the phase is not drawn at all —
   * it is what happens.**
   *
   * It used to be a flat quad with a second circle slid across it to bite a
   * crescent out.  That works for a crescent and cannot work for anything
   * else: subtracting one circle from another can only ever give you a lens,
   * and a gibbous moon's terminator is a half-ELLIPSE — the lit limb stays a
   * perfect semicircle and the terminator narrows and then crosses over.  A
   * bite gets the shape wrong for half of every month.
   *
   * The geometry to do it properly was already here.  `moonDirAt` puts the
   * moon `phase` of a turn along the sun's own arc, so its elongation from
   * the sun *is* its phase — which is the actual astronomy, and it means
   * lighting the ball by `sunDir` reproduces `moonPhase` exactly, with no
   * second copy of the number to keep in step.  The old hack and the real
   * thing were the same fact, one written twice.
   *
   * Three details it buys, none of which a quad can have:
   *
   *  - the terminator is elliptical, and **soft**, because the far limb of a
   *    real moon is grazing light on rough ground rather than a knife edge;
   *  - the dark side is not black, it is `uEarth` — earthshine, the sunlight
   *    our own world throws back at it.  A crescent with a black remainder
   *    reads as a moon with a piece missing; a crescent with the ghost of the
   *    rest of the ball behind it reads as a *sphere*, which is the entire
   *    difference this change was made for;
   *  - and the alpha follows the light, so a new moon fades out where it
   *    stands instead of hanging there as a grey ball among the stars.
   *
   * `uSun` arrives in the mesh's **own object space**, and that is not a
   * detail.  The first version compared a view-space normal against a
   * view-space sun, which needs `camera.matrixWorldInverse` — and the
   * renderer sets that at *draw* time, not when `update` runs, so the sun
   * arrived a frame stale and the terminator sat wherever the camera had
   * last been pointing.  It read as a permanently full moon.  `_sunDir` is
   * already in the group's frame and the moon is a child of the group, so
   * the object-space sun is just the inverse of the mesh's own turn — no
   * camera in it anywhere, and nothing to be stale.
   */
  const moonMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Color(0xe9eeff) },
      uEarth: { value: new THREE.Color(0x2a3350) },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uOpacity: { value: 0.9 },
      uNight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vLocal;
      void main() {
        // object space, both of them: uSun comes in the same frame
        vN = normalize( normal );
        vLocal = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uEarth, uSun;
      uniform float uOpacity, uNight;
      varying vec3 vN;
      varying vec3 vLocal;
      void main() {
        float d = dot( normalize( vN ), normalize( uSun ) );
        /* Banded, like everything else in this world, but only two steps and
         * a wide soft edge: the moon is the one lit thing here with no hard
         * shadow line on it, and a crisp toon ramp on a 4-degree ball reads
         * as a bitten biscuit. */
        float lit = smoothstep( -0.16, 0.30, d );
        lit = mix( lit, smoothstep( 0.0, 0.85, d ), 0.45 );

        /* Three seas, on the face, and only worth seeing after dark.  In
         * LOCAL space, so they ride round with the mesh as it turns to the
         * camera and the same face is always the one you see. */
        float cr = 1.0 - smoothstep( 0.10, 0.26, length( vLocal.xy - vec2( -0.26, 0.12 ) ) );
        cr += 1.0 - smoothstep( 0.06, 0.18, length( vLocal.xy - vec2( 0.22, -0.30 ) ) );
        cr += 1.0 - smoothstep( 0.05, 0.14, length( vLocal.xy - vec2( 0.04, 0.44 ) ) );

        vec3 col = mix( uEarth, uColor, lit ) * ( 1.0 - cr * 0.09 * lit * uNight );
        /* A hair of softening right on the limb.  The moon is about a
         * hundred pixels across in a game frame, so even at forty segments
         * the silhouette is a visible polygon -- and a polygonal moon reads
         * as a rock.  vLocal.z goes to zero exactly at the edge, so this
         * costs one smoothstep and takes the facets with it.
         * (No back-quotes in here: this is inside a template literal, and a
         * stray one ends the shader mid-source.  It has happened once.) */
        float rim = smoothstep( 0.0, 0.30, vLocal.z );
        // earthshine is a hint, not a second moon
        float a = uOpacity * ( 0.11 + 0.89 * lit ) * rim;
        gl_FragColor = vec4( col, a );
      }
    `,
  });

  const disc = new THREE.Mesh(new THREE.PlaneGeometry(radius * 0.104, radius * 0.104), discMat);
  disc.renderOrder = -9;
  disc.frustumCulled = false;
  group.add(disc);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.036, 40, 26), moonMat);
  moon.renderOrder = -9;
  moon.frustumCulled = false;
  group.add(moon);

  const haloMat = flat({
    color: 0xfff2d0, map: starTex(), transparent: true, opacity: 0.30,
    depthWrite: false, fog: false, cache: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(radius * 0.17, radius * 0.17), haloMat);
  halo.renderOrder = -10;
  halo.frustumCulled = false;
  group.add(halo);

  const moonHaloMat = flat({
    color: 0xdfe8ff, map: starTex(), transparent: true, opacity: 0,
    depthWrite: false, fog: false, cache: false,
  });
  const moonHalo = new THREE.Mesh(new THREE.PlaneGeometry(radius * 0.13, radius * 0.13), moonHaloMat);
  moonHalo.renderOrder = -10;
  moonHalo.frustumCulled = false;
  group.add(moonHalo);

  /* --- stars --- */
  const rng = rngKit(2711);
  const N = 420;
  const pos = new Float32Array(N * 3);
  const sz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // upper hemisphere only, weighted away from the horizon where haze eats them
    const u = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const y = Math.abs(u) * 0.92 + 0.06;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = Math.cos(a) * r * radius * 0.94;
    pos[i * 3 + 1] = y * radius * 0.94;
    pos[i * 3 + 2] = Math.sin(a) * r * radius * 0.94;
    sz[i] = rng.range(0.6, 2.6);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const starMat = new THREE.PointsMaterial({
    size: radius * 0.012,
    map: starTex(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    sizeAttenuation: true,
    color: 0xf2f4ff,
    blending: THREE.AdditiveBlending,      // a star adds light; it never paints
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  group.add(stars);

  /* --- clouds: solid, and lit by the sun.  See `core/clouds.js`. --- */
  const clouds = buildClouds(group, radius);

  /* --- one shooting star, for the deepest part of the night --- */
  const shootMat = new THREE.MeshBasicMaterial({
    color: 0xeef2ff, transparent: true, opacity: 0,
    depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  });
  const shoot = new THREE.Mesh(new THREE.PlaneGeometry(radius * 0.085, radius * 0.0035), shootMat);
  shoot.renderOrder = -9;
  shoot.frustumCulled = false;
  shoot.visible = false;
  group.add(shoot);
  const meteor = { life: 0, wait: 8, dir: new THREE.Vector3() };

  /* --- the aurora: three curtains for deep winter nights --- */
  const auroraGroup = new THREE.Group();
  {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const x = c.getContext('2d');
    const grad = x.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(120,255,190,0)');
    grad.addColorStop(0.35, 'rgba(120,255,190,0.5)');
    grad.addColorStop(0.7, 'rgba(150,160,255,0.25)');
    grad.addColorStop(1, 'rgba(150,160,255,0)');
    x.fillStyle = grad;
    x.fillRect(0, 0, 64, 128);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * (0.5 + i * 0.14), radius * 0.17, 20, 1),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0, depthWrite: false,
          fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        })
      );
      const a = 2.2 + i * 0.5;
      m.position.set(Math.cos(a) * radius * 0.5, radius * (0.5 + i * 0.05), Math.sin(a) * radius * 0.5);
      m.lookAt(0, radius * 0.2, 0);
      m.userData.ph = i * 2.1;
      auroraGroup.add(m);
    }
    auroraGroup.visible = false;
    group.add(auroraGroup);
  }
  let auroraNow = 0;

  /* --- constellations: a few drawn lines between brighter stars, one of
   * them unmistakably a hedgehog, because whose sky is this --- */
  const constellations = new THREE.Group();
  {
    // hand-authored patterns: azimuth (rad), elevation (0..1), per point
    const PATTERNS = [
      // the hedgehog: a nose, a low back of spikes, a foot
      [[0.0, 0.55], [0.10, 0.50], [0.20, 0.55], [0.26, 0.63], [0.34, 0.57], [0.42, 0.66], [0.50, 0.58], [0.56, 0.50], [0.44, 0.46]],
      // the acorn
      [[2.1, 0.70], [2.2, 0.76], [2.32, 0.71], [2.26, 0.62], [2.14, 0.63]],
      // the long fence
      [[4.2, 0.45], [4.35, 0.5], [4.5, 0.44], [4.65, 0.5], [4.8, 0.45]],
    ];
    const starPts = [];
    const linePts = [];
    for (const pat of PATTERNS) {
      const pts = pat.map(([az, el]) => new THREE.Vector3(
        Math.cos(az) * Math.sqrt(1 - el * el), el, Math.sin(az) * Math.sqrt(1 - el * el)
      ).multiplyScalar(radius * 0.93));
      starPts.push(...pts);
      for (let i = 0; i < pts.length - 1; i++) linePts.push(pts[i], pts[i + 1]);
    }
    /* **Additive, all of it.**  A star drawn with normal blending is a
     * *paint*: over a bright sky, pale blue at low opacity comes out darker
     * than the sky it is on, so the constellations appeared at dusk as a line
     * of dark dashes across a bright horizon — and since the sky group now
     * carries his tangent frame, they turned as he walked.  Reported, quite
     * reasonably, as a strange black line rotating in the sky.
     *
     * Additive makes it impossible by construction: a star can only ever add
     * light.  Where the sky is brighter than the star, the star disappears,
     * which is exactly what happens at dawn. */
    const lg = new THREE.BufferGeometry().setFromPoints(linePts);
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      color: 0xaab6e0, transparent: true, opacity: 0, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    const sg = new THREE.BufferGeometry().setFromPoints(starPts);
    const bright = new THREE.Points(sg, new THREE.PointsMaterial({
      size: radius * 0.02, map: starTex(), color: 0xfff6e0, transparent: true,
      opacity: 0, depthWrite: false, fog: false, sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    }));
    constellations.add(lines, bright);
    constellations.userData = { lines, bright };
    constellations.visible = false;
    group.add(constellations);
  }

  /* --- the rainbow: five arcs opposite the sun, earned by rain --- */
  const rainbow = new THREE.Group();
  {
    const BANDS = [0xe86a5a, 0xf0b05a, 0xf0e07a, 0x7ac088, 0x7a9ae0];
    BANDS.forEach((c, i) => {
      const r0 = radius * (0.52 - i * 0.012);
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(r0 - radius * 0.010, r0, 64, 1, 0, Math.PI),
        new THREE.MeshBasicMaterial({
          color: c, transparent: true, opacity: 0, depthWrite: false,
          fog: false, side: THREE.DoubleSide,
        })
      );
      rainbow.add(arc);
    });
    rainbow.visible = false;
    rainbow.renderOrder = -9;
    group.add(rainbow);
  }
  const bow = { life: 0, wasWet: false };

  scene.add(group);

  const _c = new THREE.Color();
  const _g = new THREE.Color();
  const _sunDir = new THREE.Vector3(0, 1, 0);
  const _moonDir = new THREE.Vector3(0, -1, 0);
  const _anti = new THREE.Vector3();
  const _flat = new THREE.Vector3();
  const _mq = new THREE.Quaternion();
  const sunLocal = new THREE.Vector3(0, 1, 0);
  const _b = new THREE.Matrix4();
  let skyT = 0;
  let nightNow = 0;
  let wetNow = 0;

  return {
    group, dome, clouds, stars, disc, halo, moon, moonHalo,

    /** How much cloud stands between him and the sun, 0 to 1. */
    sunOcclusion: (sun) => clouds.sunOcclusion(sun),


    /** Sky colours for the hour. `night` is 0 by day, 1 at full dark. */
    setColors({
      top, mid, haze, night = 0, cloud, cloudShade, cloudBase, moonPhase = 0.5, aurora = 0,
      glow = null, counter = null, glowAmt = 0,
      sunUp = 1, moonUp = 0, starAmt = null, sun = null,
    }) {
      if (sun) sunLocal.copy(sun);
      auroraNow = aurora;
      /* Stars come up with the *sun going down*, not with a night scalar that
       * is still zero a long way past sunset — `starAmt` reaches them before
       * `night` has begun to move, which is when the first of them appear. */
      /* And held back until the sky is genuinely dark.  `starAmt` alone tracks
       * the sun going under, which is a good half-hour before the sky stops
       * being bright — the constellations were at a third of their strength
       * over an orange horizon.  Squared against `night`, so they arrive with
       * the dark rather than with the sunset. */
      const starA = clamp(starAmt === null ? (night - 0.18) / 0.55 : starAmt, 0, 1)
        * clamp(night, 0, 1);
      const cu = constellations.userData;
      cu.lines.material.opacity = starA * 0.16;
      cu.bright.material.opacity = starA * 0.75;
      constellations.visible = starA > 0.02;
      domeMat.uniforms.uTop.value.set(top);
      domeMat.uniforms.uMid.value.set(mid);
      domeMat.uniforms.uHaze.value.set(haze);
      if (glow) domeMat.uniforms.uGlow.value.set(glow);
      if (counter) domeMat.uniforms.uCounter.value.set(counter);
      domeMat.uniforms.uGlowAmt.value = glowAmt;
      nightNow = night;
      starMat.opacity = starA * 0.9;
      stars.visible = starMat.opacity > 0.01;

      /* The sun reddens as it goes down, because the air it is seen through
       * is the same air that is reddening the sky behind it. */
      _c.set(0xfff6de);
      if (glow) _c.lerp(_g.set(glow), clamp(glowAmt, 0, 1) * 0.75);
      discMat.uniforms.uColor.value.copy(_c);
      discMat.uniforms.uOpacity.value = 0.95 * sunUp;
      disc.visible = sunUp > 0.01;
      haloMat.opacity = 0.30 * sunUp * (0.7 + 0.6 * clamp(glowAmt, 0, 1));
      halo.visible = disc.visible;

      const fullness = 0.5 - 0.5 * Math.cos(moonPhase * Math.PI * 2);   // 0 new, 1 full
      /* A daylight moon is a pale grey wafer, not a lamp; the same moon after
       * dark is the brightest thing in the sky. */
      moonMat.uniforms.uColor.value.set(0xe9eeff);
      moonMat.uniforms.uNight.value = clamp(night, 0, 1);
      /* **No `fullness` term here, and that is the change.**  The old flat
       * moon had to be faded out toward new, because its bite was a drawing
       * and the drawing had to be told to go away.  A lit ball needs no such
       * help: a crescent is as bright per pixel as a full moon and there is
       * simply less of it, which is now what the shader does.  Multiplying by
       * `fullness` as well would make a thin crescent both thin AND
       * transparent, and count the same fact twice. */
      moonMat.uniforms.uOpacity.value = moonUp * (0.22 + 0.74 * night);
      moon.visible = moonMat.uniforms.uOpacity.value > 0.02;
      moonHaloMat.opacity = moonUp * night * fullness * 0.22;
      moonHalo.visible = moonHaloMat.opacity > 0.01;

      /* The clouds are solid now and take a full lighting set rather than a
       * pair of flat tints — see `core/clouds.js`.  The sun goes in in *his*
       * frame and the group's rotation carries it to world space. */
      clouds.setColors({
        sun: sunLocal, quaternion: group.quaternion,
        lit: cloud, shade: cloudShade, base: cloudBase, glow: glow || 0xffd9a2,
        silver: 0.35 + 0.75 * clamp(glowAmt, 0, 1),
      });
    },

    /**
     * Follow the camera and point the disc at wherever the key light is.
     * The dome has to trail the camera because it is centred on the flat
     * origin, and on a planet you walk a long way from that.
     */
    /** How wet the sky is, fed once a frame; rain that clears earns a bow. */
    setWet(wet) {
      if (bow.wasWet && wet < 0.08 && nightNow < 0.4) bow.life = 26;
      bow.wasWet = wet > 0.4;
      wetNow = wet;
    },

    /**
     * `sky` is the climate state, or null in orbit view.  It used to be a
     * bare sun direction; the sky needs the moon's too, and they are not
     * derivable from one another once the moon has a phase.
     */
    update(dt, camera, sky, basis = null) {
      skyT += dt;
      group.position.copy(camera.position);
      const sunDir = sky?.sunDir || null;
      const moonDir = sky?.moonDir || null;

      /* The rainbow stands opposite the sun, feet on the horizon, and
       * fades over half a minute — long enough to walk toward, short
       * enough to be an event. */
      if (bow.life > 0) {
        bow.life -= dt;
        const a = Math.min(1, bow.life / 6) * Math.min(1, (26 - bow.life) / 3) * 0.34;
        rainbow.visible = a > 0.005;
        if (sunDir && rainbow.visible) {
          _anti.set(-sunDir.x, 0, -sunDir.z).normalize();
          rainbow.position.copy(_anti).multiplyScalar(radius * 0.62);
          rainbow.position.y = -radius * 0.06;
          rainbow.lookAt(group.position);      // face the camera, feet level
          rainbow.children.forEach((m) => { m.material.opacity = a; });
        }
      } else {
        rainbow.visible = false;
      }
      /* Each body simply goes where it is.  Nothing is flipped, nothing is
       * held above the skyline: the sun sets, and the dome's glow — which is
       * aimed at the sun's bearing whether it is up or not — is what keeps
       * the horizon alive after it has gone. */
      /* Everything below is in **his** frame — east, up, north — because the
       * group carries his tangent basis.  `state.sunDir` is in that frame
       * already; before the rotation it was being used as though it were
       * world space, so the drawn sun and the light that cast the shadows
       * were in different parts of the sky everywhere but one point. */
      if (basis) {
        _b.makeBasis(basis.east, basis.up, basis.north);
        group.quaternion.setFromRotationMatrix(_b);
      }
      if (sunDir) {
        _sunDir.copy(sunDir).normalize();
        disc.position.copy(_sunDir).multiplyScalar(radius * 0.9);
        disc.lookAt(camera.position);
        halo.position.copy(_sunDir).multiplyScalar(radius * 0.88);
        halo.lookAt(camera.position);
        _flat.set(_sunDir.x, 0, _sunDir.z);
        if (_flat.lengthSq() < 1e-6) _flat.set(0, 0, 1);
        domeMat.uniforms.uSunFlat.value.copy(_flat.normalize());
      }
      if (moonDir) {
        _moonDir.copy(moonDir).normalize();
        moon.position.copy(_moonDir).multiplyScalar(radius * 0.9);
        /* Turned to face the camera even though it is a ball: a sphere looks
         * the same whichever way you spin it, but its SEAS do not, and a moon
         * is tidally locked — you get the one face for ever.  Turning it is
         * how that stays true as you walk round the planet. */
        moon.lookAt(camera.position);
        moonHalo.position.copy(_moonDir).multiplyScalar(radius * 0.88);
        moonHalo.lookAt(camera.position);

        /* The light on it, in the ball's **own** space.  `_sunDir` is already
         * in the group's frame and the moon is a child of the group, so
         * undoing the mesh's own turn is the whole transform — no camera
         * matrix in it, which is the point: the camera's inverse is written
         * by the renderer at draw time and reading it here gets you last
         * frame's, which lit the moon from wherever you were looking. */
        _mq.copy(moon.quaternion).invert();
        moonMat.uniforms.uSun.value.copy(_sunDir).applyQuaternion(_mq);
      }

      /* Each cloud on its own ring at its own pace, some against the rest —
       * one shared rotation reads as the *sky* turning, which it does anyway
       * at dusk, and two of the same motion is a turntable. */
      clouds.update(dt);

      /* The aurora breathes: each curtain swells and sways on its own. */
      auroraGroup.visible = auroraNow > 0.03;
      if (auroraGroup.visible) {
        auroraGroup.children.forEach((m, i) => {
          m.material.opacity = auroraNow * 0.48 * (0.7 + 0.3 * Math.sin(skyT * 0.21 + m.userData.ph));
          m.rotation.z = Math.sin(skyT * 0.09 + m.userData.ph) * 0.08;
        });
      }

      /* A shooting star, once in a while, in the deepest dark. */
      if (meteor.life > 0) {
        meteor.life -= dt;
        shoot.position.addScaledVector(meteor.dir, dt * radius * 0.30);
        shootMat.opacity = Math.sin(clamp(meteor.life / 0.9, 0, 1) * Math.PI) * 0.8 * nightNow;
        if (meteor.life <= 0) shoot.visible = false;
      } else if (nightNow > 0.85) {
        meteor.wait -= dt;
        if (meteor.wait <= 0) {
          meteor.wait = 6 + Math.random() * 14;
          meteor.life = 0.9;
          const a = Math.random() * Math.PI * 2;
          const y = 0.45 + Math.random() * 0.3;
          const r = Math.sqrt(1 - y * y);
          shoot.position.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(radius * 0.92);
          // falling across the sky: sideways, and down
          meteor.dir.set(-Math.sin(a), -0.55 - Math.random() * 0.3, Math.cos(a)).normalize();
          shoot.lookAt(0, shoot.position.y * 0.4, 0);
          shoot.rotation.z = Math.atan2(-meteor.dir.y, 0.8) * (Math.random() < 0.5 ? 1 : -1);
          shoot.visible = true;
        }
      }
    },

    /** Orbit view wants the sky where it actually is, not on the camera. */
    setOrbit(on) {
      if (on) { group.position.set(0, 0, 0); group.quaternion.identity(); }
    },
  };
}
