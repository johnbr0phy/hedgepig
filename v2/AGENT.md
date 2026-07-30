# the hedgepig, unattended

You are a scheduled run. You wake every three hours in `~/hedgepig/v2` with no
memory of the last run, do **one** thing well, attack the result, write down
what you learned, and exit. Over weeks this compounds. Treat every run as if
the next one has to understand what you did from the repo alone — because it
does.

The game is a cel-shaded 3D hedgehog on a small planet: Vite + three.js, no
image assets, everything procedural.

**Work only inside `v2/`. Never touch the repository root** — `index.html`,
`smoke.js` and `HANDOVER.md` at the top level are v1, a finished Canvas-2D game
that must keep working.

---

## Read first, every time

1. `v2/HANDOVER.md` — how it works and every mistake made building it, with
   what each cost. Sixteen bugs are recorded there. **Do not reintroduce any of
   them.** The invariants section is not advice, it is scar tissue.
2. `v2/NEXT.md` — the ranked backlog and the run log. **This is your memory.**
   If it does not exist, creating it is this run's work.
3. `v2/README.md` — the shape of the world and the file map.

---

## The run

### 1. Orient

```
cd ~/hedgepig/v2 && npm install --silent
node smoke.js all          # must be green
npx vite build             # must be green
```

If either is red, **fixing that is the whole run.** Stop, fix, commit, exit.

Read the last three entries in `NEXT.md`'s run log. Whatever workstream the
last run built in, build in a different one this time — graphics, gameplay and
sound must all advance, and eight runs a day on one of them is waste.

### 2. Sweep — fan out, in parallel

**Spawn six subagents in a single message so they run concurrently.** One per
dimension. Give each one the paths it needs and this instruction: *be hostile;
"it looks fine" is not a review.*

| agent | territory |
|---|---|
| render | `core/toon.js` `core/post.js` `core/outline.js` `core/sky.js` `core/palette.js` — does it still read as painted, or as generic low-poly 3D? |
| world | `world/plan.js` `terrain.js` `ground.js` `grass.js` `places/*` — shape, variety, whether an open planet actually rewards walking across it |
| hog | `hog/model.js` `hog/anim.js` `hog/hog.js` — fidelity to the badge, and whether the motion reads as an animal |
| play | `game/game.js` `core/chase.js` `core/hud.js` — is there a reason to do anything? what is boring? |
| sound | `core/*` — what exists (currently nothing), what the world is asking for |
| perf | frame cost, per-frame allocations, what the harness cannot see |

Each returns findings **ranked**, each with `file:line`, one line on why it
matters, a proposed fix, and how it could be tested. Merge them into `NEXT.md`,
deduplicated and re-ranked. Fix anything both small and certain immediately;
queue the rest.

The most valuable findings in this project's history all **looked deliberate**:
a shadow camera that made the planet look moodily lit, a summer with no grass
in it, a face whose catchlight was buried inside the eyeball, a roof on upside
down. Look for those.

### 3. Build — exactly one item

Take the top of `NEXT.md` in this run's workstream. **One.** A single
improvement landed cleanly beats three half-done, and the next run is three
hours away.

If it is large or touches many files, do it in a subagent with
`isolation: "worktree"` so a mess cannot reach the working tree.

Every behavioural change needs a scenario in `v2/smoke.js` that **fails before
and passes after**. The harness drives the real modules — three.js runs
headless in Node, only a canvas is mocked — so "I cannot test this" almost
always means "this should be factored so I can". `node smoke.js gait` and
`node smoke.js open` are the models to follow: they assert a *property*, not a
snapshot.

### 4. Attack — fan out again

**Spawn three subagents to refute your own change.** Not to review it: to break
it. Each takes a different lens — correctness, visual result, performance — and
each is told to default to "this is wrong" when uncertain. Give them the diff.

If two of the three land a real hit, **revert and queue it** with what they
found. That is a good outcome, not a failed run.

Then check the change against the edges this world actually has: the poles, a
place boundary, `gait === 0`, mid-curl, underwater, at 15 fps, on the far side
of the planet.

**Budget: at most ten subagents in a run.**

### 5. Record and commit

- Append to `NEXT.md`: a dated run-log line (workstream, what landed, what the
  sweep found), and the re-ranked backlog.
- Append to `HANDOVER.md` anything that *taught* you something. This project's
  convention is that the handover is mostly mistakes and what they cost, not a
  feature list. Write it so the next run does not repeat it.
- `node smoke.js all` and `npx vite build` must both be green.
- Commit to `main` in the existing style: what changed and **why**, in prose,
  with the co-author trailer used by the other commits. **Commit locally. Never
  push.**

If you cannot finish cleanly: `git checkout -- .` and write what stopped you
into `NEXT.md`. **Never commit with the harness red.** Never leave the tree
dirty — the next run refuses to start on a dirty tree, so you would block it.

---

## Standing constraints

- **No binary assets, ever.** Textures are drawn with Canvas2D at load; audio
  must be synthesised at runtime with WebAudio. This is the thing carried from
  v1 most worth refusing to give up.
- **`heightAt` is the only answer to how high the ground is.** Never add a
  second source of ground.
- **Anything that moves is built after the planet bake** and seats itself on the
  surface each frame. Bending a rig's geometry bends its pivots with it.
- **Range off the hedgehog, never off the camera.** In v1, hazards gathered from
  the visible band made him invincible the moment you scrolled away.
- **Props are placed rigidly, surfaces are generated through the mapping.**
  Geometry authored flat and bent is squashed by `cos(latitude)`.
- **The character is fixed.** `assets/logo/hedgepig-logo-badge.jpg` is him: two
  masses not three, a dark spiny mantle, one cream mass that is face, chest and
  belly, and **no head**. Read HANDOVER §4 before touching his model. Improve
  how he moves and how he is lit; do not redesign him.
- **Derive, do not guess.** Four features ended up buried inside his own head
  because they were positioned by eye against numbers they did not share. If a
  value needs a literal to find its place, it is in the wrong place.
- Keep the ink-and-cel look. A change that makes it read as generic 3D is wrong
  however clean the code is.

---

## The three workstreams

**Graphics.** Nobody has ever measured the frame rate — do that first and put a
number in `HANDOVER.md`. Then: the ground reads as one flat wash now that ten
place-colours blend over a sphere; flower stems turn orange in autumn because
they share the `leaf` colour role; the far side of the planet is bare in orbit
view; `weather.js` names butterflies and bees that do not exist.

**Gameplay.** It is walk, avoid two hazards, reach the burrow. An open planet
wants reasons to cross it: things worth finding, a reason to go back somewhere,
something that persists between legs. Do not answer this with a HUD full of
numbers — the whole character of v1 is that it is quiet.

**Sound.** There is none. Build it procedurally with WebAudio. Footfalls should
follow the real gait cycle in `anim.js` (foot phase and stance are already
exposed on each leg); grass rustle should scale with how hard he is pushing
through it; weather, water, traffic that grows as you near the road, and
something ambient that moves with season and time of day. Start with one
convincing sound, not a broad thin layer. Respect a mute toggle, and never
start audio before a user gesture.

---

## Taste

Quiet, warm, hand-painted, and slightly melancholy. Small details that reward
attention beat big features. If a change makes the hedgehog less charming it is
not an improvement — he is the whole product.
