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

**Every mushroom grew on the left edge.** `mushCell` stored `x: r()*1.2 - .1`,
which is a *fraction* of the width, and `drawMushroom` used it as a pixel
coordinate — so the whole crop sat within about one pixel of x=0 and had done
since the mushroom garden was written. Cell systems in here are split on this:
some store pixels, some store fractions. If a cell stores a fraction, name the
field `fx` and resolve it against `W` at draw time, which also survives a resize.
`thornCell` and `mushCell` now both do.

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
hook block appended inside the IIFE (exposing `__tick`, `__peek`, `__tap`,
`__call`, `__force`, `__follow`, `__scroll`, `__hits` and a handful of road
probes — read the block, it moves), and is `eval`'d. It drives `tick()` itself rather than using rAF.

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
| `lab` | runs `hog-lab.html` under the same mocks: it must not throw, every stall must draw its share, and his face must actually appear |
| `sync` | the shared hedgehog is identical in both files |

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
- `DRY`, `SNOW`, `NIGHT` and now `POOL` remain as biome constants but are no
  longer in `ORDER`. `WOOD` is an alias for `AUTUMN`. Harmless, but confusing if
  you're grepping. The rock pool went because a tidal pool full of bubbles in the
  middle of a meadow did not make sense; its code is intact if you want it back,
  just put `POOL` back in `ORDER`. The round is now 10 zones, 200m.
- **Birds only ever fly in order to land.** `spawnBird()` returns early when
  there is no perch available. A bird with no perch used to cross the entire
  frame in level flight and read as an aircraft rather than a bird. State 2 is
  now only ever reached on departure.

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

### The animation lab

`hog-lab.html` is a bench rig for the hedgepig, away from the grass. Eleven stalls,
each running an independent copy in one fixed state — amble, scurry, snuffling,
start/stop, turning, curled, shivering, looking about, face-on, **walking away**,
yaw sweep — plus speed and size sliders, a frame stepper and a `3d` toggle that
switches to the retired 2D renderer for comparison.

**The stalls are mostly PROFILE views and the game is mostly not.** Progress
means increasing `wy`, which means walking down the screen, which means `hd` near
0 — nose-on. Nose-on is his normal travelling attitude, and it is the view that
has hidden the most faults: no ears, two grey eyes, a mouth drawn along the wrong
axis, and a cream horseshoe under his face that read as an enormous grin. Judge
him nose-on before you believe anything.

**Use the size slider.** It is there because at default scale his faults are
invisible. Two separate rounds of "that looks fine" shipped a muzzle that read
as a giant grey eyeball and a set of ears that were not being drawn at all. Turn
him up before judging anything.

It holds a WORKING COPY of `drawHog()`. Iterate there, then port the finished
function into `index.html`. Nothing in the game reads this file.

**Run `node smoke.js sync` after any port.** Do not trust your own belief that
they match. They silently diverged on the head rig — the lab had a body-relative
gaze and a trailing head lag, the game still had the camera-relative gaze the
lab's own comment calls a bug, an inverted lag, and its ears 0.37 rad out of
place — because I hand-ported with string replaces, and **a replace whose
pattern has already drifted does nothing and says nothing about it**. The lab is
what gets looked at, so the divergence made the *shipped* hedgehog the worse of
the two. The check compares the shared functions character by character, the
shared constants line by line, and the drawing body after normalising only the
differences that are declared in the check itself.

The **3d** button toggles between the current 3D renderer (`drawHog3`) and the
last 2D one (`drawHog`), which is kept only for comparison. Delete `drawHog`
once you are sure.

The **heading sweep** button swaps the eleven stalls for the same hedgehog at
two dozen headings and states. **Use it.** The stalls are nearly all profile
views and the game is nearly all nose-on, and almost every fault this hedgehog
has had lived off-axis where the bench rig could not show it: a coat that sat on
top of him rather than wrapping round, a mouth drawn along the wrong axis, two
grey eyes, no ears, a cream horseshoe that read as a grin. The sweep lives
inside `hog-lab.html` rather than in a copy of it, because a copy of the lab
goes stale the moment the lab moves and you have no way of knowing.

Two things about looking at it in a browser, both of which wasted a cycle:

- **Cache-bust the URL.** Reloading `hog-lab.html` served the previous render and
  I graded a stale page as if it were the change.
- **Chrome throttles an unfocused tab.** `requestAnimationFrame` does not run
  while an automated tool call has focus, so `await`ing a frame hangs outright
  and screenshots repeat. Patch a counter onto `window.requestAnimationFrame`
  and read it between calls to know whether anything actually advanced.

### He is 3D now

