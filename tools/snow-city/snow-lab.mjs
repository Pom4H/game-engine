import {SnowMatter,emptySnow,combineSnow,snowThermal} from '../../dist/environment/snow-matter.js';
import {freezePrimitive} from '../../dist/procedural/mesh.js';

/** Non-playable material fixture. The exact same SnowMatter is used by tyres,
 * residents and the plough in the live authority. This is a finite observation
 * window into that field, not another implementation of snow. */
export class SnowLaboratory {
 constructor(scene){this.scene=scene;this.snow=new SnowMatter({cellM:.1,depthM:.48,maxCells:65000});this.held=emptySnow();this.heatJ=0;this.transferredKg=0;this.revision=-1;this.clump=null;
  scene.add({id:'snow-lab-ground',position:[0,-.06,0],mesh:{kind:'box',size:[4.4,.12,4.4]},material:{kind:'default',color:[.16,.21,.26,1],roughness:.82}});
  scene.add({id:'snow-lab-tool',visualOnly:true,position:[0,2,0],mesh:{kind:'box',size:[.3,.025,.3]},material:{kind:'steel',color:[.52,.59,.67,.65],metalness:.8,roughness:.3}});this.publish();
 }
 apply({x,z,tool='dig',shape='round',radius=.25,depth=.22,temperature=0,dt=.1}){
  if(![x,z,radius,depth,temperature,dt].every(Number.isFinite)||Math.abs(x)>1.65||Math.abs(z)>1.65||radius<.05||radius>.35||depth<.02||depth>1||dt<=0||dt>.25||temperature< -30||temperature>200)throw RangeError('Tool outside laboratory limits');
  const h=this.snow.sample(x,z).height,y=Math.max(.025,h-depth),bounds={min:[x-radius,Math.max(0,h-depth),z-radius],max:[x+radius,h+.02,z+radius]};
  this.scene.setVisualTransform('snow-lab-tool',[x,y,z],[0,0,0],[radius/.15,1,radius/.15]);
  if(tool==='dig'){
   const cut=this.snow.cut({...bounds,distance:p=>shape==='square'?Math.max(Math.abs(p[0]-x)-radius,Math.abs(p[2]-z)-radius):shape==='blade'?Math.max(Math.abs(p[0]-x)-radius,Math.abs(p[2]-z)-.045):Math.hypot(p[0]-x,p[2]-z)-radius},dt*70);this.held=combineSnow(this.held,cut);this.transferredKg+=cut.massKg;
  }else if(tool==='dump'){
   const amount=Math.min(1,dt*70/Math.max(.001,this.held.massKg)),take={...this.held,massKg:this.held.massKg*amount,volumeM3:this.held.volumeM3*amount,enthalpyJ:this.held.enthalpyJ*amount};
   const rest=this.snow.pour([x,0,z],take,radius),used=take.massKg-rest.massKg,f=used/Math.max(1e-12,this.held.massKg);this.held={...this.held,massKg:this.held.massKg-used,volumeM3:this.held.volumeM3*(1-f),enthalpyJ:this.held.enthalpyJ*(1-f)};
  }else if(tool==='press'||tool==='heat'){
   const heat=tool==='heat'?Math.max(0,temperature)*120*dt:0;this.snow.contact({position:[x,h,z],radiusM:radius,normalLoadN:tool==='press'?5000:100,slipSpeedMps:0,durationSeconds:dt,temperatureC:temperature,heatJ:heat});
  }else if(tool==='roll'){
   this.clump??={p:[x,h+.2,z],packet:emptySnow()};const pressure=12000,sticky=this.snow.adhesion(this.snow.cell(Math.floor(x/.1),Math.floor(Math.max(0,h-.01)/.1),Math.floor(z/.1)),temperature,pressure);
   const packet=this.snow.cut({...bounds,distance:p=>Math.hypot(p[0]-x,p[2]-z)-radius},Math.max(.05,sticky)*dt*20);this.clump.packet=combineSnow(this.clump.packet,packet);this.clump.p=[x,h+Math.cbrt(this.clump.packet.volumeM3*3/(4*Math.PI)),z];
  }
  this.snow.relax(dt,300);this.publish();return this.metrics(x,z);
 }
 tunnel(){
  // A horizontal capsule removes material below an intact roof. A height-only
  // stamp cannot pass this test: both the roof and the empty cavity must remain.
  const removed=this.snow.cut({min:[-2,.10,-.23],max:[.8,.35,.23],distance:p=>Math.hypot(p[1]-.23,p[2])-.12});this.held=combineSnow(this.held,removed);this.publish();return this.metrics(0,0);
 }
 metrics(x=0,z=0){let delta=0;for(const [key,c]of this.snow.cells){const y=+key.split(',')[1],baseline=.01*Math.max(0,Math.min(.1,.48-y*.1))*160;delta+=c.massKg-baseline;}const carried=this.held.massKg+(this.clump?.packet.massKg??0),state=this.snow.sample(x,z);return{cellM:.1,changedCells:this.snow.cells.size,groundDeltaKg:delta,carriedKg:carried,massErrorKg:delta+carried,heatAddedJ:this.snow.heatAddedJ,depthM:state.depthM,temperatureC:state.temperatureC,liquidFraction:state.liquidFraction,adhesion:this.snow.adhesion(this.snow.cell(Math.floor(x/.1),0,Math.floor(z/.1)),0,12000)};}
 publish(){
  if(this.revision!==this.snow.revision){
   const positions=[],normals=[],indices=[],s=.1;
   const quad=(v,n)=>{const at=positions.length/3;for(const p of v){positions.push(...p);normals.push(...n);}indices.push(at,at+1,at+2,at,at+2,at+3);};
   for(let z=-20;z<20;z++)for(let x=-20;x<20;x++)for(let y=0;y<40;y++){
    const c=this.snow.cell(x,y,z),height=c.volumeM3/(s*s);if(c.massKg<1e-8)continue;const a=x*s,b=z*s,lo=y*s,hi=lo+height;
    const above=this.snow.cell(x,y+1,z);if(height<s-.000001||above.massKg<1e-8)quad([[a,hi,b],[a,hi,b+s],[a+s,hi,b+s],[a+s,hi,b]],[0,1,0]);
    const below=this.snow.cell(x,y-1,z);if(y>0&&below.volumeM3<s**3-.000001)quad([[a,lo,b],[a+s,lo,b],[a+s,lo,b+s],[a,lo,b+s]],[0,-1,0]);
    for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const neighbor=x+dx< -20||x+dx>=20||z+dz< -20||z+dz>=20?0:this.snow.cell(x+dx,y,z+dz).volumeM3/(s*s),low=lo+neighbor;if(low>=hi-.000001)continue;
     if(dx===1)quad([[a+s,low,b],[a+s,hi,b],[a+s,hi,b+s],[a+s,low,b+s]],[1,0,0]);
     if(dx===-1)quad([[a,low,b+s],[a,hi,b+s],[a,hi,b],[a,low,b]],[-1,0,0]);
     if(dz===1)quad([[a+s,low,b+s],[a+s,hi,b+s],[a,hi,b+s],[a,low,b+s]],[0,0,1]);
     if(dz===-1)quad([[a,low,b],[a,hi,b],[a+s,hi,b],[a+s,low,b]],[0,0,-1]);
    }
   }
   const mesh=freezePrimitive({kind:'triangle-mesh',positions,normals,indices}),e=this.scene.entities.get('snow-lab-volume');if(e){e.mesh=mesh;this.scene.renderStructureRevision++;}else this.scene.add({id:'snow-lab-volume',visualOnly:true,mesh,material:{kind:'snow',color:[.85,.91,.98,1],roughness:.91}});this.scene.setVisualTransform('snow-lab-volume',[0,0,0]);this.revision=this.snow.revision;
  }
  if(this.clump?.packet.massKg){if(!this.scene.entities.has('snow-lab-clump'))this.scene.add({id:'snow-lab-clump',visualOnly:true,mesh:{kind:'sphere',radius:1,segments:32},material:{kind:'snow',color:[.85,.91,.98,1],roughness:.9}});const r=Math.cbrt(this.clump.packet.volumeM3*3/(4*Math.PI));this.scene.setVisualTransform('snow-lab-clump',this.clump.p,[0,0,0],[r,r,r]);}
 }
}
