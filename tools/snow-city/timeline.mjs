import {SnowPeople} from './people.mjs';
import {resolveEnvironmentAt} from '../../dist/environment/types.js';
import {EPISODE_SECONDS} from './timing.mjs';
export const TAPE_REVISION='native-city-60hz-1';
let loading;
export function loadTimeline(){return loading??=readTimeline().catch(error=>{loading=undefined;throw error;});}
async function readTimeline(){
 let bytes;
 const url=new URL('timeline.bin',import.meta.url);
 if(url.protocol==='file:'){const {readFile}=await import('node:fs/promises');bytes=await readFile(url);}
 else{const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw Error(`Physical timeline: HTTP ${response.status}`);bytes=await response.arrayBuffer();}
 const json=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 if(json.version!==TAPE_REVISION||json.tickRate!==60||json.duration!==EPISODE_SECONDS||json.frames.length!==EPISODE_SECONDS*60+1)throw Error('Incompatible physical timeline');
 return json;
}
const shift=(p,o)=>[p[0]+o[0],p[1],p[2]+o[2]];
function bodyPose(body,values,o){body.position.splice(0,3,...shift(values,o));body.rotation.splice(0,3,...values.slice(3,6));if(values.length>=12){body.velocity.splice(0,3,...values.slice(6,9));body.angularVelocity.splice(0,3,...values.slice(9,12));}}
/** Read-only presentation of authored physical states; no independent worker physics. */
export function restoreTimeline(sim,tape,targetTick){
 const scene=sim.scene,period=EPISODE_SECONDS*60,sector=Math.floor(targetTick/period),localTick=targetTick%period,time=targetTick/60,record=tape.frames[localTick];
 sim.selectSector(sector);const o=sim.origin,visit=Math.floor(time/32);
 if(sim.peopleVisit!==visit){sim.people.dispose();sim.people=new SnowPeople(scene,o,`${sector}:${visit}`);sim.peopleVisit=visit;sim.tapeSkin=-1;}
 scene.tick=targetTick;scene.time=time;scene.physics.time=time;scene.environment=resolveEnvironmentAt(scene.spec.environment,time);
 for(let i=0;i<sim.cars.length;i++){const c=sim.cars[i],data=record.cars[i];bodyPose(c.rig.body,data.body,o);c.steer=data.steer;c.throttle=data.throttle;c.maxSlip=data.slip;c.distanceM=data.distance;c.fullThrottleTicks=data.fullThrottleTicks;c.driftTicks=data.driftTicks;c.replayParts=data.wheels.map(p=>({...p,point:shift(p.point,o)}));
  if(data.soft<0&&c.tapeSoft!==-1)c.clearSoftPresentation();
  if(data.soft>=0&&c.tapeSoft!==data.soft){const state=tape.soft[data.soft];c.soft.structure.position.set(state.nodes);c.soft.panels.restorePresentation(state.panels);c.softUntil=time;c.softRevision=state.revision+1;c.tapeSoft=data.soft;}
 }
 const people=sim.people,p=record.people;
 for(let i=0;i<people.actors.length;i++){const value=p.actors[i],position=shift(value.p,o);people.pose(people.actors[i],position,value.yaw,value.phase,value.mode);}
 if(people.rollingRadius!==p.radius){const old=people.balls[1];people.pushRelease?.();people.pushRelease=null;scene.remove(old.id);people.balls[1]=people.add({id:old.id,position:shift(p.balls[1],o),mesh:{kind:'sphere',radius:p.radius,segments:14},material:{kind:'snow',color:[.9,.94,.98,1],roughness:.96},body:{mass:4*Math.PI*p.radius**3/3*280,friction:.9,restitution:.015}});people.rollingRadius=p.radius;}
 for(let i=0;i<3;i++)bodyPose(people.balls[i].body,p.balls[i],o);
 const required=new Set(p.projectiles.map(v=>people.prefix+':ball'+v.index));
 for(const e of people.projectiles)if(!required.has(e.id)){scene.remove(e.id);people.owned.delete(e.id);}people.projectiles=people.projectiles.filter(e=>required.has(e.id));
 for(const value of p.projectiles){const id=people.prefix+':ball'+value.index;let e=scene.entities.get(id);if(!e){e=people.add({id,position:shift(value.body,o),mesh:{kind:'sphere',radius:.10,segments:8},material:{kind:'snow',color:[.9,.94,.98,1]},body:{mass:1.1}});people.projectiles.push({id:e.id,at:time});}bodyPose(e.body,value.body,o);}
 if(sim.tapeSkin!==p.skin){const next=tape.skins[p.skin],previous=people.skin.stamps,prefix=next.length>=previous.length&&previous.every((s,i)=>s.sequence===next[i].sequence&&s.time===next[i].time&&s.foot===next[i].foot);if(prefix){for(const s of next.slice(previous.length))people.skin.stamp({...s,position:shift(s.position,o)});}else people.skin.restoreStamps(next.map(s=>({...s,position:shift(s.position,o)})));sim.tapeSkin=p.skin;}
 people.stockM3=p.stock;people.usedM3=p.used;people.rollDistance=p.rollDistance;people.action=p.action;people.knocked=p.knocked;
 const head=people.balls[2].body;for(const d of people.decor)scene.setVisualTransform(d.id,[head.position[0]+d.offset[0],head.position[1]+d.offset[1],head.position[2]+d.offset[2]],[Math.PI/2,head.rotation[1],0]);
 scene.camera={...record.camera,position:shift(record.camera.position,o),target:shift(record.camera.target,o)};
 sim.collisionCount=record.collisions;sim.director.shot=record.shot;
 scene.resources.set('snow-city',{time,sector,shot:record.shot,action:p.action,collisions:record.collisions,prediction:record.prediction?{...record.prediction,point:shift(record.prediction.point,o),at:record.prediction.at+sector*EPISODE_SECONDS,expectedAt:record.prediction.expectedAt+sector*EPISODE_SECONDS}:null,cars:record.cars.map(c=>({distanceM:c.distance,engineRpm:c.rpm,gear:c.gear,fullThrottleTicks:c.fullThrottleTicks,driftTicks:c.driftTicks})),snowDepthM:people.skin.snowDepth,source:'authoritative-60hz-timeline'});
}