**`drawHog()` is a software 3D renderer.** He is geometry — a body ellipsoid, a
head sphere, and a coat of quills rooted on the ellipsoid's surface with real
outward normals — projected orthographically into Canvas 2D and drawn back to
front by the painter's algorithm. No WebGL, no library, no build step. The file
is still one file.

Why, after three 2D rebuilds:

- **A 2D arrangement can only be correct from one angle.** Every version was
  hand-tuned in profile and wrong everywhere else, and the mirror flip meant he
  could face exactly two directions.
- **Quills pointing at the lens must foreshorten to stubs while the rim ones
  stay long spikes.** That contrast *is* the read of a quill coat — it is the
  same thing the shells-and-fins fur literature exploits. 2D cannot do it: it
  can only draw the rim and then paint "texture" on the middle, which is exactly
  why he kept coming out a smooth loaf with a fringe.
- Turning is now free and continuous, which was improvement #1.
- Real normals give real shading, so he has form rather than a gradient.

Model space is **+x along his snout, +y up, +z across him**; canvas y is down so
screen y = −y; the ground is y = −20.5. There is exactly one rotation,
`th = π/2 − hog.hd`, about the vertical axis: `th = 0` is profile facing right,
`+90°` is nose-on. Projection is orthographic **on purpose** — §1, the field has
no perspective falloff, so neither does he.

Things worth knowing before touching it:

- **`hd = π/2` is profile, `hd = 0` is walking at the lens.** Every lab stall
  defaulted to 0 and they all came up nose-on.
- **An ellipsoid under a rotation about the vertical axis projects to an
  axis-aligned ellipse, exactly**: half-width `sqrt(a²cos²θ + c²sin²θ)`, half
  height `b`. His body is one fill and no approximation. A sphere projects to a
  circle, so his head is too.
- **The mantle boundary is a plane** (`MN`, `MK0`), not a curve. This replaces
  the hand-drawn diagonal edge of the 2D version and is right from every angle.
- **The dark mass under the coat is the body ellipse shifted along that plane's
  own normal.** 250 narrow needles nowhere near cover an ellipsoid, so without
  it the cream body shows between them and he reads as an **artichoke**. Filling
  the true mantle region means compositing a plane-section curve with the
  silhouette; the offset ellipse is one fill and is correct back-and-up in
  profile, straight up nose-on, and over all of him from behind.
- **You could see his face through his body, and the fix is not depth sorting.**
  His head sphere sits INSIDE the body ellipsoid — `(20.4/26)² + (1.6/16.5)² =
  0.62` — so the two interpenetrate, which is the one case the painter's
  algorithm cannot resolve. Depth-testing the head against the body puts his
  face behind his own flank in profile, where the head's depth is exactly zero.
  What is actually true is that the only visible part of his head is the bit
  that **protrudes** out of his front, and you stop seeing that protrusion as it
  turns away. So the whole face group fades on `st` — how much his snout axis
  points at the lens — full in profile and nose-on, gone once his back is to
  you. Everything hung off the snout (muzzle, nose, mouth, whiskers) has the
  same gate one level down, or his nose sits on the back of his head as he walks
  away. The `walking away` stall exists for this.
- **The dark mass must be DARKER than the quills standing on it.** It is the
  shadow between them. At `#6f5238` it was *lighter* than `quillDk`, so every
  gap in the coat read as a bald brown patch — worst of all nose-on, where his
  rear-facing quills all foreshorten to stubs and pile up in the middle of him.
- **The dark mass must be CLIPPED to the body.** Offset back-and-up by 7.6 it
  overhangs the top of his silhouette by about 3px, and what you see is a
  smooth brown crescent hanging behind his head with no coat on it.
- **There are two visibility ramps, and using the wrong one is invisible in code
  and obvious on screen.** `faceVis` is for features on the SIDES of his head —
  an eye, an ear — which swing into view as they turn toward the lens.
  `frontVis` is for features on the FRONT of his face — the snout, and the mouth
  under it — whose normals point straight across the view when he is side-on,
  depth 0. Gating those on `faceVis` put his nose at 40% and lost his mouth
  entirely **in profile, the commonest view there is**. Front features hide only
  once they have turned away.
- **His mouth belongs on the head sphere, not in screen space.** As a horizontal
  arc hung off the nose at a fixed offset down the frame, it slid off the side of
  his muzzle every time he pitched his head to sniff and stuck out into nothing.
  It is now a point on the sphere with the line lying *across* the projected
  snout axis, bowing outward off the head, so it cannot leave his face and it
  narrows round the side of its own accord.
