# the hedgepig adventure — v2

The same hedgehog, the same ten places, the same tap-to-call — rebuilt as a
**cel-shaded 3D world on a small planet**, with [Kenton-GMI/sakura-crossing][ref]
as the baseline for how it is built and how it is rendered.

v1 is still here, untouched, at the repository root: one 288 KB `index.html`,
Canvas 2D, no build step. This is a second build alongside it, not a
replacement.

[ref]: https://github.com/Kenton-GMI/sakura-crossing

```
cd v2
npm install
npm run dev        # http://127.0.0.1:5180
npm run play       # build, then serve the build and open it
```

Node 18+. Two dependencies: three.js and Vite. **No image assets** — every
texture in the world is drawn with Canvas2D at load time, which is the one
thing about v1 worth refusing to give up.

## Controls

| | |
|---|---|
| click / tap | call him there — and sow whatever the place and the season give you |
| drag | move the camera; it never turns him |
| scroll / pinch | close in on him |
| <kbd>space</kbd> | he stops where he is |
| <kbd>P</kbd> | see the whole planet from outside |
| <kbd>O</kbd> / <kbd>G</kbd> | ink pass and colour grade off, for seeing what they do |

## The shape of it

**Ten places of thirty metres is a three-hundred-metre round, so the planet's
radius is 47.75 m.** That number is derived, not chosen, and everything else
follows from it: the walk lies on the equator and closes into itself with no
seam, the horizon from the camera is about eleven metres away, and the field
you can walk in is ±13 m of latitude with open hillside beyond it and poles a
quarter-lap out at ±75 m.

The ring, in order — and the order is v1's, where **neighbours must share
something**:

> the butterfly garden · the wood · the mushroom garden · the lake · the mire ·
> the hen run · the farmyard · the road · the edge of town · the long meadow

Two of those run the full width of the field and are therefore unavoidable, so
each comes with its own way across: **the road has a culvert**, and **the lake
has a boat**. That rule is v1's and it is the sharpest thing in either build —
a hazard that cannot be dodged is not a hazard, it is a wall.

## What is different from v1

- **The year and the day are clocks, not distances.** v1 could make a year 284 m
  of walking because the world only scrolled one way. Here you can walk back on
  yourself, so a season that reversed with you would be nonsense. Day 150 s,
  year 204 s, a lap about 220 s — three periods that still never line up.
- **The camera follows.** v1's camera was entirely yours and never followed him;
  that was right for a field you looked *across*. Behind an eleven-metre horizon
  it is not, so it follows, lags, and still never turns him.
- **He is real geometry.** v1 ended up writing a software 3D renderer inside
  Canvas 2D to get his quills to foreshorten. Here that is just what he is: one
  cream ellipsoid, a dark mantle shell cut to a plane section, and 620 instanced
  needles raked toward his rump.

## The files

```
src/
├── main.js              entry: renderer, the two-light rig, the loop
├── core/
│   ├── toon.js          cel material, violet shadow tint, the role registry
│   ├── post.js          ink from depth second differences, grade, fxaa
│   ├── outline.js       inverted-hull outlines for the few things that want one
│   ├── chase.js         the follow camera, and the tap that calls him
│   ├── sky.js           gradient dome, cel clouds, sun/moon, stars
│   ├── textures.js      every texture in the world, drawn in Canvas2D
│   ├── palette.js       the four season corners, and night
│   ├── hud.js           four readouts and a toast
│   └── util.js          rng, noise, geometry bakery
├── world/
│   ├── plan.js          the ring of places; every spatial query goes through it
│   ├── terrain.js       heightAt — the one answer to how high the ground is
│   ├── planet.js        flat authoring bent onto the sphere, once, after the build
│   ├── ground.js        the terrain grid and the lake surface
│   ├── grass.js         250 instanced chunks, season in two uniforms
│   ├── season.js        the year and the day, and every colour they touch
│   ├── weather.js       rain, snow, leaves, petals, motes, fireflies
│   ├── props.js         trees, brambles, mushrooms, fence, the burrow
│   ├── index.js         assembly, and the one call to the planet bake
│   └── places/          the ten builders
├── hog/
│   ├── model.js         the character — read the badge before touching it
│   └── hog.js           the walk, the gait, the curl
└── game/game.js         hearts, legs, the burrow, hazards, sowing
```

`HANDOVER.md` is the one to read before changing anything. As with v1, most of
it is mistakes and what they cost.
