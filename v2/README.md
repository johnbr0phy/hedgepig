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

**The world is open.** There is no edge, no band and no corridor: you can set
off in any direction at all and keep going, over the poles and round again.
The only thing that can stop him is water.

**The ten places are the vertices of a pentagonal antiprism** — an icosahedron
with its two poles taken off. Five sit at latitude +26.565° and five at
-26.565°, the lower ring turned 36° against the upper. Every place is exactly
52.9 m from its four neighbours, every square metre of the planet belongs to
one, and walking in a straight line takes you through them.

v1's ordering rule survives, because the antiprism has a zigzag path that
visits all ten and closes on itself. That path is the old walk, still in there
as one route among many:

> the butterfly garden · the wood · the mushroom garden · the lake · the mire ·
> the hen run · the farmyard · the road · the edge of town · the long meadow

The planet is 300 m round, so its radius is 47.75 m and the horizon from the
camera is about eleven metres away.

**The road is the one thing you cannot walk round.** It is the great circle
through the roadside and the town, so it goes all the way over the planet —
and it keeps v1's sharpest rule alive, that a hazard which cannot be dodged is
not a hazard but a wall. There is a culvert under it. The lake is a lake now
rather than an ocean, so the boat is the *short* way across rather than the
only way, which is a better thing for a boat to be.

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
│   ├── grass.js         streams the meadow; wind and him, in the shader
│   ├── season.js        the year and the day, and every colour they touch
│   ├── weather.js       rain, snow, leaves, petals, motes, fireflies
│   ├── props.js         trees, brambles, mushrooms, fence, the burrow
│   ├── index.js         assembly, and the one call to the planet bake
│   └── places/          the ten builders
├── hog/
│   ├── model.js         the character — read the badge before touching it
│   ├── anim.js          the gait, the blink, the sniff, the ear flick
│   └── hog.js           steering, calling, and being hurt
└── game/game.js         hearts, legs, the burrow, hazards, sowing
```

`smoke.js` is the headless harness: `node smoke.js` runs all seventeen
scenarios, or name one — `node smoke.js gait` proves a planted foot does not
slide, `node smoke.js open` proves there is no edge to the world, `node
smoke.js roadmiss` measures how dangerous the open tarmac is. It drives the real modules, not a copy of
them; three.js runs in Node as long as nobody asks it for a WebGL context.

`HANDOVER.md` is the one to read before changing anything. As with v1, most of
it is mistakes and what they cost — and eleven of them are in there now,
because writing the harness found five more.
