# the hedgepig adventure v2 — handover notes

A cel-shaded 3D rebuild of v1, on a small planet, with
[Kenton-GMI/sakura-crossing](https://github.com/Kenton-GMI/sakura-crossing) as
the baseline for the architecture and the rendering.

Read this before changing anything. As in v1, most of it is mistakes and what
they cost, which is more useful than a feature list.

---

## 1. What was taken from the reference, and what was not

Taken, more or less whole:

- **The cel material**, including the shader patch that tints the *shadow band*
  toward violet rather than just darkening the base colour. That hue shift in
  shade is most of what separates "anime cel" from "low-poly 3D". If anything
  here ever has to be simplified, keep this.
- **The ink pass**: screen-space lines from the *second difference* of
  linearised depth. A first difference smears ink across any surface grazing the
  camera, and in a meadow seen from 40 cm up nearly every surface is grazing.
- **Inverted-hull outlines** for the few things that want a drawn contour.
- **Flat authoring, bent once.** Every builder works on a flat XZ plane and knows
  nothing about the planet; `bakeToPlanet` runs after all of them and bends the
  lot. This is the single best idea in the reference and it is why ten place
  builders could be written without one of them containing a trig function.
- **Subdivide-then-bend.** A fence rail authored as a 20 m box has two vertices
  along its length; bending only those chords straight through the planet.
- **One parametric maker per family.** Their whole motor fleet came out of one
  table of eight numbers per vehicle. Here it is trees, mushrooms, fence, cars.

Not taken:

- Their world. This is v1's world — meadow, wood, lake, mire, hens, farm, road,
  town — not a Japanese suburb re-skinned.
- Their first-person player. This is v1's tap-to-call with a follow camera.
- Their radius. Theirs was 160 m with the railway on the equator; ours is
  **derived** from ten places of thirty metres, which is 47.75 m.

## 2. The numbers everything hangs off

```
PLACE_LEN  30 m      ten places
CIRC      300 m      one lap
R          47.75 m   = CIRC / 2π       <- derived, not chosen
BAND       13 m      walkable half-width of the field
HOG_LEN     0.26 m   life size, and the meadow is built around it
HOG_SPD     1.36 m/s v1's 300 px/s off its 220 px/m meter
DAY       150 s      phase 0 is NOON
YEAR      204 s
```

The horizon from the camera is `sqrt(2·R·h)` ≈ 11 m. That one consequence
drives more of the look than any art decision: the sky is most of the frame,
the fog closes at 24–40 m, and a tree at 6 m tall is visible from 24 m away
while a hedgehog is not visible from 12.

## 3. The bugs that cost real time

Six, and five of them were invisible in the console.

### The sun ran backwards against the clock

`nightAt` is v1's, and it assumes **phase 0 is noon**. The light rig was written
with `alt = -cos(phase·τ)`, which puts the sun *under the world* at noon. The
result was a scene lit at 40 % night with a readout that said "morning", and it
read as a deliberately moody palette rather than as a bug. If the world ever
looks dim for no reason, check that these two agree.

### The shadow camera was too small, so the planet was in shadow

At ±6 m the shadow map covered him beautifully at 6 mm per texel — and
everything beyond it came back **occluded**, because a fragment sampled outside
the shadow map clamps to the map's edge. What that produces is a pool of
daylight around the hedgepig and a dark planet beyond, which is convincing
enough to look like art direction until you walk. It is ±17 m now.

### Two colours multiplied into black

The ground carried the place's soil colour in its **vertex colours** and the
season's soil colour on its **material**, and the two multiply. Two mid-browns
multiply to something very nearly black; the whole field was unlit-looking mud.
The rule now, in both `ground.js` and `grass.js`: **the material carries the
real colour, the vertices carry a multiplier around white.** Vertex colour says
how this place differs from the average one, nothing more.

### Summer had no grass at all

`SEA_DEN` for summer is 1.06 — in v1 that multiplied a *spawn count*. Here it
multiplied `InstancedMesh.count`, and setting `count` past the length of the
instance buffer does not draw 6 % more grass: it draws **none**. The field
simply was not there for a quarter of the year and nothing was logged. Clamped
now.

### One null fog froze the entire game

The orbit view takes the fog off the scene; `season.js` wrote `scene.fog.color`
every frame and threw on `null`. The loop re-armed its `requestAnimationFrame`
at the *end* of `frame()`, so a single throw did not drop one frame — it stopped
the loop **for good**, and the game froze the instant you pressed P. Two fixes,
both kept: `season.js` guards the fog, and `frame()` now arms the next frame
**first**, so any future exception is a stutter and a console message instead of
a dead game.

### `flatShading` is silently dropped on MeshToonMaterial

Three's `MeshToonMaterial` does not declare it, so passing it to the constructor
gets it dropped with a warning — three hundred of them on this world's material
set — and every "faceted" surface came out smooth. The renderer reads
`material.flatShading` directly when it builds the program, so `cel()` assigns
it after construction instead.

## 4. The hedgepig

`assets/logo/hedgepig-logo-badge.jpg` is still the character. Every rule v1
wrote down about him held here, and the two it warned hardest about are exactly
the two that went wrong again:

- **Needles nowhere near cover a body.** 620 of them still leave most of the
  surface showing, and what showed through was cream — a cream ball with spikes
  in it. v1 named that outcome three times over: an artichoke, a
  chrysanthemum, a sea urchin. The fix is a **dark mantle shell**: a second
  ellipsoid at 1.012 scale, cut to exactly the region the needles root in, in
  the needles' own brown. It has to be *darker than the needles standing on it*
  — it is the shadow between them — or every gap in the coat reads as a bald
  patch.
- **The face wins, and the coat keeps out of a radius around it.** The keep-out
  was applied to the needles and not to the mass they stand on, so the coat's
  own *edge* ran straight across his eye — worse than a quill through it,
  because it is a hard line and it is always on the same side.

New here, and worth knowing:

- The mantle's boundary is a **plane section**, which is what the badge shows: a
  diagonal from the brow down behind the front leg. Cut it as an ellipse and its
  front edge bulges across the middle of him and reads as a beetle.
- **He still has no head.** In v1 that deleted a family of painter's-algorithm
  faults; here a depth buffer would have sorted those happily, and he still does
  not get one, because the real fault it fixed was that he stopped looking like
  himself. Looking about is a damped yaw of the *features* across his front.
- The face was first placed anatomically — low and well back — and read as a
  face printed on a large cream balloon, because the mass above the eyes becomes
  a forehead and a hedgehog does not have one. Eyes are high and forward now.

## 5. Things that will bite the next change

- **`heightAt` is the only answer to how high the ground is.** The terrain grid,
  the sphere under it, every prop, every blade and his feet all read it. The
  reference had a displaced sphere *and* a flat grid disagreeing by 65 mm and
  the sphere came up through the road. Do not add a second source of ground.
- **Anything that moves is built after the bake** and seats itself on the
  surface every frame: him, the boat, the traffic, the hens, the burrow, the
  things you sow. Bending a rig's geometry bends its pivots with it.
- **Instanced meshes are culled by hand.** Their bound comes from the source
  blade, not the instance cloud, so three.js would either draw the whole meadow
  or none of it. `grass.update()` does it by distance off *him*.
- **Range off him, never off the camera.** v1's hazards gathered from the
  visible band and scrolling away made him invincible. The camera cannot be
  taken off him here, but the next camera change will test this again.
- **Sowing is the first line of `call()`,** before any early return. Whatever is
  sown is the thing he walks to; move the call down and the mushroom garden, the
  wood and the hen run quietly stop steering him.
- **The grass was three times too tall.** 0.55 m blades are true to a real
  meadow and produce a green wall with a hedgehog somewhere behind it. They are
  0.10–0.33 m, and the camera sits above the canopy looking down.
- **The ink pass is deliberately blunter than the reference's** — 0.0125 against
  0.0042. A meadow puts tens of thousands of tiny silhouettes in a frame, and at
  their sensitivity every blade came back inked and he disappeared into a
  scribble. A blade is now below the threshold; a hedgehog, a fence post and a
  barn are all comfortably above it.

## 6. Verified, and how

Stepped by hand rather than through the render loop (`hog.update` + `game.update`
in a loop from the console — `window.__hedgepig` exposes everything):

| | |
|---|---|
| tap-to-call | called 6 m away, arrived at 0.03 m, target cleared, gait eased to 0 |
| water refuses him | called into the middle of the lake, stopped on the shore |
| the culvert | entered at the near verge, immune while under, out past the far verge |
| a thorn | 3 hearts → 2, curls, knocked back |
| the burrow | leg 1 → 2, speed 1.36 → 1.47, thorn density 0.18 → 0.40 |

Scene cost: 2 879 wrapped meshes, 223 k static triangles, 99 k grass tufts
across 250 instanced chunks.

## 7. Not done

- **No smoke harness.** v1's `smoke.js` was worth more than any feature and there
  is no equivalent here yet. `plan.js` and `terrain.js` are pure and import
  nothing but `util.js`, so they can be tested under Node today; everything
  above them needs a WebGL stub.
- **No sound.**
- The orbit view's far side is bare — 4-band toon shading over an icosphere,
  with nothing on it. It is a thing you look at once.
- Butterflies and bees are named in `weather.js` and are still only motes.
- Footprints, and grass parting as he pushes through it. v1 had both and they
  are a real part of why he felt like an animal rather than a token.
- He does not shelter, and the weather does not push him about.
