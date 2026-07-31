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

1. **The orbit far side is bare.** Press `P` and half the planet is a 4-band
   ramp with nothing on it. Real props at reduced density, not labels. Flagged
   by three consecutive sweeps and taken by none of them.
2. **The road is a featureless mass.** From the town it is the largest single
   thing in frame and it has no camber, no markings, no verge, no litter and
   no wear. `places/road.js`.
3. **Post-rain glints on the quills** — a wet hedgehog, for the thirty seconds
   after a front clears. `front` now falls to zero on its own, so there is an
   event to hang it on.
4. **Shadow-map texel budget.** ±17 m at 2048 is 8 mm/texel, which flatters him
   and coarsens a fence post. A tight cascade around him is the obvious fix and
   the shadow camera has bitten twice before — read HANDOVER §3 first.
5. **Cel banding on large smooth surfaces** — the lake sheet and the sky dome
   in orbit. The ramp was tuned on props at two metres, not on a 47 m sphere.
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
7. **The mire, the hen run and the farmyard read as one brown wash** at ground
   level — the moss/soil mottle helps in the meadow and does nothing here.

### The hedgepig

1. **He does not shelter.** `rainHurry` is half of it; the other half is going
   *somewhere* — under the barn eave, into the wood — and waiting it out.
2. **Uphill and downhill look identical.** Gait, body pitch and speed should
   all answer the slope he is on. `slopeAt` is right there.
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

- `sky.js` now has coverage; the **weather fields** in `weather.js` still have
  none, and neither does `puffs.js`.
- **Per-frame allocations** have never been profiled. `critters.js` (905
  lines) and `game.js` (830) are the likely sources.
- **`main.js` is 670 lines** and owns fireflies, the rainbow, photo mode,
  puddles, hoglet names and the frame loop. The exception guard in `frame()`
  is protecting a lot of unrelated code.
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
