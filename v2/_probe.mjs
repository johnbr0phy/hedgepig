import * as THREE from 'three';
import { R, CIRC, CENTRE, CENTRES, PLACE, COUNT, LAKE, LAKE_R, MIRE, MGARD, ROAD, TOWN,
  dirAt, flatOf, lakeAt, roadAt, roadOffset, roadAlong, townAt, padAt, hardAt,
  placeWeights, placeAt, offsetFrom, arcTo, distance } from './src/world/plan.js';
import { heightAt, slopeAt, waterDepthAt, walkableAt, lakeShore, WATER_Y } from './src/world/terrain.js';

const fmt = (n, d = 3) => Number(n).toFixed(d);

/* ---- 1. the lake: is it still deep, after the road bend moved off it? ---- */
console.log('--- lake ---');
const lc = CENTRE[LAKE];
console.log('lake centre heightAt      ', fmt(heightAt(lc.x, lc.z)), ' WATER_Y', WATER_Y,
  ' depth', fmt(waterDepthAt(lc.x, lc.z)));
console.log('roadOffset at lake centre ', fmt(roadOffset(lc.x, lc.z)));
// sample the lake disc
let minD = Infinity, maxD = -Infinity, dryCount = 0, tot = 0, area = 0;
for (let a = 0; a < 64; a++) {
  for (let r = 0; r <= 20; r++) {
    const d = (r / 20) * LAKE_R;
    const p = offsetFrom(lc, Math.cos(a / 64 * Math.PI * 2) * d, Math.sin(a / 64 * Math.PI * 2) * d);
    const dep = waterDepthAt(p.x, p.z);
    tot++;
    if (dep <= 0) dryCount++;
    minD = Math.min(minD, dep); maxD = Math.max(maxD, dep);
  }
}
console.log('lake disc samples', tot, 'dry', dryCount, `(${fmt(100*dryCount/tot,1)}%)`, 'maxdepth', fmt(maxD));
// shore radius spread
let shMin = Infinity, shMax = -Infinity;
for (let a = 0; a < 48; a++) { const s = lakeShore(a / 48 * Math.PI * 2); shMin = Math.min(shMin, s.d); shMax = Math.max(shMax, s.d); }
console.log('shore radius min/max', fmt(shMin), fmt(shMax), ' LAKE_R', LAKE_R);

/* ---- 2. how much of the planet has its noise graded away? ---- */
console.log('\n--- relief mask coverage ---');
// sample uniformly on the sphere
let n = 0, sumMask = 0, hist = [0,0,0,0,0];
const v = new THREE.Vector3();
const N = 40000;
for (let i = 0; i < N; i++) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  v.set(s * Math.cos(th), s * Math.sin(th), u);
  const f = flatOf(v);
  const off = Math.abs(roadOffset(f.x, f.z));
  const m = off <= 5 ? 0 : off >= 26 ? 1 : (() => { const t = (off - 5) / 21; return t*t*(3-2*t); })();
  sumMask += m; n++;
  hist[Math.min(4, Math.floor(m * 5))]++;
}
console.log('mean road-corridor mask over the planet', fmt(sumMask / n));
console.log('mask histogram [0-.2,.2-.4,.4-.6,.6-.8,.8-1]', hist.map(h => fmt(100*h/n,1)+'%').join(' '));

/* ---- 3. relief statistics ---- */
console.log('\n--- relief ---');
let hMin = Infinity, hMax = -Infinity, hSum = 0, hs = [];
let slMax = 0, slSum = 0;
const sl = { nx: 0, nz: 0 };
for (let i = 0; i < 6000; i++) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  v.set(s * Math.cos(th), s * Math.sin(th), u);
  const f = flatOf(v);
  const h = heightAt(f.x, f.z);
  hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); hSum += h; hs.push(h);
  slopeAt(f.x, f.z, sl);
  const g = Math.hypot(sl.nx, sl.nz);
  slMax = Math.max(slMax, g); slSum += g;
}
hs.sort((a,b)=>a-b);
console.log('height min/max/range', fmt(hMin), fmt(hMax), fmt(hMax - hMin));
console.log('height p05/p50/p95', fmt(hs[300]), fmt(hs[3000]), fmt(hs[5700]));
console.log('slope mean', fmt(slSum/6000), 'max', fmt(slMax), `= ${fmt(Math.atan(slMax)*180/Math.PI,1)} deg`);

/* ---- 4. per-place relief: how different is each place, really? ---- */
console.log('\n--- per place ---');
for (const c of CENTRES) {
  let lo = Infinity, hi = -Infinity, sum = 0, k = 0, gmax = 0, gsum = 0;
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 20;
    const p = offsetFrom(c, Math.cos(a) * d, Math.sin(a) * d);
    const h = heightAt(p.x, p.z);
    lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; k++;
    slopeAt(p.x, p.z, sl);
    const g = Math.hypot(sl.nx, sl.nz); gmax = Math.max(gmax, g); gsum += g;
  }
  console.log(PLACE[c.kind].name.padEnd(24), 'mean', fmt(sum/k,2).padStart(6),
    'range', fmt(hi - lo, 2).padStart(5), 'meanslope', fmt(gsum/k,3), 'maxslope', fmt(gmax,3));
}

/* ---- 5. hardAt / roadOffset at each centre ---- */
console.log('\n--- road offsets at centres ---');
for (const c of CENTRES) {
  console.log(PLACE[c.kind].name.padEnd(24), 'roadOff', fmt(roadOffset(c.x, c.z),1).padStart(7),
    'hardAt', fmt(hardAt(c.x, c.z),3));
}

/* ---- 6. cost of heightAt / placeProp ---- */
console.log('\n--- cost ---');
const pts = [];
for (let i = 0; i < 2000; i++) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  v.set(s * Math.cos(th), s * Math.sin(th), u);
  pts.push(flatOf(v));
}
const time = (label, fn, iter = 20000) => {
  fn(); // warm
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iter; i++) fn(pts[i % pts.length]);
  const t1 = process.hrtime.bigint();
  console.log(label.padEnd(22), fmt(Number(t1 - t0) / 1e6 / iter * 1000, 2), 'us');
};
time('heightAt', (p = pts[0]) => heightAt(p.x, p.z));
time('slopeAt', (p = pts[0]) => slopeAt(p.x, p.z, sl));
time('placeWeights', (p = pts[0]) => placeWeights(p.x, p.z));
time('hardAt', (p = pts[0]) => hardAt(p.x, p.z));
time('roadOffset', (p = pts[0]) => roadOffset(p.x, p.z));
