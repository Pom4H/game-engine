export type StructureV3=[number,number,number];

export type StructuralMaterial=Readonly<{
 stiffness:number;
 damping:number;
 yieldTension:number;
 yieldCompression:number;
 fractureTension:number;
 fractureCompression:number;
 plasticity:number;
}>;

export type StructuralNodeDefinition=Readonly<{
 position:StructureV3;
 mass:number;
 tags?:readonly string[];
}>;

export type StructuralLinkDefinition=Readonly<{
 a:number;
 b:number;
 material:StructuralMaterial;
 area?:number;
 tags?:readonly string[];
}>;

export type StructuralTemplate=Readonly<{
 nodes:readonly StructuralNodeDefinition[];
 links:readonly StructuralLinkDefinition[];
}>;

export type StructuralState={
 positions:StructureV3[];
 velocities:StructureV3[];
 restLengths:number[];
 broken:Uint8Array;
 sleeping:boolean;
 quietTime:number;
 revision:number;
};

export type StructuralBinding=Readonly<{
 rest:StructureV3;
 nodes:readonly number[];
 weights:readonly number[];
}>;

export type StructuralStepOptions=Readonly<{
 gravity?:StructureV3;
 iterations?:number;
 sleepSpeed?:number;
 sleepStrain?:number;
 sleepAfter?:number;
}>;

export type StructuralMetrics=Readonly<{
 maxSpeed:number;
 maxStrain:number;
 brokenLinks:number;
 kineticEnergy:number;
 sleeping:boolean;
 revision:number;
}>;

const EPS=1e-9;
const previousPositions=new WeakMap<StructuralState,StructureV3[]>();
const clone3=(v:readonly number[]):StructureV3=>[Number(v[0])||0,Number(v[1])||0,Number(v[2])||0];
const distance=(a:readonly number[],b:readonly number[])=>Math.hypot((b[0]??0)-(a[0]??0),(b[1]??0)-(a[1]??0),(b[2]??0)-(a[2]??0));
const finite3=(v:readonly number[])=>v.length===3&&v.every(Number.isFinite);
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));

function validateMaterial(material:StructuralMaterial){
 const values=[material.stiffness,material.damping,material.yieldTension,material.yieldCompression,material.fractureTension,material.fractureCompression,material.plasticity];
 if(!values.every(Number.isFinite))throw new TypeError('Structural material values must be finite');
 if(material.stiffness<0||material.stiffness>1)throw new RangeError('Structural stiffness must be in 0..1');
 if(material.damping<0||material.damping>1)throw new RangeError('Structural damping must be in 0..1');
 if(material.plasticity<0||material.plasticity>1)throw new RangeError('Structural plasticity must be in 0..1');
 if(material.yieldTension<0||material.yieldCompression<0)throw new RangeError('Structural yield strain must be non-negative');
 if(material.fractureTension<=material.yieldTension||material.fractureCompression<=material.yieldCompression)throw new RangeError('Structural fracture strain must exceed yield strain');
 if(material.yieldCompression>=.95||material.fractureCompression>=.99)throw new RangeError('Compression strain limits must stay below collapse');
}

export function validateStructuralTemplate(template:StructuralTemplate){
 if(!template.nodes.length)throw new RangeError('Structural template requires at least one node');
 for(const node of template.nodes){
  if(!finite3(node.position))throw new TypeError('Structural node position must be a finite vec3');
  if(!Number.isFinite(node.mass)||node.mass<0)throw new RangeError('Structural node mass must be non-negative');
 }
 for(const link of template.links){
  if(!Number.isInteger(link.a)||!Number.isInteger(link.b)||link.a<0||link.b<0||link.a>=template.nodes.length||link.b>=template.nodes.length||link.a===link.b)throw new RangeError('Structural link endpoints are invalid');
  if(link.area!==undefined&&(!Number.isFinite(link.area)||link.area<=0))throw new RangeError('Structural link area must be positive');
  validateMaterial(link.material);
  const a=template.nodes[link.a]!,b=template.nodes[link.b]!;
  if(distance(a.position,b.position)<EPS)throw new RangeError('Structural link rest length must be positive');
 }
 return template;
}

export function createStructuralState(template:StructuralTemplate):StructuralState{
 validateStructuralTemplate(template);
 return {
  positions:template.nodes.map(node=>clone3(node.position)),
  velocities:template.nodes.map(()=>[0,0,0]),
  restLengths:template.links.map(link=>distance(template.nodes[link.a]!.position,template.nodes[link.b]!.position)),
  broken:new Uint8Array(template.links.length),
  sleeping:false,
  quietTime:0,
  revision:0
 };
}

export function wakeStructure(state:StructuralState){state.sleeping=false;state.quietTime=0;}

