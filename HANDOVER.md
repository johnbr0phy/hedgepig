# the hedgepig adventure — handover notes

A single self-contained HTML file. Canvas 2D, no libraries, no build step, no
assets. An endlessly scrolling meadow, touch-reactive, with weather, seasons, a
day cycle, and a dozen places to pass through — and a hedgehog walking through
it that you have to keep alive.

It began as `grass-d-gram`, an ambient toy with no goal. Section 10 covers the
game that was laid over it. Everything before that is still true and still
load-bearing.

**Files:** `index.html` (the whole thing, ~240KB, ~6,200 lines), `smoke.js` (test harness)

It is named `index.html` only because it is served from GitHub Pages. There is
no build step and no other source file.

Read this before changing anything. Most of it is mistakes I made and what they
cost, which is more useful than a feature list.

---

## 1. The single most important idea

**The camera looks across a flat field from within the grass.** Roughly 0.78m of
ground is visible across a phone screen. Everything else follows from that:

- **All grass is in one plane.** It cannot have parallax against itself. I built
  it with four different scroll rates and the user immediately spotted that it
  "ruins the illusion." Depth in the field comes from **size, colour and focus
  only**. Layers 1 to 3 are all `par: 1.00` and must stay that way.
- **Parallax is only for things between the lens and the field.** Foreground
  blades and undergrowth at 1.62, canopy branches at 2.55, lens bokeh 1.9 to 2.9.
- **There is no perspective falloff.** So a distant object must be drawn at its
  *apparent* size, not its true size. See §4.

---

## 2. Architecture

### Render pipeline (in `render()`)

Four canvases. Only `cv` is visible; the rest are composited in.

| canvas | scale | purpose |
|---|---|---|
| `cv` / `ctx` | DPR (max 2) | everything |
| `fgc` / `fgx` | 0.26 | foreground plate, upscaled for free depth of field |
| `canc` / `canx` | 0.20 | canopy branches, heavier blur |
| `bl1`, `bl2` | 0.26, 0.085 | optical diffusion |

Pass order, which is load-bearing:

```
sky gradient → sun → distant grass tile → zone grounds → puddles →
footprints → breadcrumb rings → ground foliage → bird shadows → haze → far motes →
GRASS L1 → GRASS L2 → [STANDING OBJECTS] → GRASS L3 →
cloud shadow → weather tints → foreground plate → rain/snow/leaves →
canopy → sharp foreground → birds → caterpillar → bokeh → near motes →
rings → touch bloom → DIFFUSION → split-tone → scrims → vignette → grain
```

**The `[STANDING OBJECTS]` slot is deliberate.** Anything that stands up out of
the ground (mushrooms, hay bales, fence, log, fairy house, frogs, hens, snowmen,
eggs, and now the burrow, thorn patches and culvert mouths) is drawn there via
`drawStanding()`. Short and medium grass goes behind it,
tall near grass passes in front. Get this wrong and grass grows through solid
objects — which it did, and the user reported it.

### Coordinate systems

- `scrollY` is the world axis, increasing as you travel. Everything world-anchored
  stores `wy` and computes `screenY = wy - scrollY * parallax`.
- `PX_PER_M = 220` for the distance meter. The *visual* scale implied by the grass
  is closer to 500px/m. These disagree and it doesn't matter, but don't use
  `PX_PER_M` to size objects.
- Screen-space entities (birds in flight, butterflies, motes) carry no scroll term
  at all. This is intentional — see §3.

### Determinism

Everything is generated from `hash2(cellIndex, salt)` seeding `rng()`. The world
is infinite and identical on every visit. Cells are cached in one `Map` keyed
`"prefix|index"` with a `seen` frame stamp, pruned after 130 frames.

Cell systems and their row heights:

| prefix | row | what |
|---|---|---|
| layer id | `L.RH` | grass blades |
| `so` | 620 | soil patches |
| `fo` | 380 | ground foliage clumps |
| `lf` | 190 | wood floor leaves + stones |
| `mu` | 300 | mushrooms |
| `pd` | 520 | puddles |
| `fp` | 1700 | foreground side plants |
| `bb` | 3000 | brambles |
| `br` | 3000 | canopy branches |
| `th` | 860 | thorn patches (the hazard) |
| per segment | 4400 | lake, farm, road, town, garden contents |

**Row height must be sized to the screen, not the zone.** I spread the wood's leaf
litter across the whole 4400px segment and only ~25 leaves ever landed on screen.
Rows of 190px fixed it.

---

## 3. The world model

Three cycles of different lengths, so nothing repeats:

- **Places:** 11 zones × `SEG = 4400` = 220m round
- **Year:** `YEAR = 62400` = 284m
- **Day:** `DAYLEN = 46000` = 209m

```
ORDER = [BGARD, WOOD, MGARD, LAKE, POOL, MUD, HENS, FARM, ROAD, TOWN, MEADOW]
```

Ordered so **neighbours share something**: meadow → flowery meadow → wood →
woodland floor → lake → shore → marsh → smallholding → farm → road → town. An
earlier build had beach next to snowfield and the user rejected it. Keep the walk
continuous.

**Snow and night are times, not places.** They were zones and it was jarring. Now:

- `seaW[0..3]` are spring/summer/autumn/winter weights, linearly blended
- `snowCover`, `leafFall`, `nightNow` derive from them
- Season drives grass length (0.58 winter to 1.10 summer), density, palette,
  what falls from the sky, hay bales (autumn only), lake ice (winter), and
  whether bees and butterflies fly at all

`XF = 1100` crossfades zone properties across segment boundaries. Use
`zoneAmtAt(wy, kind)` for anything spatial so edges fade rather than snap.

### Tap routing (`sow()`)

Reads **place first, then season, then hour**:

```
mushroom garden → mushrooms      wood → kick leaves
shore → bubbles                  hen run → egg hatches
deep winter (>0.52) → snowman    after dark (>0.50) → fireflies
road → dust    open water → lily pad    otherwise → flower
```

Every one of those **also drops a breadcrumb** — `dropCrumb()` is the first line
of `sow()`, before any of the early returns. Whatever you sow is the thing the
hedgepig walks to. Putting the call lower down means the mushroom garden, the
wood, the hen run and the rest silently stop steering him.

---

## 4. Bugs that cost real time

Each of these shipped and was caught by the user, not by me. Read them.

**Frog vanished mid-hop.** `breathe = jumping ? 0 : ...` then
`ctx.scale(x, breathe)` — scaled to zero height. *Never let an animation
parameter reach a scale factor unguarded.*

**Rain never fell, for several revisions.** `if (wet < .002) wet = 0` was meant to
snap dry, but the first ramp step is 0.00183, below the floor, so it reset every
frame and `wet` could never leave zero. *An asymmetric clamp on a value that ramps
both ways will trap it.* Now gated on `wetTarget < .01`.

**Every foreground plant drew off-screen.** `scale(side, 1)` then `rotate(+90°)`
sends **both** sides growing away from the frame. Composed transforms need
verifying against an actual point, on paper. Fixed with a signed quarter turn.

**Bird flap rate had a stray `* .17`** so a crow flapped at 0.46Hz. Also, a
wobbling outline doesn't read as flight — what reads is **foreshortening**:
apparent span is `span × cos(stroke angle)`, tips rake back, body rides the beat.

**Hay bales became giant tan blobs.** I sized them "realistically" at 1.4m, which
at this scale is 1.9 screen widths, drawn as one flat filled ellipse. Distant
objects need **apparent** size. Bales 250 to 330px, fence posts 220 to 270px,
cars 900 to 1150px.

**Kicked leaves were orange on a green floor.** `kickLeaves` baked a colour at
spawn from the autumn palette. Store an **index** and resolve against the live
palette at draw time. Same pattern already used by `fallLeaves`.

**He walked the entire first leg before the game had started.** `drawHog()`
returns early unless `GAME.started`, but `updateGame()` had no such guard, so
from page load he trotted off invisibly and the meter counted down with nothing
on screen. Caught only by opening it in a browser — the harness started every
scenario with a tap, so it never looked at the state before that. *A draw
function and its update must agree about when the thing exists.* `smoke.js` now
warms up 120 frames and asserts `hogWy` is still 0.

**Green showing through the wood floor** was my leaf-mould base fill, which I'd
coloured olive in spring. Ground under leaves is dark brown in every season.

**Falling blossom in a treeless meadow.** Anything that falls needs a source:
`leafFall = woodNow × season`.

**My own test harness was broken.** Mismatched pointer ids meant the "realistic
browsing" test only travelled 3m, and I reported a round of measurements from it.
Always sanity-check that a test does what it claims before trusting its numbers.

**And it broke again, the same way.** The rebuilt harness recorded its start
position *before* the scenario teleported the hedgehog into deep world, so the
`far` run cheerfully reported 1386m of travel in 40 seconds. The lesson did not
take the first time: a scenario that sets up state must re-read its baseline
after the setup, and any distance that looks impressive is probably a bug.

---

## 5. Rules learned from user feedback

