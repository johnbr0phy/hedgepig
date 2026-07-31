# NEXT — the backlog, and the run log

This file is the memory between unattended runs. Each run reads the top of the
backlog, builds **one** item, sweeps for new ones, re-ranks, and appends a line
to the run log. See `AGENT.md`.

**Strike what you land.** The backlog went a whole session stale once — the
frame measurement, the flat-wash ground, the orange stems, the butterflies and
the entire sound list were all done and still sitting at the top of their
workstreams, so the next run would have rebuilt something that already existed.

---

## Backlog

Ranked within each workstream. Take the top item of whichever workstream the
last run did *not* touch.

### Graphics

0. **The road runs through the middle of the lake, and the mushroom garden.**
   `roadOffset` is 0.00 at the centres of LAKE, MGARD, ROAD and TOWN — the road
   is a great circle and four of the ten antiprism vertices lie on it. Stand at
   the lake's centre and you are on tarmac. Structural, pre-existing since the
   layout was written, and now very visible because the road has markings. It
   wants either the road's path bent off those centres or those places moved.

1. **The orbit far side is bare.** Press `P` and half the planet is a 4-band
   ramp with nothing on it. Real props at reduced density, not labels. Flagged
   by three consecutive sweeps and taken by none of them.
2. **The road is a featureless mass.** From the town it is the largest single
   thing in frame and it has no camber, no markings, no verge, no litter and
   no wear. `places/road.js`.
2b. **Nothing in the sky glows.** There is no bloom pass — the pipeline is
   ink, grade, fxaa. The sun is a pale disc with a painted halo quad rather
   than a source: it does not bleed over the horizon, or over anything
   standing in front of it, and neither does the moon or a lit window. One
   half-res threshold-blur-add would do all of them at once, and it is the
   only thing on this list with real per-frame cost — measure it focused,
   not from a hidden tab, and put it behind a toggle like `O` and `G`.
3. **Post-rain glints on the quills** — a wet hedgehog, for the thirty seconds
   after a front clears. `front` now falls to zero on its own, so there is an
   event to hang it on.
4. **Shadow-map texel budget.** ±17 m at 2048 is 8 mm/texel, which flatters him
   and coarsens a fence post. A tight cascade around him is the obvious fix and
   the shadow camera has bitten twice before — read HANDOVER §3 first.
5. **Cel banding on large smooth surfaces** — the lake sheet and the sky dome
   in orbit. The ramp was tuned on props at two metres, not on a 47 m sphere.
5b. **Neither the rocket nor the clouds cast anything on the ground**, and it
   is one fix for both. The shadow camera is ±17 m around him, so a 123 m
   Starship in it is a black wall rather than a long shadow and it is
   switched off above the mount — the largest object in the world sits on the
   bog casting nothing. A projected mask would serve the rocket and the
   clouds at once.
6. **The clouds do not cast anything on the ground.** They dim the key light
   when one crosses the sun, which is the feel of it; an actual moving pool of
   shade on the meadow is the sight of it, and the shadow camera at ±17 m
   cannot reach 200 m clouds — it wants a projected mask, not a shadow map.
6. **The far field has no aerial perspective.** Fog is one colour at one
   density; distant hills should also desaturate and lift, not just tint.
7. **Inverted-hull outlines after the static merge** — check that `noOutline`
   and hull assignment survived being folded into 78 meshes.
8. **Windows and lamps are painted pools that do not reach the ground.** `lit`
   starts at dusk now (it is driven off `dark`), but nothing under a lamp is
   any brighter for it.

### World

1. **Instanced brambles.** 260 thorn meshes are the remaining draw-call bulk;
   they are excluded from the static merge because they toggle visibility, and
   instancing solves both at once.
2. **Grass chunk LOD.** 250 chunks culled by hand off him; a coarser ring
   beyond ~8 m would halve what is left after the brambles.
3. **Place boundaries are invisible.** Ten 30 m places blend by weight and you
   cannot tell you have left the mire. A signal at the seam — reeds thinning,
   soil changing — at a scale smaller than a place.
4. **No place owns its own relief.** The terrain rolls identically everywhere;
   the mire should be flat and low and the hillside actually steep.