export function applyStructuralImpulse(template:StructuralTemplate,state:StructuralState,point:readonly number[],impulse:readonly number[],radius:number){
 if(!finite3(point)||!finite3(impulse))throw new TypeError('Structural impulse requires finite vec3 values');
 if(!Number.isFinite(radius)||radius<=0)throw new RangeError('Structural impulse radius must be positive');
 const weights=template.nodes.map((node,index)=>{
  if(!(node.mass>0))return 0;
  const p=state.positions[index]!;const d2=(p[0]-(point[0]??0))**2+(p[1]-(point[1]??0))**2+(p[2]-(point[2]??0))**2;
  return Math.exp(-d2/(2*radius*radius));
 });
 let total=weights.reduce((sum,value)=>sum+value,0);
 if(total<EPS){let nearest=-1,best=Infinity;for(let i=0;i<template.nodes.length;i++){const node=template.nodes[i]!;if(!(node.mass>0))continue;const d=distance(state.positions[i]!,point);if(d<best){best=d;nearest=i;}}if(nearest>=0){weights[nearest]=1;total=1;}}
 if(total<EPS)return;
 for(let i=0;i<template.nodes.length;i++){
  const node=template.nodes[i]!,weight=weights[i]??0;if(!(node.mass>0)||weight<=0)continue;const fraction=weight/total,v=state.velocities[i]!;
  v[0]+=(impulse[0]??0)*fraction/node.mass;v[1]+=(impulse[1]??0)*fraction/node.mass;v[2]+=(impulse[2]??0)*fraction/node.mass;
 }
 wakeStructure(state);state.revision++;
}

function dampLinkVelocity(template:StructuralTemplate,state:StructuralState,index:number){
 if(state.broken[index])return;const link=template.links[index]!,material=link.material;if(material.damping<=0)return;
 const a=state.positions[link.a]!,b=state.positions[link.b]!,va=state.velocities[link.a]!,vb=state.velocities[link.b]!,na=template.nodes[link.a]!,nb=template.nodes[link.b]!,dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz)||1,ux=dx/length,uy=dy/length,uz=dz/length,relative=(vb[0]-va[0])*ux+(vb[1]-va[1])*uy+(vb[2]-va[2])*uz,invA=na.mass>0?1/na.mass:0,invB=nb.mass>0?1/nb.mass:0,sum=invA+invB;
 if(sum<=0)return;const impulse=relative*material.damping/sum;
 va[0]+=ux*impulse*invA;va[1]+=uy*impulse*invA;va[2]+=uz*impulse*invA;vb[0]-=ux*impulse*invB;vb[1]-=uy*impulse*invB;vb[2]-=uz*impulse*invB;
}

function solveLink(template:StructuralTemplate,state:StructuralState,index:number){
 if(state.broken[index])return false;const link=template.links[index]!,a=state.positions[link.a]!,b=state.positions[link.b]!,na=template.nodes[link.a]!,nb=template.nodes[link.b]!,material=link.material,dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz)||EPS,rest=Math.max(EPS,state.restLengths[index]!),strain=(length-rest)/rest;
 if(strain>material.fractureTension||-strain>material.fractureCompression){state.broken[index]=1;state.revision++;return true;}
 const tension=strain>=0,yieldStrain=tension?material.yieldTension:material.yieldCompression;
 if(Math.abs(strain)>yieldStrain&&material.plasticity>0){
  const target=tension?length/(1+yieldStrain):length/(1-yieldStrain),next=rest+(target-rest)*material.plasticity;
  if(Math.abs(next-rest)>1e-7){state.restLengths[index]=next;state.revision++;}
 }
 const currentRest=Math.max(EPS,state.restLengths[index]!),error=length-currentRest;if(Math.abs(error)<1e-8||material.stiffness<=0)return false;
 const invA=na.mass>0?1/na.mass:0,invB=nb.mass>0?1/nb.mass:0,sum=invA+invB;if(sum<=0)return false;
 const scale=error/length*material.stiffness,shareA=scale*invA/sum,shareB=scale*invB/sum;
 a[0]+=dx*shareA;a[1]+=dy*shareA;a[2]+=dz*shareA;b[0]-=dx*shareB;b[1]-=dy*shareB;b[2]-=dz*shareB;
 return false;
}

export function structuralMetrics(template:StructuralTemplate,state:StructuralState):StructuralMetrics{
 let maxSpeed=0,maxStrain=0,brokenLinks=0,kineticEnergy=0;
 for(let i=0;i<template.nodes.length;i++){const node=template.nodes[i]!,v=state.velocities[i]!,speed=Math.hypot(v[0],v[1],v[2]);maxSpeed=Math.max(maxSpeed,speed);kineticEnergy+=.5*node.mass*speed*speed;}
 for(let i=0;i<template.links.length;i++){if(state.broken[i]){brokenLinks++;continue;}const link=template.links[i]!,a=state.positions[link.a]!,b=state.positions[link.b]!,rest=Math.max(EPS,state.restLengths[i]!),strain=Math.abs(distance(a,b)-rest)/rest;maxStrain=Math.max(maxStrain,strain);}
 return {maxSpeed,maxStrain,brokenLinks,kineticEnergy,sleeping:state.sleeping,revision:state.revision};
}

