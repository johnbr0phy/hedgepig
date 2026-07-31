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

### Everything on his face must be *derived*, not guessed

Four separate features were positioned by eye against numbers they did not
share, and every one of them ended up **inside the mass it was supposed to sit
on**:

- the **catchlight** sat 10.2 mm from the centre of a 14.5 mm eyeball with a
  4.2 mm radius of its own — entirely buried, so both eyes read as flat black
  holes. v1's handover says plainly that the catchlight is most of what makes
  an eye look alive; this was it not being there at all.
- the **nose** was at `A × 1.03`, which was 48 mm behind the tip of the snout
  it belongs to. He had no nose.
- the **blush** was at the eye's own z of 49 mm, where his cheek is 80 mm out.
  It was never once visible.
- the **snout** was 62 mm long against a 130 mm half-body — 40 % added to his
  length, merging with the body into one long pale wedge. That is a tapir.
  v1's rule is that past about 1.25 times a short snout he is an anteater.

There is now one `SNOUT` record and one `surfaceZ(x, y)` helper, and the nose,
mouth, whiskers and blush are all placed off them. **If a feature needs a
literal number to find his face, it is in the wrong place.**

And one that hid another: the snuffle animation hard-coded the snout's resting
height, which quietly *corrected* a constructor that had put the snout on top
of his head. The model was wrong and the animation covered for it. The snuffle
rides on `userData.restY` now.

### Looking about is done in his own space, not in world space

His features are on an ellipsoid 130 mm long and 88 mm wide. Rotating the face
group about Y holds every one of them at a **constant distance from that
axis**, which is right for a sphere and wrong for him: as a feature swings
toward his flank the surface falls away beneath it and the feature is left
hanging in the air beside him. His nose sits 147 mm out on the snout and his
side is only 73 mm out, so at v1's 1.35 rad neck limit it flew **48 mm clear of
his cheek** — 18 % of his whole body length, and from outside it looks exactly
like what it was reported as: his eyes leaving his face.

`setLook` scales into unit-sphere space, rotates there, and scales back, which
maps the ellipsoid exactly onto itself; each feature is *placed* by that map
and then turned rigidly, so nothing is stretched by it. `smoke.js face` asserts
the invariant directly — the depth of every feature into the body must not
change at any angle — and it holds to 4×10⁻¹⁶.

Two things fell out of it. The **snout had to move into the face group**: the
nose, mouth and whiskers all sit on it, so it has to swing with them or his
nose is left behind. And the **glance had to get much smaller** — v1's 1.35 rad
was a *head* being aimed, with visibility ramps fading each feature as it
turned away. He has no head and no ramps, so past about half a radian his nose
is on his cheek however correctly it is placed. It is 0.5 rad now: a glance,
not a turn.

### The coat's edge is a brow line, not two circles

The keep-out round his eyes was two separate circles, and between them the coat
survived and came down the middle of his forehead as a dark wedge — a widow's
peak with a point on it, right between his eyes. The test is distance to the
*segment* joining the two eyes now, so what is cleared is the whole brow band.

Related: a dozen quills at the front of the mantle lay **forward over his
face** like a fringe with spikes in it, because a fixed rake does not turn a
brow quill far enough — its normal points forward to begin with. The rake grows
with how far forward the root sits, and anything still pointing forward after
that is simply not planted.

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

### The sun never set, and three other things were downstream of that

`state.sunDir` was built as `max(|alt|, 0.22)` in its up component, so the key
light's elevation was **never below 0.22** — the sun swung round in azimuth and
bobbed between 13° and 90°, and never once touched the horizon. Everything
that reasoned about a sun going down was therefore dead code:

- `sky.js` chose the disc's position with "if the sun is below the horizon,
  use the anti-sun instead". That test never fired, so what was called the
  moon was the sun's own direction in a colder colour, drawn with a phase
  that had nothing to do with where it was. A full moon's geometry with a
  crescent's face, and never on the correct side of the sky.
- Shadows never lengthened, because the light never grazed.
- There was no such thing as twilight, because there was no such thing as
  sunset.

The sun is on a tilted great circle now and goes properly under. Two things had
to come with it, and both are the kind of thing that only shows up in a frame:

