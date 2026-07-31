import * as THREE from 'three';
import { R, flatOf, lakeAt, CENTRE, LAKE, arcTo } from './src/world/plan.js';
import { heightAt, WATER_Y } from './src/world/terrain.js';
const f=(n,d=2)=>Number(n).toFixed(d);
let below=0, N=60000, v=new THREE.Vector3(), belowOut=0;
for(let i=0;i<N;i++){const u=Math.random()*2-1,t=Math.random()*Math.PI*2,s=Math.sqrt(1-u*u);
 v.set(s*Math.cos(t),s*Math.sin(t),u); const p=flatOf(v);
 if(heightAt(p.x,p.z)<WATER_Y){below++; if(arcTo(CENTRE[LAKE],p.x,p.z)>15) belowOut++;}}
console.log('ground below the waterline:',f(100*below/N)+'% of the planet;',
  'outside the lake disc:',f(100*belowOut/N)+'%');