- Foreground items must be **rare**. One thing crossing every 1.6m felt cluttered;
  4.4m is right. Current: branches every 10.7m, side plants 13.6m, brambles 16.8m.
- Foreground plants **enter from the side edges**, never from the bottom, so their
  base is always off-frame. No fade gates — a fade gate makes them dissolve
  mid-screen, which the user described as "come in and then disappear."
- **Birds only perch on foreground silhouettes** (canopy branches, foreground
  plants). Perched on a mid-field log they looked wrong. In flight they carry no
  scroll term, so scrolling back never runs them in reverse.
- **Blackberries only in long grass** (`terAt(wy,"dens") > .84`).
- **Nothing procedural should look tiled.** Vary count, scale, mirror, lean, hue
  and structure per instance from its own seed.
- Grass should move as **one field**. Neighbouring blade correlation was 0.667 and
  felt like independent twitching; narrowing the stiffness spread to 22–33 took it
  to 0.953.

---

## 6. Performance

Budget in fills per frame at 390×844: meadow ~1220, wandering ~700, worst case
(60 sown flowers on screen) ~1760. Desktop 1440×900 roughly doubles. An adaptive
scaler in `tick()` thins blade density if frames drop below 44fps.

Techniques that mattered, in order of payoff:

1. **`Path2D` cache** keyed on quantised (width, bend). A blade is a matrix set
   plus a cached fill instead of rebuilding two béziers. Path ops fell from ~4,000
   to ~1,050 per frame.
2. **No per-blade `save`/`restore`.** Direct `setTransform`, reset once per layer.
   Context saves fell from ~1,000 to 52 per frame.
3. **Integer-indexed gradient array**, not a `Map` with a built string key. Killed
   ~1,000 string allocations a frame.
4. **Pre-baked distant grass tile** (1024px tall, seamless, blurred by
   downsample/upsample) drawn in 34 wind-swayed strips.
5. **Diffusion pass is nearly free**: downsample, multiply by itself to square it
   so only highlights survive, downsample again, add back with `lighter`.

---

## 7. Test harness

**Now shipped, as `smoke.js` in this folder.** Run it with:

```
node smoke.js <scenario>
```

It mocks `document`, `window`, `Path2D` and a full Canvas2D context that counts
`fill`, `stroke`, `save` and path ops, and flags non-finite coordinates and
scale-to-zero. The engine is extracted from the HTML with a regex, has a small
hook block appended inside the IIFE (exposing `tick`, `sow`, and a `__peek()`),
and is `eval`'d. It drives `tick()` itself rather than using rAF.

Scenarios, with the assertion each one exists for:

| scenario | asserts |
|---|---|
| `walk` | called onward repeatedly, the realistic one |
| `idle` | **nobody calls him: he must move exactly 0px** |
| `back` | called behind him: he must walk backwards (negative travel) |
| `scout` | camera run ahead independently of him |
| `road` | aimed at the culvert: ~660 frames underground, no car hits |
| `roadmiss` | aimed wide: must take car hits, ~5 runs in 6 |
| `goal` | called onto the burrow: leg must advance |
| `far` | deep world, exercises every zone |
| `abandon` | camera parked, walked 90m+ away: hazards must still bite |

`idle` and `back` are the two that would have caught the old auto-runner. Traffic
uses unseeded `Math.random`, so `road`/`roadmiss` need a few runs to judge.

**The most useful trick** is forcing `scrollY` to a known value after a warm-up
and instrumenting a specific subsystem, e.g.:

```js
s = s.replace("  breeze = (.10", "  if (frameId > 470) scrollY = 11000;\n  breeze = (.10", 1);
```

Never trust a scenario without first checking it travelled the distance it claims.

---

## 8. Things not done

- **Nothing persists across reloads.** Sown flowers, snowmen, lily pads and
  mushrooms are in memory only. The world itself is deterministic so the terrain
  is identical, but anything the user made is lost.
- **No audio.** Deliberate — autoplay restrictions, and it works as a quiet thing.
- **The road's cars are the one honest scale compromise**, at 2 to 2.7m rather
  than 4.5m, because a real car is five screen widths and unreadable.
- Zone name announcements are suppressed if one is already showing, so fast
  scrolling skips some. Intentional anti-spam.
- `DRY`, `SNOW` and `NIGHT` remain as biome constants but are no longer in
  `ORDER`. `WOOD` is an alias for `AUTUMN`. Harmless, but confusing if you're
  grepping.

---

## 9. If you change one thing, check these