- **The key light had to gain a floor.** The old clamp was, accidentally,
  guaranteeing that a night still had a directional light in it (intensity
  0.52 at full dark). Removing the clamp without replacing it gave a moonless
  night with *no* key at all — a black field with a catchlight floating in it.
  There is now the moon when there is one and a fifth of a light from
  overhead when there is not.
- **The moon's phase is now its position.** Elongation from the sun *is* the
  phase, which is the real astronomy and costs nothing: full is opposite the
  sun and up all night, new is beside it and therefore not there.

### One darkness was doing three jobs

`nightAt` carries a deliberate -0.22 offset so that dusk lags sunset. That is
correct for *is it night* — fireflies, the owl, lit windows — and it is flat
zero until the sun is 13° under, which meant the whole of dusk was painted in
**full daylight sky colours**. The blue hour came out as a flat cream wash and
no amount of tuning the three sky stops could fix it, because the sky was being
told it was still afternoon.

There are three curves now and they are not interchangeable:

| | |
|---|---|
| `night` | is it night — gameplay, unchanged, still v1's |
| `dark` | what colour is it — starts the moment the sun touches the rim |
| `lum` | how much light is there — `max(night, dark·0.62)`, so evening dims steadily and the small hours are still darkest |

Driving the light intensities off `dark` instead makes dusk exactly as black as
midnight; driving the sky off `night` gives a violet-free dusk. Both were tried
in that order.

### A sky with no bearing cannot have an hour

The dome was a function of height alone, so a sunset looked identical whichever
way you turned — the one cue that gives a sky a time *and a direction* was
simply absent. It now carries a horizon glow aimed at the sun's own bearing,
with a cooler counter-glow behind you, off a seven-stop ramp keyed to sun
altitude. That ramp is doing the job a Rayleigh/Mie model does in a photoreal
sky; chosen stops are the right trade in a world drawn with four-band ramps.

Related, and cheap: the hour readout was an eighth of the clock each. Once the
clock stopped running at one speed that stopped being an hour, and it announced
"dawn" for a sun 25° up. `hourNameAt` reads the sun's height instead, which is
what an hour has always been a description of.

### A blocker may never hold something already inside it

Sown props were never registered as obstacles, so he walked into snowmen and
settled into an idle inside one. Adding them as blockers is three lines; the
trap it opens is the whole problem. A no-go that appears *around* him refuses
every direction including his escape, and he is frozen for good — a far worse
bug than the one being fixed.

`blockedAt` therefore takes where the step is coming *from* and refuses only
moves that go **deeper**. Not *strictly* outward, which was the first version
and was still a cage: with a second blocker in front of him the only way out is
`tryStep`'s slide, and a slide is tangential — the same depth, not less — so
both moves were refused and he was pinned between two things he could have
walked around. The harness has that case, and it caught it.

### Weather that is a function of the season is not weather

Rain, snowfall and leaf-fall were each a pure function of the season weights.
That is not a small stylisation — it means at a given point in the year it
always rained, exactly as hard, and between those points it never did. Nothing
ever *arrived* and nothing ever *cleared*, so the one event a sky can give you
— the rain stopping — could only happen at one fixed moment of the year, and
the rainbow that is earned by it with it.

A front is a slow wander put through a threshold, and the threshold is what
makes it weather: a threshold has a before and an after, where an amplitude
only has a size. The season moves the *threshold*, not the rain — a wet season
is one where the front gets over the bar often and stays. Wind uses the same
wander at a lower bar, so it gets up before the rain does, which is the
cheapest possible way to make weather feel like it comes from somewhere.

And lying snow now accumulates and melts instead of being read off the
calendar. As a direct function of the winter weight you could stand in a
blizzard on bare grass, and in bright sun on deep snow: the ground and the sky
disagreed all winter.

### Snow could not cover the place tint, because the tint is in the vertices

The rule from §3 — the material carries the real colour, the vertices carry a
multiplier around white — has a consequence nobody had hit yet. Whitening the
*material* for snow does not whiten the *hue*: under deep snow the material is
very nearly white, so the vertex multiplier is the only colour left in the
ground. In sunlight the top toon band clips it away and you cannot see it; in
**shadow** it is all there is.

