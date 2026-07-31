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

### Built, listed as done, and never once seen

"Butterflies, bees, birds" went into the run log two sessions running. They
were all genuinely there, and nobody had ever seen one. Four things stacked up,
and no single one of them would have been enough:

- **Seven butterflies and five bees, for a whole planet**, all pinned within a
  few metres of `CENTRE[BGARD]`. That is one place out of ten, on a world where
  a lap is 300 m and the horizon is 11. Nine tenths of the time there were none
  within sight of you, and in the garden itself seven insects over sixteen
  square metres is one every two metres.
- **They never streamed, although the code looked as though it might.** The
  re-home test was "faded out and far away" — but they only fade when the
  weather grounds them, so on a fine summer day a butterfly never qualified to
  be moved and stayed where it was built for the whole game. The fix is the
  *other* half: cull by distance off him, like the grass chunks. Without the
  cull the streaming ran in principle and never once in practice.
- **Half life size.** 26 mm wings against a 260 mm hedgehog. A small white is
  about 45 mm across, so the honest number is nearly double.
- **And the ones you could see were not butterflies.** The wings were mapped
  with `petalTex`, which is a **five-petal flower** — so each wing was a whole
  rosette and a butterfly read as a small flower hovering over the grass. They
  have their own wing texture now, a forewing and a hindwing, and the flap is a
  rotation about the body axis rather than a yaw that only slid them past each
  other.

Two smaller things came out of it. The fly-or-not gate was a hard threshold on
a product of four factors, so one shower took every insect off the planet at the
same instant; each one has its own tolerance now and a shower thins them. And
three of the seven colours were near-white, which against this world's pale
horizon is an invisible butterfly — one white is charming, three is a third of
the population you cannot see.

**The general lesson, and it has now happened twice:** a feature can be
complete, correct, committed and still absent. "Ranged off him" is not the same
as "reachable"; a pool anchored to one place on a planet you walk around is a
pool nobody meets. The next thing built for the world wants a sentence about
*how often you will be standing near one*, and the harness now asserts exactly
that — walk to the far side of the planet, and count how many are within 12 m.

### Clouds: the lighting model, not the integration

The clouds were flat cel quads that turned to face you — fine as painted
background and completely inert: the same colour whether the sun was behind
them or over your shoulder, so the one thing a sky does in an evening did not
happen.

**Volumetric raymarching was researched and deliberately not built.** It is the
right answer for a photoreal sky and the wrong one here twice over: it costs a
nested loop per pixel (a view ray, and a second ray to the sun at every
sample), and the standard remedies — quarter-res cloud pass, temporal
upscaling — are a whole machinery this project does not have. And it would
look photoreal, next to four-band toon ramps and a screen-space ink pass. The
rule in §5 is that a change which makes this read as generic 3D is wrong
however clean the code is.

What *was* taken is the shading model, applied to ordinary low-poly geometry
for a few instructions:

- **Henyey–Greenstein forward scattering**, the real phase function at g≈0.72.
  Droplets scatter light forward, so a cloud between you and the sun glows.
  This is the silver lining and it is most of the effect.
- **Beer's law by proxy.** Thickness on a mesh is the silhouette: a face
  edge-on to you has a lot of cloud behind it. So the glow lives at the rim,
  which is where it lives.
- **The powder effect** — darkening just inside the lit edge, which is what
  gives a cumulus its cauliflower. The reference is candid that it is not
  physical; it is kept for the same reason it was invented.
- **Sky above, land below** — the top takes the sky, the base takes the haze,
  and the base is the part that goes pink first.

Cost: 26 draw calls and about 14 000 triangles.

Two things had to be found by measuring:

- **A ring of clouds has nothing over your head.** They were placed at a
  radius and a height, which puts every one of them between 8° and 36° of
  elevation — so near noon the sun is above all of them and "a cloud goes
  over and the meadow dims" happened *zero* per cent of the time. They are on
  a dome now, weighted low because you spend this game looking down, and the
  sun is behind cloud 4–19 % of the hour.
