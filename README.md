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

## v2

`v2/` is a second build alongside this one, not a replacement: the same
hedgehog and the same ten places, rebuilt in three dimensions as a cel-shaded
world on a planet 47.75 m across, with
[Kenton-GMI/sakura-crossing](https://github.com/Kenton-GMI/sakura-crossing) as
the baseline for how it is built and rendered. Vite and three.js, still no image
assets. `cd v2 && npm install && npm run dev`. See `v2/README.md`.

Nothing above this line changes — v1 keeps the root and keeps its URL.

## Controls

v1 (the root):

| | |
|---|---|
| tap / click | call him there — and sow whatever the place and season give you |
| scroll / drag | move the camera, which never follows him on its own |

v2 walks him on the keys instead: **WASD** to move, **double-tap a direction**
to roll, and the click is left for sowing.