What that produced was a white field with a bright green hedgehog-shaped hole
in it — and it reads as a shading bug, which is what half an hour went on
before the multiplier was the suspect. `buildGround` now takes one uniform and
one line of vertex shader that lerps the whole multiplier to one. The
alternative was rewriting 20 000 vertex colours per frame.

While proving it: **a snowfield at 2.15 key intensity clips every channel** and
comes out as a flat sheet of paper. The snow colour is 0xdfe9f1, not white, so
the shading has somewhere to go.

### The sky did not know which way was up

The dome shader took the view direction's **world** `.y` as elevation. On a
planet the world horizontal is the horizon at exactly *one* point on the
surface — flat (0, 0), where `dirAt` returns +Y — and everywhere else the
entire sky gradient was tilted against the skyline, by up to ninety degrees.

What that arrives as is a hard cream wall filling half the frame with blue
down one side of it, and it reads so completely like a rendering fault that
three other things were suspected first: the cloud planes, the sun's halo, and
the new horizon glow. It had been there since the dome was written.

The same frame error was under the sun and the moon: `state.sunDir` is in
**his** tangent frame (east, up, north) and `seatLight` converts it properly
for the light rig — but `sky.update` was using the same vector as though it
were world space to place the disc. So the drawn sun and the light casting the
shadows were in different parts of the sky everywhere but that one point.

The fix is one rotation, not one conversion: the sky group carries his tangent
basis, and the dome reads its own **object-space** y. Everything inside the
group — clouds, stars, constellations, the aurora, the meteor, both discs —
becomes correct at the same time, and `state.sunDir` can be used directly
because group space now *is* his frame. `setOrbit` clears the rotation with
the position.

Found while chasing something else, which is the usual way here. The lesson is
the general one: **on this world, any `.y` is a bug unless you can say which
frame it is in.**

### Clouds have to be small enough that several fit in the sky

They were 34–88 m wide at 90–190 m out — up to 52° of arc each. One cloud
filled half the sky, and since a cloud plane is brighter than the sky behind
it, the result was another cream wall. 26–58 m at 150–280 m, and 28 of them.
Their texture also had lobes running off the edge of its own canvas, which put
a dead-straight vertical cut down one side of every cloud.

### An animation rate is not an utterance rate

A hedgehog is a nose with legs on, so `anim.js` twitches his nose every half
second to two seconds. That is right to *look* at, and it was wired straight
to `audio.sniff()` — one sound per twitch, which is a hedgehog snuffling
continuously, forever. It stops being charming inside a minute and then it is
the only thing in the mix.

The nose keeps its rate. The **voice** is gated: `createVoiceGate` holds one
shared clock across every kind of utterance, so a chunter cannot land on top
of a snuffle and he never talks over himself, and each kind asks with its own
probability. Roughly one small noise every ten seconds comes out of it — the
harness asserts the *rate*, in noises per minute, reading `VOICE` rather than
carrying its own copy of the tuning.

Two details worth keeping:

- **The chance is asked after the gap, and a refused roll does not restart the
  clock.** The other way round, a run of bad luck makes him mute for a minute.
- **A gap is a floor, not a schedule.** Quiet for at least that long, and then
  the dice decide. Clocked noises read as a cuckoo clock; this reads as a
  creature.

And on the sounds themselves: a snuffle that is only filtered noise is a
draught under a door. Every utterance is breath *plus* a little voicing — the
low triangle under each puff is the whole difference between a hedgehog and a
bellows.

### The keys, and the two things they made reachable

WASD drives him camera-relative; the tap is now only for sowing. `driveBy`
takes a heading in **his own tangent frame** and a throttle, and shares every
bit of its steering with a call through `_steer` — the turn rate, the bank, the
facing ramp. Two copies of those would drift, and the drift reads as "he
handles differently when you drive him", which is the bug you cannot find by
reading either copy.

Three things were only learned by doing it:

- **The heading comes off the camera's real forward, not `chase.yaw`.** They
  agree to within the smoothing lag most of the time — but the chase clamps
  its position when the ground would come between it and him and then re-aims,
  so they part company exactly when you are backed into a bank, which is
  exactly when you are pressing keys hardest. `RIGHT_OF` is `+π/2` and that was
  *measured* against the live camera, not reasoned: the sign depends on how
  `makeBasis` consumes (east, up, north), and backwards gives mirrored controls
  that read as a broken camera rather than as a wrong sign.
- **The slide was faking success.** `tryStep` used to free up whichever flat
  axis still worked. Walking due east makes `dz` exactly zero, so the z retry
  is `canStand(x, z)` — where he already is — which succeeds, resets the
  blocked timer and moves him **nowhere**. With click-to-call that expired
  after 1.1 s and you never saw it; with a key held down he pressed against a
  fence in silence for as long as you liked. Sliding is a *step deflection*
  now, nearest angle first, which cannot fake a zero-length move and does not
  depend on which way round the planet you happen to be standing. It stops
  short of a right angle on purpose: past that he is crab-walking, and a
  dead-on press should stop and complain, because that is what an animal does.
- **`rolling` is set by whichever branch of `update` is moving him**, and at
  zero throttle that branch stops running — so a roll begun by the keys stayed
  set for ever and he idled, snuffled and stood about still tucked into a ball.
  `driveBy` clears it on the *release edge*, not while held at zero, because a
  called roll is somebody else's and the keys report zero on every frame nobody
  is touching them.

`driveHog` is exposed on `window.__hedgepig` for the same reason `__shot` is:
a hidden tab has no rAF, so nothing that only runs inside `frame()` can be
exercised from a console — and the keys are exactly that.

## 5. Things that will bite the next change

- **A pitched roof is `s * +angle`, not `s * -angle`.** Rotating about +x by a
  negative angle lifts the *far* edge, so both slabs rise at the eaves and meet
  low in the middle: a valley, not a ridge. The barn and all three town houses
  had their roofs on upside down, against gable ends that were the right way up
  the whole time.
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

- **Frame rate, measured at last (2026-07-30):** one `pipeline.render` frame
  at 1260×693 CSS (scale 2 → 3.5 M px) issues **1 104 draw calls and 1.33 M
  triangles** through 48 programs — the scene once for shadows, once for the
  ink's depth source, and the post passes on top. The wall time measured was
  81 ms/frame, but from a *hidden* tab, which Chrome GPU-throttles, so treat
  it as an upper bound, not a number. The draw-call bulk is the ~830 rigid
  props each being its own mesh; if a focused frame is ever actually slow,
  the lever is merging those by material after the bake (`bake` in `util.js`
  already does the geometry work), which would take the call count down by
  an order of magnitude. The `pixelBudget` guard (4.6 M px) already caps
  resolution on dense screens.
  **Done (2026-07-31):** the static merge in `world/index.js` folds 1 205
  prop meshes into 78 by (material, shadow flags, renderOrder) — frame
  calls 1 104 → 837 at the same view. Excluded by `userData.noMerge`:
  anything that toggles visibility (thorns, seasonal), animates in place
  (the cat), is transparent, instanced, or pickable. The remaining bulk is
  the 260 brambles and the grass chunks.
- ~~No sound~~ — `core/audio.js` (2026-07-30): everything synthesised, nothing
  sampled. Footfalls come off the real gait (`anim.js` reports the frame a
  foot plants — the audio runs on that edge, not a timer), the beds follow
  the clock (birds by day, crickets by night, silence with the snow, which
  ducks everything because that is what snow does), and the lake and the
  traffic range off *him*. `M` mutes, persisted. No audio before a gesture.
- ~~Butterflies and bees are only motes~~ — `world/critters.js`: butterflies
  anchored to the garden that flee him, bees orbiting blooms, bird flyovers,
  frogs that plop off the bank with a ring when he comes too close, fish
  rises, and an owl in the wood at night. All ranged off him, never the
  camera — a bird spawned off the camera is the invincibility bug wearing
  feathers.
- The orbit view's far side is still mostly bare, though the ground now
  carries moss/soil mottling at a few-metre scale everywhere.
- Footprints, and grass parting as he pushes through it (the shader push
  exists; the memory of it does not).
- He does not shelter. Rain now *hurries* him (`rainHurry`), which is half
  of it.