export function stepStructuralGraph(template:StructuralTemplate,state:StructuralState,dt:number,options:StructuralStepOptions={}):StructuralMetrics{
 if(!Number.isFinite(dt)||dt<=0||dt>1/20)throw new RangeError('Structural step requires 0 < dt <= 1/20');
 if(state.positions.length!==template.nodes.length||state.velocities.length!==template.nodes.length||state.restLengths.length!==template.links.length||state.broken.length!==template.links.length)throw new RangeError('Structural state does not match template');
 if(state.sleeping)return structuralMetrics(template,state);
 const gravity=options.gravity??[0,0,0],iterations=Math.max(1,Math.min(12,Math.trunc(options.iterations??4)));
 let before=previousPositions.get(state);if(!before||before.length!==state.positions.length){before=state.positions.map(clone3);previousPositions.set(state,before);}else for(let i=0;i<before.length;i++){const p=state.positions[i]!,b=before[i]!;b[0]=p[0];b[1]=p[1];b[2]=p[2];}
 if(!finite3(gravity))throw new TypeError('Structural gravity must be a finite vec3');
 for(let i=0;i<template.links.length;i++)dampLinkVelocity(template,state,i);
 for(let i=0;i<template.nodes.length;i++){
  const node=template.nodes[i]!,v=state.velocities[i]!,p=state.positions[i]!;if(!(node.mass>0)){v[0]=v[1]=v[2]=0;continue;}
  v[0]+=(gravity[0]??0)*dt;v[1]+=(gravity[1]??0)*dt;v[2]+=(gravity[2]??0)*dt;p[0]+=v[0]*dt;p[1]+=v[1]*dt;p[2]+=v[2]*dt;
 }
 for(let pass=0;pass<iterations;pass++)for(let i=0;i<template.links.length;i++)solveLink(template,state,i);
 for(let i=0;i<template.nodes.length;i++){
  const node=template.nodes[i]!,v=state.velocities[i]!,p=state.positions[i]!,prev=before[i]!;if(!(node.mass>0)){v[0]=v[1]=v[2]=0;continue;}
  v[0]=(p[0]-prev[0])/dt;v[1]=(p[1]-prev[1])/dt;v[2]=(p[2]-prev[2])/dt;
 }
 const metrics=structuralMetrics(template,state),sleepSpeed=Math.max(0,options.sleepSpeed??.015),sleepStrain=Math.max(0,options.sleepStrain??.002),sleepAfter=Math.max(0,options.sleepAfter??.5);
 if(metrics.maxSpeed<=sleepSpeed&&metrics.maxStrain<=sleepStrain){state.quietTime+=dt;if(state.quietTime>=sleepAfter){state.sleeping=true;for(const velocity of state.velocities){velocity[0]=velocity[1]=velocity[2]=0;}}}else state.quietTime=0;
 return state.sleeping?{...metrics,sleeping:true,maxSpeed:0,kineticEnergy:0}:metrics;
}

export function bindPointToStructure(template:StructuralTemplate,point:readonly number[],influences=4):StructuralBinding{
 if(!finite3(point))throw new TypeError('Structural binding point must be a finite vec3');const count=Math.max(1,Math.min(template.nodes.length,Math.trunc(influences)));
 const ranked=template.nodes.map((node,index)=>({index,d2:(node.position[0]-(point[0]??0))**2+(node.position[1]-(point[1]??0))**2+(node.position[2]-(point[2]??0))**2})).sort((a,b)=>a.d2-b.d2).slice(0,count);
 if(!ranked.length)throw new RangeError('Structural template has no nodes');if((ranked[0]?.d2??Infinity)<EPS)return {rest:clone3(point),nodes:[ranked[0]!.index],weights:[1]};
 const raw=ranked.map(item=>1/Math.max(EPS,item.d2)),sum=raw.reduce((a,b)=>a+b,0);return {rest:clone3(point),nodes:ranked.map(item=>item.index),weights:raw.map(value=>value/sum)};
}

export function deformBoundPoint(template:StructuralTemplate,state:StructuralState,binding:StructuralBinding):StructureV3{
 let x=binding.rest[0],y=binding.rest[1],z=binding.rest[2];for(let i=0;i<binding.nodes.length;i++){
  const index=binding.nodes[i]!,weight=binding.weights[i]??0,node=template.nodes[index],position=state.positions[index];if(!node||!position)continue;
  x+=(position[0]-node.position[0])*weight;y+=(position[1]-node.position[1])*weight;z+=(position[2]-node.position[2])*weight;
 }
 return [x,y,z];
}

export function deformPointByStructure(template:StructuralTemplate,state:StructuralState,point:readonly number[],influences=4){return deformBoundPoint(template,state,bindPointToStructure(template,point,influences));}

export function structuralMaterial(material:StructuralMaterial){validateMaterial(material);return Object.freeze({...material});}
