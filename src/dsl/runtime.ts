import {Scene} from '../scene/scene.js';
import type {EntitySpec,Primitive} from '../scene/types.js';
import type {Vec3,MutableVec3} from '../math.js';
import {V3,finiteVec3} from '../math.js';
import {validateScene,validateEntity} from '../scene/validate.js';
import {spawnVehicle,type SceneVehicle} from '../vehicles/scene-vehicle.js';
import {vehicle} from '../vehicles/components.js';
import {generateM3ProceduralWheelVehicle,M3_VEHICLE_DEFINITION,m3PartMaterial} from '../vehicles/m3.js';
import {compileVehicle,PICKUP_CANOPY_VEHICLE_DEFINITION} from '../vehicles/index.js';
import {solveTwoBone,type HumanoidJoint,type HumanoidBinding} from '../animation/locomotion.js';
import {StructuralBody,type StructuralConstraintSpec} from '../physics/structure.js';
import {StructuralStaticContactSolver} from '../physics/structural-contact.js';
import {SpatialHash} from '../core/spatial-hash.js';
import {ModuleScheduler} from '../core/kernel.js';
import {mulberry32} from '../core/random.js';
import type {Program,Item,Walker,KinematicArm,SpatialQuery,Schedule,Structure} from './index.js';

/** Validates data arriving from an untrusted compiler worker before any GPU/scene allocation. */
export function validateProgram(input:unknown):Program {
 let count=0;const visit=(v:unknown,depth=0):void=>{
  if(++count>500000||depth>32)throw new RangeError('Scene data budget exceeded');
  if(typeof v==='number'&&!Number.isFinite(v))throw new TypeError('Scene contains a non-finite number');
  if(typeof v==='string'&&v.length>16384)throw new RangeError('Scene string exceeds budget');
  if(v&&typeof v==='object'){
   if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)throw new TypeError('Only plain scene data is accepted');
   for(const [k,x] of Object.entries(v)){if(['texture','environmentRadiance'].includes(k))throw new TypeError('External textures/HDR are not enabled in the code sandbox');if(['__proto__','prototype','constructor'].includes(k))throw new TypeError('Reserved scene key');visit(x,depth+1);}
  }else if(!['undefined','number','string','boolean'].includes(typeof v)&&v!==null)throw new TypeError('Non-data scene value');
 };
 visit(input);const p=input as Program;
 if(!p||p.version!==1||!Array.isArray(p.items)||p.items.length>128||!p.stage)throw new TypeError('Export default scene(stage, items)');
 const ids=new Set<string>();let vertices=0,vehicles=0,walkers=0,structures=0;
 for(const item of p.items){
  const id='kind'in item&&item.kind==='vehicle'?item.blueprint?.source?.id:(item as EntitySpec).id;
  if(typeof id!=='string'||!id||id.length>100||ids.has(id))throw new TypeError('Scene items need unique IDs of at most 100 characters');ids.add(id);
  if('kind'in item){if(item.kind==='vehicle'){
   vehicles++;if(!item.controls||!['m3','pickup'].includes(item.model)||typeof item.damage!=='boolean')throw new TypeError('Invalid vehicle placement');
   finiteVec3(item.position,'Vehicle position');if(item.velocity)finiteVec3(item.velocity,'Vehicle velocity');
   for(const [key,value]of Object.entries(item.controls))if(!['throttle','brake','steer','flap','pitch','roll'].includes(key)||typeof value!=='number'||value<(key==='brake'?0:-1)||value>1)throw new RangeError('Invalid vehicle control '+key);
   if(item.paint)validateEntity({id:'paint',material:item.paint});
  }if(item.kind==='walker')walkers++;if(item.kind==='structure')structures++;}
  if(!('kind'in item)){
   for(const mesh of [(item as EntitySpec).mesh,(item as EntitySpec).renderMesh])if(mesh?.kind==='triangle-mesh')vertices+=mesh.positions.length/3;
   if((item as EntitySpec).material?.texture)throw new TypeError('External textures are not enabled in the code sandbox');
  }else if(!['vehicle','walker','arm','spatial','schedule','structure'].includes(item.kind))throw new TypeError(`Unknown DSL item ${item.kind}`);
 }
 if(vehicles>4||walkers>8||structures>1)throw new RangeError('Scene budget: 4 vehicles / 8 figures / 1 structural lab');
 if(vertices>40000)throw new RangeError('Authored mesh budget is 40,000 vertices');
 if(p.input&&!ids.has(p.input)||p.follow&&!ids.has(p.follow))throw new TypeError('input/follow must name a scene item');
 if(p.stage.rendering?.environmentRadiance)throw new TypeError('Embedded HDR is not enabled in the code sandbox');
 if(p.preview){range(p.preview.resolutionScale??1,.25,1.5,'Resolution scale');range(p.preview.maxPixelRatio??1.5,1,2,'Pixel ratio');}
 validateScene({version:1,...p.stage,entities:p.items.filter(i=>!('kind'in i))});
 return structuredClone(p);
}
let m3:ReturnType<typeof compileVehicle>|undefined,pickup:ReturnType<typeof compileVehicle>|undefined;
function model(kind:'m3'|'pickup'){
 if(kind==='pickup')return pickup??=compileVehicle(PICKUP_CANOPY_VEHICLE_DEFINITION);
 if(kind!=='m3')throw new TypeError('Unknown vehicle model');
 if(!m3){const geometry=generateM3ProceduralWheelVehicle();m3={...geometry,definition:M3_VEHICLE_DEFINITION,parts:geometry.parts.map(p=>({...p,material:m3PartMaterial(p)}))};}
 return m3;
}
const range=(v:number,min:number,max:number,label:string)=>{if(!Number.isFinite(v)||v<min||v>max)throw new RangeError(label);return v;};
function bones(item:Walker):{entities:EntitySpec[];bindings:HumanoidBinding[]}{
 range(item.speed,0,6,'Walking speed');range(item.height,.5,2,'Figure height scale');finiteVec3(item.position,'Walker position');range(item.heading,-100,100,'Walker heading');
 const pairs:readonly[HumanoidJoint,HumanoidJoint][]=[['leftHip','leftKnee'],['leftKnee','leftAnkle'],['rightHip','rightKnee'],['rightKnee','rightAnkle'],['leftShoulder','leftElbow'],['leftElbow','leftHand'],['rightShoulder','rightElbow'],['rightElbow','rightHand']];
 const entities:EntitySpec[]=[],bindings:HumanoidBinding[]=[];
 const add=(name:string,joint:HumanoidJoint,mesh:Primitive,extra:Partial<HumanoidBinding>={})=>{const id=`${item.id}/${name}`;entities.push({id,collision:'none',mesh,material:{kind:'plastic',color:item.color,roughness:.7}});bindings.push({entity:id,joint,...extra});};
 for(const [a,b]of pairs)add(a,a,{kind:'cylinder',radius:a.includes('Hip')||a.includes('Knee')?.065:.045,height:1,segments:12},{boneTo:b});
 add('torso','chest',{kind:'box',size:[.25,.42,.38]});add('head','head',{kind:'sphere',radius:.12,segments:16});
 for(const side of ['left','right'] as const)add(`${side}boot`,`${side}Foot`,{kind:'box',size:[.26,.13,.13]},{offset:[.02,.07,0],foot:side});
 return{entities,bindings};
}
const TRIANGLES:readonly (readonly[number,number,number])[]=[[0,3,1],[0,2,3],[4,5,7],[4,7,6],[0,1,5],[0,5,4],[2,6,7],[2,7,3],[0,4,6],[0,6,2],[1,3,7],[1,7,5]];
function skin(points:Float64Array):Primitive {
 const positions=Array.from(points),normals=Array<number>(positions.length).fill(0),indices=TRIANGLES.flat();
 for(const [a,b,c]of TRIANGLES){const A=positions.slice(a*3,a*3+3) as MutableVec3,B=positions.slice(b*3,b*3+3) as MutableVec3,C=positions.slice(c*3,c*3+3) as MutableVec3,n=V3.cross(V3.sub(B,A),V3.sub(C,A));for(const i of [a,b,c])for(let k=0;k<3;k++)normals[i*3+k]!+=n[k]!;}
 for(let i=0;i<normals.length;i+=3){const n=V3.normalize(normals.slice(i,i+3) as MutableVec3);normals.splice(i,3,...n);}
 return{kind:'triangle-mesh',positions,normals,indices};
}