- Did you break the standing-objects draw slot? Grass will grow through things.
- Did you add parallax between grass layers? The field will delaminate.
- Does anything new fall from the sky without a source above it?
- Is a new procedural element sized by *apparent* size or true size?
- Does a new foreground item enter from a side edge?
- Run `smoke.js` and confirm it still travels ~33m in the `walk` scenario before
  believing its numbers.
- Can he still get past a road? `node smoke.js road` must show
  ~1300 frames underground and zero hits.
- Is a new hazard *avoidable*? Anything spanning the full width of the field is a
  guaranteed death, because he cannot be stopped. See §10.

---

## 10. The game

The ambient toy is still underneath all of this. What was added on top:

### The loop

Tap and he walks to that spot, in any direction, and **stops there**. Tap again
and he sets off again. He is never on rails: with nobody calling him he stands
still and snuffles about in the grass indefinitely. Reach the burrow at the end
of the leg and the next leg starts, slightly faster and thornier. Three hearts,
and a hit costs one.

- **There is only ever one live target.** `dropCrumb()` clears `crumbs` before
  pushing, so a new tap replaces the old destination outright rather than
  queueing. On arrival the crumb is marked eaten and he stops.
- `hog.hd` is a full-circle heading — **no forward clamp**, he can turn round
  and walk back up the field. Turning uses `wrapAng()` for the shortest way
  round; without it he takes the long way when the target is behind him.
- `hog.gait` eases 0→1 on setting off and back down on arrival, so he leans into
  a start and settles out of a stop. The step is also clamped to the remaining
  distance, or the easing overshoots the target and he jitters on the spot.
- `HOG_SPD0` is 300 px/s, about 1.36 m/s on the meter.
- **The camera is entirely yours and never follows him.** There was an
  `updateCamera()` that held him at 38% of screen height; it is gone. If you do
  not scroll, he walks off the bottom in about three seconds. `drawHogMark()`
  puts a pulsing chevron on whichever edge he left by, so he can be found again.

### Two traps in a free camera

Both of these were live bugs, and both come from the same root: **code that
ranges off `scrollY` is asking "what can be seen", not "what is near him".**

- `collectHazards()` originally gathered thorn rows and cars from
  `scrollY .. scrollY + H`. With a camera that follows, those are the same
  thing. With a free one, scrolling away from the hedgepig made him
  **invincible**. It now ranges off `hog.wy`.
- Cars only move and spawn inside `drawRoad()`'s segment loop, which is a draw
  function and so is camera-ranged. Scrolling away from a road emptied it of
  traffic, which made the culvert pointless. That loop now spans the union of
  the camera range and `hog.wy ± 600`.

Anything else that gates on visibility and also affects him will have the same
bug. The `abandon` scenario in `smoke.js` exists to catch it: it parks the camera,
walks him 148m away from it, and asserts he still takes a thorn hit.

### Why water is not a hazard

Lake bands run the **full width** of the field. So does the road. Anything
full-width is an unavoidable wall for something that cannot stop, so:

- **Water** he crosses in his boat. That art already existed for the old
  wandering hedgehog; `afloat` still drives it.
- **The road** gets a culvert. `crossX(seg)` puts a hedgehog tunnel at a
  deterministic x in every road band, drawn as a mouth on each verge. He can
  only enter at the near verge (`hog.wy` within 80px of `bandEdges()[0]`) and
  within 46·k of the mouth — you cannot wander into it from the middle of the
  tarmac. While `hog.under` he is immune, invisible, leaves no prints and parts
  no grass.

This matters: a road band is 2288px of tarmac, eighteen seconds at his pace, and
a car is 900–1150px long on a 430px screen. Before the culvert, `roadmiss` in the
harness was a guaranteed three-car death every time. **Any new hazard must be
dodgeable in x, or it is just a wall.**

### Hazards

Only two, deliberately. `collectHazards()` gathers ellipses into `hazBuf`:

| kind | source | notes |
|---|---|---|
| `thorn` | `th` cells, `thornTake()` | density is `.18 + leg*.11`, capped .88 |
| `car` | `roadCell().cars` | only reachable if he missed the culvert |

Car hitboxes are `len*.46 × wid*.54`, matching the car you can see, and traffic
spawns every 0.7–2.3s. That is tuned so that walking over the tarmac costs a car
hit in about five runs in six, while the culvert is safe in six out of six —
check both with `road` and `roadmiss` if you touch either number. A road you can
stroll across makes the tunnel pointless.

Thorns skip any cell where `hardAt(wy) > .5`, so they never grow on tarmac or
water. A hit curls him up for ~1.2s, knocks him back, and sets `hog.repel` so he
veers off for 1.3s instead of walking straight back into the same bush.

