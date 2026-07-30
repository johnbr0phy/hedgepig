const plan = await import('./src/world/plan.js');
const t = await import('./src/world/terrain.js');
const { R, CIRC } = plan;
const POLE = R * Math.PI / 2;
console.log('--- at the pole, three different longitudes ---');
for (const x of [0, 100, 200]) {
  const d = plan.dirAt(x, POLE);
  console.log(` x=${x}`,
    'dir', [d.x, d.y, d.z].map(v=>v.toExponential(2)).join(','),
    'h', t.heightAt(x, POLE).toFixed(6),
    'lake', plan.lakeAt(x, POLE).toFixed(4),
    'town', plan.townAt(x, POLE).toFixed(4),
    'roadOff', plan.roadOffset(x, POLE).toFixed(4),
    'place', JSON.stringify(plan.placeAt(x,POLE).a)+'/'+plan.placeAt(x,POLE).t.toFixed(3));
}
console.log('--- seam ---');
for (const z of [0, 20, -20]) {
  console.log(` z=${z}`, t.heightAt(0,z).toFixed(9), t.heightAt(CIRC,z).toFixed(9),
    'roadOff', plan.roadOffset(0,z).toFixed(6), plan.roadOffset(CIRC,z).toFixed(6));
}