- **An ear reads as an ear by poking out of the head's OUTLINE.** Sitting whole
  on the cream it is just a second eye beside the real one — which it became
  again the moment the head was made bigger. `RR_EAR` is 1.5 and the ears are
  drawn **before** the head sphere, so the sphere buries all but the tip.
- **The crown coat goes down before the head too.** Drawn after the face, as the
  2D hood was, the front of it lands on his cheek and reads as debris stuck to
  it. Behind the sphere, only the tips show, as a fringe.
- **Do not pick quill properties off the loop index.** A regular pick over a
  golden-angle spiral *is* phyllotaxis, and it drew a literal pinecone. Hash them.
- **Band every quill that is long enough on screen to show a band**, and only
  those: on a foreshortened quill the pale tip overlay is a fat blob, and a few
  hundred of those read as scales. A field of flat dark triangles is noise; the
  dark-base-to-pale-tip band plus a strong backward rake is what reads as a coat.
- **All four legs still go down before the body**, and **the near half of the
  coat goes down before the face.** The depth sort will happily paint legs
  across his belly and quills across his eye if you let it — both are the old
  faults of §10, reintroduced by giving a sort the chance to make them.
- **He costs about 440 fills a frame at full detail, 220 at the floor.** Measure
  it by wrapping `drawHog` and differencing `ops.fill` across the call — pinning
  `quality` and differencing scenario TOTALS is how I got this wrong twice, most
  recently because the harness divided every total by a hardcoded 3650 whatever
  the scenario ran. He is roughly 27% of an `idle` frame, against a documented
  meadow budget of ~1220. He is also the only thing on screen you are actually
  watching, and he gives half of it back under load — but do not add to him
  casually, and do not trust a fills figure you have not counted the frames for.

**`hog.dir` is gone.** It was a ±1 facing sign, and it only ever meant anything
because `ctx.scale(hog.dir*k, k)` mirrored the whole drawing by it. Once the
renderer turned him continuously, every remaining user of it was wrong: the
nose's grass field, the snuffle motes and the breath all placed things at
`x + dir*26k` while his nose is drawn at `x + sin(hd)*26k` — 55px to one side
nose-on, against a field radius of 90px, so the grass parted *beside* him. It
also only updated while `|sin(hd)| > .10`, so walking straight at or away from
the lens it held a sign that could be a half-turn stale. Use `Math.sin(hog.hd)`
and `Math.cos(hog.hd)` — the projected snout — for anything positional.

Two pieces of flat 2D art predate the geometry and still live in screen space:
his **boat** and his **shiver arcs**. They used to be mirrored for free by that
same `ctx.scale`. They are now mirrored by `faceSgn` and the hull foreshortened
by `boatS`, which is floored in magnitude so it can never reach zero.

### What he is made of, and the reference

**`assets/logo/hedgepig-logo-badge.jpg` is the character.** Read it before
touching his drawing. Two rounds of "rebuilt from a photo" went past it and both
produced something that wasn't him. From the badge:

- **Two masses, not three.** A **dark spiny mantle** over the back, and **ONE
  cream mass that is face, chest and belly together**. There is no head.
- **Give him a separate pale head and he reads as a seal in a wig.** That was
  the actual fault: a cream sphere with a hard edge against the body, with the
  quills sitting on top like a crest.
- **The mantle must reach the ground at the rump.** The quill arc used to span
  `-3.02 → -0.10` — the top only — so the bottom two-thirds of him was a bald
  blob. It now runs `-4.25 → -0.12`; that lower sweep is the whole difference
  between a mantle and a wig.
- **The mantle is a path, not an ellipse:** an arc round the back and top,
  closed by a *diagonal* front edge from the brow down behind the front leg. As
  an ellipse its front edge bulged forward across the middle of him and read as
  a beetle's shell.
- **Dark brown, mostly.** ~90 fine dark needles with only ~18 pale tips. Fat
  cream triangles read as petals; he looked like a chrysanthemum.
- Needles **rake** toward the rump. Dead-radial is a sunburst.
- The **muzzle is pale**, only the nose is dark. A grey muzzle is a foreign
  object on a cream face. `SNOUT_R` past about 1.25 and he is an anteater.
- The **cheek blush** is a surprising amount of the charm. Place it off the
  **eye**, not off the head, or it lands on the snout as a smear.

### He has no head

**There is no head sphere, and there never should be again.** The badge has ONE
cream shape; his head is only where that shape narrows. So his features are
placed straight onto the front of the body ellipsoid, and his whole body is that
one cream ball — there is no dark mass under the coat either, so the only dark
on him is the spines.

This replaced a head sphere, and the point of the change was not tidiness. It
**deleted a family of faults that could not be fixed while the head existed**:

- the head sphere sat *inside* the body ellipsoid — `(20.0/26)² + (1.7/16.5)² =
  0.60` — so the two interpenetrated, which is the one case the painter's
  algorithm cannot sort. That is why his face drew through him, and why every
  attempt to fix it by reordering failed.
- a separate pale sphere reads as **a seal's head**. That is what started all
  of this.
- the mantle boundary left a **slab** from the front and a **grin** nose-on.
- the crown coat landed on his **cheek** whichever way it was filtered — by
  depth the front of it, by screen height his nape, because nose-on everything
  on his midline projects to X = 0.

What it costs is the neck: he cannot turn his head independently, so looking
about comes from the features shifting across his front (a damped yaw) rather
than a head rotating.

Rules that carry over, and one new one:

- **The face wins; the coat works around it.** His eye positions are computed
  *before a single quill is drawn* and the coat keeps out of a radius around
  each. Every arrangement tried the other way round — coat down first, face
  drawn over it — put spines on his cheek or through his eye. The radius shrinks
  as he turns side-on, where a generous zone leaves a bald patch round the one
  visible eye.
- **`faceVis` vs `frontVis`.** `faceVis` is for features on the SIDES that swing
  into view; `frontVis` is for features on the FRONT, whose normals point across
  the view when he is side-on. Using the wrong one is invisible in code and
  obvious on screen: it once put his nose at 40% and lost his mouth entirely in
  profile, the commonest view there is.
- **His mouth is three points on his own surface**, bowed outward, so it is a
  smile at every angle. Derived any other way it inverts into a frown somewhere.
- **The catchlights track the pointer.** A catchlight is a reflection, so it
  belongs on the side of the eye facing what it reflects, with a cool glint
  opposite to read as wet. His neck stops at 1.35 rad; his eyes do not stop.

`hog-heads.html` is the bench where four head *mechanics* were built side by
side — the sphere, blended authored poses, this one, and an authored wedge —
so a direction could be chosen instead of iterated toward. It is a scratch
tool: delete it once you are sure, or keep it if another rethink is coming.

### He watches your pointer

`lookAt(h, dx, dy, th)` aims his head at a screen position. The snout's
screen-x component is `cos(hy + th)` and its depth is `sin(hy + th)`; the
pointer is effectively at the camera plane, so we want the branch with depth
≥ 0, and `acos` returns exactly that. The clamp at ±1.35 rad is his neck —
past it he strains as far round as he can, which is the right behaviour
anyway.

It sets only the spring **targets**, so he lags and settles onto you rather
than snapping. `h.lookLock` suppresses the idle glancing while he is
watching.

In the game a mouse holds his attention indefinitely (it hovers, then sits
still, so an expiring timer would make him look away from a stationary
cursor); a finger only exists while it is down, so that one expires after
1.4s and he goes back to snuffling. In the lab **every** stall tracks the
pointer wherever it is on the page — eleven of him turning at once is the
fastest way to see whether the aim is right at every body angle. Stall
rects are cached in `resize()`, because a `getBoundingClientRect` per stall
per frame thrashes layout.

### The head spring

`updateLook()` runs three springs, semi-implicit Euler, stable at the `dt=0.05`
ceiling `tick()` clamps to. The point of a spring over a lerp is that **a lerp
cannot overshoot**, and the settle is most of what separates "interpolated" from
"alive". Gaze overshoots ~7% and settles in 0.8s.

The caller sets two inputs and `updateLook` consumes both: `hog.turn` (radians
the body rotated this frame) and `hog.acc` (px/s²). Both are set *after*
`updateLook` runs, so they arrive one frame late, which is invisible.

**The turn lag must be driven by turn RATE, not by adding the turn onto the
yaw.** Added as a position, the spring reaches equilibrium carrying the entire
restoring velocity, so when the turn stops the head whips **17–22° past** where
it should settle — a wobble, not a lag. Measured, not guessed. As a rate-driven
target it holds 22° behind through a full-speed turn and returns overshooting by
about a degree.

`hlag` is the same idea in translation: a mass on a spring inside an
accelerating body, so his head sits back as he sets off and carries on forward
as he pulls up. It is read twice — once as a shift, once as a nod.

### What I got wrong this session, and what caught it

Four independent reviewers read the rebuild cold and found more than I did. The
pattern in what they found is worth more than the list:

- **Three of my own comments asserted something the arithmetic then denied.** A
  golden-ratio thinning sequence "spreads evenly" (it strips whole wedges bald,
  because it shares its irrational with the golden-angle ordering); a spine
  ripple travelling "nose to rump" (it ran the other way); "no colour trick
  needed" thirteen lines above a colour trick. **If a comment states a fact,
  check the fact.**