5. **Worn paths.** Molehills and thistle rings are the world's only memory.
   Ground that darkens where he repeatedly walks would be the third, and the
   grass shader already carries 16 trail markers to build it on.
6. **The wood is one tree at one density.** A clearing, a deadfall, a stand of
   one species.
6b. **The wood is the only place anybody lives.** Four residents, one place in
   ten — deliberate, because a resident is a destination, but it does mean
   nine places have nobody in them. The farm and the town are the obvious
   next addresses.
7. **The mire, the hen run and the farmyard read as one brown wash** at ground
   level — the moss/soil mottle helps in the meadow and does nothing here.

### The hedgepig

0. **He is the only one who talks.** Four residents in the wood have forty
   lines each and he answers none of them — the panel is one-sided. Either he
   gets a voice in it or the lines should stop being addressed to him.
1. **He does not shelter.** `rainHurry` is half of it; the other half is going
   *somewhere* — under the barn eave, into the wood — and waiting it out.
2. **Uphill and downhill look identical** *— part done: the ball now gathers
   pace downhill and spends it climbing (`hog.momentum`). On his legs nothing
   answers the slope at all: gait and body pitch are still flat-ground.*
3. **No fatigue.** Speed is constant within a leg. A late-leg tiredness that
   shows in the gait and nowhere else.
4. **He never looks at anything.** The glance tracks the pointer and nothing
   else — not the cat, not a bird flyover, not the hoglet behind him.
5. **Turning is feet, not spine.** Check whether anything bends into a pivot.
6. **Curl has one shape.** The defensive curl (a thorn) and the sleep curl
   (home after dark) are the same pose and should not be.
7. **He never grooms.** A quill shake exists; a slow preen at rest is exactly
   the kind of detail the taste section asks for.

### Gameplay

1. **Legs escalate only in speed and thorn density.** Leg 12 is leg 3 with
   more brambles in it.
2. **The burrow is always found, never missed.** A leg you fail to finish
   before dawn is the obvious tension and it does not exist.
3. **Nothing is ever lost.** Hearts are the only stake; the thistle, the
   carried leaf and both hoglets are pure gain. The hoglets in particular
   follow forever and cannot be left behind, so following costs nothing.
4. **Seasons change what things look like and almost nothing else.** Winter
   should close something and open something else. Now that a season lasts
   longer than a day there is room for it to matter.
5. **Night is only a palette** beyond the owl and the fireflies. Nothing is
   nocturnal-only.
6. **Sowing has no consequence past the 26-item pool.** What you sowed in
   place 3 could still be there next lap, and the golden thistle proves the
   idea works.
6b. **The pad is scenery.** The biggest thing in the world and there is
   nothing to do at it: no climbing the tower, no ride, no launch, no reason
   to walk over there twice. Five lines on the apron is all it has.
7. **Photo mode goes nowhere.** `S` keeps a shot and nothing ever shows it
   again; a contact sheet in the journal closes the loop.
8. **The journal has no second page.** Nothing gets harder or stranger to earn
   a new first.

### Sound

1. **No reverb anywhere.** The wood, the culvert and the open hillside are all
   equally dry. One feedback-delay bus switched by place.
2. **Footfalls have one timbre.** Grass, road, mud, snow and boat deck want
   their own noise-burst envelopes — the surface is already known.
3. **Weather has no voice beyond rain.** Now that fronts arrive and clear
   there is wind to hear coming, which is the whole point of it leading.
4. **No audio LOD** — check what stays running while muted or off screen.
5. **His voice has five sounds and no context.** He snuffles the same way in
   the wood as on the road; place, weather and how tired he is could all
   colour it, and `VOICE` is one table to do it from.

### Debt and harness

- `sky.js` and the critters now have coverage; the **weather fields** in
  `weather.js` still have none, and neither does `puffs.js`.
- **`weather.js` still calls its motes butterflies and bees** in the comment
  at the top of the file, and now that there are real ones the motes are a
  second, worse version of the same idea.
- **Per-frame allocations** have never been profiled. `critters.js` (905
  lines) and `game.js` (830) are the likely sources.
- **`main.js` is 670 lines** and owns fireflies, the rainbow, photo mode,
  puddles, hoglet names and the frame loop. The exception guard in `frame()`
  is protecting a lot of unrelated code.
