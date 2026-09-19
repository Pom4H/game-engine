import {CAR,puddleAt} from './actors.mjs';
export function waterContact(scene,x,z){
 let wet=0;for(let i=0;i<2;i++){const surface=scene.winter.sample('puddle'+i,x,z);if(surface)wet=Math.max(wet,Math.min(1,surface.waterDepthM/.004)*puddleAt(x,z));}return wet;
}
export class WetSpray {
 constructor(scene){this.particles=[];this.sequence=0;this.emitted=0;for(let i=0;i<96;i++)scene.add({id:'spray-'+i,position:[0,-1000,0],mesh:{kind:'sphere',radius:.5,segments:6},scale:[.01,.02,.01],material:{kind:'default',color:[.54,.61,.65,.58],roughness:.12}});}
 step(scene,time){
  const x=CAR.startX+time*CAR.speed;
  for(const axle of [-1.301,1.536])for(const side of [-1,1]){
   const z=CAR.z+side*.80,wet=waterContact(scene,x+axle,z);
   if(wet>.10&&scene.tick%2===0){
    const index=this.sequence++%96,a=this.sequence*2.39996,life=.23+((this.sequence*17)%19)/100,velocity=[-.5+Math.sin(a)*.4,.55+wet*.8,side*(.5+wet)],p={index,born:time,life,origin:[x+axle,.05,z],velocity};this.particles=this.particles.filter(p=>p.index!==index);this.particles.push(p);this.emitted++;
   }
  }
  this.particles=this.particles.filter(p=>{const age=time-p.born,e=scene.entities.get('spray-'+p.index);if(age>p.life){e.position=[0,-1000,0];return false;}e.position=p.origin.map((v,i)=>v+p.velocity[i]*age+(i===1?-4.905*age*age:0));if(e.position[1]<.008)e.position[1]=.008;e.scale=[.009,.022*(1-age/p.life)+.006,.009];return true;});
 }
 amount(scene,time){const x=CAR.startX+time*CAR.speed;return Math.max(...[-1.301,1.536].flatMap(a=>[-1,1].map(s=>waterContact(scene,x+a,CAR.z+s*.80))));}
}
