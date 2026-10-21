import {Scene} from '../../dist/scene/scene.js';
import {LiveSnowWorld} from './live-world.mjs';
export function makeAuthority(spec,{startTick=0,archive}={}){
 const scene=new Scene(spec);scene.tick=startTick;scene.time=startTick/60;scene.physics.time=scene.time;scene.profiling=true;
 const world=new LiveSnowWorld(scene,{authority:true}),systems={};let count=0,totalMs=0;
 return{get tick(){return scene.tick;},world,scene,
  step(){scene.step(1/60);if(archive&&scene.tick%60===0){const at=performance.now();archive.update(world,{evict:scene.tick%300===0||world.snow.cells.size>world.snow.maxCells*.85});const ms=performance.now()-at;systems['city:archive']=(systems['city:archive']??0)+ms;totalMs+=ms;}scene.contacts.drainFootsteps();count++;totalMs+=scene.lastProfile.totalMs;for(const [k,v]of Object.entries(scene.lastProfile.systems))systems[k]=(systems[k]??0)+v;},
  audioFrame:frame=>({tick:frame.tick,camera:frame.camera,events:frame.events,cars:frame.cars.map(({body,rpm,phase,throttle,surface,slip})=>({body,rpm,phase,throttle,surface,slip}))}),
  frame:()=>world.frame(),checkpoint:()=>({snow:world.snow.snapshot()}),
  profile:()=>{const result={tick:scene.tick,ticks:count,msPerTick:totalMs/Math.max(1,count),systems:Object.fromEntries(Object.entries(systems).map(([k,v])=>[k,v/Math.max(1,count)]))};count=0;totalMs=0;for(const k of Object.keys(systems))delete systems[k];return result;},
  dispose:()=>world.dispose(),
 };
}