- **The scene got much heavier with the zone pass.** 472 calls, **1.92 M
  triangles** and **101 shader programs** at 1260x693, 27.7 ms hidden-tab. The
  triangle count roughly tripled and the program count nearly doubled — every
  `cache: false` material is its own program, and the new props make a lot of
  them. Worth a pass to share materials before adding more.
- **The frame is measured but from a hidden tab.** 503 calls, 201 k triangles,
  45 programs at 1260×693, 22.1 ms with a real `gl.finish()`. A focused
  measurement would settle it.

---

## Run log

Newest last. One line each: date, workstream, what landed, what the sweep found.

- **2026-07-30 — setup.** Backlog seeded by hand from the build session that
  produced the open world, the streaming meadow, the rebuilt gait and the
  sown-flower growth. 65/65 in the harness at `3a2f12e`. No unattended run had
  happened yet.
- **2026-07-30 — the big pass (interactive session).** 83/83. Animation
  rebuild (one trunk for body/mantle/coats/ears; a reserve coat that grows
  through the skin as he curls; spin settling to the nearest whole turn;
  pivots that step the feet; eyes in against the nose; sniffing, dozing,
  yawning, scratching, shaking, the arrival wiggle). All of `core/audio.js`,
  synthesised, gait-driven. A phased moon, shooting stars, per-cloud drift, a
  rainbow after rain. Butterflies, bees, birds, frogs, fish, an owl, hens that
  scatter. World-anchored dust, tap ripple, camera out while rolling. Place
  contrast and moss/soil mottle; stems got their own colour role. localStorage
  persistence, the golden thistle, `rainHurry`, the hoglet from leg 3. Frame
  measured at 1 104 calls / 1.33 M tris.
- **2026-07-31 — the second fifty (interactive session).** 92/92, deployed to
  johnbr0phy.github.io/hedgepig/v2 by a Pages workflow that runs the harness
  as a deploy gate. Footprints in snow and mud, the grass remembering his
  path, balking at the water's edge, lapping, nibbling, carrying leaves,
  sneezing, darkening in rain, sleeping home-after-dark to a wound-forward
  dawn. A second hoglet, named. Squirrel, mice, dragonflies, snails, moths,
  the cat's ear and tail, ducks with wake rings, a spiderweb, barn swallows,
  molehills. Dawn fog, puddles, cicadas, distant lightning, leaf-bursts,
  snow-dusted canopies, an aurora, constellations. Car doppler, grass swish,
  panned hoots, a dawn phrase, boat creaks, culvert drips. Three lines per
  interactable, thistle rings that knit, autumn berries, photo mode, a
  journal, fireflies, and the world blooming when you have stood everywhere.
  The static merge folded 1 205 prop meshes into 78.
- **2026-07-31 — the third pass (interactive session, four reported faults
  plus a backlog sweep).** 126/126. **Reported and fixed:** he sat inside
  snowmen (sown solids were never blockers — they are now, placed clear of
  him, he walks to their edge, and a blocker may never hold what is already
  inside it); the weather churned (the year was 1.36 days long, so a season
  lasted 51 s — the day is 240 s and the year 1 080 s now); the sun and moon
  moved wrongly (the clock is phase-warped so the sun crawls through the
  horizon and hurries over the top, doubling twilight to 30 % of the day);
  and the colour was flat (a seven-stop glow ramp keyed to sun altitude, a
  warm horizon on the sun's bearing with a cool counter-glow behind, and a
  golden-hour split that warms the light while cooling the shade).
  **Found while doing it, all four invisible in the console:** the sun never
  set at all — its elevation was clamped at 0.22, so shadows never lengthened
  and the moon was the sun in a colder colour in the sun's own place; the sky
  dome took the *world* `.y` as elevation, so the entire gradient was tilted
  against the skyline everywhere but one point on the planet, and both discs
  were being placed with tangent-frame vectors read as world ones; the ink
  pass had never once been below a blade of grass, and no threshold could put
  it there because size is the discriminator and a depth filter cannot see
  size; and snow could not cover the ground's *hue*, because the place tint
  lives in the vertex colours — a white field with a bright green
  hedgehog-shaped hole in it. Also: weather became fronts that arrive and
  clear, lying snow accumulates and melts, the lake got a shore, footprints
  got toes and the ground's slope, clouds got small enough that several fit
  in the sky, and the second hoglet got its own name.
  **Sweep found / still open:** the orbit far side (three sweeps running now);
  the road as a featureless mass, which is the largest single thing in frame
  from the town; no aerial perspective in the far field; and the mire, hen run
  and farmyard reading as one brown wash at ground level.
