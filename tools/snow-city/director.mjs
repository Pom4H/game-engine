import {closestApproach,clamp,yawPoint,smooth,mix} from './math.mjs';
import {compose} from '../../dist/math.js';
const attachedPoint=(p,body)=>{const m=compose(body.position,body.rotation,[1,1,1]);return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+body.position[0],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+body.position[1],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+body.position[2]];};
export class ActionDirector{
 constructor(){this.lastEye=null;this.shot='drone';this.prediction=null;this.history=[];}
 choose(scene,cars,people,time,origin){
  const live=cars.filter(c=>scene.entities.has(c.id));let event=null;
  for(let a=0;a<live.length;a++)for(let b=a+1;b<live.length;b++){
   const ba=live[a].rig.body,bb=live[b].rig.body,risk=closestApproach(ba,bb);
   if(risk.time>.18&&risk.distance<3.8&&Math.hypot(...ba.velocity)>5&&(!event||risk.time<event.time))event={...risk,car:live[a]};
  }
  const phase=time%32,hero=live[0],body=hero?.rig.body;
  let eye,target,shot;
  if(event){shot='impact';target=event.point;eye=[target[0]+8,2.3,target[2]+9];this.prediction={at:time,expectedAt:time+event.time,point:target,distance:event.distance};}
  else if(phase<5){shot='drone';target=body?[body.position[0],.7,body.position[2]]:[origin[0],1,origin[2]];eye=[target[0]-25+phase*3,29-phase,target[2]+22-phase*2];}
  else if(phase<11&&body){shot='wing';eye=attachedPoint([1.0,.5,-1.7],body);target=attachedPoint([8,.5,1.0],body);}
  else if(phase<13&&body){shot='side';eye=attachedPoint([-.8,.9,-4.5],body);target=[body.position[0]+body.velocity[0]*.16,body.position[1],body.position[2]+body.velocity[2]*.16];}
  else if(phase<29){shot='snow-play';const p=people.focus(time);target=p;eye=[p[0]-6,phase<17?5:2.4,p[2]-5];}
  else{shot='scout';const t=smooth((phase-29)/3);eye=[origin[0]+mix(8,65,t),mix(8,24,t),origin[2]+mix(20,65,t)];target=[origin[0]+mix(0,96,t),1,origin[2]+mix(20,96,t)];}
  if(shot!==this.shot){this.history.push({time,shot});this.history=this.history.slice(-80);}this.shot=shot;
  // Cameras are placed from predicted live motion; a collision is never scripted.
  scene.camera={position:eye,target,fov:shot==='wing'?77:58,aperture:0};return{shot,prediction:this.prediction};
 }
}
