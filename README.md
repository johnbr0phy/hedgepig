# the hedgepig adventure

A hedgehog walks through an endless procedural meadow. Tap to call him; he walks
to that spot and stops. Thorns and the road hurt. Find the burrow at the end of
each leg.

**Play it: https://johnbr0phy.github.io/hedgepig/**

One self-contained HTML file. Canvas 2D, no libraries, no build step, no assets.
The world has weather, four seasons, a day/night cycle and eleven places, on
three cycles of different lengths (220m, 284m, 209m) so nothing ever repeats.

- `index.html` — the whole thing
- `smoke.js` — headless test harness: `node smoke.js <scenario>`
- `HANDOVER.md` — how it works, and every mistake made building it

## Controls

| | |
|---|---|
| tap / click | call him there — and sow whatever the place and season give you |
| scroll / drag | move the camera, which never follows him on its own |