- **The occlusion cone is deliberately wider than the cloud.** At the true
  angular radius the sun is behind something about one per cent of the time —
  honest for a fair-weather sky, and it means you never once see it while you
  are watching.

And one self-inflicted trap worth recording: `season.js` had a local
`const damp` for how damp the season is, which **silently shadows the imported
`damp` easing function** for the rest of the scope. It surfaced four hundred
lines later as `damp is not a function`, in a code path added long afterwards.
It is `wetness` now.

### A star drawn with normal blending is a paint

The constellations came out at dusk as a **line of dark dashes across a bright
horizon**, turning slowly as he walked. Reported, quite reasonably, as a
strange black line rotating in the sky.

Two things made it, and the second is new:

- `LineBasicMaterial` in pale blue at 0.07 opacity over a bright cream-and-
  orange sky comes out *darker than the sky*. Normal blending is a paint: it
  can darken. A star that darkens the sky it is on is a contradiction, and it
  was reachable because nothing said otherwise.
- They **rotate** now, because the sky group carries his tangent frame. That
  was the fix for the tilted dome and it is correct — but it turned a static
  artifact into a moving one, which is what made it read as a fault rather
  than as scenery.

Everything star-shaped is **additive** now: stars, constellation lines,
constellation points. A star can only add light, so where the sky is brighter
than the star the star disappears — which is precisely what happens at dawn,
for free. And their opacity is gated on `night` as well as on the sun's
altitude: the sun going under is a good while before the sky stops being
bright, and they were at a third strength over an orange horizon.

**The rule:** anything in this world that represents *emitted* light — stars,
fireflies, glints, the aurora, a lit window seen from outside — must be
additive. If it can darken what is behind it, it is not a light.

### The flattest thing on the planet was the road's own verge

The world had **1.44 m of relief across the whole of it** — four sine octaves
summing to less than a metre and a half, on a globe 300 m round walked by an
animal 26 cm long. Nothing was ever hidden behind anything: you could see the
whole visible world from anywhere in it, and it read as one flat green wash
however much was scattered on it. That is most of what "sparse" means here,
and no amount of extra props fixes it.

Raising it is nearly free, because `heightAt` is the only answer to ground
height and the globe mesh, every prop, every blade and his feet all read it.
Two things had to be found by measuring rather than reasoning:

- **The steepest ground on the planet was not a hill.** `reliefMask` faded the
  entire relief to zero over 4.7 m beside the road, which at 1.44 m was a
  gentle verge and at 3.4 m is a **38° bank running the whole way round the
  world**. A grading mask has a gradient of about `relief × 1.5 / width`, so
  its width has to scale with the relief. It is 21 m wide now. Any future
  landform taller than this one wants checking here *first* — I spent three
  tuning passes on the wave amplitudes before looking at the mask, and the
  waves were never the problem.
- **`walkableAt` refuses water and nothing else**, so no slope can ever stop
  him and relief has to be self-limiting. The harness's 0.22 m per 0.4 m
  ceiling — 29° — is the real constraint, and it is scar tissue from the lake
  basin's `l ** 0.8` cliff. The world now peaks at 22.6°.

And a **landform hook**: a term belonging to one place, faded in by that
place's own weight, exactly as `basin` and `dishes` already do for the lake
and the mire. Written as a function of `dot(surface direction, axis)` for the
same reason the relief is — that form is smooth and single-valued over a
sphere by construction, so a landform that breaks at a pole or a seam cannot
be written in it.

The harness asserts the relief **as a floor** as well as a ceiling, because
the failure mode is a quiet flattening: a mask widened or an amplitude
trimmed, and the world goes back to a table top with nothing looking wrong in
the diff.

### `bakeToPlanet` maps an instanced mesh's positions *for* you

The bake treats each instance's position as **flat authoring coordinates** and
maps it onto the sphere itself (`planet.js`, the `isInstancedMesh` branch). A
builder that seats instances with `positionAt`/`basisAt` before the bake is
therefore mapping them **twice**: a point already 47.7 m out comes back at a
longitude of 47.7 m, which is a radian round the planet.

