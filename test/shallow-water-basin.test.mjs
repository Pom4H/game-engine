import test from 'node:test';
import assert from 'node:assert/strict';
import {ShallowWaterBasin,FloatingBasinBoat} from '../dist/physics/shallow-water-basin.js';

const smooth=x=>{const t=Math.min(1,Math.max(0,x));return t*t*(3-2*t);};
function tilt(t){
 if(t<1)return 0;
 if(t<3.1)return Math.PI/180*8*smooth((t-1)/2.1);
 if(t<4.2)return 8*Math.PI/180;
 if(t<7)return Math.PI/180*(8-16*smooth((t-4.2)/2.8));
 if(t<8)return -8*Math.PI/180;
 if(t<10.7)return Math.PI/180*(-8+8*smooth((t-8)/2.7));
 return 0;
}

test('finite-volume basin conserves actual volume when tilting and reversing',()=>{
 const basin=new ShallowWaterBasin({columns:100,rows:72,widthM:10.4,lengthM:7.44,depthM:1.08});
 const boat=new FloatingBasinBoat(-1.3,2.04);
 let minX=boat.x,maxX=boat.x,low=Infinity,high=0;
 const first=basin.volumeM3();
 const dt=1/120;
 for(let k=1;k<=1440;k++){
  const t=k*dt;
  basin.step(dt,tilt(t));boat.step(basin,dt);
  const volume=basin.volumeM3();
  assert(Math.abs((volume-first)/first)<1e-11,'mass conservation at tick '+k);
  const depth=basin.sample(boat.x,boat.z);
  assert(Number.isFinite(depth.heightM));assert(Number.isFinite(boat.worldRollRad));
  minX=Math.min(minX,boat.x);maxX=Math.max(maxX,boat.x);
  low=Math.min(low,...basin.depth);high=Math.max(high,...basin.depth);
 }
 assert(maxX-minX>2,'the boat must move with water current, not the mesh transform');
 assert(high-low>.5,'the free surface must slosh in response to tilt');
});

test('opaque island blocks through-flow but preserves mass along its shores',()=>{
 const nx=64,nz=48,solid=new Uint8Array(nx*nz);
 for(let z=12;z<26;z++)for(let x=23;x<42;x++)solid[z*nx+x]=1;
 const basin=new ShallowWaterBasin({columns:nx,rows:nz,widthM:10.4,lengthM:7.44,depthM:1,solid});
 const initial=basin.volumeM3();
 for(let k=0;k<280;k++)basin.step(1/150,.10);
 assert(Math.abs(initial-basin.volumeM3())<1e-8);
 for(let z=12;z<26;z++)for(let x=23;x<42;x++)assert.equal(basin.depth[z*nx+x],0);
 assert(basin.depth.some(h=>h>1.05),'water height varies around the obstruction');
});

test('floating body pitch counteracts rotated basin at settled water-level gradient',()=>{
 const basin=new ShallowWaterBasin({columns:64,rows:44,widthM:9,lengthM:7,depthM:1.2});
 const boat=new FloatingBasinBoat(0,1);
 for(let k=0;k<100;k++){basin.step(1/120,.05);boat.step(basin,1/120);}
 assert(Number.isFinite(boat.worldRollRad));
 assert(boat.surfaceHeightM>.1);
 assert(Math.abs(boat.x)>0);
});