- **2026-07-31 — his voice (interactive session).** 136/136. Five utterances,
  all synthesised: a snuffle, a chunter for nose-down foraging, a peep when
  pleased, a soft burr of a purr for standing about half asleep, and a huff
  when he is put out. Each is breath plus a little voicing. The work was in
  how seldom he uses them: the nose twitches 62 times a minute and used to
  fire a sound every time, so `createVoiceGate` now holds one shared clock
  across every kind of utterance and each asks with its own odds — 5.5
  audible noises a minute, nine twitches in ten silent. The gate is exported
  and the harness asserts the rate off the `VOICE` table rather than a copy
  of it.
- **2026-07-31 — the keys (interactive session).** 151/151. WASD drives him,
  camera-relative, off the camera's real forward rather than `chase.yaw`;
  double-tapping a direction rolls him, which is where the double-*click*
  used to be; and the tap is now only for sowing, which finally separates
  putting things in the world from deciding where he goes. Two faults fell
  out of it, both of which a called walk had been hiding: `tryStep`'s slide
  freed up whichever flat axis still worked, and walking due east makes the
  z retry `canStand(x, z)` — where he already is — so it succeeded, reset
  the blocked timer and moved him nowhere; he pressed against a fence in
  silence for as long as you held the key. And `rolling` is set by whichever
  branch of `update` is moving him, so a roll begun by the keys survived the
  release and he stood about tucked into a ball for ever. Sliding is a step
  deflection now, and the drive un-tucks what it tucked.
- **2026-07-31 — the insects nobody had ever seen (interactive session).**
  157/157. Butterflies, bees and birds had been in the run log twice and were
  all genuinely built; four things stacked up to make them invisible. Seven
  butterflies and five bees for a whole planet, pinned within a few metres of
  one place out of ten. Streaming that could never fire, because the re-home
  test wanted them faded and they only fade when the weather grounds them —
  the missing half was culling by distance off him, as the grass does. Half
  life size. And the ones you *could* see were mapped with `petalTex`, which
  is a five-petal flower, so a butterfly read as a small flower hovering over
  the grass. Now: 22 and 16, re-homed near him on ground that suits, at 46 mm
  with a proper wing texture and a flap about the body axis, each with its own
  tolerance for a wet day so a shower thins them instead of deleting the
  species. Birds every 7–20 s rather than 16–42.
  **Sweep found / still open:** they are honest-sized, which means subtle — if
  they still read as too quiet, the size is one number. And `weather.js` still
  spawns motes named for butterflies and bees, which now duplicates real
  animals.
- **2026-07-31 — clouds in three dimensions (interactive session).** 157/157.
  Researched volumetric raymarching and deliberately did not build it: a
  nested loop per pixel on a frame already at 500 calls, and photoreal next to
  four-band toon ramps. Took the *shading model* instead and put it on
  low-poly geometry — real Henyey–Greenstein forward scatter at g≈0.72 for the
  silver lining, Beer by silhouette proxy, the powder effect for the
  cauliflower, sky above and land below. 26 draw calls, ~14k triangles. A
  cloud crossing the sun now dims the meadow. Two things needed measuring: a
  *ring* of clouds has nothing overhead, so the crossing happened zero per
  cent of the time until they went on a dome; and the occlusion cone has to be
  wider than the cloud, because at the true radius it is a one-per-cent event
  you never see.
