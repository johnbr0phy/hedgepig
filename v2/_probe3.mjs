import * as THREE from 'three';
import { R, CIRC, CENTRE, CENTRES, PLACE, COUNT, LAKE, LAKE_R, roadPoint, roadOffset,
  offsetFrom, flatOf, placeWeights, placeProp, hardAt, arcBetween, distance } from './src/world/plan.js';
import { heightAt, waterDepthAt, WATER_Y, slopeAt } from './src/world/terrain.js';
const f = (n, d = 3) => Number(n).toFixed(d);

/* --- road elevation profile round the lap --- */
console.log('--- the road, along its own lap ---');
let lo = 9, hi = -9, prof = [];
for (let s = 0; s < CIRC; s += 1) {
  const p = roadPoint(s, 0);
  const h = heightAt(p.x, p.z);
  prof.push(h); lo = Math.min(lo, h); hi = Math.max(hi, h);
}
console.log('centreline height min/max', f(lo), f(hi), 'range', f(hi - lo));
let maxGrad = 0;
for (let i = 0; i < prof.length; i++) maxGrad = Math.max(maxGrad, Math.abs(prof[(i+1)%prof.length] - prof[i]));
console.log('steepest metre of road', f(maxGrad), 'm/m');
// cross-section: how far from the centreline until the ground has relief again
for (const s of [0, 30, 60, 90, 150, 210, 270]) {
  const row = [];
  for (const t of [0, 3, 6, 10, 15, 20, 26, 35]) {
    const p = roadPoint(s, t);
    row.push(f(heightAt(p.x, p.z), 2).padStart(6));
  }
  console.log(` s=${String(s).padStart(3)}  across 0/3/6/10/15/20/26/35 m:`, row.join(''));
}

/* --- place colour separation vs the mottle --- */
console.log('\n--- ground colour: place signal vs mottle ---');
const MEAN = (() => {
  const m = new THREE.Color(0,0,0), c = new THREE.Color();
  const list = Object.values(PLACE);
  for (const p of list) { c.set(p.ground); m.r += c.r/list.length; m.g += c.g/list.length; m.b += c.b/list.length; }
  return m;
})();
const mult = (kind) => {
  const c = new THREE.Color(PLACE[kind].ground);
  return [ (MEAN.r + (c.r-MEAN.r)*1.22)/MEAN.r,
           (MEAN.g + (c.g-MEAN.g)*1.22)/MEAN.g,
           (MEAN.b + (c.b-MEAN.b)*1.22)/MEAN.b ];
};
const pairs = [];
for (let i = 0; i < COUNT; i++) for (let j = i+1; j < COUNT; j++) {
  const d = arcBetween(CENTRES[i].dir, CENTRES[j].dir);
  if (d > 55) continue;                       // neighbours only
  const a = mult(CENTRES[i].kind), b = mult(CENTRES[j].kind);
  const sep = Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
  pairs.push([sep, PLACE[CENTRES[i].kind].name, PLACE[CENTRES[j].kind].name]);
}
pairs.sort((p,q)=>p[0]-q[0]);
// mottle: mossy up to .14, dry up to .12 -> multiplier swing
const mossSwing = Math.hypot(0.14*0.5, 0.14*0.25, 0.14*0.4);
const drySwing  = Math.hypot(0.12*0.9, 0.12*0.55, 0.12*0.15);
console.log('mottle swing: moss', f(mossSwing), ' dry', f(drySwing));
for (const [sep, a, b] of pairs.slice(0, 6)) console.log('  ', f(sep).padStart(6), a, '|', b);
console.log('   ...');
for (const [sep, a, b] of pairs.slice(-3)) console.log('  ', f(sep).padStart(6), a, '|', b);

/* --- water sheet: mesh resolution vs the shore ramp it draws --- */
console.log('\n--- the water sheet ---');
const RINGS = 16, SEG = 56, RAD = LAKE_R + 1.5;
console.log('radial spacing', f(RAD/RINGS), 'm;  arc spacing at the shore', f(2*Math.PI*11/SEG), 'm');
// depth gradient at the shore
let gsum = 0, gk = 0;
for (let a = 0; a < 36; a++) {
  const ang = a/36*Math.PI*2;
  const at = (d) => offsetFrom(CENTRE[LAKE], Math.cos(ang)*d, Math.sin(ang)*d);
  // find the contour
  let l0 = 0, h0 = 20;
  for (let i = 0; i < 24; i++) { const m = (l0+h0)/2; const p = at(m); if (heightAt(p.x,p.z) < WATER_Y) l0 = m; else h0 = m; }
  const p1 = at(h0 - 0.3), p2 = at(h0 + 0.3);
  gsum += Math.abs(heightAt(p2.x,p2.z) - heightAt(p1.x,p1.z))/0.6; gk++;
}
const g = gsum/gk;
console.log('mean bed gradient at the waterline', f(g));
console.log('  the alpha cut  (depth .004->.05) spans', f(0.046/g, 2), 'm of ground');
console.log('  the foam band  (depth .035->.09) spans', f(0.055/g, 2), 'm of ground');
console.log('  one radial cell is', f(RAD/RINGS, 2), 'm  -> foam is', f((0.055/g)/(RAD/RINGS), 2), 'of a cell');

/* --- how far you can see vs how far the grass goes --- */
console.log('\n--- sightline vs VIEW=21 ---');
for (const camH of [0.9, 1.4, 2.2]) {
  const base = Math.sqrt(2*R*camH);
  for (const featH of [0, 1, 2, 3]) {
    const extra = Math.sqrt(2*R*featH);
    process.stdout.write(` cam ${camH}m, ground+${featH}m: ${f(base+extra,1)} m   `);
  }
  console.log();
}

/* --- grass fill: cost with placeWeights shared --- */
console.log('\n--- fill cost, shared weights ---');
const _w = new Float64Array(COUNT);
const propFrom = (w, key) => { let v = 0; for (let i = 0; i < COUNT; i++) if (w[i] > 0) v += w[i]*PLACE[i][key]; return v; };
const run = (shared) => {
  const t0 = process.hrtime.bigint();
  for (let n = 0; n < 20; n++) for (let i = 0; i < 877; i++) {
    const x = (Math.random()-0.5)*5, z = (Math.random()-0.5)*5;
    if (hardAt(x, z) > 0.45) continue;
    if (waterDepthAt(x, z) > 0) continue;
    if (shared) {
      placeWeights(x, z, _w);
      const dens = propFrom(_w, 'dens');
      if (Math.random() > Math.min(dens,1.3)/1.3) continue;
      heightAt(x, z); propFrom(_w, 'len'); propFrom(_w, 'dry');
    } else {
      const dens = placeProp(x, z, 'dens');
      if (Math.random() > Math.min(dens,1.3)/1.3) continue;
      heightAt(x, z); placeProp(x, z, 'len'); placeProp(x, z, 'dry');
    }
  }
  return Number(process.hrtime.bigint()-t0)/1e6/20;
};
run(false); run(true);
console.log('as written ', f(run(false), 2), 'ms/cell');
console.log('shared     ', f(run(true), 2), 'ms/cell');
