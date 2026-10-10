import {makeCity} from '../promo/city.mjs';
import {batchStaticScenery} from '../../dist/procedural/static-batch.js';

// One executable world for TypeScript and Rust/WASM, with Scene and PhysicsWorld
// the sole owners of physical state. No City-specific physics shortcuts.
export const CITY_SEED=0x20c17;
export const CITY_TRAFFIC=48;
const base=makeCity('street');
const spec=base.spec;
spec.seed=CITY_SEED;
spec.environment={
 ...spec.environment,temperatureC:2.8,humidity:.65,groundMoisture:.55,
 precipitation:'rare',snowfall:'none',sunlight:.78,wind:[1.2,0,.4],
 clock:{startHour:15,hoursPerSecond:0},
};
spec.rendering={
 ...spec.rendering,sunDirection:[-.55,.68,.30],
 sunColor:[1,.95,.88],sunIntensity:2.7,
 skyColor:[.30,.44,.61],fogDensity:.0008,
 shadowExtent:42,exposure:1,
};
const extras=[];
let seed=CITY_SEED;
function rand(){
 seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 return seed/4294967296;
}
function add(id,position,size,kind,color,extra={}){
 extras.push({id,position,mesh:{kind:'box',size},renderOnly:true,
  material:{kind,color,roughness:kind==='glass'?.18:.87,...extra}});
}
// Extra procedural districts add broad culling and streaming pressure. Far
// buildings remain render projections, not collision authority.
for(let block=0;block<18;block++){
 const x=-125+block*17;
 for(const side of [-1,1]){
  const distance=18+(block%3)*9,depth=10+rand()*7,height=10+rand()*26;
  const z=side*(distance+depth*.5),name='district-'+block+'-'+(side>0?'north':'south');
  const grey=.20+rand()*.19;
  add(name+'-structure',[x,height*.5,z],[11+rand()*3,height,depth],
    'concrete',[grey,grey*.96,grey*.89,1]);
  add(name+'-roof',[x,height+.18,z],[12,.36,depth+1],
    'steel',[.12,.14,.16,1]);
  // Window planes with real geometry instead of screen-space density hacks.
  const levels=Math.max(2,Math.min(8,Math.floor(height/3)));
  for(let level=0;level<levels;level++)for(let col=-1;col<=1;col++)
   add(name+'-window-'+level+'-'+col,
     [x+col*3.2,2.2+level*3.0,z-side*(depth*.5+.008)],
     [1.60,1.55,.018],'glass',[.08,.15,.21,1]);
 }
}
// Dense moving vehicles participate in the real rigid contact law.
for(let pair=0;pair<CITY_TRAFFIC/4;pair++){
 const x=-55+pair*12.4;
 for(let lane=0;lane<2;lane++)for(let side=0;side<2;side++){
  const id='bench-car-'+pair+'-'+lane+'-'+side;
  const z=lane===0?-1.7:1.7,fromLeft=side===0;
  const color=(pair+lane)%3===0?[.15,.22,.30,1]:
    (pair+lane)%3===1?[.43,.16,.12,1]:[.31,.32,.34,1];
  extras.push({
   id,position:[x+(fromLeft?-2.35:2.35),.73,z],
   mesh:{kind:'box',size:[4.10,1.32,1.55]},
   material:{kind:'steel',color,roughness:.30},
   body:{mass:1250,velocity:[fromLeft?3.0:-3.0,0,0],
    angularVelocity:[0,(pair%3-1)*.012,0],restitution:.12,friction:.80},
  });
 }
}
// The fixed camera route continues into the extended city without leaving
// the physical asphalt.
extras.push({
 id:'city-east-road',position:[124,-.075,0],
 mesh:{kind:'box',size:[76,.15,7.35]},
 material:{kind:'asphalt',color:[.11,.12,.13,1],roughness:.83},
 environmental:{surfaceUse:'road',waterDepthM:.0008,snowDepthM:0},
});
spec.entities.push(...batchStaticScenery(extras,e=>!!e.renderOnly));
spec.camera={position:[-61,2.1,6.2],target:[-44,1.8,3.5],fov:55,focusDistance:22,aperture:.015};
// Existing cars, walkers and weather keep their engine-owned motion/material
// laws; both backends receive exactly the same original city content.
export const cityMetadata=Object.freeze({
 seed:CITY_SEED,trafficBodies:CITY_TRAFFIC,
 districtBlocks:18,authoredSourceEntities:base.sourceCount+extras.length,
 compiledEntities:spec.entities.length,
 physicsAuthority:'Scene.physics (JS scheduler + optional Rust/WASM contacts)',
});
export default spec;
