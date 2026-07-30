/* ------------------------------------------------------------------ *
 * The palette.
 *
 * v1 mixed its colours as `rgb()` strings at draw time, which meant the
 * season lived inside every draw call.  Here the season is a *blend of four
 * palettes* done once a frame in `world/season.js`, and everything else
 * reads the blended result.  So this file is only the four corners of that
 * blend plus the things that never change.
 *
 * The whole scheme is warm greens against a violet shadow.  That violet is
 * doing the same job as the shadow tint in the cel shader: an anime
 * background has *coloured* shade, never dark shade.
 * ------------------------------------------------------------------ */

export const PAL = {
  /* ink and air */
  ink: 0x453f57,
  fog: 0xd6e2e4,
  skyTop: 0x7fb6de,
  skyMid: 0xb9dcec,
  skyHaze: 0xeef1e6,
  cloud: 0xfffdf6,
  cloudShade: 0xdfe0ee,

  /* the two-light anime setup */
  sun: 0xfff3d6,
  fill: 0x9fb8e8,
  hemiSky: 0xd8e8f4,
  hemiGround: 0x8d81a8,

  /* the ground, before the season gets at it */
  soil: 0x6d5844,
  soilDry: 0x9a805a,
  mud: 0x5d4c3c,
  chalk: 0xcfc7ae,
  stone: 0xa9a496,
  stoneDark: 0x7d7a70,

  /* built things */
  timber: 0x8a6a4a,
  timberDark: 0x5f472f,
  slate: 0x6b6f7c,
  tile: 0xb26a58,
  render: 0xe6dfd0,
  tarmac: 0x5b5a60,
  paint: 0xf3f0e4,
  rust: 0xa8674a,
  metal: 0x8f96a0,

  /* water */
  water: 0x74a8bc,
  waterDeep: 0x4d7f97,
  waterFoam: 0xe8f3f2,
  ice: 0xc6dde6,

  /* the hedgepig himself — from assets/logo/hedgepig-logo-badge.jpg */
  hogCream: 0xf3ddb8,
  hogCreamShade: 0xd8b98d,
  hogQuill: 0x4b3524,
  hogQuillLight: 0x6d4d33,
  hogQuillTip: 0xe8cfa4,
  hogNose: 0x37281f,
  hogEye: 0x2d2118,
  hogBlush: 0xe79a94,

  /* flora accents */
  petal: 0xf6d3e2,
  bloomYellow: 0xf2cf6a,
  bloomWhite: 0xf7f4e6,
  bloomBlue: 0x8fa6dd,
  bloomRed: 0xd2604f,
  mushroomCap: 0xc85a4a,
  mushroomStem: 0xefe6d2,
  bramble: 0x3f5a3a,
  thorn: 0x2f4433,
  berry: 0x77304c,
  hay: 0xd9b26a,
  straw: 0xc9a662,

  /* creatures */
  hen: 0xe9e2d4,
  henRed: 0xc4543f,
  butterfly: 0xf0a94b,
  bee: 0xe6bb4d,
  frog: 0x6f9a58,
};

/**
 * The four season corners.  Index order is v1's `seaW`: spring, summer,
 * autumn, winter — and the same order everything downstream assumes.
 *
 * `len` and `den` are v1's `SEA_LEN` / `SEA_DEN` verbatim: grass is shortest
 * and thinnest in winter and longest in summer, and that single pair of
 * numbers is most of what makes a season read from inside the field.
 */
export const SEASONS = [
  {
    name: 'spring',
    grass: 0x8fbf63, grassDark: 0x5f8f47, grassDry: 0xb9c473,
    /* The ground is what shows *between* the grass, so it is olive rather
     * than brown: v1 could get away with true soil colours because its
     * blades covered the field completely, and here they do not. */
    ground: 0x6f7c48, sky: 0x8fc0e2, haze: 0xf0f3e4, sun: 0xfff4d8,
    fill: 0xa6c0ea, len: 0.86, den: 0.94, leaf: 0x8fc46a, canopy: 0x77ae5c,
  },
  {
    name: 'summer',
    grass: 0x79b055, grassDark: 0x4a7d3c, grassDry: 0xc9c069,
    ground: 0x74804a, sky: 0x6fb0dd, haze: 0xf4f2df, sun: 0xfff0c6,
    fill: 0x94b4e6, len: 1.10, den: 1.06, leaf: 0x63a24f, canopy: 0x4f8a45,
  },
  {
    name: 'autumn',
    grass: 0xa6ab5c, grassDark: 0x76773f, grassDry: 0xc79a52,
    ground: 0x7d6f3c, sky: 0x8fb6d0, haze: 0xf2e8d2, sun: 0xffe6b4,
    fill: 0xb2b0dc, len: 1.00, den: 0.96, leaf: 0xd08840, canopy: 0xc07a3c,
  },
  {
    name: 'winter',
    grass: 0x9aa382, grassDark: 0x6c7362, grassDry: 0xb0a888,
    ground: 0x6e6a54, sky: 0xa8c4d8, haze: 0xeef2f4, sun: 0xf0eef0,
    fill: 0xb4c4e4, len: 0.58, den: 0.55, leaf: 0xa8a894, canopy: 0x8e9384,
  },
];

/** Night, blended over whatever the season gave us. */
export const NIGHT = {
  sky: 0x2b3355,
  skyTop: 0x1d2745,
  haze: 0x4a5273,
  sun: 0xbcc6f0,      // the moon stands in for the key light
  fill: 0x5a6494,
  hemiSky: 0x39456b,
  hemiGround: 0x272b40,
  fog: 0x39456b,
  ink: 0x1d1b2a,
  grade: 0x8f9fd0,
};