`road.js` had done exactly that since it was written, so the road's centre
line, all 502 kerbstones and the town's paving have been **inside the planet**
for their whole existence. The backlog item that said "the road is a
featureless mass with no markings" was not describing missing work — the
markings were there, they were just never anywhere near the road.

**The rule: instanced meshes are handed flat coordinates and left alone.**
Rigid props go through `ctx.put`/`ctx.scatter`, which set `planetRigid`;
instances go through the bake. Neither wants `positionAt` called on it first.

### A statistical test that reports the scenario order

`roadmiss` measures how many road crossings cost a heart and needs 60 %. It
passed alone and failed inside `all`, one crossing either side of the line —
and its own comment already recorded that this had happened before at six runs
and been "fixed" by going to twelve.

The cause is that the harness shares one cached world, so this scenario
inherits whatever the ones before it left: **his speed** above all, since a
later leg crosses sooner and is exposed for less time. It resets speed and
invulnerability now and runs twenty-four crossings, and it sits at 17/24 on
every run rather than wandering.

The general point, since this is twice: **a shared cached world makes every
threshold test order-dependent.** If a scenario measures a rate, it has to
reset the state that rate depends on, or it is measuring the suite.

### A resident is a destination, and it needs a reach of its own

`world/characters.js` puts four animals in the wood — a badger at his sett, a
robin, a toad under the deadfall, a wood mouse under the birches — and they
are the first thing in this world that is **pinned on purpose**. Everything in
`critters.js` re-homes near him, because a butterfly nobody is standing next to
may as well not exist; a badger must not, because the whole value of a badger
is going back to the same badger.

Three things about them are load-bearing:

- **Ranged and culled off *him*, never off the camera** (`SEE = 15`). A
  character that noticed the camera would notice you from orbit, on the far
  side of the planet. Same invariant as the grass chunks and the insects.
- **Reach is per animal.** Every interactable in this world is met at 0.8 m
  because every interactable stands still. The robin does not — it hops to
  within 1.15 m of him and keeps that distance by design, so on the shared
  0.8 m the one character that *comes to you* was the one you could never
  speak to. `TEMPER.talk` is 1.05 / 1.60 / 0.80 / 0.85, and the harness
  asserts both halves of it: the robin is reachable at its own distance and
  is not at an interactable's.
- **He keeps the resident he has, out to `talk + 0.45`.** Leaving at the
  radius he arrived at means a hedgehog snuffling on the spot crosses it and
  the panel blinks out mid-sentence.

The panel itself is `core/dialogue.js`, and it is deliberately dumb: it types,
it waits, and it never closes itself. What closes it is walking away, Space, or
the next line. **Space is the hop and the advance both**, and `advance()`
returns whether it did anything precisely so the key can be swallowed —
without that, one press finishes the line *and* hops him away from the animal
saying it.

`speaker()` enforces the two rules the interactables' lines were built on: never
the same line twice running, and **never two conditional lines back to back**,
or a character who is asked about a rainy night answers with a second remark
about the weather and reads as a forecast rather than an animal.

The lines are given the climate's state and the game's merged — `hearts` and
`found` live in `game.state`, the weather in `climate.state`, neither knows the
other exists — and **every predicate reads defensively**, because `say` is
called from inside `frame()` and one exception in a per-frame path has already
cost this project a whole game.

### A bramble is arching canes, and nothing else about it reads

It was a squashed icosahedron with twenty-six cones stuck through it, which is
an excellent spiky turtle and not a thorn bush at all. What your eye actually
names a bramble by is the **arch**: a cane leaves the ground, sweeps up and
out, and roots again at the tip. Half a dozen of those crossing each other is a
bramble with no thorns on it; a dome is not one however many spines you add.

Two details that mattered more than the geometry: the thorns hook *backwards*
down the cane, which is why real ones catch, and they are small — a thorn you
can count from two metres is a cactus. And `tubeBetween` guards a zero-length
segment, because two arc samples coincide where the curve flattens at the tip,
and the NaN goes straight into the baked geometry where only the harness would
ever find it.

### A ball that does not gather pace downhill is a fast walk with the legs hidden