- **Two faults I had already fixed once, and reintroduced.** Alpha-fading cream
  over dark brown, which I fixed for the curl and then re-added via `headVis`;
  and an overlay pass of quills over the face, which I got wrong in both
  directions before removing it entirely.
- **A string replace whose pattern has drifted does nothing and says nothing.**
  This is how the two files diverged, and it is why `smoke.js sync` exists.
- **Three of my slices were too greedy** and silently deleted neighbouring code
  — five functions once, then 320 duplicated lines, then the whole colour
  palette. Every one was caught by the harness within a minute. Assert on what
  you cut.
- **A measurement is not a measurement until the divisor is checked.** The
  harness divided every scenario's op counts by a hardcoded 3650 whatever it
  actually ran, and I published a performance figure off it.
- **The lab tests profile; the game is nose-on.** Almost every remaining fault
  was in the view the bench rig does not show.

### Still to do on the animation

In rough order of payoff:

1. *(done — the 3D rebuild turns him continuously; there is no mirror flip left
   to remove.)*
2. *(part done — jointed, with a stance and a swing. NOT planted: one leg cycle
   covers 44 model units of travel, of which the stance is 27, and the foot
   would have to cover all 27 backwards on a leg 10 units long. The arithmetic
   is in the comment. Fixing it properly means re-timing the whole gait and
   probably slowing him down, because the body bob is locked to twice the leg
   rate and is already 5.9Hz at full pelt.)*
3. *(done — the head spring, above)*
4. Anticipation and follow-through on setting off and arriving. Partly there:
   `hlag` gives the head a trail, but the body itself does not anticipate.
5. Two gaits blended by speed, not one stride shape played faster.
6. A ripple through the spines, nose to rump, per footfall.
7. *(done — the ear flick, above. `hog.flick = 1` also fires from
   `dropCrumb()`, so he pricks his ears when you call him. A footfall trigger
   and a pin-back on a hit are still worth adding.)*
8. *(done — superseded by the head rig above)*
9. Idle variety — a scratch, a shake, sitting up, a yawn.
10. A curl with weight — flinch, squash, bounce, wary unroll. The retraction is
    in; the weight is not.

### Drawing and animating him

`drawHog()` builds him in layers, and the order is the whole reason he reads as
a hedgehog rather than a porcupine:

```
aura → ground shadow (or the boat) →
FAR half of the depth-sorted coat →
all four legs → body ellipse → dark mass, clipped to the body →
NEAR half of the coat →
crown coat → ears → head sphere → muzzle → blush → nose → mouth →
whiskers → eyes →
shiver arcs (or the boat's near gunwale)
```

Two rules in that order are load-bearing and both have been broken by a depth
sort that was allowed to decide for itself: **all four legs go down before the
body**, or the near pair paints across his belly; and **the near half of the coat
goes down before the face**, or a quill on his own side is painted over his eye.
The crown coat has no pass over the face at all — see the head rig, above.

Two things here were got wrong and are easy to get wrong again:

1. **The quills were once drawn last, over everything**, which buried his ear and
   eye and made him a fan of sticks. Keep the dome between the spike roots and
   the face.
2. **All four legs are drawn before the body.** Drawing the near pair over it
   painted them across his belly — "legs through his body". Only the part below
   the belly should ever show. Depth between the pairs now comes from an actual
   depth sort *among the legs* plus a colour difference; the old 2px foot-height
   split is gone, because the feet plant and swing on their own cycle.
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

- **Everything airborne converges on a band.** `airK(z)` scales 1.9 down to 0.10,
  and every leaf and flake is interpolated from a spawn point scattered all round
  the frame toward `AIR_BAND` (40% of H), where the far field sits. Some drift
  down into it, some drift up — a healthy mix is roughly 60/40, and you can
  measure it.

  **Shrinking alone is not enough.** The first attempt at this kept a uniform
  downward drift and just scaled it; the report back was that it still looked
  like it fell top-to-bottom, and that was right. A directional sweep reads as
  rain no matter what you do to the size. It is the *convergence on a vanishing
  point* that reads as depth. If you rework this, check that near and far
  particles differ in their distance from the band by at least 3x, and that
  spawns still go both above and below it.
- Leaves and snow are each drawn **twice**, crossfading on `z` around 0.56: the
  near end on the blurred foreground plate (`drawFallLeaves(fgx, 1)`,
  `drawSnowfall(fgx, 1)`) so it is genuinely out of focus, the far end sharp in
  the main pass. Snow uses the identical model — it had the same fault.
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
