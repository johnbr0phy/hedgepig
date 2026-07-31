import * as THREE from 'three';
import { PAL } from './palette.js';
import { flat } from './toon.js';
import { cloudTex, starTex } from './textures.js';
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
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorld = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHaze;
      uniform float uBands;
      varying vec3 vWorld;

      void main() {
        float h = normalize( vWorld ).y;
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
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  group.add(dome);

  /* --- the light in the sky: sun by day, moon by night, one disc ---
   *
   * The moon has a **phase**, carved by a second circle sliding across the
   * first, and the phase runs off the year clock — thirteen lunations a
   * year, so a night sky two evenings apart is visibly a different moon.
   * By day the same disc is the sun and the shader leaves it whole. */
  const discMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Color(0xfff6de) },
      uNight: { value: 0 },
      uBite: { value: 3.0 },
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
      uniform float uNight, uBite, uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float r = length( c );
        float disc = 1.0 - smoothstep( 0.86, 0.98, r );
        // the phase: a bite of sky slid across the moon by the year clock
        float bite = 1.0 - smoothstep( 0.80, 1.04, length( c - vec2( uBite, 0.20 ) ) );
        float a = disc * ( 1.0 - bite * uNight );
        // three seas, faint, and only by night
        float cr = 1.0 - smoothstep( 0.10, 0.26, length( c - vec2( -0.26, 0.12 ) ) );
        cr += 1.0 - smoothstep( 0.06, 0.18, length( c - vec2( 0.22, -0.30 ) ) );
        cr += 1.0 - smoothstep( 0.05, 0.14, length( c - vec2( 0.04, 0.44 ) ) );
        vec3 col = uColor * ( 1.0 - cr * 0.09 * uNight );
        gl_FragColor = vec4( col, a * uOpacity );
      }
    `,
  });
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(radius * 0.104, radius * 0.104), discMat);
  disc.renderOrder = -9;
  disc.frustumCulled = false;
  group.add(disc);

  const haloMat = flat({
    color: 0xfff2d0, map: starTex(), transparent: true, opacity: 0.30,
    depthWrite: false, fog: false, cache: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(radius * 0.17, radius * 0.17), haloMat);
  halo.renderOrder = -10;
  halo.frustumCulled = false;
  group.add(halo);

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
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  group.add(stars);

  /* --- flat clouds: billboarded puffs, no depth writes --- */
  const tex = cloudTex();
  const crng = rngKit(7781);
  const clouds = new THREE.Group();
  const matA = flat({ color: PAL.cloud, map: tex, transparent: true, opacity: 0.66, depthWrite: false, fog: false, cache: false });
  const matB = flat({ color: PAL.cloudShade, map: tex, transparent: true, opacity: 0.34, depthWrite: false, fog: false, cache: false });
  matA.map.wrapS = matA.map.wrapT = THREE.ClampToEdgeWrapping;

  const puffs = [];
  for (let i = 0; i < 20; i++) {
    const r = crng.range(90, 190);
    const a = crng.range(0, Math.PI * 2);
    const w = crng.range(34, 88);
    const h = w * crng.range(0.24, 0.34);
    const y = crng.range(22, 62);
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matB);
    back.position.set(1.2, -h * 0.1, -0.8);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matA);
    g.add(back, front);
    g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    g.lookAt(0, y * 0.55, 0);
    g.renderOrder = -9;
    g.userData = { ang: a, rad: r, baseY: y, drift: crng.range(0.004, 0.014) * crng.sign(), bob: crng.range(0, Math.PI * 2) };
    clouds.add(g);
    puffs.push(g);
  }
  clouds.frustumCulled = false;
  group.add(clouds);

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
  const _sunDir = new THREE.Vector3(0, 1, 0);
  const _anti = new THREE.Vector3();
  let skyT = 0;
  let nightNow = 0;
  let wetNow = 0;

  return {
    group, dome, clouds, stars, disc, halo,

    /** Sky colours for the hour. `night` is 0 by day, 1 at full dark. */
    setColors({ top, mid, haze, night = 0, cloud, cloudShade, moonPhase = 0.5 }) {
      domeMat.uniforms.uTop.value.set(top);
      domeMat.uniforms.uMid.value.set(mid);
      domeMat.uniforms.uHaze.value.set(haze);
      nightNow = night;
      starMat.opacity = clamp((night - 0.18) / 0.55, 0, 1) * 0.9;
      stars.visible = starMat.opacity > 0.01;
      // the disc cools and shrinks into a moon, and takes its phase
      _c.set(0xfff6de).lerp(new THREE.Color(0xe9eeff), night);
      discMat.uniforms.uColor.value.copy(_c);
      discMat.uniforms.uNight.value = night;
      const fullness = 0.5 - 0.5 * Math.cos(moonPhase * Math.PI * 2);   // 0 new, 1 full
      discMat.uniforms.uBite.value = fullness * 2.6;
      disc.scale.setScalar(1 - 0.34 * night);
      haloMat.opacity = (0.30 * (1 - night) + 0.10 * night) * (0.4 + 0.6 * fullness);
      if (cloud) matA.color.set(cloud);
      if (cloudShade) matB.color.set(cloudShade);
      matA.opacity = 0.66 - 0.22 * night;
      matB.opacity = 0.34 - 0.12 * night;
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

    update(dt, camera, sunDir) {
      skyT += dt;
      group.position.copy(camera.position);

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
      if (sunDir) {
        /* Whichever of sun and anti-sun is above the horizon is the disc:
         * the sun goes down and the moon comes up **opposite it**, which is
         * both roughly the astronomy and the only way the night sky ever
         * actually contains the moon — following the sun's own direction
         * put the "moon" under the planet all night, every night. */
        _sunDir.copy(sunDir).normalize();
        if (_sunDir.y < 0) _sunDir.negate();
        disc.position.copy(_sunDir).multiplyScalar(radius * 0.9);
        disc.lookAt(camera.position);
        halo.position.copy(_sunDir).multiplyScalar(radius * 0.88);
        halo.lookAt(camera.position);
      }

      /* Each cloud on its own ring at its own pace, some against the rest —
       * one shared rotation reads as the *sky* turning, which it does anyway
       * at dusk, and two of the same motion is a turntable. */
      for (const p of puffs) {
        const u = p.userData;
        u.ang += dt * u.drift;
        p.position.set(
          Math.cos(u.ang) * u.rad,
          u.baseY + Math.sin(skyT * 0.05 + u.bob) * 1.6,
          Math.sin(u.ang) * u.rad
        );
        p.lookAt(0, u.baseY * 0.55, 0);
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
      if (on) group.position.set(0, 0, 0);
    },
  };
}
