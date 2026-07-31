import * as THREE from 'three';
import { R, CIRC, CENTRE, LAKE, LAKE_R, offsetFrom, flatOf, distance } from './src/world/plan.js';
import { heightAt, waterDepthAt, WATER_Y } from './src/world/terrain.js';
import { noise2 } from './src/core/util.js';
const f = (n, d = 3) => Number(n).toFixed(d);

/* the ring where the DRAWN water and the GAMEPLAY water disagree */
console.log('--- lake: drawn sheet (to 15 m, alpha from the bed) vs waterDepthAt (clipped at 13.5) ---');
let worst = 0, wb = 0, n = 0;
for (let a = 0; a < 144; a++) {
  const ang = a / 144 * Math.PI * 2;
  const at = (d) => offsetFrom(CENTRE[LAKE], Math.cos(ang) * d, Math.sin(ang) * d);
  // outermost radius (<=15) at which the bed is still below the waterline
  let out = 0;
  for (let d = 15; d >= 8; d -= 0.05) { const p = at(d); if (heightAt(p.x, p.z) < WATER_Y - 0.005) { out = d; break; } }
  if (out > LAKE_R) { const w = out - LAKE_R; if (w > worst) { worst = w; wb = ang; } n++; }
}
console.log('bearings where drawn water extends past the walkable cut:', n, '/144, widest ring', f(worst), 'm');

/* the ground mottle uses flat (x, z), which is longitude*R -- squeezed at the poles */
console.log('\n--- moss/soil mottle: feature size on the GROUND, by latitude ---');
for (const z of [0, 22, 40, 55, 65, 72]) {
  const cs = Math.cos(z / R);
  console.log(` z=${String(z).padStart(3)} m (lat ${f(z / R * 180 / Math.PI, 0)}deg)  cos=${f(cs, 3)}`,
    ` moss patch ~${f(3.2 * cs, 2)} m across in x,  ${f(3.2, 2)} m in z`);
}
// where are the mapping poles relative to the places?
console.log('mapping poles at z = +-', f(R * Math.PI / 2, 1), 'm; nearest place centre is',
  f(distance(0, R * Math.PI / 2, CENTRE[LAKE].x, CENTRE[LAKE].z), 1), 'm away');

/* fog cover at the grass edge */
console.log('\n--- fog at the grass edge ---');
const fog = (d) => Math.max(0, Math.min(1, (d - 11) / (40 - 11)));
for (const d of [11, 15, 21, 26, 30]) console.log(` ${String(d).padStart(3)} m -> fog ${f(fog(d) * 100, 0)}%`);