- **2026-07-31 — the four who live in the wood (interactive session).**
  203/203. A badger at his sett, a robin that comes to you, a toad under the
  deadfall and a wood mouse under the birches, forty lines each, said through
  the typing panel in `core/dialogue.js`. Space is the hop and the advance
  both, and the advance swallows the key or one press finishes the line and
  hops him away from whoever is saying it. Three things needed working out
  rather than writing: they are **pinned**, unlike every critter, because a
  resident is a destination and not a butterfly; **reach is per animal**,
  because the robin keeps 1.15 m off you by design and would have been
  unreachable on the 0.8 m every interactable uses; and the resident is
  **held out to `talk + 0.45`**, or a hedgehog snuffling on the spot walks
  out of the conversation mid-sentence. Also landed: brambles rebuilt as
  arching canes with backward-hooked thorns, leaves in fives and fruit on the
  cane (a dome with spines in it was a spiky turtle, not a thorn bush); and
  the ball gathers pace downhill and spends it climbing, which is the first
  thing in the game that answers the relief the world grew two commits ago.
  **Sweep found / still open:** he is the only one who talks — forty lines
  each, addressed to a hedgehog who cannot answer; and the wood is the only
  place anybody lives.
- **2026-07-31 — a Starship in the bog, and the residents on the ring
  (interactive session, two reported asks).** 217/217. A full stack at
  **actual size** in the mire — 71 m booster, 1.8 m hot-stage ring, 52 m
  ship, 123 m of it, beside a 146 m catch tower with its chopsticks out, on
  a planet whose radius is 47.75 m. It comes up over the horizon from the far
  side of the world. The mire because Starbase is on a coastal wetland and
  the mire is this world's. Four things had to be worked out and all four are
  in HANDOVER §4: nothing vertical may be bent onto the planet; each standing
  thing needs its own rigid group *and* legs that reach below their own datum
  by `d²/2R`, or the outer ones stand on tiptoe; the apron is a skin that
  follows `heightAt` rather than a plinth that clears it, because the plinth
  version stood a metre proud and he could not hop onto his own launch site;
  and concrete is hard ground, which is decided in `plan.js` — without
  `padAt` the meadow grew straight up through the pad. The residents are red
  dots on the compass now, hollow with a tick once met, and their scale is
  20 m rather than the burrow's half-lap because on the burrow's scale four
  animals in one wood collapsed into one smudge in the middle of the ring.
  **Sweep found / still open:** the rocket casts no shadow at all, because a
  123 m object does not fit in a ±17 m shadow frustum and what it produces
  there is a black wall rather than a long shadow — a projected mask, like
  the one the clouds want, is the honest fix for both. And there is nothing
  to *do* at the pad: it is the largest object in the world and it is
  scenery.
- **2026-07-31 — the moon stopped being a drawing (interactive session).**
  224/224, deployed. Asked whether the sun and moon were real light-emitting
  3D objects. Half the answer was already yes and better than expected: there
  is one directional light and `keyDir` follows the sun by day and the **moon**
  by night, so the moon has always cast the night shadows, and both discs read
  the same `sunDir`/`moonDir`. Directional is also the right physics for a
  body that far off — a point light would be worse geometry and six shadow
  renders. So the sun stays a flat disc, because an unlit sphere four degrees
  across is pixel-for-pixel the disc it replaces. The **moon** became a real
  lit ball, and with it its phase stopped being drawn: `moonDirAt` already put
  it `phase` of a turn along the sun's arc, so elongation *is* phase and
  lighting the ball reproduces `moonPhase` for free — the old bite-a-circle
  hack and the real thing were one fact written twice. Gibbous phases were
  wrong before and could not have been right: a subtracted circle gives a
  lens, and a real terminator is a half-ellipse. Earthshine on the dark side,
  a soft limb, alpha that follows the light. 2 000 triangles and 0.03 ms
  against a 4.6 ms spread — unmeasurable.
  **Two faults made and caught while doing it:** the lighting was first done
  in view space, which needs `camera.matrixWorldInverse` — written by the
  renderer at draw time, so the sun was a frame stale and the moon was full
  every night; and a back-quote in a comment *inside* a GLSL template literal
  ended the shader source and took the module down. The harness now asserts
  the lit fraction `(1 + uSun.z)/2` against `fullness` over seven phases,
  which is exactly the number the view-space bug pinned at 1.0.
  **Sweep found / still open:** there is no bloom, so nothing in the sky
  actually *glows* — the sun is a pale disc with a painted halo rather than a
  source, and that is the one remaining thing that would make either body read
  as emitting. It is also the only option here with real frame cost.