`rollSpeed()` was `1 + ball` — a tuck worth exactly double, on the flat, up a
hill and down one alike. With nearly six metres of relief in the world that is
the wrong answer in the most noticeable possible place.

`hog.momentum` is deliberately **not** a per-frame slope multiplier: it
accumulates going downhill and bleeds off on the flat and against a rise, so a
long descent leaves him genuinely quick for a few seconds at the bottom and a
climb costs him what he gained. That memory is the whole difference between
rolling and sliding. Drag is higher than gain so it cannot run away, and the cap
is 1.6× on top of the tuck — fast enough to feel committed to, slow enough that
4.6 rad/s of steering can still put him where you meant. Standing up spends it:
the legs are not a wheel.

### A Starship, at actual size, on a planet 300 m round

There is a full Starship stack in the mire — a 71 m booster, a 1.8 m hot-stage
ring and a 52 m ship, so 123 m of it, beside a 146 m catch tower. Nothing is
scaled down. The planet's radius is 47.75 m, so the stack is **2.6 planet
radii** tall and the tower is **3.1**, and it comes up over the horizon from
the far side of the world like a mast. `places/starbase.js`.

The mire is not an arbitrary address: Starbase stands on a coastal wetland at
Boca Chica, and the mire is this world's flat wet place at the edge of the
water. It is the one spot on the planet that is *right*.

Four things had to be got right and every one of them is a rule that will
apply to the next big thing anybody builds here:

- **Nothing vertical may be bent onto the planet.** `bakeToPlanet` wraps flat
  geometry round the sphere, which is correct for ground and catastrophic for
  a rocket: a 123 m cylinder wrapped round a 48 m sphere curls past its own
  base and comes out the other side. Everything that stands up is in a
  `planetRigid` group, re-seated whole on the tangent frame at its own foot.
- **Each standing thing needs its OWN rigid group.** A rigid group stands on
  one tangent plane, and a tangent plane leaves the sphere by `d²/2R` — 2.1 m
  at 14 m out. Put the rocket and the tower in one group seventeen metres
  apart and one of them floats two metres in the air. Every leg, column and
  tank is also drawn reaching *below* its own datum by that amount (`SINK`),
  so the outermost feet meet the ground and the innermost are buried. A rigid
  structure on a small planet either does that or stands on tiptoe.
- **The apron follows the ground; it does not raise it.** The first version
  was a plinth clearing the highest terrain under its footprint, and the mire
  has 0.9 m of wave in it across twenty-six metres — so it stood a metre proud
  and the hedgepig, whose hop peaks at 0.42 m, could not get onto his own
  launch site. Grading a pad flat means owning a second source of ground, and
  §5 says there is exactly one. It is a **skin** now: a radial mesh whose
  every vertex sits 3 cm over `heightAt`, which is the same trick the mire's
  own standing pools use eighty lines away. No platform, no step, no hop.
- **Concrete is hard ground, and hard ground is decided in `plan.js`.** Left
  out of `hardAt`, the meadow grew straight up through the pad — the grass
  field takes its cue from that function and from nowhere else. `padAt` is in
  there now with the town's paving and the road. It is deliberately *not* in
  `reliefMask`, which is what the town and the road use to grade the terrain
  flat under themselves: the mire stays a mire under the concrete.

**Above the pad the fog is off.** The world's fog runs 11 m to 40 m — it is a
*ground haze*, sized to hide the horizon of a small planet from something
26 cm tall. Left on, everything above about 12 m of this would be solid fog
colour and the rocket would be a stump. Steel standing 123 m up is above the
haze, which is also what it looks like in life: distant hills fade, a rocket
in clear air does not. The apron and the tanks keep their fog, because they
are down in it with everything else.

**Nothing above the mount casts a shadow.** The shadow camera is ±17 m around
*him* (§3), and an object poking out of an orthographic shadow frustum does
not produce a long shadow — it produces a solid black wall across the whole
map, because everything past the frustum is clamped to its edge. The mount and
the tanks are inside it and do all the work that can honestly be done.

The whole site is thirteen draw calls: each part is one baked geometry per
material, and the materials are the shared cached ones, so it adds no shader
programs at all.

