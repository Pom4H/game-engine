import {closestApproach} from './math.mjs';
import {compose} from '../../dist/math.js';
const attached=(p,b)=>{const m=compose(b.position,b.rotation,[1,1,1]);return [0,1,2].map(k=>m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+b.position[k]);};
export class LiveDirector{
 constructor(){this.history=[];this.shot='scout';this.subject='';this.since=-Infinity;this.visits=new Map();this.zones=new Map();this.zone='';this.prediction=null;}
 choose(world){const time=world.scene.time,candidates=[];
  for(const car of world.cars){const b=car.rig.body,speed=Math.hypot(b.velocity[0],b.velocity[2]),slip=car.wheelIds.reduce((v,id)=>v+car.rig.part(id).slipPowerW,0);
   candidates.push({id:car.id,kind:slip>2500?'wing':'chase',score:2+Math.min(5,slip/30000)+speed*.10,car});
   for(const other of world.cars){if(car===other)continue;const risk=closestApproach(b,other.rig.body);if(risk.time>.18&&risk.time<2.5&&risk.distance<3.5&&speed>5)candidates.push({id:car.id+':'+other.id,kind:'impact',score:30/(.7+risk.time),p:risk.point,risk});}
  }
  for(const a of world.people.actors.values())if(a.mode!=='walk')candidates.push({id:a.id,kind:a.mode,score:{build:8,push:12,throw:6,angel:5,shovel:6,gather:3}[a.mode]??2,p:a.p});
  const service=world.service;if(service)candidates.push({id:'roads',kind:'road-service',score:service.load.massKg>2?5:1,p:service.rig.body.position});
  for(const c of candidates){const p=c.car?.rig.body.position??c.p;c.zone=Math.floor(p[0]/48)+':'+Math.floor(p[2]/48);}
  const ranked=candidates.map(c=>({...c,value:c.score/(1+(time-(this.visits.get(c.id)??-1000)<24?3:0)+(c.kind!=='impact'&&time-(this.zones.get(c.zone)??-1000)<24?3:0)+(c.zone===this.zone?Math.max(0,time-this.since-2)*.9:0))})).sort((a,b)=>b.value-a.value);
  let next=ranked[0];if(time-this.since<3&&next?.kind!=='impact')next=candidates.find(c=>c.id===this.subject)??next;
  if(!next)return;if(next.id!==this.subject){this.visits.set(this.subject,time);this.zones.set(this.zone,time);this.zone=next.zone;this.subject=next.id;this.shot=next.kind;this.since=time;this.history.push({time,subject:next.id,shot:next.kind});this.history=this.history.slice(-60);}
  let position,target;
  if(next.car){const b=next.car.rig.body;target=attached([next.kind==='wing'?8:2,.4,0],b);position=next.kind==='wing'?attached([1.1,.25,-1.45],b):[b.position[0]-b.velocity[0]*.9-8,7,b.position[2]-b.velocity[2]*.9+6];}
  else{target=[next.p[0],next.p[1]+.8,next.p[2]];position=[target[0]-5,next.kind==='impact'?3.5:3.2,target[2]-5];}
  for(const map of [this.visits,this.zones])for(const [key,at] of map)if(time-at>60)map.delete(key);
  this.prediction=next.risk?{point:next.p,at:time,expectedAt:time+next.risk.time,distance:next.risk.distance}:null;
  world.scene.camera={position,target,fov:next.kind==='wing'?75:58,aperture:0};
 }
}
