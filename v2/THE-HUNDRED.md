# The Hundred — an adversarial audit of the hedgepig

Produced 2026-07-31 by twenty-two agents working in parallel: ten read one
dimension of the game each, ten adversaries then tried to kill what they found,
and two more merged, ranked and criticised what survived. 3.2 M tokens, 751 tool
calls, forty-five minutes.

**Every reviewer was made to read `HANDOVER.md` and `NEXT.md` in full first**,
and every finding was put to an adversary whose instructions were to throw it
out if it restated a documented decision, was factually wrong about the code, was
generic advice, or would damage the art direction. Several of the survivors were
verified by *running* the modules headless rather than by reading them — the
displacement in #1, the slew rate in #9 and the ear geometry in #23 are measured
numbers, not estimates.

A caution worth stating: this list was written by agents, not by a player. It is
very good at finding logic that cannot fire and geometry that does not line up,
and it cannot tell you whether the game is any fun. Read it as a bug list with
ambitions, not as a design document.

---

## The eight themes

- "Built, listed as done, and never once seen" is now the dominant failure mode, and it has moved from content into machinery. The rainbow, the ear flick, `ctx.stand`, `hullOutlineTree`, the `aSize` star attribute, `hog.lean`, `hog.landed`, the `grade` toggle, the catch arms opening, the burrow's compass branch — all complete, correct, committed and unreachable. HANDOVER names this pattern twice; it is now at least a dozen instances, and the common tell is that nothing in the harness asserts that the thing ever *happens*, only that it exists.
- Edge-detected events on slow continuous state can never fire. Three separate features latch on `state.wet` falling from >0.4 to <0.08 in a single frame against a signal whose steepest slew is 0.0046 per frame — two orders of magnitude short. The codebase already contains the correct pattern (`wetFor` accumulates, and the post-rain shake works because of it). Any future one-frame edge test on a damped or wandered value wants the same treatment.
- Mars is the meadow with the paint scraped off. HANDOVER catalogues four leak classes from the Mars work and every one of them has an uncaught sibling: hazards and blockers still enforced with nothing drawn, weather still falling, the sound bed still a summer meadow, the traffic and hens and boat still running because `ctx.post` was handed the scene rather than `world.root`, the ending absent from the save and from the journal, and the ship he arrived in not solid. The re-dressing trick is sound; the *inventory* of what has to be switched off was never made systematically.
- The world is superb at geometry and derivation and systematically weak at consequence. Things are placed correctly and then nothing answers them: rain that reaches the ground and stops, a blocker that refuses a step with no visual, cars on 24 % of the road they belong to, a burrow with no bearing, a resident nobody looks at, a launch with no engine noise. The next big win is not more objects — it is closing loops on objects that already exist.
- The two most heavily-built systems, the sky and the audio, are also the two with the most mis-routing. The right curves exist and the consumers read the wrong ones: `1 - night` instead of `state.day`, `dark` instead of `night` for meteors, `sunDir` instead of the key direction for cloud occlusion, `state.wet` instead of the surface for footfalls, `thrust` read by the plume and not the mixer, wind leaning the rain and nothing else. Most of these are one-field substitutions with a field already computed and already named for the job.
- A measured constraint is silently invalidating a whole subsystem. The camera can never look above ~19° of elevation, and the constellations, the aurora and the meteors are all authored between 26° and 55°. `clouds.js` already compensates by weighting its dome low 'because you spend this game looking down' — that comment is the tell that the constraint is being designed around rather than measured and lifted. The same class of measurement ("how often will you be standing near one") is what the butterflies needed.
- HANDOVER's own rule — 'on this world, any `.y` is a bug unless you can say which frame it is in' — is still generating bugs. The rainbow's `lookAt` builds its roll against world +Y inside a tangent-frame group; the orbit sky's `setOrbit` is undone by `update` on the next frame and the sun disc holds a stale tangent vector read as a world one. Frame discipline is the one invariant this codebase has not yet made structurally impossible to break.
- The backlog has drifted in three separate directions and each drift would cost an unattended run a whole session: items that are already done (World #4's landforms, Graphics #3's quill glints), items that misdiagnose their own cause (the 101 shader programs are keyed by tint hex, not by `cache: false`; Graphics #7 audits an assignment that was never made), and items built on a false premise (photo capture is dev-server-only, so a contact sheet would sit on top of nothing). Striking and re-diagnosing is cheap and protects the next several runs.

---

## Shape of the list

| | small | medium | large |
|---|---|---|---|
| count | 69 | 29 | 2 |

| | high | medium | low |
|---|---|---|---|
| impact | 32 | 58 | 10 |

**90 of the 100 are new** — not already in the `NEXT.md` backlog.
The synthesiser reported a shortfall of 0, i.e. it did not
have to invent any filler to reach a hundred.

---

## The hundred

### 1–10 · the ones that are actually broken

**1. Sleeping in the burrow teleports him 23 m and cancels itself**  
`small` · `high impact` — *game loop*

`game.js:871` sets `hog.under = true` to tuck him away for the 46x night, but `culvert(dt)` runs first every frame (`game.js:838`) and branches purely on `hog.under` with no idea why it is set — it lerps him toward `roadPoint(cv.along, roadOffset(hog))`, sees `|across| > cv.half + 0.3`, clears `under` and toasts 'out the other side, and dry'. Stepped headless from the lake burrow: 22.68 m of great-circle displacement in one frame, `state.sleeping` still true so the night fast-forwards while he stands in the open, and `main.js:824` awards the `culvert` journal flag off the same frame. Guard the culvert branch on `!state.sleeping`, or give sleep its own flag rather than reusing `under`. This fires every single time he gets home after dark, which is the beat the whole working sky was built to pay off.

**2. The whole Earth game loop still runs on Mars — invisible brambles cost hearts**  
`medium` · `high impact` — *mission / game loop*

`main.js:794` calls `game.update(dt)` unconditionally and `dressMars` (`mission.js:556-573`) only hides meshes, never touching `t.live`, so `checkThorns` (`game.js:671-678`) wounds him off hitboxes with nothing drawn in them — the nearest live bramble to the landing site measures 10.38 m and it is live at every leg. Alongside it: `world.blockedAt` still refuses the pad's r=9.4/6.2 no-gos 31 m away, the burrow test at `game.js:846` still advances a leg and toasts 'the brambles are thicker', `readouts()` still writes 'the mire', and every tap routes through `sowKinds`→MIRE→'stone' which registers a real blocker inside the hidden `sown` group. Losing a heart to something you cannot see is the most confusing failure this game can produce and three of them reset twelve legs. One `mission.onMars` branch around hazards, the burrow, sown solids and the place readout — or drive `applyThorns` to zero when `dressMars(true)` runs.

**3. He gets out of the rocket standing inside it, among the engine bells**  
`small` · `high impact` — *mission*

`mission.js:622` places him at `offsetFrom(CENTRE[MIRE], SITE_U + 0.9, SITE_V)`, and the site is the ship's own axis (`crossAt` returns 1 and `altAt` 0 at `TOTAL`, and staging set `ship.position.y = 0`). The Starship's barrel is `D = 9` m, so 0.9 m from the axis is well inside the hull under the Raptors, and `chase._seeded = false` at 626 then re-seeds a hedgehog-height shot from in there. The comment directly above says 'onto the ground beside it, facing away from it, because the first thing anybody does is turn round and look'. `smoke.js:2217` only asserts `< 2 m` from the site, so it passes — the tolerance needs to become a floor as well as a ceiling, and 0.9 has to clear 4.5 plus his own half-width.

**4. The documented escape from a bramble is deleted by holding a key**  
`small` · `high impact` — *hazards / fairness*

`hog.hit()` (`hog.js:319`) gives him a target a metre away — HANDOVER's fix for 'three hearts gone without moving' — but `driveBy` nulls any target the instant the throttle is live (`hog.js:238-241`), and the steering bias `repel` (1.3 s) is only read inside `_steer`, which cannot run while `hurt > 0` (1.2 s) because both movement branches gate on `this.hurt <= 0` (`hog.js:361, 368`). Driven against the real world, holding a heading into a live bramble takes him 3 hearts → 0 → reset → 1 in twelve seconds with five 'ow — brambles' toasts, and the zero-hearts reset (`game.js:709-723`) leaves him standing in the same bush. The keys are the primary control now, so the case `hit()` was written for is the common case. Keep `repel` alive past `hurt` (~2.2 s) and let it bias the drive heading exactly as it already biases a called walk.

**5. speaker(): a conditional line comes back every other utterance, for ever**  
`small` · `high impact` — *dialogue*

`characters.js:109` — `if (fits.length && !fresh.length) spent.clear()` runs on the very call that refuses the spent set, so the set is empty again by the next call. With one fitting condition (night, or rain — the common case) the sequence is conditional, general, conditional, general for ever, so the badger's 'after dark this is a different wood, and it is mine' is half of everything he says all night. The file's own design note at `characters.js:59-62` says conditionals must 'interrupt when their moment comes and then go quiet again'. `smoke.js:1908` cannot catch it because it asserts a floor of 3 of 12 and the real number is 6. Fix with a spend-counter that decays over general lines instead of clearing on the refusing call.

**6. Five invisible walls stand in the meadow for nine months of the year**  
`small` · `high impact` — *places / fairness*

`buildMeadow` places five hay bales with `ctx.block(u, v, 0.55)` each (`green.js:990-996`) and then hides the group outside autumn (`green.js:999`). Blockers have no seasonal switch — `blockedAt` honours `b.enabled === false` (`world/index.js:158`) and nothing anywhere sets it — so five 0.55 m no-gos sit at (-7, 6.5), (-3.6, 4.9), (-0.2, 6.5), (3.4, 4.9), (6.8, 6.5) all year in the place a leg most often starts. Trap for the fix: `places/index.js:213` rebuilds the blocker list with `.map((b) => ({...b, dir, cosR}))`, so mutating the object the builder pushed does nothing — `ctx.block` has to return the final record.

**7. `setShadowTint` never reaches the hedgepig's own body or any resident**  
`small` · `high impact` — *render / materials*

`toon.js:221-228` walks `roles` and `matCache`, and a material built with `cache: false` and no `role` is in neither — `cel()` only calls `matCache.set` when `key` is non-null (`toon.js:149`) and `key` is null whenever `cache` is false (`toon.js:118-122`). 21 such sites exist and the victims are the ones that matter: the hedgepig's body (`hog/model.js:96`), every part of all four wood residents via `M()` (`characters.js:270-271`), and the squirrel, mice, ducks, frogs, snails, toad and molehill in `critters.js`. `season.js:665-667` lerps the world's shade band from 0x6b5f8e to 0x2d3352 after dark; all of these keep their daytime violet all night. Have `cel()` push every material into one flat list and iterate that. HANDOVER §1 names the violet shade band as the one thing to keep if anything is ever simplified.

**8. Going to Mars leaves no journal line, and two labelled entries can never be earned**  
`small` · `high impact` — *journal*

`mission.js:628` calls `game?.note?.('mars')` and the flag persists, but `LABELS` in `main.js:388-402` has no `mars` key and `.filter(Boolean)` drops it — the game's climax is silently absent from its only record. In the other direction `LABELS.owl` ('heard the owl in the wood') and `LABELS.storm` ('weathered a storm') have no callers anywhere in `src/`, though the owl already hoots (`critters.js:254-272`) and thunder already fires at `main.js:742`. That is three of thirteen entries dead in two directions, and eleven is the ceiling however long you play. Three lines of code.

**9. Fix the rain-clearing edge — the rainbow has never once fired**  
`small` · `high impact` — *weather / sky*

Three features test a one-frame edge on `state.wet`: `sky.js:525` (`bow.wasWet && wet < 0.08`, with `bow.wasWet = wet > 0.4` overwritten on the next line), `main.js:826` (the journal's 'stood beneath a rainbow') and `critters.js:907` (post-rain puddles). Measured against `season.js:298-307`, the wander's steepest slew is 0.01349/s, so `wet` moves at most ~0.0046 in a frame while the edge needs a drop of 0.32 in one — the trigger is impossible by two orders of magnitude, and `game.js:880` fast-forwards `dayT`, not `state.t`, so sleeping cannot jump it either. Five arcs, a journal entry the player can see listed and never earn, and the puddles. The correct pattern is already in the file: `wetFor` at `main.js:498/771-772` accumulates instead of edge-testing, which is why the post-rain shake does fire.

**10. Nothing points at the burrow any more — the ship took the only slot**  
`small` · `high impact` — *compass / navigation*

`main.js:779` sets `game.state.goal = PAD` on every non-flying frame and `main.js:940` hands the compass `home: PAD`, so the wedge and the readout say 'the ship 84 m' from the first frame of a save to the last; the burrow branch in `readouts` (`game.js:822-828`) is only reachable while `mission.active`. Underneath, the burrow loop is fully live — `game.js:847-877` advances the leg, ramps speed and thorn density, restores a heart and puts him to bed — and `placeBurrow()` moves it a new random point three places along every leg. The comment at `main.js:935` defends this as 'two wedges on one ring is a ring nobody reads', but the second grammar already exists: the residents are dots on their own `FOLK_FAR` scale. A warm dot for the burrow costs one entry in the `folk` array.


### 11–25 · high value, mostly small

**11. Seat the ears off the ellipsoid normal — both are sealed under the mantle shell**  
`small` · `high impact` — *hog / model*

`model.js:269` seats each ear at the literal `(A*0.30, 0.030, C*0.72*s)`. Measured on the built model the ear's furthest vertex reaches 1.0055 of a body radius against a mantle shell scaled to 1.012 (`model.js:350`), with the nearest mantle vertex only 0.0247 rad off the ear's own direction — the shell covers it completely, before the 24-42 mm quills standing all round it. Both ears are occluded from every angle, so the flick at `anim.js:422-433` (every 2.5-8.5 s, and it rotates the ear about its own centre rather than pivoting at its base) has never been seen. Same fix the blush got: derive off `surfaceZ` and clear the 1.012 shell. The badge's hedgehog reads partly by those two notches in the coat line.

**12. Give the mouth a position — it is the one feature setLook slides off his muzzle**  
`small` · `high impact` — *hog / model*

The mouth's `TubeGeometry` is baked at absolute coordinates with the mesh left at the origin (`model.js:203-221`) — the only one of twelve `face` children with `position === (0,0,0)`, so `setLook` (`model.js:545-554`) gives it a rigid `rotation.y` about the body axis instead of the ellipsoid map every other feature gets. The smile's centroid sits at 0.875 of the snout radius at rest and 1.155 at the 0.5 rad limit: off the muzzle entirely, hanging on his cheek at any real glance. `smoke.js:704-722` cannot catch it because `sFace` computes its invariant from `p.rest`, which is the origin here, so the drift reads as identically zero. Fix both halves — position the mesh and build the curve relative to it, and make `sFace` assert against each feature's geometry centroid.

**13. Drive the sound beds off `state.day`, not `1 - state.night` — dusk sounds like noon**  
`small` · `high impact` — *sound*

`audio.js:531` computes `const day = 1 - state.night` and feeds the birds (`day > 0.5`, line 589) and the cicadas (549). `state.night` carries the deliberate -0.22 offset documented in HANDOVER's 'One darkness was doing three jobs' — it is flat zero until the sun is 13° under — so `1 - night` is still 1.0 through the whole of sunset. The crickets at line 544 read `state.night` directly and so do not start until proper dark, which leaves a window at dusk with birds at full volume, cicadas at full volume and no crickets: the exact opposite of an evening. `season.js:348` already computes `state.day = sstep(-0.02, 0.26, alt)` and its own comment at :237 calls it 'the honest one, unlike `1 - night`'. audio.js is the last consumer still on the wrong curve.

**14. Mars sounds exactly like the meadow — birds, crickets, grass swish and all**  
`small` · `high impact` — *sound / mission*

`season.js:698` sets `state.mars` and `audio.js` never reads it. After touchdown the normal frame path resumes against an unchanged climate state: birdsong every 3-9 s (`audio.js:589`), crickets after dark (544), cicadas at a summer noon (549), the music box (596) and — the one nobody noticed — `swish` at 558, explicitly 'his own body through the blades', playing while he walks on bare regolith. Muting the living beds is a handful of multiplies by `(1 - state.mars)`, and the positive half is cheap and true: 6 mbar means a very quiet, very low, heavily lowpassed wind with nothing living in it, which is the best 'you are somewhere else' cue available.

**15. Ten cars, six hens and a rowing boat go on running on Mars**  
`small` · `high impact` — *mission*

`greenThings()` (`mission.js:459-482`) collects `world.grass`, `world.water`, `place:*`/`brambles` under `world.root`, the pad parts, the registered extras and the `sown` group — but the traffic (`road.js:820`), the hens (`farm.js:483`) and the boat (`water.js:804`) are built in `ctx.post` callbacks, and `world/index.js:93` hands those callbacks the real scene, not `world.root`. `main.js:144` registers only critters, characters and hoglets with `leaveBehind`. `world.update` is unconditional on Mars (`main.js:795`) so the traffic updater keeps cycling cars live and setting `c.obj.visible = true`. The hen run is 48 m from the landing site, the boat 72, the road 78 — a short walk on the one planet HANDOVER is proud of being freely walkable. Three `leaveBehind` arguments, or move the postBake movers into a group of their own.

**16. Earth's rain, snow, autumn leaves and fireflies still fall on Mars**  
`small` · `medium impact` — *weather / mission*

`weather.update(dt, hog, camera, state)` runs in both branches of the frame (`main.js:783` and `796`) and is never gated on `mission.onMars`, so `weather.js:266-272` keeps driving rain from `state.wet`, snowfall, leaf-fall, petals, daytime motes and night fireflies off the Earth climate, all positioned on `basisAt(hog.x, hog.z)` and therefore following him. `climate.update` (`main.js:715`) goes on generating fronts, so `state.snow` accumulates on Mars and the firefly lantern (`main.js:832`) lights up there. Only the clouds were remembered (`mission.js:563`) — and even there each cloud's own `mesh.visible` stays true, so `sunOcclusion` (`clouds.js:282`) goes on randomly dimming the Martian sun with clouds that are not drawn. Landing in an autumn shower with orange leaves blowing past unmakes the sequence.

**17. The sky is left behind at the pad: `sky.update` never runs during the flight**  
`small` · `high impact` — *mission*

`sky.update` is at `main.js:923`, after the `if (flying) { … return; }` at 780-788, and the only thing that re-seats the dome is `group.position.copy(camera.position)` inside that call (`sky.js:537`). For the whole 42 s the 260 m dome stays parked on the chase camera's last position at the pad, while the liftoff shot climbs to `viewpoint + up*300` (`mission.js:361-368`) and crosses 260 m about 5 s in — where `high = sstep(140, 1400, alt)` is still zero and the sky is meant to be fully present. Because the dome is `BackSide` with `depthWrite: true`, once the camera is outside it the sky does not vanish, it becomes a finite ball receding behind the rocket with the sun, halo and clouds inside it. Call `sky.update` inside the flying branch with the ship's own tangent basis.

**18. Stop the ground reacting to feet that are 40 cm in the air**  
`small` · `high impact` — *hog*

`hog.js:707` seats the painted contact shadow at `positionAt(this.x, this.y + 0.006, this.z)` — his feet — so through the 0.42 m, 0.7 s hop the blob climbs with him while the real shadow-map shadow stays down, and `anim.js:435` scales it by ball and gait but never by height. It wants the support height `settle()` already computes (ground vs `platformAt().top`) so it still lands correctly on a stump. Separately the footfall edge at `anim.js:241` is gated on `moving` and `ball` but not on airborne state — `gait` does not drop during a hop — so hopping while walking keeps firing `onFootfall`, which plays a step, bursts dust at `hog.y + 0.004` and stamps a snow or mud footprint at `hog.y`, all floating 40 cm up. Both are one-line gates on state the class already tracks.

**19. Drive the stride, the metres and the ball's spin from ground actually covered**  
`medium` · `high impact` — *hog*

`hog.js:397` computes `const before = { x: this.x, z: this.z }` and never reads it again; three lines later the frame's `ground` is `gait * speed * (1 + rainHurry) * rollSpeed() * dt` — what he intended — and it feeds `stride`, `walked` and `spin`, while `anim.js:150` keeps a third copy with neither `rainHurry` nor `rollSpeed`. Pressed against a fence (`tryStep` false, and on a held key `hog.js:555-559` deliberately never stops him) his feet take full strides on the spot and the ball keeps accumulating spin while wedged; in a downpour `rainHurry` is up to 0.18 so his real speed exceeds the cycle's by ~0.25 m/s and the feet slip. It is also why `hog.walked`, shown in the HUD and written to the save, can be inflated by holding a key against a wall. One measured displacement replaces three derived ones; the variable to hold it is already declared.

**20. Turn his features toward whoever is speaking to him**  
`small` · `high impact` · *already on the backlog* — *hog / residents*

`hog.lookAtScreen` (`hog.js:328`) is the only thing that aims his glance and it is wired solely to the pointer (`chase.js:117, 182`); `lookLock` decays over 1.4 s, after which `animate()` damps `lookYawTarget` toward `_aimTurn * 0.55 * gait`, and standing still `gait` is zero so his features return dead ahead. Meanwhile `hog.idle()` (`hog.js:622-641`) keeps picking a random ±0.55 rad glance every 1.6-4.8 s. So with a badger half a metre away typing forty lines at him — whose own animation beat is opening one eye at him — he glances off into the trees. A `lookAt(x, z)` converting a world bearing into the same clamped ±0.5 yaw, ranked below `lookLock` and held for the length of the line, is about eight lines; `metResident`, the critters, the cat and both hoglets all publish an x and a z. It is also the only case that works with no pointer at all, on a phone.

**21. Move the hard-surface ramp outside the tarmac and the apron: grass grows on both**  
`small` · `high impact` — *terrain / plan.js*

Verified by running the real modules: `roadAt` (`plan.js:342`) is `sstep(3.2, 4.8)`, so the whole soft ramp lies inside the carriageway and the mask only reaches 1 at the tarmac's outer edge, while `grass.js:282` rejects a tuft at `hardAt > 0.45` — which solves to 4.05 m against a deck drawn out to 4.80 m. Sampled every 3 m round the lap, grass is permitted at 4.2, 4.4, 4.6 and 4.79 m on 94-95 % of the ring: a 0.75 m strip of 0.10-0.33 m blades standing through the outer edge of the carriageway, both sides, all 300 m. `padAt` (`plan.js:370`) is the same shape — grass permitted at 12.0-12.9 m on 100 % of a 13 m apron. Sown props are looser again at `hardAt < 0.2` (4.32 m), so a flower can be planted on the tarmac. Fix: `1 - sstep(ROAD_HALF, ROAD_HALF + ROAD_EDGE)`. Do NOT do the same to `townAt` or `lakeAt` — those are read by `reliefMask` and `basin` and would move the terrain.

**22. Gate the water sheet's depth bake by `lakeAt`: it draws water where `waterDepthAt` says dry**  
`small` · `high impact` — *terrain / water*

`waterDepthAt` (`terrain.js:419`) returns 0 whenever `lakeAt(x, z) <= 0`, a hard cut at `LAKE_R = 13.5`, but the sheet is built to `RAD = LAKE_R + 1.5 = 15` (`ground.js:208`) and its per-vertex `aDeep` is baked straight off `heightAt` with no lake gate (`ground.js:226`). Measured over 144 bearings, on 37 of them (26 %) the bed is still below the waterline past 13.5 m, deepest 1.04 m — so on a quarter of the shoreline he walks out onto opaque drawn water while `walkableAt` says dry, `grass.js:283` passes its own test and grows through it, and footprints, frogs and ducks all agree with the gameplay side. One line: `deep.push(lakeAt(at.x, at.z) > 0 ? WATER_Y - heightAt(...) : -1)`. Two answers to where the water is, at the one edge he deliberately balks at.

**23. Nothing in the world can be hopped onto — `ctx.stand` has never had a caller**  
`medium` · `high impact` — *places*

`ctx.stand(u, v, r, top)` (`places/index.js:112-124`) exists with a long comment about logs, stumps, boulders and low walls; `world.platformAt` is implemented (`world/index.js:192-201`), `hog.settle` reads it with a step ceiling (`hog/hog.js:589-592`) and the hop is tuned to 0.42 m. Grepped the whole tree: zero callers. Built the world headless — platforms 0, blockers 493 — and `smoke.js:1492-1494` has to push a synthetic platform to assert 'jumped onto a log, he stands on the log'. Every candidate is already placed and already registered as a plain wall through `blockLine`: the meadow's fallen log (`green.js:903`, r 0.28), `fallenTrunk`'s four mushroom-garden runs and the wood's deadfall (`green.js:809`), the drystone wall segments (`green.js:221`). A 0.17-0.20 m log stands 0.34-0.40 m proud, inside the hop by design. A `standLine` beside `blockLine` converts the family at once; `shared.platforms` is already passed by reference.

**24. The ink fade is in raw metres, so the Starship, the tower and the orbit view carry no line**  
`medium` · `high impact` — *render / post*

`post.js:120` does `edge *= 1.0 - smoothstep(uFadeStart, uFadeEnd, dc)` with a hard-coded 9 m → 26 m (`post.js:61-62`, set nowhere else). The 123 m stack and 146 m tower are built `fog: false` (`starbase.js:115-118`), so above ~26 m they are crisp smooth-shaded steel with no contour anywhere — the largest object in the world is the one the house style never touches. The far tree line between 26 m and the fog far of 40 m is visible and un-inked, and in orbit the globe sits 100-200 m off so `P` switches the ink pass off entirely. Matching the fog is not enough: fog far is 40 m and the nose is 123. Drive `uFadeStart`/`uFadeEnd` from the view alongside `camera.far` in `setPlanetView` (`main.js:313-325`) — and note that function moves `camera.far` 400↔1200 and never re-runs `pipeline.setSize`, the only place `uNear`/`uFar` are written (`post.js:353-354`).

**25. The catch arms are closed on the booster and the rocket flies through them**  
`medium` · `high impact` — *mission / starbase*

`catchTower` puts the arms at `armY = BOOSTER + MOUNT - 8.5 = 82.5` m (`starbase.js:369`), exactly the height of the booster's catch pins (`starbase.js:164`). Working the plan out — `h = TOWER_SEC/2 = 5.5`, `RAIL_X = -6.4`, rig stepped to pad x = +17 — each arm's chord is a 24 m box running from pad x ≈ +9.0 to ≈ −14.8 at z ≈ ±4.0…±4.8, and the vehicle's barrel is 9 m across. The arms are drawn wrapped around the vehicle at the pins, which is correct for a stacked rocket and catastrophic for a launch: `mission.js` never touches `pad.tower` except to hide it on Mars, so through liftoff and ascent the booster passes through two open-truss steel arms with no clearance, in the shot the camera is deliberately climbing to hold. Split the two arms into their own group so they can rotate ~30° clear during `ignition`.


### 26–50 · the middle

**26. Give the launch an engine, and stop freezing the meadow beds through the flight**  
`large` · `high impact` — *sound / mission*

`mission.js:637` sets `st.thrust = thrustAt(st.t)` every frame and the docstring at 283 says 'plume, dust, sound and shake' — nothing reads it for sound. The whole 42 s has two cues: `audio?.home?.()` at boarding (603, and semantically inverted — the coming-home cadence at the moment he leaves for good) and `audio?.thunder?.()` at separation (676). `thrustAt`'s `case 'stage'` even carries the comment 'the gap you can hear', naming a silence in a sound that does not exist. Worse, `audio.update` is at `main.js:866`, after the `flying` early return at 780, so every `setTargetAtTime` holds and the crickets, wind and rain you took off with play at meadow levels in vacuum. `rumble` (`audio.js:186-199, 577-578`) is already a filtered noise source with per-frame gain and cutoff — it is an engine roar with different numbers.

**27. Nothing above ~19° of elevation can ever be on screen — the whole authored sky is out of reach**  
`medium` · `high impact` — *camera / sky*

`chase.js:113` clamps pitch to [0.06, 1.32], all of it looking down; at the most level pose (pitch 0.06, dist 1.95) the camera is 0.37 m above his feet looking down 5.2°, so with a 48° vertical fov the top of frame is +18.8° (+20.6° zoomed out), and raising pitch only tips further down. Against that ceiling: the hand-authored constellations sit at 26.1-49.5° (`sky.js:364-368`), the three aurora curtains at ~35-55° (`sky.js:347`), meteors are seeded at 26.7-48.6° (`sky.js:628-630`). The plain star field is fine (29 % below 18.8°). Two possible fixes and they are alternatives: re-key those three ranges to roughly 6-20°, or decouple the look pitch from the orbit pitch (a raised look target, or hold-to-look-up) — a wider clamp alone does not work, because `chase.js:239-243` lifts the camera back to `floor + 0.18`. Leave the clouds where the measurement put them.

**28. Make the cloud deck answer the front — a downpour has fair-weather cumulus in it**  
`medium` · `high impact` — *sky*

`clouds.js:154-215` builds 26 cumulus once, and `setColors` (233-246) is handed only colours built at `season.js:459-464` from `PAL.cloud`, `dk` and `skyGlow` with no `state.front` term anywhere. `opacity` is never passed so it defaults to 1 and every cloud stays visible, while `season.js:434-436` lerps all three dome stops toward 0xa8b0bb by `front * 0.62` — a wet day is a flat grey dome with 26 bright white cumulus stuck on it. `update(dt)` (`clouds.js:248`) drifts each cloud at a fixed rate and never reads `state.wind`, so a gale and a still day move the sky at the same speed. The comment at `season.js:427-431` says it outright: 'a front is cloud, and cloud is what actually makes a rainy day look rainy'. Darken the tints and hide a fraction by `front`; `sunOcclusion` already skips `!c.mesh.visible` so the dimming follows for free.

**29. On touch and narrow screens the game states no controls and locks out P, J and C**  
`medium` · `high impact` — *onboarding / touch*

`#keys` (`index.html:166-174`) is the only place any control is ever named, and it is `display:none` below 820 px (`index.html:110`) and on `body.touch` (`touch.js:106`), with nothing bringing it back. `touch.js` builds exactly two buttons (`#hg-hop` and the contextual `#hg-act`), so everything else in the keydown block at `main.js:339-424` is unreachable on glass: `P` (the whole-planet view and its ten place labels), `J` (the journal), `C` (photo mode), `Escape`. A phone player is never told that double-tap-and-hold rolls him or that the wedge is the ship. The desktop legend is also incomplete and slightly wrong: `J`, `N` and `Escape` are absent and it says 'click sow' when a click also sends him there (`chase.onCall` → `game.call`). One `?`/`H` overlay reusing the legend copy plus a small stack of icon buttons closes both halves.

**30. Give him a reply — dialogue.js has the multi-line queue and speakTo never uses it**  
`medium` · `high impact` · *already on the backlog* — *dialogue*

`main.js:622` calls `dialogue.open(c.name, c.say(...))` with a single string; `open` normalises a bare string into a one-element list and `advance()` walks the queue (`dialogue.js:186-206`), and `smoke.js:1940-1949` already exercises a two-line conversation including the two-press exit. In play the queue is always length 1, so Space only ever means 'close'. NEXT lists this as hedgepig #0, and the remaining cost is now genuinely only a reply table: panel, queue, swallowed Space and settle/mark timing are all built and asserted. He has no words — a snuffle, a tilt, '…' — so the change is confined to `speakTo` plus per-resident hedgehog beats, and it closes the item's own alternative ('or the lines should stop being addressed to him').

**31. Residents are pinned to the wood by one line, and the farm and the town are ready**  
`medium` · `high impact` · *already on the backlog* — *places / characters*

`WOOD_CHARACTERS` (`characters.js:137`) is plain data with `at: {u, v}` per animal, and `createCharacters` turns it into world coordinates with a single `offsetFrom(CENTRE[WOOD], spec.at.u, spec.at.v)` (`characters.js:718`) plus one more for the badger's sett (753). `TEMPER` is keyed by animal, `MODELS` is a lookup, `speaker()` is generic, `SEE`/`talk` are per animal and the compass draws whatever is in the list — reading `CENTRE[spec.place ?? WOOD]` in those two places is the entire coupling. Nine of ten places have nobody in them and HANDOVER's own point is that a resident is a destination. The two obvious addresses need no new machinery: a barn owl on the beam the farm's flavour text already mentions, and the town cat, which has a model and an animator (`road.js:1429-1448`) and is currently a prop that cannot be spoken to.

**32. Mars is not in the save — reaching the ending leaves nothing behind**  
`medium` · `high impact` — *mission / persistence*

`save()` (`game.js:79-88`) writes leg, hearts, walked, found, x, z, hd, rings, flags, visited and met — not `onMars`. A reload after landing puts him back in the meadow, at the Mars landing site's coordinates, with the Starship rebuilt on the pad and the ten places back. Combined with the missing `mars` journal label this means the game's stated goal is unwinnable in any lasting sense: you can reach it and the save cannot tell you did, while `smoke.js:2223` asserts the flag exists ('and the journal has it') and the journal cannot show it. NEXT Gameplay 0 covers skipping and getting back; the persistence half is recorded nowhere. A persisted `onMars` that re-dresses the world on load turns the ending from a mode into an outcome.

**33. The shipped build cannot take a photo, and S is both shutter and 'walk backwards'**  
`small` · `medium impact` — *photo mode*

`main.js:420` gates the capture on `import.meta.env?.DEV` and `window.__shot` POSTs to `/__shot`, a Vite dev-server middleware (`vite.config.js:16`) that does not exist in the deployed build — so backlog Gameplay 7 ('S keeps a shot and nothing ever shows it again') is built on a false premise: in the game people play, S keeps nothing, and a contact sheet would be built on top of a capture path that cannot fire. Meanwhile `DRIVE_KEYS` maps `KeyS: 'b'` (`main.js:201-202`) and photo mode is only a CSS class (`main.js:384`), so the drive keys stay live and the shutter key walks him backwards out of his own composition in both builds. A client-side `canvas.toBlob` download plus moving the shutter to `Enter` or a second press of `C` fixes both.

**34. Mode keys stay live through the flight, and P mid-launch strands the game**  
`small` · `medium impact` — *input / mission*

The keydown handler (`main.js:339-424`) runs unconditionally while `frame()` returns early inside `if (flying)` at 788, before anything reconciles state. Pressing `P` during the cutscene runs `setPlanetView(true)` (`main.js:309-329`), which captures `savedFog = scene.fog` — already `null`, because `mission.begin()` nulled it at `mission.js:588` — sets `camera.far = 1200` against the mission's 24000 and rebuilds the shadow frustum under a mission managing all three. `mission.finish()` restores its own saved values but `planetView` is still true, so `main.js:792` refuses to drive him, and pressing `P` again writes the mission-era `null` over the world's fog permanently. `C` and `J` are similarly live over a cutscene meant to own the screen. `if (mission.active) return;` after the drive-key block covers all of it, and it is the natural place to hang the skip Gameplay 0 and Mobile 2 both ask for.

**35. metResident never re-evaluates, so the robin can hold the panel while you stand on the toad**  
`small` · `medium impact` — *residents*

`main.js:635-651`: once `metResident` is set it is only released by `busy` or by leaving `talk + 0.45`, and `characters.nearest()` is never consulted again. The robin's `talk` is 1.60 (`characters.js:671`) and it holds itself at 1.15 m off him by design, so release needs 2.05 m and only happens while he is actually moving — and it averages ~0.22 m/s. The toad sits 5.72 m from the robin's home, inside its 8 m `LEASH`, so the robin follows you there; pause anywhere near the toad and it closes to 1.15 and takes the panel, and every shuffle inward keeps it. The toad is one of four and the `everyone` journal note is gated on her. Re-check `nearest` each frame and switch only to a strictly closer candidate scored by `d / talk` rather than raw `d`, which keeps the documented hold rule intact.

**36. The full HUD sits over the whole cutscene, with a compass frozen on stale bearings**  
`small` · `medium impact` — *mission / hud*

`begin()` calls `hud.clearFlash()` and `main.js` clears the prompt and the touch action, and that is all — the hearts, place readout, status line and compass ring stay up for the whole 42 seconds. The compass block (`main.js:926-960`) sits after the flying early return so the ring holds its last redraw for the entire flight: the wedge pointing at the pad and four residents' dots, all measured from where he was standing before he got in, held for forty seconds over another planet. The status line freezes the same way because `game.update` is not called during flight. `document.body.classList.add('photo')` already hides every panel (`main.js:383-386`) — the mechanism is written and one line away in `begin()`/`finish()`.

**37. A whole berry bush is eaten in five consecutive frames**  
`small` · `medium impact` — *balance*

`updateBerries` (`game.js:249-268`) has no cooldown of any kind: `if (b.left > 0 && distance < 0.55 && hog.gait < 0.3)` runs every frame, so standing still beside a bush consumes all five berries in about 83 ms, fires `hog.onNom('berry')` five times (five overlapping nom sounds and five puff bursts) and trips the three-berry milestone — the fourth heart, a toast and a journal note — inside the same tenth of a second. The fourth heart is autumn giving something back for its shorter days and it arrives as a burst of clipping audio. A 0.8-1.2 s gate per berry, the same shape as `touchCool` twenty lines away at `game.js:783-790`, turns it into a hedgehog eating.

**38. The boat is moored underneath the jetty and cannot be seen at its mooring**  
`small` · `medium impact` — *places / water*

`lakeShore(0).d` = 10.666, so the jetty is seated at u = 10.166 (`water.js:536`) with seven boards spanning local x -0.91..+0.87 — deck cover from u 9.26 to 11.04 at WATER_Y + 0.215..0.265. The boat's near mooring is `ctx.at(near.d - 0.35, 0)` = 10.316 (`water.js:812`), 0.15 m from the deck's centre, with the hull at WATER_Y + 0.02 and its rim top near +0.19: a couple of centimetres under the planking, inside its footprint in both axes. The jetty and the boat are the lake's only two built objects and they are drawn inside each other, hiding a whole mechanic at the exact spot the player goes looking for it. Move the mooring to `shore.d - 1.4` or a metre round the shore so the crossing leaves from the end of the pier.

**39. Move the mire's stepping-stone line off the launch pad — 8 of its 11 stones are deleted**  
`small` · `medium impact` — *places / water*

Verified by running the real `offsetFrom`/`distance`: `buildMire` lays 11 stones at u = -7 + i*1.4, v = sin(i*0.8)*1.5 (`water.js:918-927`), then the Starbase is built last and `clearPad` (`water.js:1095-1105`) removes every seated child within `apronR + 0.6` = 13.6 m of PAD. Stones 3-10 measure 9.6-13.3 m and all of them go; stones 0-2 survive at 14.8/14.8/14.4. What is left is a three-stone stub running from nowhere into the concrete, and nothing throws or logs. `clearPad` itself is deliberate and documented; the fault is that the stone line was authored before the pad existed. `mireForm` (`terrain.js:299-303`) still shapes its two swells around a crossing that is 73 % absent. Derive the line's origin from `PAD_U/PAD_V` so moving the pad moves the crossing rather than eating it.

**40. The lost hoglet re-seats half a metre in front of the camera**  
`small` · `medium impact` — *hoglet*

`hoglet.js:97-102`: at `d > 14` it is teleported to 1.4 m directly behind him along `hog.hd + PI`, and the chase camera's default `dist` is 1.95 m on the same bearing (`chase.js:49`) — so the re-seat lands roughly 0.55 m in front of the lens, dead centre of frame, with no celebrate pose and no run-in. It fires after the boat and the culvert, the two set-pieces most likely to be watched, because those are the only ways it loses that much ground. HANDOVER's butterfly rule is explicit that a re-home may only happen while the thing is invisible (`critters.js:610-616`). The arrival path already does it properly at `hoglet.js:83-89` — off to the side, with `cele = 1.1` — so reuse it: re-seat outside the camera cone and let it run in pleased with itself.

**41. The touch hop button hops him out of a conversation**  
`small` · `medium impact` — *touch / dialogue*

`main.js:366` routes Space through `if (!dialogue.advance()) hog.jump()` precisely so one press cannot finish a line and hop him away from whoever is saying it — HANDOVER calls that swallow load-bearing. `main.js:140` wires the thumb button as `onHop: () => { if (!mission.active) hog.jump(); }` with no dialogue check, so tapping hop while the badger is talking hops him, which walks him past `talk + 0.45` and closes the panel mid-sentence. One line (`if (!dialogue.advance()) hog.jump()`) fixes it and simultaneously gives touch players the only way they have to skip a typing line — there is currently none.

**42. The dialogue panel sits underneath the hop button on a phone**  
`small` · `medium impact` — *touch / layout*

`dialogue.js:36-40` pins `.hg-say` at `bottom: 5.4rem`, `max-width: min(30rem, 76vw)`, centred, with no media query anywhere in the file, while `touch.js:86` puts `#hg-hop` at `right: 1rem; bottom: 6.6rem` with a 74 px box. On a 390 px phone the panel spans roughly x=47-343 and y=86 upward for 100+ px of wrapped text and the button spans x=300-374, y=106-180 — they overlap, and the overlap is the end of every line. `index.html:134-135` already moved `#toast` to `bottom: 41%` and gave `#prompt` a `bottom: 20rem !important` for exactly this reason; the dialogue panel was never given the same treatment, and it carries the only authored dialogue in the game.

**43. Photo mode does not hide everything: the E prompt and the ten orbit labels stay in shot**  
`small` · `medium impact` — *photo mode*

`hud.js:280-284` builds `#prompt` with `node.style.cssText = '...opacity:0...'` and then sets `node.style.opacity = '1'` at 289; an inline style beats `body.photo .panel { opacity: 0 }` (`index.html:94`) unconditionally, so standing at the pad and pressing `C` leaves '⌨E climb aboard' in the middle of the frame — exactly where you would stand to photograph the rocket. Separately the ten orbit place-labels (`main.js:465-473`) are inline-styled divs with no `panel` class, so `P` then `C` gives a portrait of the planet with ten name tags on it. `dialogue.js:14-21` carries a careful note that photo mode must win on specificity and that ids must never be used for styling; the prompt breaks that contract. Toggle a class, and give the labels `panel`.

**44. You can walk straight through the fifty-two metres of Starship you arrived in**  
`small` · `medium impact` — *mission*

On Earth the stack is solid — `ctx.block(u, v, 9.4)` at the pad (`starbase.js:554`) plus a tower no-go at 6.2 — but those blockers are registered at PAD, not at the landing site. On Mars `finish()` leaves `pad.stack` parked at the site and registers nothing there, so he walks through the skirt, the engines and out the far side, while the pad's blockers stay armed 31 m away where nothing is drawn. The ship also carries no interactable at the site, so the one object on the planet has nothing to say when he stands under it. The world's whole vocabulary for 'there is something here' is that things stop you and then talk to you, and the object the entire game exists to reach does neither. Register the skirt as a blocker at the landing site, and five lines at the landing leg.

**45. There are no footprints in Martian dust, on the dustiest ground in the game**  
`small` · `medium impact` — *mission*

`main.js:264-265` stamps a print only when `s.snow > 0.45` or `s.wet > 0.4`, and Mars has neither — so the footprint machinery, which HANDOVER §4 says 'worked the day it arrived' because Mars is the same sphere, in fact never fires there. Everything needed is in hand: `season.js:698` sets `state.mars = marsAmt` on the very state object `onFootfall` already reads as `climate.state`, and `prints.stamp` already takes a colour and already reads the ground's slope and draws toes. It is one `else if (s.mars > 0.5)` with a dust colour. A bootprint in regolith is the single most recognisable image of standing on another planet, and Mars is currently the one surface he leaves no mark on.

**46. A Martian sunset uses Earth's warm glow ramp — the one sky colour Mars never touches**  
`small` · `medium impact` — *mission / season*

`season.js:415-419` blends `skyTop`, `skyMid` and `skyHaze` toward `MARS` (at that exact point in the function for the documented reason), and the later Mars block at 605-620 does the ground, grass, rock and fog. But `skyGlow` and `skyCounter` — the horizon glow aimed at the sun's bearing and the counter-glow behind you, computed at 448-449 and handed to `sky.setColors` at 455 — are never Mars-blended, and they also feed `cloud`, `cloudShade` and `cloudBase`. The clock keeps running on Mars, so the first sunset there paints Earth's seven-stop warm ramp across a butterscotch sky. Real Mars inverts it: the dust forward-scatters blue, so the sky is butterscotch and the sun's halo at sunset is cold blue. Same fault class as 'it landed on a world with orange fog under a blue sky', surviving in the one sky term nobody checked.

**47. Read the per-star size that is already computed and uploaded**  
`small` · `medium impact` — *sky*

`sky.js:288` fills `sz[i] = rng.range(0.6, 2.6)` for all 420 stars and `sky.js:292` uploads it as an `aSize` attribute, but the material is a plain `PointsMaterial` (`sky.js:293-303`) which has no idea the attribute exists — every star renders at exactly `radius * 0.012`, and the constellations' 'bright' points are a second fixed size (`sky.js:396`). A star field with one magnitude reads as a tiled texture; a scattering of magnitudes is most of what makes stars look far away. One `onBeforeCompile` multiplying `gl_PointSize` by `aSize` is the whole fix, and the variation was authored, paid for and discarded at upload.

**48. Let a cloud cross the moon**  
`small` · `medium impact` — *sky*

`season.js:512` asks `sky.sunOcclusion(state.sunDir)` unconditionally. After dark the sun is under the horizon and every cloud is above 7.4° (`clouds.js:201`), so `cover` is exactly zero all night and `shadeDip` multiplies the moon key by 1.0 until dawn. Passing `state.keyIsSun ? state.sunDir : state.moonDir` costs nothing and reuses the whole existing damped path — `state.keyIsSun` is already set at `season.js:387`. HANDOVER records that a moonlit night is lit by a real directional key casting real shadows; a cloud taking it away for a few seconds is the same effect the daytime already has, and it is far more noticeable at night because the moon key is the only light there is.

**49. Slow the shooting stars by an order of magnitude — there are six or seven a night**  
`small` · `medium impact` — *sky*

`sky.js:622-625` gates the meteor on `nightNow > 0.85`, and `nightNow` is `dark` (`season.js:357-358`, passed in as `night: dk` at :465), not `night`. `dark > 0.85` means `alt < -0.235`, which with the phase warp is ~85 s of a 240 s day — about 71 % of the whole night rather than its deepest part — and `meteor.wait = 6 + Math.random() * 14` is a mean gap of 13 s, so 4.6 a minute and 6-7 a night. Gate on `state.night` instead (night > 0.85 is ~27 s a day, genuinely the small hours) and put the gap in tens of seconds. This is HANDOVER §4's 'an animation rate is not an utterance rate' in a different file: the whole value of a shooting star is that you might miss it.

**50. Roll the rainbow in his tangent frame, not the world's**  
`small` · `medium impact` — *sky*

`sky.js:552` calls `rainbow.lookAt(group.position)`, and `Object3D.lookAt` builds its basis against `this.up` — the default world +Y — and only then divides out the parent's rotation, so the arch's roll is fixed against WORLD up while its feet are placed in group space (`sky.js:550-551` sets a flat `_anti` and `y = -radius * 0.06`, both in his frame). The sky group carries his tangent basis, so the bow tips over by up to ninety degrees depending where on the planet he stands: exactly the family HANDOVER §4 names. Secondary: the whole block (545-557) runs before the group quaternion is written at 567-570, and `lookAt` calls `updateWorldMatrix`, so it also reads last frame's rotation. Invisible today only because the rainbow can never fire — fix it in the same change as the wet edge, or the one advertised reward arrives lying on its side.


### 51–75 · polish and depth

**51. Let the hoglet look at him — it passes `lookYaw: 0` two lines after computing the bearing**  
`small` · `medium impact` — *hoglet*

`hoglet.js:129` hands the animator `lookYaw: 0` every frame, so the follower's features are locked dead ahead for its whole life, while the bearing to him is already computed at `hoglet.js:106` for the steering and the model it was built from carries `setLook`'s clamped ±0.5 rad glance. The whole idea of the hoglet is that it watches the one ahead — its header says so, and the second one follows the first for the same reason. One line, and it is most of what would make it read as attentive rather than as a smaller copy of him on rails.

**52. Wire the lean, and delete four never-written fields**  
`small` · `medium impact` — *hog*

`this.lean` (`hog.js:131`) is multiplied into the body pitch in `seat()` at `hog.js:691` and assigned nowhere, so it is permanently zero — the transform for leaning into a start and settling out of a stop exists and has no input, while `_steer`'s own comment says the gait 'eases in and out, so he leans into a start and settles out of a stop'. One damped number off the frame-to-frame change in `gait * speed` puts weight into every start, stop and thump into a fence. The same sweep turns up `bob` (declared 130, read in `seat` at 672, never written), `legSpeed` (116, referenced nowhere in src), `stride` (129, written at 401 and never read) and `snuffle` (143, damped in `idle` at 624 and read by nobody; `anim.js:364` computes its own) — worth deleting so the next reader does not assume they mean something.

**53. Let him raise his spines — the coat never moves except to tuck**  
`small` · `medium impact` — *hog / anim*

Nothing in the animator touches the three quill coats except the uniform `tuck` scale and the rain-darkening of their materials; `anim.js` never reads `s.hurt`, `s.repel` or `s.blocked` at all, and the only hurt feedback in the game is `chase.js:218`'s camera tremble. The coats are children of `trunk` (`model.js:462-470`) and every quill root is pushed 4 mm under the skin (`model.js:420`), so scaling the coat meshes 1.02-1.04 about the body centre lifts all 371 needles at once — at 1.03 the roots sit at 0.989 of a body radius, still under the 1.012 mantle shell. The trigger is nearly free: `checkThorns` (`game.js:671-678`) already loops every live bramble computing `distance`, so a 'near' band is one extra comparison. Bristling is the natural half-step between walking about and the full curl, and it would give the hazards the only anticipation they have.

**54. Pressing into an obstacle has no visual answer — he walks on the spot in silence**  
`small` · `medium impact` — *readability*

`hog.js:549-559`: a refused step increments `blocked` and after 1.1 s calls `onGrumble`, which is `audio.grumble()` (`main.js:274`), gated at `VOICE.grumble = 0.7` behind a 2.4 s own-gap and the shared voice clock (`audio.js:382-389`). Meanwhile `hog.js:291` damps `gait` toward `want * facing` with no blocked term, so the legs keep cycling at full stride against a fence. The only visual anywhere on `blocked` is `main.js:746` — a leaf burst, in the wood, only when `leafFall > 0.15`. HANDOVER's keys section says 'a dead-on press should stop and complain, because that is what an animal does', and the complaining half is audio-only, 30 % likely to be refused, mutable, silent before the first gesture and at best 1.1 s late. A scuff puff at his feet (`puffs.burst` is already wired for footfalls two lines away) or ears flattening on `blocked > 0.3`.

**55. Vary the noise buffer's read offset — every one-shot reads the same 80 ms of white noise**  
`small` · `medium impact` — *sound*

`noiseBuffer` is built once at unlock and `puff()` starts it at offset 0 every time (`audio.js:255` — `src.start(t)`), so every footfall, snuffle, chunter, hop, landing, sneeze, lap, tuck and unfurl reads the identical waveform, varied only by the ±10 % `playbackRate` at 244 and the filter. `noiseVoice`'s `src.start()` (line 120) likewise takes no offset, so the four beds loop the same two seconds in lockstep — though their filters are largely disjoint, so that half matters much less. Fix is `src.start(t, rng.next() * 1.9)` in both places; the buffer is 2 s and the longest puff is 0.3 s. The file's opening paragraph is about refusing to staple a sample onto a drawn world, and the one-shot path is one fixed fragment played several hundred times a minute — most of why footfalls read as a repeat rather than as feet.

**56. Footfalls know the weather and not the ground, and the caller has the surface in hand**  
`small` · `medium impact` · *already on the backlog* — *sound*

`main.js:252` calls `audio.footfall(s.wet)` — one number — and `footfall` (`audio.js:260`) lerps two frequencies off it. Three lines below the call, main.js is already branching on snow/wet/dry to pick the dust puff, `hog.afloat` and `hog.under` are in scope, `placeKindAt` is imported at `main.js:14` and `hardAt` is one export away at `plan.js:375`. So the boat deck, the tarmac, the town's paving, the launch concrete, the culvert (which should ring) and lying snow are all the same soft tick. Note the original diagnosis was inverted: `state.wet` is high while it snows, so the fault shows on lying snow after a front clears — deep `state.snow`, `state.wet` near zero, and he gets the brightest driest tick the function can make. `swish` (`audio.js:558`) has the same gap: he swishes through grass on the road, the paving and the pad.

**57. Nothing rustles — the quills are the whole character and they have no sound**  
`small` · `medium impact` — *sound*

The tuck and the unfurl are a plain filtered whoosh at `audio.js:581-582`; a hedgehog curling is a dry rattle of hundreds of spines against each other. And `s.shake` — the shake-off the game deliberately earns when a front clears (`main.js:770-771`, gated on five seconds of wet) — has no callback in `anim.js` at all: line 166 reads it and drives `shakeRoll` at 306, and nothing tells the audio. `anim.js` has an `onSneeze` hook at 202 and no equivalent for the shake, the yawn, the scratch, the arrival wiggle or the balk head-shake. One `quills(amount)` — a short burst of very dense, very short high-bandpass grains — serves the curl, the shake-off, the sneeze and brushing through a cane: four events for one function, and the shake-off is the game's own reward for standing out in the rain.

**58. `home()` plays for three unrelated events, one of them backwards**  
`small` · `medium impact` — *sound*

The same four-note phrase fires for finding a golden thistle (`game.js:320`), reaching the burrow (`game.js:861`) and climbing into the rocket (`mission.js:603`) — the last semantically inverted, a coming-home cadence at the moment he leaves the planet for good. Meanwhile `wound()` running the hearts to zero (`game.js:709-715`) resets the leg to 1, the speed to `HOG_SPD` and the thorn density to 0.18 — the only real setback in the game — and plays exactly the same `hurt()` as any single thorn, so a leg reset and a scratch are indistinguishable. There are about eight musical moments in the whole game and three of them are the same one. Four distinct cadences off the existing `SCALE` and `MODES` tables: a small find, a proper arrival, a rising figure for the launch, a falling one for the reset.

**59. Split the roll and the traffic — a passing car bends the pitch of his own roll**  
`small` · `medium impact` — *sound*

`audio.js:577-578`: `rumble.g.gain = rolling * 0.14 + carAmt² * 0.05` and `rumble.f.frequency = 120 + rolling * 130 + carAmt * 260 + doppler * carAmt`. One lowpassed noise bus carries a tucked hedgehog rolling downhill and a car on the road, so a lorry passing while he is in a ball shifts the cutoff of his own roll by up to 400 Hz on a filter whose whole range is 120-250, and the two events are literally the same sound at different settings. It is also why the traffic can never be panned — panning that bus pans his roll with it. The roll is his signature move and `hog.momentum` has just made it something you commit to; the road is a hazard you are meant to hear coming. Two buses instead of one, and the car's is then free to take a bearing.

**60. Suspend the audio context when the tab is hidden — every bed plays forever**  
`small` · `medium impact` · *already on the backlog* — *sound*

There is no `visibilitychange` handler anywhere in `src/` and `ctx.suspend()` is never called (only `resume`, at `audio.js:208`). rAF stops in a hidden tab so `update` stops being called and every `setTargetAtTime` holds its last target: wind, rain, crickets, cicadas, lake and swish keep playing at whatever level they were at, indefinitely — tab away mid-roll and `rumble.g.gain` holds at 0.14 and the ball rumbles under your other tabs for as long as you leave it. Chrome does not throttle audio in background tabs, only rAF. This is the answer to NEXT Sound #4 ('check what stays running while muted or off screen') and the answer is: all of it. Four lines, and it matters twice as much now the touch layer has shipped.

**61. Stop clamping `aDeep` at zero: the drawn waterline overshoots the real one by up to 1.5 m**  
`small` · `medium impact` — *terrain / water mesh*

`ground.js:226` bakes `Math.max(0, WATER_Y - heightAt(...))`, so every dry vertex reads exactly 0 and the information needed to locate the crossing inside a cell is thrown away. With `RINGS = 16` over `RAD = 15` the radial cell is 0.94 m, so the alpha cut `smoothstep(0.004, 0.05, vDeep)` (`ground.js:272`) fires only in the last few centimetres of the interpolation from the last wet vertex. Reproducing the mesh's own interpolation over all 56 segments against `lakeShore`: the drawn edge sits 0.66 m outside the true waterline on average and 1.50 m at worst. Removing the clamp is safe in all three shader terms — `shallow`, `foam` and the alpha all saturate correctly below zero — and raising `RINGS` to ~32 tightens it further. This is separate from the missing `lakeAt` gate; fixing one leaves the other.

**62. The harness's cliff assertion only ever steps east — half the compass is unmeasured**  
`small` · `medium impact` — *terrain / harness*

`smoke.js:269-277` measures `|heightAt(x + e, z) - heightAt(x, z)|` with `e = 0.4 / cos(lat)` and never steps in z, so 'no cliffs anywhere he can stand' has only ever seen east-west gradients. Measured both ways plus eight bearings over 40 000 walkable samples: east-west 0.160 m per 0.4 m (exactly what the harness reports), north-south 0.144, and the true worst in any direction 0.172 — a 22 % margin against the 0.22 ceiling with half the compass unmeasured. The worst sample is 10.9 m from the lake's centre, corroborating `lakeForm`'s own note that the basin already spends 0.152 of the ceiling on its rim. HANDOVER §4 names this assertion as the thing that keeps the relief self-limiting, since `walkableAt` refuses water and nothing else. Sweeping eight bearings inside the existing loop is four lines.

**63. Strike NEXT World #4 — every place owns its own relief now**  
`small` · `medium impact` — *backlog hygiene*

'No place owns its own relief. The terrain rolls identically everywhere; the mire should be flat and low and the hillside actually steep' is still at rank 4 of the World workstream (`NEXT.md:79-80`), and `terrain.js:123-368` landed ten hand-drawn landforms at commit d111492, each faded by its own weight with a written rationale, plus `reliefMask` holding the mire, farm, hens and town down. Measured over 900 samples within 20 m of each centre: the mire is the flattest place on the planet (1.03 m range, 0.052 mean gradient), the hen run next (1.54 / 0.051), against the wood at 2.36 m above datum / 0.152 and the meadow's 3.50 m range. Nothing in NEXT.md has been struck, and only instanced brambles and grass LOD sit above it — so an unattended run is one or two turns from rebuilding ten landforms that already exist.

**64. Strike 'post-rain glints on the quills' — it is built and shipping**  
`small` · `low impact` — *backlog hygiene*

NEXT Graphics item 3 asks for wet-quill glints for the thirty seconds after a front clears; they exist. `main.js:513-540` builds 14 additive points scattered over the mantle region as children of `hog.parts.trunk`, and `main.js:860-864` drives their opacity off `climate.state.wet`, drying over 32 seconds and hiding while he is under the culvert. NEXT's own preamble records that the backlog went a whole session stale and the next run nearly rebuilt existing work; this is the same trap re-armed in the hedgepig's own neighbourhood. Worth a glance while striking it: the glints are placed on hard-coded half-axes 0.134/0.082/0.091 rather than off `HOG_BODY`, which is the literal-number-to-find-his-body pattern HANDOVER §4 records biting four features already.

**65. The badger has no catchlight, and his is the largest face in the game**  
`small` · `medium impact` — *residents*

`characters.js:287-300` builds a surface-placed additive catchlight and both `robinModel` (498) and `mouseModel` (640) call it; `badgerModel` does not — his eyes are bare 8.5 mm dark spheres (`characters.js:373-379`). The comment at 262-267 makes it a decision about size ('the eyes of the two small ones'), but he is the largest animal in the world that is not a building and you meet him at half a metre. HANDOVER §4 records what a buried catchlight cost on the hedgepig: both eyes read as flat black holes and the face died. The badger's entire design is that he wakes as you approach — near eye first, far eye a second behind, called 'the single detail this whole animal is for' at `characters.js:786` — and that beat lands on two black dots. One wrinkle: the wake/blink scales the eye meshes themselves (795-796), so the spark has to scale or hide with the lid.

**66. Let the residents' lines see the game — `_talkState` carries only hearts and found**  
`small` · `medium impact` — *dialogue*

`main.js:621`: `Object.assign(_talkState, state, { hearts: game.state.hearts, found: game.state.found })`, so no predicate can ask about `leg`, `met`, `visited`, the hoglets, the journal or whether he has been to Mars — all of it in `game.state` one object away. The residents cross-reference each other in the written lines ('i knew the badger when he was only very old') but no line can know whether you have met him, and nothing ever notices the two hoglets walking behind him. The same gap is why nobody has a first-meeting line: the badger's opening sentence in your first ever game is 'you again. good.' (`characters.js:147`), even though `speakTo` calls `game.meet(c.key)` four lines later and already knows it is news. The predicate helpers at `characters.js:63-73` are three lines each, plus one extra `Object.assign`.

**67. The toad vanishes under snow while her compass dot goes on pointing at her**  
`small` · `low impact` — *residents / compass*

`characters.js:937`: `seen = near < SEE && !(c.key === 'toad' && snow > 0.5)` — she is simply not drawn, and `nearest()` skips her because it requires `obj.visible` (`characters.js:966`). Meanwhile `main.js:952-958` maps all four residents onto the compass ring unconditionally off their live x, z, so her red dot stays solid and points at an empty deadfall. Snow accumulates at 0.045/s and melts (`season.js:314-316`), so this is a state you walk into and out of with nothing said either way, and while it holds, `everyone` — the journal note for having met all four — is silently unobtainable. Two cheap halves: give the compass an `away` state so an absent resident goes faint rather than lying, and let her announce the retreat by gating a farewell on rising snow.

**68. Two things that emit light are still normal-blended: the owl's eyes and the firefly lantern**  
`small` · `low impact` — *critters / render*

`critters.js:258-261` builds the owl's eyes as `MeshBasicMaterial({ color: 0xffe9a0, opacity: 0.9, depthWrite: false, fog: false })` with no `blending`, and `main.js:551-556` builds the three firefly motes the same way — while the lantern pool six lines below at 561-568 is correctly additive, as are the stars, the constellations and the residents' catchlights. HANDOVER §5 states the rule as absolute and names fireflies in it: anything representing emitted light must be additive, because normal blending is a paint and can darken what is behind it. The sweep that fixed the constellations, the dew and the catchlights missed these two. It matters most for the lantern he carries against a dusk or moonlit-snow sky, where a 0.9-opacity pale disc subtracts from the sky it sits on. One word in each place.

**69. Make the sun's and moon's halos additive — the project's own rule says they must be**  
`small` · `low impact` — *render / sky*

`sky.js:255-271`: both halos are `flat()` → `MeshBasicMaterial` with default `NormalBlending`, 0xfff2d0 at 0.30 and 0xdfe8ff at up to 0.22. Checked in linear, the sun's halo over the brightest haze (0xf4f2df) pulls the blue channel from 0.745 down to 0.713, and the moon's pale-blue halo over a warm twilight pulls red down and lifts green and blue — a grey wash round the moon on an orange sky, which is exactly the constellation fault HANDOVER records. Everything else star-shaped was converted; these two were missed and they are the two attached to the actual light sources. NEXT Graphics #2b wants bloom so the sun reads as a source; before adding a pass, the painted halo should at least be incapable of subtracting light. The opacities need re-tuning on the way — additive at 0.30 over a 0.9-linear day sky clips.

**70. Every transparent overlay writes into the grass ink mask**  
`small` · `low impact` — *render / post*

`grass.js:193-196` writes `gl_FragColor.a = 0.0` and argues it is safe because 'these are opaque, blending is off' — true of the grass, false of everything drawn after it. Three's `NormalBlending` with `premultipliedAlpha` false uses `blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`, so destination alpha is overwritten toward the source's: rain (`weather.js:152-154, 231` — 2600 LineSegments at opacity 0.6) lifts destination alpha to 0.6 on every streak pixel, taking the ink from `mix(0.20, 1.0, 0.0) = 0.20` to 0.68, 3.4× more ink on the grass behind it. Snow, leaf-fall and petals do the same at their soft fringes, and `AdditiveBlending` (`weather.js:247, 251`) simply accumulates destination alpha toward 1, so a glint drifting over the meadow at night gives the grass under it full ink. Fix with `CustomBlending`, `blendSrcAlpha = ZeroFactor`, `blendDstAlpha = OneFactor` on the handful of overlay materials.

**71. `pipeline.enabled.grade` is never read — the G key does nothing**  
`small` · `low impact` — *render / post*

`post.js:377-380` runs the grade quad unconditionally; only `enabled.ink` (370) and `enabled.fxaa` (378, 382) are ever tested, while `main.js:378` binds `G` to toggle `enabled.grade` and `main.js:376` comments the pair as 'two quiet toggles, for seeing what the ink and the grade actually do'. Half of that is a no-op. It has survived because skipping the grade also skips the only `linearToSRGB` in the chain (`post.js:184`), so the naive fix hands you a near-black frame — the honest version is a bypass quad that just encodes. The grade is where the golden hour, the night blend and the wet desaturation all land, and a debug affordance that silently lies is worse than not having one.

**72. `sky.setOrbit` is undone by `sky.update` on the very next frame**  
`small` · `medium impact` — *render / sky*

`sky.js:640-643` sets `group.position.set(0,0,0)` and `quaternion.identity()` for orbit view, and `sky.js:536` then does `group.position.copy(camera.position)` unconditionally at the top of every `update`, which `main.js:923` calls after the orbit branch every frame. So the 26 solid cumulus, the dome, the stars and both discs re-centre on an orbit camera 148 m off the planet: at `radius = 260` the clouds sit 151-255 m from that camera while the globe spans 100-196 m along the same axis, hanging in space around the limb. `main.js:923` also passes `sky` and `basis` as null in orbit, so `_sunDir` is never refreshed while the quaternion has just been reset to identity — the drawn sun sits at a stale tangent-frame direction read as a world one, while the orbit key light is hand-placed at a fixed `(-1.05, 0.95, 0.75)` (`main.js:905`). `smoke.js:1229` asserts a state that survives exactly one frame. P is the postcard view.

**73. Drop the tint hex from the cel program cache key — and NEXT blames the wrong thing**  
`small` · `medium impact` — *render / materials*

`toon.js:84`: `mat.customProgramCacheKey = () => 'celTint_' + hex`. Three r180 pushes that string into the program cache key unconditionally (`three.module.js:7138, 7188`), so every distinct tint links its own WebGLProgram — 75 distinct `tint: 0x…` literals across `src`. The shader source is byte-identical for all of them (`patchedChunk` is a module-level constant at `toon.js:60-68` and the tint arrives as a plain uniform), so the key buys nothing and is stale by construction anyway because `setShadowTint` rewrites the uniform without touching it. NEXT's debt note blames the 101-program count on 'every `cache: false` material is its own program', which is wrong — programs are keyed by parameters, not identity. A constant `'celTint'` collapses the family to the handful of real variants. `grass.js:199` does the same on its wind material.

**74. Move the paper grain after the sRGB encode and into the final pass**  
`small` · `medium impact` — *render / post*

`post.js:182-185` adds the grain in linear space and then encodes: `c += (g-0.5)*uGrain; gl_FragColor = vec4(linearToSRGB(max(c, 0.0)), 1.0)`. A fixed ±0.009 linear offset is ~7× stronger perceptually at c=0.03 than at c=0.8, so the grain is heavy in the shade and barely present in the sky, and `max(c, 0.0)` clips the negative half in the darks into a brightening bias. It is then FXAA'd (`post.js:378-383`) by a pass with no contrast early-out — the standard `if (lumaMax - lumaMin < threshold) return cM;` is absent — so `dir` is computed straight from grain noise on flat surfaces and, with `reduce` bottoming out at 1/128 (`post.js:218`), clamps near 2 texels in the darks: a directional blur steered by noise. Doing it last and post-encode fixes all three and doubles as the dither the 8-bit output lacks (NEXT Graphics #5's sky-banding half).

**75. Aerial perspective is now nearly free — the depth texture is already produced and bound**  
`small` · `medium impact` · *already on the backlog* — *render / post*

NEXT Graphics #6 wants distant things to desaturate and lift rather than just tint. What has changed since it was written is that the pipeline already creates `rtScene.depthTexture` and binds it for the ink pass (`post.js:264-268, 281`). Handing the same texture plus `uNear`/`uFar` to the grade quad and adding a depth-driven desaturate-and-lift is a few lines in `post.js`, needs no change to any material or to `season.js`, and reaches everything including the `fog: false` objects (the rocket, the tower). It composes with the ink-fade item: the line thins and the colour flattens over the same range, which is what a background painter does. The enabling work landed for a different reason and nobody re-ranked it.


### 76–100 · the long tail

**76. Lean the falling snow, leaves and petals with the wind**  
`small` · `medium impact` — *weather*

`Field.update` (`weather.js:85-98`) applies only a per-particle sine drift on x and z. The whole-field lean lives in `RainField.update` (`weather.js:182-186`) and nowhere else — `weather.js:284` computes a gust and hands it to `rain.update` alone, while `weather.js:278-280` calls `f.update(dt, _origin, b, t)` for snow, leaves, petals, motes and flies with no wind argument at all. So in a blizzard the snow drops dead vertical past grass bent double, and autumn leaves in a gale wander gently downward. HANDOVER's own note is that rain does not wobble and the wind leans all of it at once; the second half applies to snow and leaves too, off the same two parameters computed one line away. It is the cheapest way to make a gust visible rather than only audible, and Sound 3 wants the gust to have a voice — this gives it a face.

**77. Make the rain land on something**  
`medium` · `medium impact` — *weather*

`RainField.update` recycles a streak the instant its head passes -1.2 (`weather.js:200`) and the field origin is seated at `hog.y + 1.2` (`weather.js:277`), so -1.2 is precisely ground level: streaks stop dead and nothing happens. In the heaviest weather the world can make there is no splash, no ring, no dimple on the lake sheet, no drip off a canopy or the culvert mouth — the lake is glassy in a downpour, which is the one surface a viewer's eye goes looking at. `critters.splash(x, z)` is already built and exported (`critters.js:213, 1006`) with a ring pool behind it, and the tap ripple in `main.js:152` already seats itself on the planet. One wrinkle: the recycle test is a plane at the field origin's height, not `heightAt`, so a splash spawned there wants seating on the real ground. The rain was rebuilt from 420 dots to 2600 streaks specifically because you could not see it; it is visible now and still does not touch the world.

**78. The meadow has one thing to meet and the mushroom garden has none**  
`small` · `medium impact` — *places / content*

Counted off the built world, interactables per place are town 10, roadside 6, garden 3, hen run 3, farmyard 3, wood 2, mire 2, lake 1, meadow 1, mushroom garden 0. The meadow is the largest and densest place — a ridge, a hollow, a wall along a measured contour, two hedge stumps, a fallen log, seed heads, thistles, tussocks, molehills — and carries only the hare's form (`green.js:980`). The mushroom garden is the second-richest geometrically (three fairy rings, four fungus-covered log runs, moss, deep litter) and carries nothing; `critters.js` also anchors to eight places and never to MGARD, so it has no pinned life either. Four `ctx.interact` calls in the meadow (the gap in the wall, the hedge stump, the log, the top of the ridge) and two in the garden cost nothing and give the ridge a payoff for climbing it — the fairy rings are described in their own comment as 'the only shape in the world that says somebody comes here'.

**79. The road is only dangerous within 36 m of the culvert — 24 % of its own ring**  
`medium` · `medium impact` — *places / road*

Cars spawn at `CULVERT_ALONG - dir * 34` and despawn past 36 m (`road.js:841, 850`), and `CULVERT_ALONG = 0` is the roadside's centre, which is where the culvert mouths are. `checkCars` (`game.js:680-697`) is the only road hazard there is, so traffic lives on 72 m of the 300 m lap and the other 228 m can be strolled across for nothing — including the whole stretch through the town, as the comment at `road.js:1100-1102` already notes. Cars are one of the game's two hazards and they are absent from three quarters of the object they belong to. The fix is the rule this codebase applies to everything else — range off him: stream the spawn origin off `roadAlong(hog)` instead of a constant, keeping the 34 m spawn distance so nothing fades up in view. That makes the culvert the earned safe crossing it was built to be. Re-check `roadmiss`, which HANDOVER already flags as order-dependent.

**80. Only 54 m of the 300 m road ring is dressed; the other 82 % is paint on bare tarmac**  
`medium` · `medium impact` · *already on the backlog* — *places / road*

The tarmac, kerbs, centre line, edge lines and wear all run the full lap (`road.js:358-478`), but everything else stops within about 27 m of the roadside's centre: `VERGE_RUN = 27` (533), `HEDGE_RUN = 26` (626), `roadScatter` samples s in -24..24 (773), and the culvert, milestone, sign, fingerpost, drain and litter are all inside 19 m. The obvious fix is not one loop bound — the sward is a single `InstancedMesh` whose frustum culling depends on its bound being local (`road.js:588-595`), so running it round the ring needs chunking like `grass.js`, and running the hedges round would add ~500 blockers to a `blockedAt` already carrying 493. Chunked sward plus the thistle band all the way round — no blockers, no new geometry — dresses a tenth of the world's surface and gives the walk between places a line to follow.

**81. Three quarters of the town's paving is on the side of the street with nothing on it**  
`medium` · `medium impact` · *already on the backlog* — *places / town*

The paving slots (`road.js:1156-1166`) exclude the carriageway (`|off| < 5.12`) and everything behind the garden walls (`off < -6.4`), which leaves a 1.3 m strip in front of the terrace and the entire far side out to the 10 m disc edge — roughly four times the area. On that far side there is a 40-brick low wall at `WALL2_Q = 6.4`, one lamp post at q = +5.6 and the sleeping cat; everything else the town owns (three fronts, three gardens, gates, bin, bicycle, washing, both milk bottles, the other lamp, 8 of its 10 interactables) is on the terrace side. It is also the flattest built ground in the world (`townForm` spans 1.57 m). Arrive from the meadow and you land on a large empty paved apron with a wall at the end of it. The far pavement is where a town's public furniture goes — postbox, phone box, bus stop with a step, bench, drain — and anything there stands square without a landform fight.

**82. Make the hoglet obey blockers and platforms — it walks through every solid thing**  
`medium` · `medium impact` — *hoglet*

`hoglet.js:118-120` tests `walkableAt(nx, nz)` only, which refuses water and nothing else (`terrain.js:434`); it never consults `world.blockedAt` — `createHoglet(scene, opts)` is not even handed `world` (`main.js:122-123`) — so it clips through brambles, fences, walls, sown snowmen and the launch mount, cutting the corner he walked round a tree and passing through the trunk. It never reads `platformAt` either, setting `h.y = heightAt(...)` flat, so it stands inside the log he just hopped onto. And its fallback is the axis-freeing retry that `hog.js:521-542` documents at length as broken on a globe: walking due east, the second test is the spot it already occupies. From leg 3 there are two hoglets on screen behind him for most of the game. `blockedAt(x, z, fx, fz, y)` already takes a from-position and refuses only deeper moves, so it can be reused unchanged.

**83. Animate the hop: nothing outside hog.js reads `air`, `vy` or `landed`**  
`medium` · `medium impact` — *hog / anim*

`this.landed` (declared `hog.js:165` with the comment 'for the squash', set at 603, advanced at 618) is read nowhere in the codebase, and `air` and `vy` are referenced only inside `hog.js` and in the harness's own setup (`smoke.js:1473, 1513`). So the hop is pure translation of `this.y`: the legs keep running the walk cycle in the air, there is no crouch before the push, no tuck at the top, no reach for the ground on the way down, no squash on landing, and `onLand` (`main.js:276`) adds a sound and a dust puff and nothing else. The hop exists to get him onto a stump, and it looks like the whole hedgehog being lifted by an invisible hand. `anim.js:129-136` already argues for anticipation and follow-through by name and builds them for the tuck; the state to key the same two frames is computed every frame and thrown away, with a field named for the job.

**84. The residents have 78 lines, not the 160 the docs claim, and one visit exhausts a character**  
`medium` · `medium impact` — *residents / content*

Counted from `characters.js:137-254`: badger 12 general + 7 conditional, robin 14+7, toad 12+6, mouse 13+7 — 78 lines, against the 'forty lines each' (160) in HANDOVER §4 and in three run-log entries. In plain weather no conditional fits, so only the general pool rotates: at `TALK_GAP = 5.5` (`main.js:610`) the badger is exhausted in 66 s and the robin in 77, after which it repeats verbatim in the same authored order. The rotation index `i` lives in a closure with no persistence, so every reload restarts each character at line 1. A resident is a destination and the value of a destination is that going back gets you something; one uninterrupted visit is less than the pool. General lines are the cheapest content in the codebase — pure data in one table — and doubling each pool is what makes the third visit worth making.

**85. Give the four residents a call of their own — meeting a badger is silent throughout**  
`medium` · `medium impact` — *sound / residents*

`speakTo` (`main.js:619-631`) opens the dialogue panel with no `audio` call at all, and `world/characters.js` — 974 lines, four pinned animals — contains not one audio reference; neither does `core/dialogue.js`. Note the constraint: `dialogue.js:6` refuses 'no portrait, no border, no sound, no box within a box', which is a list of visual-novel chrome, so leave the panel alone. What is missing is the animal's own call, which is world and not UI: a greeting when he comes into `TEMPER.talk` range, panned by bearing the way the owl already is. `hoot(pan)` is already a two-blip call in that shape, `birdPhrase` is very nearly the robin, `createVoiceGate` (`audio.js:76`) already exists to stop an animal talking over itself, and `TEMPER` (`characters.js:669`) is where a per-animal timbre hangs. Pointedly, the robin's own line says 'that is why you know my voice and not theirs'. The 16 bees at `critters.js:665-686` also fly past a camera 0.19 m up without a hum.

**86. The owl never takes the mouse, and the mouse will not stop talking about it**  
`medium` · `medium impact` — *critters / residents*

The owl is two lit eyes in the wood (`critters.js:254-273`), lit when `night > 0.6` and hooting on a timer through `audio.hoot(pan)`. The wood mouse lives ~10.3 m away at (-6.8, 3.4) off the wood centre, and four of her lines are about it: 'there is an owl. there is always an owl. i am telling everyone.' (`characters.js:233`), 'this is my time. it is also the owl's time. we share it very badly.' (245). Nothing connects the two — `critters.update` and `characters.update` run in the same frame from the same `world.update` and neither knows the other exists. A hoot she answers — freezing mid-dart (the freeze pose exists at `characters.js:898-906`), vanishing into the litter for half a minute, coming back with a line about it — is one hook between two files, and it is the only thing on the table where night stops being a palette (Gameplay #5) and becomes a fact about somebody's life.

**87. The snails and the molehills never got the streaming the butterflies got**  
`medium` · `medium impact` — *critters*

Two snails are anchored inside ±5 m of the butterfly garden (`critters.js:346-364`) and drawn only while `damp > 0.25`, which rises during rain and decays at `dt/45` — about 34 s of grace after a front clears. Three molehills are anchored inside ±8 m of the meadow centre and do not appear until 200/400/600 s of `lived`, a plain accumulator declared at `critters.js:537` and never persisted. Neither species is ever re-homed near him; `nearbySpot` is used only by the butterflies and bees. This is HANDOVER's own mandated question — how often will you be standing near one — applied to the species the butterfly sweep did not reach: rain hurries him along and he does not shelter, so the conditions that produce a snail are the conditions that move him elsewhere from the one place in ten where snails exist. And NEXT World 5 calls molehills one of the world's only two memories, which is not true of a counter that restarts every reload.

**88. One `panFor(x, z)` helper — the owl is the only thing that comes from a direction**  
`medium` · `medium impact` — *sound*

`blip` supports `pan` (`audio.js:214`) and exactly one caller computes a real bearing: `main.js:113-115` pans the hoot by `sin(atan2(owl.z - hog.z, owl.x - hog.x) - chase.yaw)`. Everything else is centre — the lake bed, the hens' `squawk`, the frogs' `plip`, the fish rises, the four residents and the rocket. `birdPhrase` (`audio.js:484`) picks a random pan unrelated to the bird actually flying over, and `puff` has no `pan` option at all, so nothing noise-based can be placed even in principle. The one missing input is the listener's heading: `audio.update` is handed `(dt, hog, state, world)` and not `chase.yaw`. On a planet where the horizon is 11 m, sound is the only sense with any range, and it currently says nothing about direction. One helper, one extra argument, and a `pan` option on `puff`.

**89. The pad and the tower make no sound at any distance**  
`medium` · `medium impact` — *sound / starbase*

`places/starbase.js` builds 123 m of Starship, a 146 m Mechazilla and a tank farm, and none of it is audible from anywhere. The place-sound hook is the wrong tool — `ctx.sound` (`places/index.js:61`) has one caller in the entire build (a hen squawking at `farm.js:514`) and carries no level. The right shape is the one the lake already uses at `audio.js:551-555`: a bed whose gain is `clamp(1 - distanceTo(CENTRE[PAD]) / range)` squared, computed in `update` where `hog.x/z` and `CENTRE` are already to hand. A slow cryogenic vent hiss and wind through a 146 m lattice, at a pitch nothing else in the world uses. NEXT already carries 'the pad is scenery'; the cheapest half of it is audible rather than interactive, and HANDOVER is proud that the stack comes up over the horizon like a mast — hearing it before it clears the curve is the same idea a beat earlier.

**90. The hoglets have never made a sound**  
`small` · `low impact` — *sound*

`game/hoglet.js` contains zero audio references. Both hoglets — one from leg 3, one from leg 6 — arrive, walk and catch up in complete silence, and `hoglet.update` already returns `'arrived'` (consumed at `main.js:807` and 816) so there is a clean once-only edge for the first cue. Note what not to build: `hoglet.js:95-96` records that a hoglet left too far behind simply turns up again, because 'a lost hoglet is a sad mechanic, not a fun one' — a falling-behind cue would advertise a stake that deliberately does not exist. An arrival peep, and an occasional answering one when he speaks, is the whole of it. `peep()` transposed up a fourth is a hoglet: one function, and the first thing that would make the procession read as company rather than two props with pathfinding.

**91. Entry is unlit: the belly-flop has no plasma, glow, shake or sound**  
`medium` · `medium impact` — *mission*

`thrustAt('entry')` returns 0 (`mission.js:292`) and nothing is substituted, so 4.6 seconds of `entry` — the phase whose own docstring at `mission.js:251-257` calls belly-first 'the pose the vehicle is famous for and the reason the flip exists' — has no leading-edge glow, no plasma, no shake and no sound. The camera shot for it (`mission.js:412-417`) is level and side-on with Mars beyond, which is the right frame and currently holds nothing but a grey tube. The pieces are in the file: the additive unlit cone material written for the plume, `noseAt` knowing the tilt through the whole 1.35 → 1.62 rad sweep, and `1 - altAt(t)/900` as the ramp. An additive glow shell on the windward side is the same construction as the plume with a different aim. Deliberately not proposing shortening `coast`/`turn` — `TURN` is what pays for the palette swap.

**92. The mire has no water in it — 6.3 % of the planet is under the waterline and never asked**  
`medium` · `medium impact` — *terrain / water*

Sampled 80 000 area-weighted points: 7.9 % of the planet's surface sits below `WATER_Y` and 6.3 % of it is outside the lake disc entirely, because `waterDepthAt` (`terrain.js:419`) early-returns on `lakeAt <= 0`. So all the water in the world is one disc. The mire is the world's declared wet place and the address chosen for Starbase because 'Starbase stands on a coastal wetland', and its standing pools are `poolDisc` — 'a flat dark disc with a mud lip, and no depth at all' (`water.js:426`) — laid 3 cm over `heightAt`, which he walks straight through. A named `pondAt` in the shape of `lakeAt`, feeding `waterDepthAt` from a short explicit list of hollows rather than a global threshold, gives the mire, the mushroom garden's dish and the wood's hollow something to hold. It must be a list, not a threshold: 6 % of the planet turned no-go is a great deal of wall, and the route to the pad has to stay walkable.

**93. Freeze the lake in deep winter — the one wall in the world becoming a floor**  
`large` · `high impact` · *already on the backlog* — *terrain / season*

`season.js:589` already lerps the water colour toward `PAL.ice` once `state.snow > 0.45`, so in deep winter the lake visibly ices over — while `walkableAt` (`terrain.js:434-436`) still refuses anything with `waterDepthAt > 0.06`, the boat still floats and the frogs still work. `walkableAt` refuses water and nothing else, so the lake is the entire no-go list for the planet, and this is the only place the terrain itself can answer Gameplay #4's 'winter should close something and open something else'. Most of what it needs is contour rather than authored geometry — `lakeShore`, `aDeep`, the foam band and the shore props all come off the bed, so they thaw back for free. The real cost the obvious version understates: he seats on `heightAt` in two places (`hog.js:112, 586`) and so do the footprints and every `seat()` in game.js, so the honest shape is one seasonal `groundAt` that everything moves onto, not an ice special case bolted beside `heightAt`.

**94. Give the year a declination, so winter nights are long and the sunrise walks**  
`medium` · `medium impact` — *sky / season*

`sunDirAt`/`moonDirAt` (`season.js:113-132`) use a constant `TILT = 0.42` with no year term, so `alt = cos(solarPhase * TAU)` is positive for exactly half of every day of every year (smoke.js asserts it), and since the east-west component is `-sin(th)` the sun rises due east and sets due west on every single day. One declination term keyed to `state.yearPhase`, folded into the same great circle, gives short dark winter days, long summer evenings and a sunrise point that walks along the horizon. `nightAt`, `hourNameAt`, `dark`, `lum`, the key light and the moon all derive from `sunAltAt` and follow for free. Two things to watch: the same declination has to go into `moonDirAt` or the moon's elongation stops being its phase, and the harness check becomes 'half the daylight averaged over a year'. NEXT Gameplay 4 says seasons change what things look like and almost nothing else; this is the one change that makes the season change the clock.

**95. The road's grading corridor covers half the planet and takes a third of the wave field**  
`medium` · `medium impact` — *terrain*

`reliefMask` grades the wave field with `sstep(5.0, 26.0, |roadOffset|)` (`terrain.js:95`), widened from 4.7 m to 21 m to cure the 38° verge bank. A 52 m corridor round a 300 m lap is 15 600 m² of the planet's 28 650; sampled over 160 000 points the mean surviving mask is 0.692, 11 % of the surface is fully flattened and 49.5 % is suppressed to some degree — before the town/farm/hens/mire terms multiply in. The mask is applied to all six octaves equally, including the two planet-scale ones (a = 1.45 at λ ≈ 277 m, a = 0.95 at λ ≈ 152 m), and those are precisely the octaves a road can climb over without any cross-fall problem: a 277 m wave tilts a 9.6 m carriageway by under 2°. Mask per octave by wavelength — full suppression for the short ones, little or none for λ > ~120 m — and give the big swells back to the emptiest ground in the game. Re-run the harness's relief floor and its 0.22 m slope ceiling after touching this.

**96. The outline system is used on exactly one mesh, and 34 `noOutline` flags decorate nothing**  
`medium` · `medium impact` — *render / outline*

`hullOutline` has exactly one caller in the whole repo — `hog/model.js:101`, on his body — and `hullOutlineTree` (`outline.js:112-120`) has none. That makes all 34 scattered `userData.noOutline = true` flags dead intent: `props.js:327, 1082`, `characters.js:298, 419, 544`, eight sites in `critters.js`, six in `water.js`, `road.js:472-474, 585`, `farm.js:55, 262, 774`, `green.js:861`, `clouds.js:189`, `puffs.js:188`, `main.js:556, 571`, `game.js:454` and five more inside `model.js`. The file's own header says 'the hedgepig, the burrow and the cars want a heavier, deliberate line'; the burrow and the cars never got one. This also settles NEXT Graphics #7 ('check that `noOutline` and hull assignment survived the static merge') — there was no hull assignment on any world prop, so there was nothing to survive. Either give the burrow and the cars the line, or delete the tree walker and the flags.

**97. The arrival toast promises thicker brambles long after they stop thickening**  
`small` · `low impact` · *already on the backlog* — *difficulty*

`game.js:851-852`: `state.thornDensity = min(0.88, 0.18 + leg*0.11)` reaches its cap at leg 7 and never moves again, while `hog.speed = HOG_SPD * (1 + 0.08*(leg-1))` is unbounded — leg 20 is 3.43 m/s on his legs, and with the tuck and full downhill momentum (`rollSpeed` maxes at 2 × 2.6) that is 17.8 m/s of ground speed on a planet whose horizon from his eye is 11 m: he crosses everything he can see in under a second. Every arrival still flashes `home. leg ${leg} — and the brambles are thicker` (`game.js:863`), which is false from leg 8 onward. Backlog Gameplay 1 already says legs escalate only in speed and thorns; what is new is that the two escalations diverge. Cap speed at something the 4.6 rad/s steering can still aim, and let the toast say what actually changed.

**98. Nothing you sow survives a reload — the 26-item pool is not in the save**  
`medium` · `medium impact` — *persistence / sowing*

`save()` (`game.js:79-88`) writes leg, hearts, walked, found, x, z, hd, rings, flags, visited and met. The `sown` array (`game.js:342`, capped at `POOL` and recycled oldest-first at 565) is not among them, so every flower, mushroom, rock, snowman and sandcastle he has planted vanishes on reload, while the golden thistle's `rings` — explicitly 'the one thing in the world that stays' — do persist. So the game already has both halves of the idea and only ships one. NEXT Gameplay 6 reads 'sowing has no consequence past the 26-item pool'; the sharper statement is that it has no consequence past the tab. Each record is a kind, a seed, an x/z and a growth clock — under 26 short entries — and `sowAt` already reconstructs a prop from exactly that. It would also make the world remember you were there, which the save's own comment calls the backlog's oldest complaint about both builds.

**99. Polish the E prompt: its `<kbd>` is unstyled and its toast re-fires on every crossing**  
`small` · `low impact` — *hud*

Two small faults in the same element. `hud.js:294` writes `'<kbd>E</kbd> climb aboard'`, but the only `kbd` rule in the stylesheet is `#keys kbd` (`index.html:52-56`), scoped to the legend — so the key cap in the game's one standing instruction renders in browser-default monospace with no chip, against a HUD that is otherwise entirely ui-rounded, and it is the only place the typography breaks. And `main.js:687-688`: `const near = shipDistance() < SHIP_REACH` is a single threshold with no dead band, and every rising edge calls `hud.flash('the hatch is open. it is a very long way up.')`, which `hud.flash` only dedupes against what is showing or queued (`hud.js:301-303`) — so once the ~2.6 s toast expires the same line is pushed again on the next crossing. Two numbers (enter at 10.6, leave at 11.4) and a `oncePerVisit` guard.

**100. Dragonflies cross the whole mire in a quarter of a second**  
`small` · `low impact` — *critters*

`critters.js:836` retargets to `offsetFrom(CENTRE[MIRE], ±4.5, ±4.5)` — anywhere in a 9 m box, independent of where the insect currently is — and `d.dart = 0.28` lerps it there (`critters.js:822-829`). The mean jump between two uniform points in that box is about 4.7 m, so roughly 17 m/s, with diagonals over 40; a real dragonfly tops out near 10. A dart is what makes a dragonfly a dragonfly, but at this rate it is a teleport across the frame rather than a flick-hover-flick, and the mire is now the highest-traffic place in the world because the rocket stands in it. Either clamp the target to a metre or two of where it already is, or scale the dart duration by the distance — one line either way.

---

## The completeness critic

A final agent was given the finished list and asked three questions: what is
missing, which of the top twenty are wrong, and which five would it do first.
It verified about fifteen of the claims against the source before answering.

I read HANDOVER.md and NEXT.md in full, then verified about fifteen of the claims directly against the source (culvert/sleep at `game.js:838/871`, `speaker()` at `characters.js:109`, `ctx.stand` callers = zero, `setShadowTint` at `toon.js:222-228`, hay bales at `green.js:990-999`, `roadAt`/`hardAt` vs `grass.js:282`, `SITE_U + 0.9` against `D = 9`, `dressMars` only touching `visible`, `prevWetJ`/`state.wet` continuity, the journal `LABELS` table and `note()` callers, `setPlanetView` never re-running `pipeline.setSize`). The findings I checked all hold. Here are the three answers.

## 1. What is missing

**Performance is absent, entirely.** NEXT's World #1 (instanced brambles — 260 visibility-toggling meshes, named as the remaining draw-call bulk) and World #2 (grass LOD beyond ~8 m, explicitly "what is left" after the frustum fix) are the top two items of a whole workstream and appear nowhere in 100 entries. Nor does Graphics #4 (shadow texel budget). Rank 73 is the only perf item and it is a program-count nicety. The run log says 923 draw calls, one machine, an M1, and an adaptive scaler that has never been seen to fire — and Mobile #1 says none of it has run on a phone. A hundred items with zero coverage of "does this still run" is a real gap.

**Reverb.** NEXT Sound #1, top of its workstream: "the wood, the culvert and the open hillside are all equally dry." Ten sound items on this list and not one is the one the backlog already ranks first. Rank 56 walks right past it — it asks the culvert for a different footfall timbre when what the culvert wants is a tail.

**Onboarding beyond controls.** Rank 29 catches that no control is ever named on touch. Nobody catches that the game never states its own goal. I grepped: there is no first-run text of any kind. The compass reads "the ship 84 m" from frame one and a new player has no idea E exists, or Mars, or legs, or the burrow. Related, and also absent: there is no way to reset a save — no `removeItem` anywhere — so once you have been to Mars the game can never be started again.

**Content, as opposed to defects.** The list is roughly 85% bug-hunt. NEXT's content items are mostly missing: Gameplay 0b ("Mars is a destination, not a place") — you have seven items about Earth systems misbehaving on Mars and not one proposing anything to *do* there; Gameplay 0 / Mobile 2 (skip the flight, get home again) survives only as a footnote inside rank 34; World 5 worn paths, with the grass shader already carrying 16 trail markers; World 3 place boundaries; World 6 the wood at one density; Gameplay 2 (a leg you fail to finish before dawn) and Gameplay 3 (nothing is ever lost). These are the "thin, unfinished" half of the brief.

**The hedgepig's own workstream.** Eight NEXT items; the list takes look-at (20) and half of bristle (53). Absent: he does not shelter (#1, documented as half-done via `rainHurry`); no fatigue (#3); uphill/downhill does nothing to his *legs* (#2, marked part-done — the ball got momentum, the gait got nothing); the defensive curl and the sleep curl are the same pose (#6), which is cheap to do while you are already in the sleep code fixing rank 1; grooming (#7).

**Robustness of the one function that runs every frame.** `main.js` is 1 026 lines and owns fireflies, the rainbow, photo mode, puddles, hoglet names and the loop, all behind one exception guard that this project has already lost a whole game to. Nothing on the list touches it, or context loss, or a blocked `localStorage` in a private window. And ranks 32 and 98 both add fields to the save with no version key — an old save meeting new code is undefined.

## 2. What is wrong in the top 20

**Ranks 2, 14, 15, 16 are one bug listed four times** (and 44, 45, 46 make seven). Every one of them is "the Earth frame loop is not gated on `mission.onMars`". `dressMars` sets `visible = false` and nothing else — no `t.live`, no blockers, no updaters. That is one guard and an afternoon, not four top-20 slots. Ranking fault, and it crowds out everything above.

**Rank 4's fix would damage the game.** Keeping `repel` alive past `hurt` and letting it bias the *drive* heading makes him steer somewhere other than the key you are holding for 2.2 s. HANDOVER's keys section is explicit that `driveBy` and `_steer` share every bit of steering because two copies drift, and the drift reads as "he handles differently when you drive him" — the bug you cannot find by reading either copy. Impact is also overstated: `state.invuln` already exists (`game.js:701`), and the failure requires the player to hold a key into a thorn bush. The legible fix is ranks 53/54 — bristle, a scuff, ears back — not overriding input.

**Rank 10's finding is right and its fix is wrong.** Putting the burrow in the `folk` array puts it on `FOLK_FAR = 20 m`. The burrow can be half a lap. HANDOVER documents that exact collapse in the other direction and says plainly the two scales are not interchangeable. It needs a third grammar, not the residents'.

**Ranks 11 and 12 are over-ranked.** Sub-centimetre placement on a 26 cm animal seen from ~2 m through a deliberately blunt ink pass, sitting above the dusk-audio curve and the sky being left behind at the pad. Rank 6 is also generous at "high": five 0.55 m discs in a 30 m place.

**Ranks 8, 13 and 17 are under-ranked** and should all be above 11/12. Rank 8 is three lines and it is the game's climax missing from its only record. Rank 13 is HANDOVER's own three-curves lesson with one file left on the wrong side of it. Rank 17 leaves a 260 m dome parked at the pad through the set-piece the whole game exists for.

Nothing in the top 20 is already built, and none of it restates HANDOVER back at you. That part is honest work.

## 3. The five I would do first

1. **One `mission.onMars` guard** (ranks 2 + 15 + 16 + 44 + 45 + 46 as a single change). Losing a heart to a bramble you cannot see is the worst failure this game can produce, and it happens on the ending. It also silences six hens, ten cars and a rowing boat, stops autumn leaves falling on Mars, and gets you footprints in regolith nearly free.
2. **Rank 1, the sleep/culvert collision.** It fires every single time he gets home after dark, teleports him 23 m and cancels the night fast-forward — the exact beat the working sky was built to pay off. One condition.
3. **Rank 8, the journal.** Three lines. Right now you can finish the game and the only record of it lists eleven entries, two of which are unearnable and the thirteenth of which is the ending.
4. **Rank 9 + 50 together, the rainbow.** A reward the player can see listed and has never once been able to earn, because three call sites edge-test a value that moves 0.0046 per frame and needs to move 0.32. The accumulator pattern that works (`wetFor`) is already in the same file. Fix the tangent-frame roll in the same commit or the reward arrives on its side.
5. **Rank 3, getting out of the rocket.** He steps out standing inside the hull among the Raptors, in the last five seconds of the 42-second sequence that is the point of the game. One number, plus turning `smoke.js:2217`'s tolerance into a floor as well as a ceiling.

Honourable mention: rank 7 (`setShadowTint` never reaching the hedgepig's own body or any of the four residents — HANDOVER §1 names the violet shade band as the last thing to give up, and the character it was built for never gets it) would be sixth, and is cheaper than most of the top five.

