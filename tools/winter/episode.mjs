import {CAR_ORIGIN,FINISH} from './scene.mjs';

/** Example-level goals; simulation, footprints and wet tyre effects stay in the engine. */
export class WinterEpisode {
 constructor(scene,vehicleParts){
  this.scene=scene;this.vehicleParts=vehicleParts;this.started=false;this.distance=0;this.sawSpray=false;
  this.last=[...scene.spec.animation.walkers[0].root];
  scene.use({id:'winter:goals',phase:'commit',rateHz:10,context:'none',reads:['animation','surface-contacts'],writes:['winter:goals'],after:['engine:clock'],run:()=>{
   const position=scene.animation.pose('walker').position;
   this.distance+=Math.hypot(position[0]-this.last[0],position[2]-this.last[2]);this.last=[...position];
   this.sawSpray ||= this.started&&scene.contacts.sprayEmitted>=12;
   // Release the cast after it clears the courtyard, before it reaches the road edge.
   const departed=scene.entities.get('car-body')?.position[0]>30;
   return[{type:'resource',key:'winter:goals',value:this.inspect()},...(departed?vehicleParts.map(part=>({type:'remove',id:part.id})):[])];
  }});
 }
 canInteract(){
  if(this.started)return false;
  const person=this.scene.animation.pose('walker')?.position??this.last;
  const dx=Math.max(0,Math.abs(person[0]-CAR_ORIGIN[0])-2.4),dz=Math.max(0,Math.abs(person[2]-CAR_ORIGIN[2])-.99);
  return Math.hypot(dx,dz)<1.8;
 }
 interact(){
  if(!this.canInteract())return false;
  this.scene.animation.addVehicle({id:'winter-car',velocity:[2.4,0,0],startTime:this.scene.time,parts:this.vehicleParts});
  this.started=true;return true;
 }
 inspect(){
  const person=this.scene.animation.pose('walker')?.position??this.last;
  const footprints=this.scene.contacts.footprints.snapshot().length;
  const goals=[footprints>=8,this.sawSpray,this.started&&this.sawSpray&&Math.hypot(person[0]-FINISH[0],person[2]-FINISH[2])<1.8];
  return{goals,complete:goals.every(Boolean),distanceM:this.distance,footprints,carStarted:this.started,canInteract:this.canInteract(),sprayEmitted:this.scene.contacts.sprayEmitted,wetness:this.scene.contacts.wetness,time:this.scene.time};
 }
}