const hotMaterial=['color','roughness','metalness','clearcoat','clearcoatRoughness'] as const;
const DEFAULT_RENDERING={sunDirection:[.4,.8,-.3] as Vec3,sunIntensity:2.5,skyColor:[.38,.46,.56] as Vec3,exposure:1,shadowExtent:24,fogDensity:0,sunColor:[1,.97,.92] as Vec3};
function structuralKey(program:Program):string {
 const p=structuredClone(program);delete p.preview;delete p.stage.camera;
 if(p.stage.rendering){for(const key of Object.keys(DEFAULT_RENDERING))delete (p.stage.rendering as Record<string,unknown>)[key];if(!Object.keys(p.stage.rendering).length)delete p.stage.rendering;}
 const strip=(m:import('../scene/types.js').MaterialSpec|undefined)=>{if(!m)return;const alpha=m.color?.[3]??1;for(const key of hotMaterial)delete m[key];(m as Record<string,unknown>).alpha=alpha;};
 for(const item of p.items){if('kind'in item&&item.kind==='vehicle'){item.controls={};strip(item.paint);}else if(!('kind'in item))strip(item.material);}
 return JSON.stringify(p);
}

/** One program instance, one Scene; no user JavaScript executes in this renderer context. */
export class ProgramRuntime {
 readonly scene:Scene;program:Program;readonly vehicles=new Map<string,SceneVehicle>();
 readonly metrics:Record<string,unknown>={};
 private readonly after:((time:number)=>void)[]=[];
 private readonly structures:{body:StructuralBody;contacts:StructuralStaticContactSolver}[]=[];
 private disposed=false;private key='';
 constructor(input:unknown){
  this.program=validateProgram(input);this.key=structuralKey(this.program);const p=this.program,entities:EntitySpec[]=[],walkers=[];
  for(const item of p.items)if(!('kind'in item))entities.push(item);else if(item.kind==='walker'){const rig=bones(item);entities.push(...rig.entities);walkers.push({id:item.id,root:item.position,speed:item.speed,heading:item.heading,heightScale:item.height,bindings:rig.bindings});}
  const spec=validateScene({version:1,environment:{temperatureC:20,humidity:0,groundMoisture:0,precipitation:'arid',snowfall:'none',sunlight:1},...p.stage,rendering:{...DEFAULT_RENDERING,...p.stage.rendering},entities,animation:{walkers,...p.stage.animation}});
  this.scene=new Scene(spec);
  try{
   for(const item of p.items)if('kind'in item){
    switch(item.kind){
     case 'vehicle':{
      const source=item.blueprint.source,bp=vehicle(source.id,source);
      const handle=spawnVehicle(this.scene,bp,model(item.model),{modelOriginM:[0,.75,0],position:item.position,damage:item.damage?{}:false,...(item.paint?{paint:item.paint}:{}),...(item.velocity?{velocity:item.velocity}:{})});
      handle.vehicle.setControls(item.controls);this.vehicles.set(source.id,handle);break;
     }
     case 'arm':this.installArm(item);break;
     case 'spatial':this.installSpatial(item);break;
     case 'schedule':this.installSchedule(item);break;
     case 'structure':this.installStructure(item);break;
    }
   }
   for(const update of this.after)update(0);
  }catch(error){this.scene.dispose();throw error;}
 }
 /** Pure validation first. Shader/camera/control edits preserve Scene, body poses,
  * contacts and lifetime state. Structural edits return false for atomic replacement. */
 reconcile(input:unknown):boolean {
  if(this.disposed)throw new Error('Program disposed');const next=validateProgram(input);
  if(structuralKey(next)!==this.key)return false;
  const materials:import('../scene/types.js').AppearanceMaterialPatch[]=[];
  for(const item of next.items){
   if('kind'in item&&item.kind==='vehicle'){
    const previous=this.program.items.find(p=>'kind'in p&&p.kind==='vehicle'&&p.blueprint.source.id===item.blueprint.source.id);
    if(!previous||!('controls'in previous)||JSON.stringify(previous.controls)!==JSON.stringify(item.controls))this.vehicles.get(item.blueprint.source.id)!.vehicle.setControls({throttle:0,brake:0,steer:0,pitch:0,roll:0,flap:0,...item.controls});
    const defaults=model(item.model).parts.filter(p=>p.role==='paint');
    for(const part of defaults)materials.push({id:`${item.blueprint.source.id}/${part.id}`,set:{color:[.55,.58,.62,1],roughness:.3,metalness:.12,clearcoat:0,clearcoatRoughness:.2,...part.material,...item.paint}});
   }else if(!('kind'in item)&&item.material){
    const original=this.scene.entities.get(item.id),targets=original?[original]:[...this.scene.entities.values()].filter(e=>e.id.startsWith(item.id+':shard:'));
    for(const e of targets)materials.push({id:e.id,set:{color:item.material.color??e.material.profile.color,roughness:item.material.roughness??e.material.profile.optical.roughness,metalness:item.material.metalness??e.material.profile.optical.metalness,clearcoat:item.material.clearcoat??0,clearcoatRoughness:item.material.clearcoatRoughness??.2}});
   }
  }
  if(next.stage.camera&&JSON.stringify(next.stage.camera)!==JSON.stringify(this.program.stage.camera))this.scene.setCamera(next.stage.camera);
  const rendering:Record<string,unknown>={},nextRendering={...DEFAULT_RENDERING,...next.stage.rendering};
  for(const [key,value]of Object.entries(nextRendering))if(JSON.stringify(value)!==JSON.stringify((this.scene.spec.rendering as Record<string,unknown>)?.[key]))rendering[key]=value;
  const changed=materials.map(patch=>{
   const current=this.scene.entities.get(patch.id!)!.material,set:Record<string,unknown>={};
   for(const key of hotMaterial)if(patch.set[key]!==undefined&&JSON.stringify(patch.set[key])!==JSON.stringify(current[key]))set[key]=patch.set[key];
   return {...patch,set};
  }).filter(p=>Object.keys(p.set).length);
  if(Object.keys(rendering).length||changed.length)this.scene.patchAppearance({...(Object.keys(rendering).length?{rendering}:{}),materials:changed});
  this.program=next;return true;
 }
 step(dt=1/60):void {
  if(this.disposed)throw new Error('Program disposed');if(dt!==1/60)throw new RangeError('Program step is fixed at 1/60 s');
  for(const structure of this.structures)for(let i=0;i<2;i++){
   // Isolated static-contact lab: these are the only nodal masses, no duplicate rigid proxy.
   structure.body.step(dt/2,this.scene.physics.gravity,b=>structure.contacts.project(b));
  }
  this.scene.step(dt);for(const update of this.after)update(this.scene.time);
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.scene.dispose();this.after.length=0;this.structures.length=0;this.vehicles.clear();}
 private installArm(a:KinematicArm):void{
  for(const p of [a.root,a.target,a.pole])finiteVec3(p,'Arm point');range(a.upper,.05,5,'Upper arm');range(a.lower,.05,5,'Lower arm');range(a.swing,0,2,'Arm swing');
  const links=[0,1].map(i=>this.scene.add({id:`${a.id}/bone${i}`,collision:'none',mesh:{kind:'cylinder',radius:.055,height:1,segments:16},material:{kind:'aluminum',color:[.52,.62,.75,1],roughness:.25}}));
  const joints=[0,1,2].map(i=>this.scene.add({id:`${a.id}/joint${i}`,collision:'none',mesh:{kind:'sphere',radius:.09,segments:16},material:{kind:'plastic',color:[.9,.47,.22,1]}}));
  const target=this.scene.add({id:`${a.id}/target`,collision:'none',mesh:{kind:'sphere',radius:.045,segments:12},material:{color:[.9,.8,.2,1],emissive:[.1,.05,0]}});
  this.after.push(t=>{const requested:Vec3=[a.target[0]+Math.sin(t)*a.swing,a.target[1],a.target[2]],result=solveTwoBone(a.root,requested,a.upper,a.lower,a.pole),points=[a.root,result.joint,result.end];
   target.position.splice(0,3,...requested);for(let i=0;i<3;i++)joints[i]!.position.splice(0,3,...points[i]!);
   for(let i=0;i<2;i++){const d=V3.sub(points[i+1]!,points[i]!),length=V3.length(d),e=links[i]!;e.position.splice(0,3,...V3.scale(V3.add(points[i]!,points[i+1]!),.5));e.scale[1]=length;e.rotation.splice(0,3,Math.atan2(d[2],d[1]),0,Math.asin(Math.max(-1,Math.min(1,-d[0]/length))));}
   this.metrics[a.id]={requested,end:result.end,error:V3.length(V3.sub(result.end,requested))};
  });
 }
 private installSpatial(q:SpatialQuery):void{
  range(q.count,1,256,'Spatial object count');if(!Number.isInteger(q.count))throw new TypeError('Object count must be integer');range(q.cell,.25,10,'Cell size');range(q.radius,.2,8,'Query radius');finiteVec3(q.at,'Query point');
  const random=mulberry32(q.seed),items=Array.from({length:q.count},(_,i)=>({id:i,x:(random()-.5)*16,z:(random()-.5)*16})),index=new SpatialHash(q.cell);
  for(const item of items)index.add(item,0);const candidates=index.near(q.at[0],q.at[2],q.radius),candidateSet=new Set(candidates),exact=new Set(candidates.filter(p=>Math.hypot(p.x-q.at[0],p.z-q.at[2])<=q.radius));index.near(q.at[0],q.at[2],q.radius);
  for(const item of items)this.scene.add({id:`${q.id}/${item.id}`,collision:'none',mesh:{kind:'sphere',radius:.075,segments:8},position:[item.x,.15,item.z],material:{color:exact.has(item)?[.1,.75,.5,1]:candidateSet.has(item)?[.95,.56,.1,1]:[.33,.38,.44,1]}});
  this.scene.add({id:`${q.id}/range`,collision:'none',mesh:{kind:'torus',radius:q.radius,tube:.025,segments:64},position:q.at,material:{color:[.15,.7,.7,1]}});
  this.metrics[q.id]={exact:exact.size,candidates:candidates.length,total:items.length,...index.diagnostics};
 }
 private installSchedule(s:Schedule):void{
  const scheduler=new ModuleScheduler(),descriptions=[{id:'input',phase:'input',rateHz:60,reads:[],writes:['control']},{id:'intent',phase:'plan',rateHz:s.rate,reads:['control'],writes:['intent']},{id:'route',phase:'plan',rateHz:20,reads:[],writes:[s.conflict?'intent':'route']},{id:'physics',phase:'simulate',rateHz:60,reads:['intent'],writes:['pose']},{id:'publish',phase:'publish',rateHz:20,reads:['pose'],writes:[]}] as const;
  for(const d of descriptions)scheduler.use(d);scheduler.plan(0);
  const boxes=descriptions.map((d,i)=>this.scene.add({id:`${s.id}/${d.id}`,collision:'none',mesh:{kind:'box',size:[.6,.25,.6]},position:[i*.9-1.8,.4,0],material:{color:[.2,.4,.65,1]}}));
  this.after.push(t=>{const tick=Math.floor(t*60),plan=scheduler.plan(tick),active=new Set(plan.flatMap(p=>p.modules.map(m=>m.id)));for(let i=0;i<boxes.length;i++)boxes[i]!.scale[1]=active.has(descriptions[i]!.id)?4:1;this.metrics[s.id]={tick,active:[...active],...scheduler.diagnostics};});
 }
 private installStructure(s:Structure):void{
  range(s.mass,1,10000,'Structural mass');range(s.height,1,8,'Drop height');range(s.stiffness,1e4,1e9,'Structural modulus');range(s.yieldStrain,.001,.5,'Yield strain');finiteVec3(s.velocity,'Initial velocity');
  if(this.scene.physics.bodies.size&&[...this.scene.physics.bodies.values()].some(b=>b.invMass))throw new TypeError('This structural lab supports static contacts, not a coupled rigid/soft assembly');
  const positions:Vec3[]=[];for(const x of [-.65,.65])for(const y of [-.45,.45])for(const z of [-.5,.5])positions.push([x,y+s.height,z]);
  const material={youngModulusPa:s.stiffness,yieldStressPa:s.stiffness*s.yieldStrain,failureStressPa:s.stiffness,brittle:false,plasticity:.75,failureStrain:.9},constraints:StructuralConstraintSpec[]=[];
  for(let a=0;a<8;a++)for(let b=a+1;b<8;b++)constraints.push({kind:'distance',a,b,areaM2:.015,material});
  const structure=new StructuralBody({nodes:positions.map(position=>({position,mass:s.mass/8})),constraints,collisionTriangles:TRIANGLES,iterations:8,sleepDelay:10});
  structure.activateFromRigid([0,s.height,0],s.velocity,[0,0,0]);this.structures.push({body:structure,contacts:new StructuralStaticContactSolver([{center:[0,-.05,0],half:[30,.05,30]}],TRIANGLES)});
  const e=this.scene.add({id:s.id,collision:'none',mesh:skin(structure.position),material:{kind:'aluminum',color:[.5,.28,.14,1],roughness:.36}});
  let last=-1;this.after.push(()=>{if(last!==structure.steps){last=structure.steps;e.mesh=skin(structure.position);this.scene.renderStructureRevision++;}this.metrics[s.id]=structure.stats;});
 }
}
