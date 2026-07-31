import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { PAL } from './palette.js';

/* ------------------------------------------------------------------ *
 * The 3D-to-2D pipeline.
 *
 *   scene  ->  rtScene (colour + depth texture)
 *          ->  ink pass    : screen-space line work from the depth buffer
 *          ->  grade pass  : split-tone, grain, vignette, linear->sRGB
 *          ->  fxaa pass   : clean up the line work, straight to screen
 *
 * Lines come from a *second difference* of linearised depth.  A first
 * difference smears ink across the ground wherever a surface is grazing the
 * camera — and in a meadow seen from 40 cm up, nearly every surface is.  The
 * second difference is flat across any plane no matter how oblique, so it
 * fires only on real silhouettes and real creases.
 *
 * The sensitivity is the second place this departs from its source, and
 * the reason is grass.  A meadow puts tens of thousands of tiny silhouettes
 * in every frame, and at the reference's 0.0042 every single blade came
 * back inked: the field read as a scribble and the hedgepig disappeared
 * into it.  0.0125 was supposed to put a blade below the threshold and leave
 * a hedgehog, a fence post and a barn above it.
 *
 * **It never did, and once the meadow trebled in density it was not close.**
 * A blade is a real silhouette against ground several metres behind it, so
 * its second difference is enormous — every bit as large as the hedgehog's.
 * Sweeping `uSens` from 0.0125 to 0.28 barely thinned the field and would
 * have taken the fence posts long before it took the grass, because
 * magnitude is not what separates them.  **Size is**, and size is precisely
 * what a screen-space depth filter cannot see: an animator inking a meadow
 * draws the shapes and suggests the grass, and no threshold reproduces that
 * decision.
 *
 * So the grass declares itself instead — `grass.js` writes 0 into the alpha
 * of the colour target, which nothing else uses — and `uGrassInk` says how
 * much line a blade is allowed.  The meadow went from a scribble to a
 * painted field in one line of shader.
 *
 * The distances are the other place this departs from its source.  On a planet
 * of radius 47 m the horizon from a low camera is about 11 m away, so ink
 * that faded out between 40 and 98 m never faded at all: everything was
 * inside the near band and the whole frame came back scribbled.  The fade
 * now runs 9 -> 26 m, which is the same *shape* against this world's depth
 * range as the original was against its own.
 * ------------------------------------------------------------------ */