### Residents on the compass, and a scale that is not the burrow's

The four in the wood are red dots on the compass ring — solid until you have
met them, then a hollow ring with a tick through it. Meeting somebody crosses
them off rather than deleting them, because a met resident that vanished would
take "go back and see her again" with it, and going back is the entire point
of having residents at all.

**Their distance scale is not the burrow's, and that was a real bug.** The
burrow's dot walks in from the rim against half a lap, because the burrow can
genuinely be half a lap away. Measured the same way, four animals who all live
inside one wood landed within eight pixels of the middle and piled into a
single unreadable smudge on top of him. `FOLK_FAR` is 20 m: at the rim they
read as "that way, and a long way", and inside it they separate.

Who has been met lives in `game.state.met`, in the save, **not** in
`characters.js` — the same reasoning as `visited`. The save is one object
written from one place, and a second thing keeping its own key in
localStorage is how two saves come to disagree about which run you are on.

### The moon is a ball, the sun is a disc, and the asymmetry is the point

**The moon's phase is no longer drawn. It is what happens.**

It used to be a flat quad with a second circle slid across it to bite a
crescent out. That works for a crescent and cannot work for anything else:
subtracting one circle from another can only give you a lens, and a gibbous
moon's terminator is a half-*ellipse* — the lit limb stays a perfect
semicircle while the terminator narrows, flattens and crosses over. The bite
was wrong for half of every month.

The geometry to do it properly was already in the file. `moonDirAt` puts the
moon `phase` of a turn along the sun's own arc, so **its elongation from the
sun *is* its phase** — which is the real astronomy — and that means lighting a
ball by `sunDir` reproduces `moonPhase` exactly, with no second copy of the
number to keep in step. The hack and the truth were the same fact written
twice; deleting the hack was the whole change.

Three things it buys that a quad cannot have: an elliptical terminator, soft
because the far limb of a real moon is grazing light on rough ground; a dark
side that is **earthshine** rather than black, so a crescent reads as a
*sphere* with the rest of it faintly there instead of a moon with a piece
missing; and an alpha that follows the light, so a new moon fades out where it
stands rather than hanging about as a grey ball among the stars.

**The sun stays a disc, deliberately.** It has to be drawn unlit — a lit
sphere has a terminator, and a sun with a terminator is a crescent — and an
unlit sphere four degrees across is pixel-for-pixel the disc it would replace.
It would be triangles for nothing.

Two traps, both of which bit:

- **Light it in the mesh's OWN object space, never in view space.** The first
  version compared `normalMatrix * normal` against a view-space sun, which
  needs `camera.matrixWorldInverse` — and the renderer writes that at *draw*
  time, not when `update` runs. The sun arrived a frame stale, the terminator
  sat wherever the camera had last been pointing, and the moon was full every
  night of the month. `_sunDir` is already in the sky group's frame and the
  moon is a child of that group, so undoing the mesh's own turn is the entire
  transform and no camera comes into it.
- **No back-quotes inside the GLSL template literals.** A single one in a
  comment ended the shader source mid-string and took the whole module out
  with a `SyntaxError` a hundred lines from the cause.

The mesh is turned to face the camera even though it is a ball: a sphere looks
the same however you spin it, but its *seas* do not, and a moon is tidally
locked. And there is a `smoothstep` on the limb — at forty segments the
silhouette is still a visible polygon at a hundred pixels across, and a
polygonal moon reads as a rock.

**Cost: none that can be measured.** 2 000 triangles against the frame's
1.92 M, one draw call, one shader program. Timed interleaved with `gl.finish()`
it comes out at 0.03 ms against a 4.6 ms run-to-run spread — which is to say,
below the noise. Note the interleaving: a straight A-then-B run in a hidden tab
reported that *deleting* the moon cost 17 ms, which is §4's rule about
measurements all over again.

### The point of the game is to leave

Find the Starship in the mire, press `E`, and go to Mars. `game/mission.js`
owns the whole of it: countdown, ascent, hot-stage separation, coast, turn,
entry, the belly-flop flip, the landing burn, and the hedgehog getting out
onto another planet. Forty-two seconds, and the burrow loop still runs
underneath it — what changed is what the compass points at.

