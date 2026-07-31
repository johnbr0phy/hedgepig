import * as THREE from 'three';
import { R, CIRC, CENTRE, CENTRES, PLACE, LAKE, LAKE_R, MIRE, offsetFrom, flatOf,
  lakeAt, hardAt, placeProp, distance, roadOffset } from './src/world/plan.js';
import { heightAt, waterDepthAt, walkableAt, lakeShore, WATER_Y, slopeAt } from './src/world/terrain.js';

const f = (n, d = 3) => Number(n).toFixed(d);

/* --- A. the harness cliff test only steps in x. what about z? --- */
let steepX = 0, atX = null, steepZ = 0, atZ = null;
for (let i = 0; i < 40000; i++) {
  const z = R * Math.asin(-1 + (2 * i) / 40000);
  const x = (i * 13.7) % CIRC;
  if (!walkableAt(x, z)) continue;
  const e = 0.4 / Math.max(0.08, Math.cos(z / R));
  if (walkableAt(x + e, z)) {
    const d = Math.abs(heightAt(x + e, z) - heightAt(x, z));
    if (d > steepX) { steepX = d; atX = [x, z]; }
  }
  if (walkableAt(x, z + 0.4)) {
    const d = Math.abs(heightAt(x, z + 0.4) - heightAt(x, z));
    if (d > steepZ) { steepZ = d; atZ = [x, z]; }
  }
}
console.log('--- cliffs, per 0.4 m ---');
console.log('east-west (what the harness measures)', f(steepX), 'at', atX && atX.map(v=>f(v,1)).join(','));
console.log('north-south (unmeasured)            ', f(steepZ), 'at', atZ && atZ.map(v=>f(v,1)).join(','));

/* --- B. the true steepest walkable gradient, both axes --- */
let worst = 0, wat = null;
const sl = { nx: 0, nz: 0 };
for (let i = 0; i < 40000; i++) {
  const z = R * Math.asin(-1 + (2 * i) / 40000);
  const x = (i * 13.7) % CIRC;
  if (!walkableAt(x, z)) continue;
  slopeAt(x, z, sl);
  const g = Math.hypot(sl.nx, sl.nz);
  if (g > worst) { worst = g; wat = [x, z]; }
}
console.log('steepest walkable gradient', f(worst), '=', f(Math.atan(worst)*180/Math.PI,1), 'deg at', wat && wat.map(v=>f(v,1)).join(','));
console.log('  0.4 m of that slope =', f(worst * 0.4), 'm rise (harness ceiling 0.22)');

/* --- C. the lake's edge: is it a contour or a circle? --- */
console.log('\n--- the lake edge ---');
let clipped = 0;
for (let a = 0; a < 72; a++) {
  const ang = a / 72 * Math.PI * 2;
  const s = lakeShore(ang);
  // does the BED stay below the waterline past LAKE_R?
  const p = offsetFrom(CENTRE[LAKE], Math.cos(ang) * (LAKE_R + 0.6), Math.sin(ang) * (LAKE_R + 0.6));
  const bed = heightAt(p.x, p.z);
  if (s.d > LAKE_R - 0.15 && bed < WATER_Y) clipped++;
}
console.log('bearings where the shore is CUT by LAKE_R rather than by the bed:', clipped, '/72');
// how much of the bed inside the disc is above the water (islands)
let dry = 0, tot = 0, interiorDry = 0;
for (let a = 0; a < 120; a++) for (let r = 1; r <= 30; r++) {
  const ang = a/120*Math.PI*2, d = r/30 * LAKE_R;
  const p = offsetFrom(CENTRE[LAKE], Math.cos(ang)*d, Math.sin(ang)*d);
  tot++;
  const dep = waterDepthAt(p.x, p.z);
  if (dep <= 0) { dry++; if (d < lakeShore(ang).d) interiorDry++; }
}
console.log('dry samples inside the lake disc', dry, '/', tot, ' of which INSIDE the shore contour:', interiorDry);

/* --- D. water anywhere but the lake? --- */
let wet = 0, N = 60000;
const v = new THREE.Vector3();
for (let i = 0; i < N; i++) {
  const u = Math.random()*2-1, th = Math.random()*Math.PI*2, s = Math.sqrt(1-u*u);
  v.set(s*Math.cos(th), s*Math.sin(th), u);
  const p = flatOf(v);
  if (waterDepthAt(p.x, p.z) > 0) wet++;
}
console.log('\nfraction of the planet that is water:', f(100*wet/N,2)+'%',
  ' (lake disc area / sphere =', f(100*(Math.PI*LAKE_R*LAKE_R)/(4*Math.PI*R*R),2)+'%)');

/* --- E. cost of one grass cell fill (the terrain half of it) --- */
console.log('\n--- grass fill cost, terrain queries only ---');
const CELL = 5, DENSITY = 26;
const t0 = process.hrtime.bigint();
let accepted = 0;
const cx = 0, cz = 0;
for (let i = 0; i < 877; i++) {
  const x = cx + (Math.random()-0.5)*CELL, z = cz + (Math.random()-0.5)*CELL;
  if (hardAt(x, z) > 0.45) continue;
  if (waterDepthAt(x, z) > 0) continue;
  const dens = placeProp(x, z, 'dens');
  if (Math.random() > Math.min(dens,1.3)/1.3) continue;
  heightAt(x, z);
  placeProp(x, z, 'len');
  placeProp(x, z, 'dry');
  accepted++;
}
const t1 = process.hrtime.bigint();
console.log('one cell:', f(Number(t1-t0)/1e6, 2), 'ms for', accepted, 'tufts  (2 cells/frame budget)');

/* --- F. how many placeWeights calls per fill --- */
let calls = 0;
console.log('\n--- reliefMask coverage per place ---');
for (const c of CENTRES) {
  let m = 0, k = 0;
  for (let i = 0; i < 400; i++) {
    const a = Math.random()*Math.PI*2, d = Math.sqrt(Math.random())*13;
    const p = offsetFrom(c, Math.cos(a)*d, Math.sin(a)*d);
    const off = Math.abs(roadOffset(p.x, p.z));
    const t = Math.max(0, Math.min(1, (off-5)/21));
    m += t*t*(3-2*t); k++;
  }
  console.log(PLACE[c.kind].name.padEnd(24), 'road mask', f(m/k, 2));
}