const INK_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uNear: { value: 0.05 },
    uFar: { value: 400 },
    uInk: { value: new THREE.Color(PAL.ink) },
    uThickness: { value: 1.35 },
    uSens: { value: 0.0125 },
    uConcave: { value: 0.055 },
    uConcaveAmount: { value: 0.30 },
    uFadeStart: { value: 9.0 },
    uFadeEnd: { value: 26.0 },
    uStrength: { value: 1.0 },
    uSkyDepth: { value: 260.0 },
    /* How much ink a blade of grass is allowed.  See `grass.js`: the meadow
     * marks itself in the alpha channel because no depth threshold can tell
     * a blade from a hedgehog. */
    uGrassInk: { value: 0.20 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4( position.xy, 0.0, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uTexel;
    uniform float uNear, uFar;
    uniform vec3 uInk;
    uniform float uThickness, uSens, uConcave, uConcaveAmount;
    uniform float uFadeStart, uFadeEnd, uStrength, uSkyDepth, uGrassInk;
    varying vec2 vUv;

    float linearDepth( vec2 uv ) {
      float d = texture2D( tDepth, uv ).x;
      return -perspectiveDepthToViewZ( d, uNear, uFar );
    }

    void main() {
      vec3 col = texture2D( tDiffuse, vUv ).rgb;

      vec2 t = uTexel * uThickness;
      float dc = linearDepth( vUv );

      if ( dc > uSkyDepth ) {
        gl_FragColor = vec4( col, 1.0 );   // pure sky: nothing to ink
        return;
      }

      float dl = linearDepth( vUv - vec2( t.x, 0.0 ) );
      float dr = linearDepth( vUv + vec2( t.x, 0.0 ) );
      float du = linearDepth( vUv + vec2( 0.0, t.y ) );
      float dd = linearDepth( vUv - vec2( 0.0, t.y ) );

      // second difference of linear depth, normalised by distance
      float sx = ( dl + dr - 2.0 * dc ) / dc;
      float sy = ( du + dd - 2.0 * dc ) / dc;

      float convex  = max( 0.0,  sx ) + max( 0.0,  sy );
      float concave = max( 0.0, -sx ) + max( 0.0, -sy );

      float edge = smoothstep( uSens * 0.32, uSens, convex );
      edge = max( edge, smoothstep( uConcave, uConcave * 3.4, concave ) * uConcaveAmount );

      // let the far field dissolve into haze instead of getting busy
      edge *= 1.0 - smoothstep( uFadeStart, uFadeEnd, dc );
      edge *= uStrength;

      // the meadow suggests itself; it does not get drawn blade by blade
      float notGrass = texture2D( tDiffuse, vUv ).a;
      edge *= mix( uGrassInk, 1.0, notGrass );

      // ink keeps a whisper of the underlying hue so it never looks pasted on
      vec3 line = mix( uInk, col * 0.42, 0.22 );
      gl_FragColor = vec4( mix( col, line, clamp( edge, 0.0, 1.0 ) ), 1.0 );
    }
  `,
};

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uShadowTint: { value: new THREE.Color(0xaea9d2) },
    uLightTint: { value: new THREE.Color(0xfff8ea) },
    uSaturation: { value: 1.12 },
    uLift: { value: 0.030 },
    uVignette: { value: 0.16 },
    uWarmth: { value: 0.05 },
    uGrain: { value: 0.018 },
    uTime: { value: 0 },
  },
  vertexShader: INK_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uShadowTint, uLightTint;
    uniform float uSaturation, uLift, uVignette, uWarmth, uGrain, uTime;
    varying vec2 vUv;

    vec3 linearToSRGB( vec3 c ) {
      return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0031308 ) ), vec3( 1.0 / 2.4 ) ) - 0.055,
                  step( 0.0031308, c ) );
    }

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    }

    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb;
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );

      // split-tone: cool in the darks, warm paper white in the lights
      float k = smoothstep( 0.02, 0.55, l );
      c *= mix( uShadowTint, uLightTint, k );

      c += vec3( uWarmth, uWarmth * 0.45, 0.0 ) * l * 0.35;

      // keep shade readable — never crushed to black
      c = c + uLift * ( 1.0 - k );

      c = mix( vec3( l ), c, uSaturation );

      float r = length( vUv - 0.5 ) * 1.42;
      c *= 1.0 - uVignette * pow( clamp( r, 0.0, 1.0 ), 2.6 );

      // paper grain: v1 had it as a final canvas pass and it is half of why
      // that build read as illustration rather than as render
      float g = hash( floor( vUv * vec2( 1600.0, 900.0 ) ) + uTime );
      c += ( g - 0.5 ) * uGrain;

      gl_FragColor = vec4( linearToSRGB( max( c, vec3( 0.0 ) ) ), 1.0 );
    }
  `,
};

const FXAA_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2() },
  },
  vertexShader: INK_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    varying vec2 vUv;

    float luma( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }

    void main() {
      vec3 cM = texture2D( tDiffuse, vUv ).rgb;
      vec3 cNW = texture2D( tDiffuse, vUv + vec2( -uTexel.x, -uTexel.y ) ).rgb;
      vec3 cNE = texture2D( tDiffuse, vUv + vec2(  uTexel.x, -uTexel.y ) ).rgb;
      vec3 cSW = texture2D( tDiffuse, vUv + vec2( -uTexel.x,  uTexel.y ) ).rgb;
      vec3 cSE = texture2D( tDiffuse, vUv + vec2(  uTexel.x,  uTexel.y ) ).rgb;

      float lM = luma( cM ), lNW = luma( cNW ), lNE = luma( cNE ),
            lSW = luma( cSW ), lSE = luma( cSE );
      float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
      float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );

      vec2 dir = vec2(
        -( ( lNW + lNE ) - ( lSW + lSE ) ),
         ( ( lNW + lSW ) - ( lNE + lSE ) )
      );
      float reduce = max( ( lNW + lNE + lSW + lSE ) * 0.25 * 0.18, 1.0 / 128.0 );
      float rcp = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + reduce );
      dir = clamp( dir * rcp, vec2( -8.0 ), vec2( 8.0 ) ) * uTexel;

      vec3 rgbA = 0.5 * (
        texture2D( tDiffuse, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb +
        texture2D( tDiffuse, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
      vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture2D( tDiffuse, vUv - dir * 0.5 ).rgb +
        texture2D( tDiffuse, vUv + dir * 0.5 ).rgb );

      float lB = luma( rgbB );
      gl_FragColor = vec4( ( lB < lMin || lB > lMax ) ? rgbA : rgbB, 1.0 );
    }
  `,
};

function makeQuad(def) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(def.uniforms),
    vertexShader: def.vertexShader,
    fragmentShader: def.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  return { quad: new FullScreenQuad(mat), mat };
}

export class Pipeline {
  constructor(renderer, scene, camera, { pixelBudget = 4.6e6 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.pixelBudget = pixelBudget;
    this.size = new THREE.Vector2(1, 1);
    this.forceScale = 0;

    const opts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.NoColorSpace,
    };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, opts);
    this.rtScene.depthTexture = new THREE.DepthTexture(2, 2);
    this.rtScene.depthTexture.format = THREE.DepthFormat;
    this.rtScene.depthTexture.type = THREE.UnsignedIntType;
    this.rtScene.depthTexture.minFilter = THREE.NearestFilter;
    this.rtScene.depthTexture.magFilter = THREE.NearestFilter;

    this.rtA = new THREE.WebGLRenderTarget(2, 2, { ...opts, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(2, 2, {
      ...opts, type: THREE.UnsignedByteType, depthBuffer: false,
    });

    this.ink = makeQuad(INK_SHADER);
    this.grade = makeQuad(GRADE_SHADER);
    this.fxaa = makeQuad(FXAA_SHADER);

    this.ink.mat.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.enabled = { ink: true, grade: true, fxaa: true };
    this._t = 0;
  }

  /* -------------------------- the adaptive scaler -------------------------- *
   *
   * v1 had one of these and v2 lost it: "an adaptive scaler in `tick()` thins
   * blade density if frames drop below 44fps".  Without it the game simply is
   * whatever speed it is on your machine, and the only person who finds out
   * is you.
   *
   * **Supersampling is the right thing to give up first.**  The scale is 1.5
   * on a low-DPI screen purely so the ink pass has clean edges to work with —
   * it is a bonus, not the picture.  Dropping it to 1.0 renders at native
   * resolution: the world still has every blade of grass, every prop and
   * every shadow in it, and the only thing lost is the extra anti-aliasing.
   * Thinning the grass or pulling the draw distance in would be visible as a
   * *worse world*, which is the one thing worth protecting.
   *
   * **`dt` can only tell you that you are slow, never that you are fast.**
   * With vsync it sits at 16.7 ms whatever headroom there is, so it is used
   * as the fall signal only; the recovery is a periodic attempt to step back
   * up, which falls again if it was not warranted.  Down fast, up slow, and
   * a long cooldown after a fall so a stutter cannot start it oscillating.
   */
  adapt(dtMs) {
    if (!(dtMs > 0) || dtMs > 400) return;      // a tab coming back is not a frame
    this._ema = this._ema ? this._ema * 0.9 + dtMs * 0.1 : dtMs;
    this._cool = Math.max(0, (this._cool || 0) - dtMs);
    if (this._cool > 0) return;
    const q = this._quality ?? 1;
    if (this._ema > 19 && q > 0.6) {
      this._quality = Math.max(0.6, q - 0.12);
      this._cool = 1800;
      this._resize();
    } else if (this._ema < 15.5 && q < 1) {
      this._quality = Math.min(1, q + 0.06);
      this._cool = 5000;                        // and give it a long time to prove it
      this._resize();
    }
  }

  _resize() {
    if (this._w) this.setSize(this._w, this._h);
  }

  /** Resolution scale: supersample a little on low-DPI screens for clean ink. */
  setSize(w, h) {
    this._w = w; this._h = h;
    const dpr = window.devicePixelRatio || 1;
    let scale = this.forceScale
      || (dpr < 1.5 ? 1.5 : Math.min(dpr, 2)) * (this._quality ?? 1);
    // never below native: past that it is not anti-aliasing, it is a blur
    if (!this.forceScale) scale = Math.max(1, scale);
    if (w * h * scale * scale > this.pixelBudget) {
      scale = Math.max(1, Math.sqrt(this.pixelBudget / (w * h)));
    }
    this.scale = scale;
    const rw = Math.max(2, Math.floor(w * scale));
    const rh = Math.max(2, Math.floor(h * scale));
    this.size.set(rw, rh);

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, true);

    this.rtScene.setSize(rw, rh);
    this.rtA.setSize(rw, rh);
    this.rtB.setSize(rw, rh);

    const texel = new THREE.Vector2(1 / rw, 1 / rh);
    this.ink.mat.uniforms.uTexel.value.copy(texel);
    this.fxaa.mat.uniforms.uTexel.value.copy(texel);
    this.ink.mat.uniforms.uNear.value = this.camera.near;
    this.ink.mat.uniforms.uFar.value = this.camera.far;
    // scale ink weight with resolution so lines stay ~2 device px
    this.ink.mat.uniforms.uThickness.value = 1.05 + 0.55 * scale;
  }

  render(dt = 0) {
    const r = this.renderer;
    this._t = (this._t + dt * 24) % 1024;
    this.grade.mat.uniforms.uTime.value = Math.floor(this._t);

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);

    let src = this.rtScene.texture;

    if (this.enabled.ink) {
      this.ink.mat.uniforms.tDiffuse.value = src;
      r.setRenderTarget(this.rtA);
      this.ink.quad.render(r);
      src = this.rtA.texture;
    }

    const last = this.enabled.fxaa ? this.rtB : null;
    this.grade.mat.uniforms.tDiffuse.value = src;
    r.setRenderTarget(last);
    this.grade.quad.render(r);

    if (this.enabled.fxaa) {
      this.fxaa.mat.uniforms.tDiffuse.value = this.rtB.texture;
      r.setRenderTarget(null);
      this.fxaa.quad.render(r);
    }
    r.setRenderTarget(null);
  }

  dispose() {
    [this.rtScene, this.rtA, this.rtB].forEach((rt) => rt.dispose());
    [this.ink, this.grade, this.fxaa].forEach((p) => {
      p.quad.dispose();
      p.mat.dispose();
    });
  }
}