**Mars is this planet, re-dressed while you are not looking at it.** The
alternative was a second body with a second radius and a second `heightAt`,
and `planet.js` exports `R`, `CENTER` and `positionAt` as module constants
that the ground, the grass, every prop, his feet, the camera and the weather
all read directly — so making those switchable is a rewrite of everything, to
arrive at a Mars that behaves exactly like the sphere already here. Instead
the ship really does climb off the mount, the meadow really does shrink
underneath it, and at five kilometres with the planet thirty pixels wide and
the camera facing the other way, the palette ramps over two seconds and
everything that grows is switched off. Then it turns round and comes down on
a red world. Every frame is real geometry, nothing is a backdrop, and there is
no cut — and **walking on Mars is free**, because it is the same sphere, so
his feet, the horizon and the footprints all worked the day it arrived.

The one thing you must never see is the swap. `TURN` is what pays for it.

Things that bit, in the order they bit:

- **The cutscene is a function of time, not an integration.** `tick()` clamps
  `dt` to 0.05 and a phone genuinely sees that; a velocity integrated over
  forty seconds lands the rocket somewhere else. The harness runs the whole
  flight at 60 fps and at 20 and asserts it lands on the same rock.
- **The stack's origin is the mount deck, not the vehicle's feet.** Flying it
  from its own origin put the landed Starship 113 m above Mars on nothing.
  `begin()` shifts the children down by `DECK` so the origin becomes the
  bottom of what is flying, and staging sets `ship.position.y = 0` so the
  ship becomes that in its turn.
- **The plume fired out of the nose.** The cone's geometry occupies local
  `-y`, so mapping local `+y` onto `-nose` — which is what "the flame points
  backwards" sounds like — sends it forwards. It flew to Mars with a
  hundred-metre torch coming out of its own front.
- **The sky went Mars-coloured and the dome never saw it.** `sky.setColors`
  is called from the *middle* of `climate.update`, well before the ground
  palette is worked out, so a sky colour written with the rest of the Mars
  blend arrives a whole function too late. It landed on a world with orange
  fog under a blue sky.
- **The ground kept its place tint.** The per-vertex colour says how much
  greener than the meadow each place is, and it is still multiplied in — so
  Mars had the ten places of the old world faintly showing through it in
  green. Same fault as §4's snow, same one-line fix, same uniform.
- **Hiding a group is not enough for anything that ranges off him.** The
  critters, the residents and the hoglets all set their own `visible` from
  how far off him they are, so they switched themselves back on the next
  frame and followed him to Mars. They are not *run* there.
- **The launch site came too.** The landing site is 31 m from the pad, which
  is nothing on a planet 300 m round, so the tower and the tank farm were
  still in frame at touchdown. He took the rocket and left the ground works.
- **And everything the game had sown.** Seven separate `scene.add` calls in
  `game.js` are one group now, for exactly this.

**You cannot stand back far enough to watch a launch.** The horizon from a
metre up is 11 m, and to hold 123 m of rocket in a 34° frame you need to be
200 m out — at which point the pad is under the curve, because a viewpoint at
ground distance `d` must be `d²/2R` up to see the pad at all, and that is
400 m at 200. So the launch camera climbs with the rocket, from 12 m at the
fence to 300. It is not a cheat; it is what this planet costs.

### Rain was a colour grade, not weather

Standing out in the heaviest weather this world can make, **you could not see
a single drop** — and three things were stacked up to make that true.

- **The box is a cube and the camera is a cone.** Counted at the frame:
  eleven of a hundred and five active drops were inside the frustum. For snow
  that hardly matters — you read it from the few flakes near your face — but
  rain needs a *curtain*, and a curtain wants an order of magnitude more.
- **A drop is a streak and a point cannot be one.** At 9.5 m/s a drop covers
  16 cm in a frame and was drawn as a 5.5 cm dot, so even the eleven you
  could theoretically see were strobing between positions a stride apart.