### Deformation, prints and shivering

- **Grass** — he pushes two entries into the existing `fields` array every frame,
  one for his bulk and one for his nose. That is the same mechanism the old
  hedgehog's snuffling used and that `simulate()` already reads; nothing new was
  needed in the blade solver.
- **Footprints** — `tracks[]`, one every 15px of travel, alternating left and
  right off the perpendicular of his heading. Drawn in the **ground** pass, before
  the grass, so blades still pass over them. On snow they invert: a cool dent with
  a bright lip instead of a dark pad, and they last ~9s longer.
- **Shivering** — `hog.shiver` follows `snowCover`. It adds a high-frequency x
  jitter, slows his turn rate, puts two little arcs off his back, and makes his
  breath show as pale motes.

### Drawing and animating him

`drawHog()` builds him in layers, and the order is the whole reason he reads as
a hedgehog rather than a porcupine:

```
far legs → body → long dark spikes → spine dome over their roots →
short pale spikes → face lobe → snout, nose, whiskers, eye, ear → near legs
```

Two things here were got wrong and are easy to get wrong again:

1. **The quills were once drawn last, over everything**, which buried his ear and
   eye and made him a fan of sticks. Keep the dome between the spike roots and
   the face.
2. **All four legs are drawn before the body.** Drawing the near pair over it
   painted them across his belly — "legs through his body". Only the part below
   the belly should ever show; depth between the pairs comes from colour and a
   2px difference in foot height, not from draw order.
3. **Spikes must clear the dome by a good margin.** The pale layer originally ran
   from `drx*.52` out to `+9.5`, which lands *inside* the dome radius — so it
   read as texture on a smooth loaf, not as spines. Base radius plus length has
   to exceed `drx` by roughly a third of `drx` before the silhouette looks spiky
   at all. Both layers now do.

**The gait.** Everything hangs off `hog.walk`, advanced by distance travelled
rather than by time, so it never moonwalks. The body bobs and squashes at
*twice* the leg rate — two footfalls a stride — and the four legs run as a
diagonal trot, the far pair half a stride ahead of the near pair. The whole
spine mass jiggles a little against the beat. All of it is scaled by `hog.gait`,
so it fades out to breathing when he stops.

**The snuffle.** `hog.dip` rises when he is standing still: nose to the ground,
head swaying, and the nose itself twitching on a three-sine wobble with a small
swell on each sniff. Whiskers trail off it. He also emits `snuffle()` motes and
pushes a wider grass field with his nose, so you can see him rummaging.

Curling is one parameter, `hog.curl`: it closes the spike arc from a back-only
sweep to a full ring, rounds the dome, retracts the legs and fades the face out.

### Leaves, and the one place depth is faked

§1 says there is no perspective falloff, and that still holds **for the field**.
Falling leaves are not in the field — they are between the lens and it, like the
bokeh and the canopy, and they are the one thing that scales with distance.

- **`fallLeaves` recede, they do not descend.** Each carries a `z` from 0 at the
  lens to 1 in the far field; `flScale(z)` runs 1.7 down to 0.14. The shrinking
  is what reads as falling — the camera is at grass level, so a leaf on its way
  down is mostly going *away*. Screen-y travel is deliberately small: about 330px
  of a 900px frame over ten seconds. They used to run top-to-bottom like rain,
  which is wrong for this camera.
- They are drawn **twice**, crossfading on `z` around 0.44: the near end on the
  blurred foreground plate (`drawFallLeaves(fgx, 1)`) so it is genuinely out of
  focus, the far end sharp in the main pass. That, not the size alone, is where
  the sense of distance comes from.
- **`kicked` leaves track height separately from world position.** `h` lifts them
  up the frame *and* scales them up slightly (up is nearer the lens); gravity
  returns them to the exact `wy` they came from, with one small bounce. Their
  shadow stays on the litter. Before this they inherited a screen-space `vy` and
  sailed off down the frame, which looked like they were falling out of the sky
  rather than being kicked off the floor.

Check both with `scratchpad/leaves.js`-style probes if you touch them: the scale
range should span at least 4x, y travel should stay under about half the frame,
and a kicked leaf should return to `h == 0` within two seconds.

### Things the game does not do

- **Nothing persists.** Leg number, hearts and score are gone on reload.
- **No win.** Legs go on forever, getting faster and thornier.
- The burrow is placed by `newLeg()` and nudged forward 400px at a time until it
  is off hard ground. If he walks past it, another appears 3400px ahead rather
  than dead-ending the run.
