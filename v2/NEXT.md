# NEXT — the backlog, and the run log

This file is the memory between unattended runs. Each run reads the top of the
backlog, builds **one** item, sweeps for new ones, re-ranks, and appends a line
to the run log. See `AGENT.md`.

---

## Backlog

Ranked within each workstream. Take the top item of whichever workstream the
last run did *not* touch.

### Graphics

1. **Nobody has measured the frame rate.** Every frame observed while building
   this was a background-tab frame, so the cost of ~50 000 grass tufts, a
   21 500-triangle globe and 830 rigid props is genuinely unknown. Measure it
   focused, at a real window size, and put the number in `HANDOVER.md`. Every
   other item on this list is guesswork until that exists.
2. **The ground reads as one flat wash.** Ten place colours blended over a
   whole sphere average out to a single olive. Wants either more contrast
   between places, or a second signal — worn paths, bare soil, moss in the
   damp, something that varies at a scale smaller than a place.
3. **Flower stems go orange in autumn** because they share the `leaf` colour
   role. A stem is not a leaf. Give stems their own role.
4. **The far side of the planet is bare** in orbit view (`P`): a 4-band toon
   ramp over an icosphere with nothing on it.
5. **`weather.js` names butterflies and bees** that were never built — they are
   still just motes. Summer should have something flying that reacts to him.
6. **The ink pass may be too heavy on grass again** now the meadow is three
   times denser. Check `uSens` against a full-density frame.

### Gameplay

1. **There is no reason to cross an open planet.** It is walk, dodge two
   hazards, reach the burrow. Wants something worth finding out there, and a
   reason to return somewhere. Quiet, not a quest log.
2. **Nothing persists between legs.** What you sow is recycled after 26 items
   and nothing else remembers you were there. Footprints, worn paths, flowers
   that stay — v1's world remembered nothing either, and it was its weakest
   part.
3. **The interactables say one line and go quiet.** The cat, the coop, the
   fairy door, the birdbath. They could reward a second visit.
4. **Weather does not touch him.** He shivers in snow and that is all. Rain
   should change how he moves or where he wants to be.

### Sound

1. **There is none at all.** Start with `core/audio.js` and *one* convincing
   sound: footfalls, driven off the real gait cycle — `anim.js` exposes
   `fore`, `lift` and `stance` per leg, and a footfall is the frame `stance`
   goes true. Synthesised, no files. Mute toggle. No audio before a gesture.
2. Grass rustle, scaled by how hard he is pushing through it — the shader
   already knows, via `uHog`/`uHogR` in `grass.js`.
3. Water at the lake, traffic swelling as you near the road, wind on the open
   hillside.
4. Something ambient that moves with season and time of day, the way the
   palette already does.

### Debt

- `props.js` still exports `contactShadow` and `PROP_MAT`, unused since the
  disc rebuild.
- `plan.js` exports `PLACE_SPAN`, `wrapX` and `arcTo` that may now have no
  callers — check before deleting, `arcTo` is used by `terrain`.
- The harness has no coverage of `season.js`'s palette application, `sky.js`,
  or the weather fields.

---

## Run log

Newest last. One line each: date, workstream, what landed, what the sweep found.

- **2026-07-30 — setup.** Backlog seeded by hand from the build session that
  produced the open world, the streaming meadow, the rebuilt gait and the
  sown-flower growth. 65/65 in the harness at `3a2f12e`. No unattended run has
  happened yet.