- **Rain does not wobble.** The sine drift that is right for a petal made a
  field of independently wandering drops, which reads as midges. Real rain
  falls dead straight and the *wind* leans all of it at once.

It is `LineSegments` now — 2 600 streaks, one draw call, one vertex where the
drop is and one where it was a frame and a half ago, in a tighter box with a
lower ceiling. Lines are always one pixel wide in WebGL and that is exactly
right: a raindrop at four metres *is* about a pixel across.

### Messages had no queue, and that was the whole fault

`flash` wrote straight into the element and reset one timer, so two things
happening on the same frame meant you read the second and the first never
existed. With twenty-seven callers that is not a rare case — arriving at the
burrow alone can fire the leg message, a journal first, a hoglet catching up
and a resident's greeting within a few frames.

Three rules, each of them a thing that was wrong: every message gets its own
turn in the order it happened; nothing is on screen for less than can be read,
and a long line gets longer, because none of the twenty-seven callers passed a
duration; and there is a beat between them, spent faded out, because swapping
the text under a panel that is already up reads as a glitch rather than as a
second thing being said.

The queue is capped at four, and past the cap the **oldest** go — the newest
is the one you are still looking at the cause of. And it runs with no DOM at
all, like `dialogue.js`, so the ordering is asserted rather than eyeballed.

A standing instruction — "press E" — is deliberately **not** a flash. A toast
is a thing that happened; a prompt is a thing that is true while he stands
there, and putting it through the queue would either lose it while the offer
was open or block the queue for as long as he loitered. They are two kinds of
message and the fault the queue fixed was that they had been one.

### It was unplayable on a phone, and it looked finished

You could look around, pinch, and tap to sow. **You could not walk.** Every
input that moves him was on WASD, the hop was on space and the rocket was on
E, so on a touch screen the game was a thing to look at. None of that is
visible from a desktop, which is exactly why it lasted.

`core/touch.js` is the missing half. The screen splits down the middle:
**left is a floating stick**, right is look-and-sow as before.

- **The stick appears wherever the thumb lands.** A stick painted at a fixed
  place is one you have to look down to find; the point of a game about a
  hedgehog is not looking at your own thumb.
- **Double-tap-and-hold rolls him** — the same gesture as the keys, where two
  taps of a direction tuck him. The first tap has already set him walking, so
  the second is an *upgrade* rather than a fresh start, which is why it feels
  immediate on both.
- **The zone is decided on touch-DOWN and never revisited.** Testing whether
  the *current* position is on the left hands your finger to the look camera
  halfway through a walk.
- **The ring follows the thumb past its own edge**, or your thumb wanders off
  it during any real walk and the throttle silently pins at full in a
  direction you can no longer steer.
- **A tap on the stick's side still sows.** The stick claimed the whole left
  half of the screen and took the sow tap with it, so half the world quietly
  became unplantable and nothing said why.
- **One owner per finger.** Both the stick and the chase camera want
  `pointerdown` on the same canvas, and two handlers deciding what a finger
  meant is a race settled by the order they were bound in.
  `chase.setPointerFilter` lets the stick claim its own outright.
- Buttons fire on `pointerdown`, not `click`: a click on a touch screen
  arrives up to 300 ms late, and a hop you asked for a third of a second ago
  has already been missed.

The controls are built on the **first real touch** rather than off a
user-agent string, so a laptop with a touchscreen gets both and gets the
thumb buttons only once somebody uses their hands.

**And the toast had been rendering as a vertical strip one word wide, all
along.** `.panel` sets `position: absolute` for the six readouts that are
placed by corner, and the span inside `#toast` was inheriting it — so it was
out of flow, its container collapsed to no width, and every message in the
game wrapped to one word per line. It is only obvious on a narrow screen,
which is why finding it took putting the thing on a phone.

The small-screen layout lives in `index.html` and not with the touch
controls, because it is a consequence of how wide the **screen** is rather
than of what is pointing at it — a narrow desktop window has the same problem
and no thumbs. `touch.js` only injects its stylesheet on the first touch, so
anything in there would never reach that window.

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
