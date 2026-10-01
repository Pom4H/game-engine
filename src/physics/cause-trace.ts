import type {Vec3} from '../math.js';

export const PHYSICS_CAUSE_TRACE_SCHEMA='cause-trace' as const;
export const PHYSICS_CAUSE_TRACE_VERSION='1.0' as const;

export type PhysicsComponentKind='body'|'wheel'|'wing'|'rotor'|'shaft'|'other';
export type PhysicsLawKind='gravity'|'aerodynamics'|'fluid'|'wheel-contact'|'rotor-aerodynamics'|'constraint'|'collision'|'other';
export type PhysicsEffectKind='force'|'torque'|'impulse'|'position-correction'|'velocity-correction'|'angular-velocity-correction'|'power';
export type PhysicsSourceKind='gravity-field'|'air'|'fluid'|'surface'|'body'|'shaft'|'constraint'|'internal';
export type PhysicsEnergyStage='force-driver'|'fluid'|'gravity-integrate'|'contacts-solver';

export interface PhysicsCauseRef {
 readonly componentId:string;
 readonly lawId:string;
 readonly lawKind:PhysicsLawKind;
 readonly effectKinds:readonly PhysicsEffectKind[];
}
export interface PhysicsSourceRef {readonly kind:PhysicsSourceKind;readonly id:string}
export interface PhysicsContributionEffect {
 readonly forceN?:Vec3;
 readonly torqueNm?:Vec3;
 readonly impulseNs?:Vec3;
 readonly positionCorrectionM?:Vec3;
 readonly velocityCorrectionMps?:Vec3;
 readonly angularVelocityCorrectionRadps?:Vec3;
 readonly pointWorldM?:Vec3;
 readonly powerW?:number;
 readonly inputsHash?:string;
}
export interface PhysicsBodyState {
 readonly positionM:Vec3;
 readonly rotationRad:Vec3;
 readonly velocityMps:Vec3;
 readonly angularVelocityRadps:Vec3;
}
export interface PhysicsCauseManifestWriter {
 component(input:{readonly componentId:string;readonly bodyId:string;readonly kind:PhysicsComponentKind;readonly parentComponentId?:string}):void;
 law(bodyId:string,cause:PhysicsCauseRef):void;
}
export interface PhysicsCauseWriter {
 readonly bodyId:string;
 contribute(cause:PhysicsCauseRef,source:PhysicsSourceRef,effect:PhysicsContributionEffect):string;
}

interface Envelope {
 readonly schema:typeof PHYSICS_CAUSE_TRACE_SCHEMA;
 readonly schema_version:typeof PHYSICS_CAUSE_TRACE_VERSION;
 readonly type:string;
 readonly type_version:1;
 readonly seq:number;
 readonly run_id:string;
 readonly tick?:number;
 readonly substep?:number;
 readonly sim_time_s?:number;
}
export type PhysicsTraceRecord=Envelope&Readonly<Record<string,unknown>>;

interface ComponentDefinition {readonly componentId:string;readonly bodyId:string;readonly kind:PhysicsComponentKind;readonly parentComponentId?:string}
interface LawDefinition {readonly bodyId:string;readonly cause:PhysicsCauseRef}
interface ActiveFrame {
 readonly tick:number;readonly substep:number;readonly simTime:number;
 readonly sums:Map<string,{force:[number,number,number];torque:[number,number,number];ids:string[];contactIds:string[]}>;
 readonly writers:Map<string,PhysicsCauseWriter>;readonly activeLawKeys:Set<string>;readonly energySums:Map<string,number>;
}

const finiteVec=(value:Vec3,label:string):void=>{
 if(value.length!==3||!value.every(Number.isFinite))throw new TypeError(`${label} must be a finite vec3`);
};
const sameArray=(a:readonly unknown[],b:readonly unknown[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const cloneVec=(value:Vec3):[number,number,number]=>[value[0],value[1],value[2]];
const magnitude=(v:Vec3)=>Math.hypot(v[0],v[1],v[2]);

export const physicsCause=(componentId:string,lawId:string,lawKind:PhysicsLawKind,effectKinds:readonly PhysicsEffectKind[]):PhysicsCauseRef=>{
 if(!componentId||!lawId||componentId.length>180||lawId.length>180||!effectKinds.length||new Set(effectKinds).size!==effectKinds.length)throw new TypeError('Invalid physics cause');
 return Object.freeze({componentId,lawId,lawKind,effectKinds:Object.freeze([...effectKinds])});
};

/** Complete proof-mode recorder. It never drops records: exceeding maxRecords fails the run.
 * Components/laws for a body become immutable when that body first evaluates. */
export class PhysicsCauseTrace implements PhysicsCauseManifestWriter {
 readonly runId:string;readonly maxRecords:number;
 private sequence=0;
 private readonly records:PhysicsTraceRecord[]=[];
 private readonly components=new Map<string,ComponentDefinition>();
 private readonly laws=new Map<string,LawDefinition>();
 private readonly sealedBodies=new Set<string>();
 private frame:ActiveFrame|undefined;
 private maxForceResidual=0;private maxTorqueResidual=0;private maxEnergyResidual=0;
 constructor(options:{readonly runId?:string;readonly maxRecords?:number}={}){
  this.runId=options.runId??'physics';
  this.maxRecords=options.maxRecords??100_000;
  if(!this.runId||this.runId.length>180||!Number.isSafeInteger(this.maxRecords)||this.maxRecords<128||this.maxRecords>5_000_000)throw new RangeError('Invalid physics trace options');
  this.append('trace.header',{engine:{name:'@rom4/game-engine'},coordinate_system:{handedness:'right',x:'+forward',y:'+up',z:'+right'},units:'SI',float:'f64',deterministic:true});
 }
 private append(type:string,data:Readonly<Record<string,unknown>>):PhysicsTraceRecord{
  if(this.records.length>=this.maxRecords)throw new RangeError('Physics cause trace capacity exceeded; proof would be incomplete');
  const record=Object.freeze({schema:PHYSICS_CAUSE_TRACE_SCHEMA,schema_version:PHYSICS_CAUSE_TRACE_VERSION,type,type_version:1 as const,seq:this.sequence++,run_id:this.runId,...(this.frame?{tick:this.frame.tick,substep:this.frame.substep,sim_time_s:this.frame.simTime}:{}),...data});
  this.records.push(record);return record;
 }
 component(input:{readonly componentId:string;readonly bodyId:string;readonly kind:PhysicsComponentKind;readonly parentComponentId?:string}):void{
  if(!input.componentId||!input.bodyId||input.componentId.length>180||input.bodyId.length>180)throw new TypeError('Invalid physics component');
  if(this.sealedBodies.has(input.bodyId))throw new Error(`Physics cause manifest for ${input.bodyId} is sealed`);
  const componentKey=`${input.bodyId}\0${input.componentId}`,previous=this.components.get(componentKey);
  if(previous){
   if(previous.bodyId!==input.bodyId||previous.kind!==input.kind||previous.parentComponentId!==input.parentComponentId)throw new TypeError(`Conflicting physics component ${input.componentId}`);
   return;
  }
  const definition:ComponentDefinition={componentId:input.componentId,bodyId:input.bodyId,kind:input.kind,...(input.parentComponentId!==undefined?{parentComponentId:input.parentComponentId}:{})};
  this.components.set(componentKey,definition);
  this.append('manifest.component',{component_id:input.componentId,body_id:input.bodyId,kind:input.kind,...(input.parentComponentId!==undefined?{parent_component_id:input.parentComponentId}:{})});
 }
 law(bodyId:string,cause:PhysicsCauseRef):void{
  const component=this.components.get(`${bodyId}\0${cause.componentId}`);if(!component)throw new TypeError(`Physics law ${cause.lawId} requires a declared component`);
  if(this.sealedBodies.has(bodyId))throw new Error(`Physics cause manifest for ${bodyId} is sealed`);
  const key=`${bodyId}\0${cause.componentId}\0${cause.lawId}`,previous=this.laws.get(key);
  if(previous){
   if(previous.bodyId!==bodyId||previous.cause.lawKind!==cause.lawKind||!sameArray(previous.cause.effectKinds,cause.effectKinds))throw new TypeError(`Conflicting physics law ${cause.lawId}`);
   return;
  }
  this.laws.set(key,{bodyId,cause});
  this.append('manifest.law',{body_id:bodyId,component_id:cause.componentId,law_id:cause.lawId,law_kind:cause.lawKind,effect_kinds:[...cause.effectKinds]});
 }
 sealBody(bodyId:string):void{
  if(!this.components.has(`${bodyId}\0${bodyId}`))throw new TypeError(`Body component ${bodyId} is not declared`);
  this.sealedBodies.add(bodyId);
 }
 beginSubstep(tick:number,substep:number,simTime:number):void{
  if(this.frame)throw new Error('Physics trace substep already open');
  if(!Number.isSafeInteger(tick)||tick<0||!Number.isSafeInteger(substep)||substep<0||!Number.isFinite(simTime)||simTime<0)throw new TypeError('Invalid physics trace frame');
  this.frame={tick,substep,simTime,sums:new Map(),writers:new Map(),activeLawKeys:new Set(),energySums:new Map()};
  this.append('frame.begin',{});
 }
 writer(bodyId:string):PhysicsCauseWriter{
  const frame=this.frame;if(!frame)throw new Error('Physics contribution requires an active substep');
  this.sealBody(bodyId);
  const cached=frame.writers.get(bodyId);if(cached)return cached;
  const writer:PhysicsCauseWriter=Object.freeze({bodyId,contribute:(cause:PhysicsCauseRef,source:PhysicsSourceRef,effect:PhysicsContributionEffect)=>this.contribute(bodyId,cause,source,effect)});
  frame.writers.set(bodyId,writer);return writer;
 }
 private contribute(bodyId:string,cause:PhysicsCauseRef,source:PhysicsSourceRef,effect:PhysicsContributionEffect):string{
  const frame=this.frame;if(!frame)throw new Error('Physics contribution requires an active substep');
  const law=this.laws.get(`${bodyId}\0${cause.componentId}\0${cause.lawId}`);
  if(!law||law.bodyId!==bodyId)throw new Error(`Undeclared physics cause ${cause.componentId}/${cause.lawId}`);
  if(!source.id||source.id.length>256)throw new TypeError('Invalid physics source');
  const force=effect.forceN??[0,0,0],torque=effect.torqueNm??[0,0,0];finiteVec(force,'force');finiteVec(torque,'torque');
  if(effect.impulseNs)finiteVec(effect.impulseNs,'impulse');if(effect.positionCorrectionM)finiteVec(effect.positionCorrectionM,'position correction');if(effect.velocityCorrectionMps)finiteVec(effect.velocityCorrectionMps,'velocity correction');if(effect.angularVelocityCorrectionRadps)finiteVec(effect.angularVelocityCorrectionRadps,'angular velocity correction');if(effect.pointWorldM)finiteVec(effect.pointWorldM,'point');
  if(effect.powerW!==undefined&&!Number.isFinite(effect.powerW))throw new TypeError('Invalid physics power');
  if(effect.inputsHash!==undefined&&(!effect.inputsHash||effect.inputsHash.length>256))throw new TypeError('Invalid physics input hash');
  const sum=frame.sums.get(bodyId)??{force:[0,0,0] as [number,number,number],torque:[0,0,0] as [number,number,number],ids:[],contactIds:[]};
  if(!frame.sums.has(bodyId))frame.sums.set(bodyId,sum);
  for(let k=0;k<3;k++){sum.force[k]!+=force[k]!;sum.torque[k]!+=torque[k]!;}
  const contributionId=`${frame.tick}.${frame.substep}/${cause.componentId}/${cause.lawId}/${sum.ids.length}`;sum.ids.push(contributionId);if(effect.impulseNs||effect.positionCorrectionM||effect.velocityCorrectionMps||effect.angularVelocityCorrectionRadps)sum.contactIds.push(contributionId);frame.activeLawKeys.add(`${cause.componentId}\0${cause.lawId}`);
  this.append('physics.contribution',{contribution_id:contributionId,body_id:bodyId,component_id:cause.componentId,law_id:cause.lawId,source:{kind:source.kind,id:source.id},effect:{...(effect.forceN?{force_N:cloneVec(effect.forceN)}:{}),...(effect.torqueNm?{torque_Nm:cloneVec(effect.torqueNm)}:{}),...(effect.impulseNs?{impulse_Ns:cloneVec(effect.impulseNs)}:{}),...(effect.positionCorrectionM?{position_correction_m:cloneVec(effect.positionCorrectionM)}:{}),...(effect.velocityCorrectionMps?{velocity_correction_m_s:cloneVec(effect.velocityCorrectionMps)}:{}),...(effect.angularVelocityCorrectionRadps?{angular_velocity_correction_rad_s:cloneVec(effect.angularVelocityCorrectionRadps)}:{}),...(effect.pointWorldM?{point_world_m:cloneVec(effect.pointWorldM)}:{}),...(effect.powerW!==undefined?{power_W:effect.powerW}:{}),...(effect.inputsHash!==undefined?{inputs_hash:effect.inputsHash}:{})}});
  return contributionId;
 }
 wrench(bodyId:string,force:Vec3,torque:Vec3):string{
  const frame=this.frame;if(!frame)throw new Error('Physics wrench requires an active substep');finiteVec(force,'wrench force');finiteVec(torque,'wrench torque');
  const sum=frame.sums.get(bodyId)??{force:[0,0,0] as [number,number,number],torque:[0,0,0] as [number,number,number],ids:[],contactIds:[]};
  const df:[number,number,number]=[force[0]-sum.force[0],force[1]-sum.force[1],force[2]-sum.force[2]],dt:[number,number,number]=[torque[0]-sum.torque[0],torque[1]-sum.torque[1],torque[2]-sum.torque[2]];
  const forceResidual=magnitude(df),torqueResidual=magnitude(dt);this.maxForceResidual=Math.max(this.maxForceResidual,forceResidual);this.maxTorqueResidual=Math.max(this.maxTorqueResidual,torqueResidual);
  if(forceResidual>1e-9||torqueResidual>1e-9)throw new Error(`Unattributed physics wrench on ${bodyId}: force residual ${forceResidual}, torque residual ${torqueResidual}`);
  const wrenchId=`${frame.tick}.${frame.substep}/${bodyId}/wrench`;
  this.append('physics.wrench',{wrench_id:wrenchId,body_id:bodyId,contribution_ids:[...sum.ids],resultant:{force_N:cloneVec(force),torque_Nm:cloneVec(torque)},residual:{force_N:forceResidual,torque_Nm:torqueResidual}});
  return wrenchId;
 }
 energy(bodyId:string,stage:PhysicsEnergyStage,deltaJ:number):void{
  const frame=this.frame;if(!frame)throw new Error('Physics energy accounting requires an active substep');
  if(!Number.isFinite(deltaJ))throw new TypeError('Invalid physics energy delta');
  const sums=frame.sums.get(bodyId),ids=stage==='contacts-solver'?(sums?.contactIds??[]):(sums?.ids??[]);
  const scale=Math.max(1,Math.abs(deltaJ));
  if(Math.abs(deltaJ)>1e-10*scale&&!ids.length)throw new Error(`Unattributed physics energy on ${bodyId} during ${stage}: ${deltaJ} J`);
  frame.energySums.set(bodyId,(frame.energySums.get(bodyId)??0)+deltaJ);
  this.append('physics.energy',{body_id:bodyId,stage,delta_J:deltaJ,contribution_ids:[...ids]});
 }
 energyClosure(bodyId:string,beforeJ:number,afterJ:number):void{
  const frame=this.frame;if(!frame)throw new Error('Physics energy closure requires an active substep');
  if(!Number.isFinite(beforeJ)||!Number.isFinite(afterJ))throw new TypeError('Invalid physics energy closure');
  const accounted=frame.energySums.get(bodyId)??0,actual=afterJ-beforeJ,residual=actual-accounted,tolerance=1e-9*Math.max(1,Math.abs(beforeJ),Math.abs(afterJ),Math.abs(accounted));
  this.maxEnergyResidual=Math.max(this.maxEnergyResidual,Math.abs(residual));
  if(Math.abs(residual)>tolerance)throw new Error(`Unattributed physics energy on ${bodyId}: residual ${residual} J`);
  this.append('physics.energy-closure',{body_id:bodyId,before_J:beforeJ,after_J:afterJ,actual_delta_J:actual,accounted_delta_J:accounted,residual_J:residual,tolerance_J:tolerance});
 }
 stateMutation(bodyId:string,wrenchId:string,before:PhysicsBodyState,after:PhysicsBodyState,dt:number):void{
  if(!this.frame)throw new Error('Physics state mutation requires an active substep');
  if(!Number.isFinite(dt)||dt<=0)throw new TypeError('Invalid physics integration dt');
  for(const [label,state] of [['before',before],['after',after]] as const)for(const [key,value] of Object.entries(state))finiteVec(value as Vec3,`${label}.${key}`);
  const contactIds=this.frame.sums.get(bodyId)?.contactIds??[];
  this.append('physics.state-mutation',{mutation_id:`${this.frame.tick}.${this.frame.substep}/${bodyId}/integrate`,body_id:bodyId,writer_id:'PhysicsWorld.integrate',wrench_id:wrenchId,contact_contribution_ids:[...contactIds],dt_s:dt,before:{position_m:cloneVec(before.positionM),rotation_rad:cloneVec(before.rotationRad),velocity_m_s:cloneVec(before.velocityMps),angular_velocity_rad_s:cloneVec(before.angularVelocityRadps)},after:{position_m:cloneVec(after.positionM),rotation_rad:cloneVec(after.rotationRad),velocity_m_s:cloneVec(after.velocityMps),angular_velocity_rad_s:cloneVec(after.angularVelocityRadps)}});
 }
 endSubstep():void{
  const frame=this.frame;if(!frame)throw new Error('No physics trace substep is open');
  this.append('frame.end',{active_laws:[...frame.activeLawKeys].sort(),writers:[...frame.writers.keys()].sort()});
  this.frame=undefined;
 }
 snapshot():readonly PhysicsTraceRecord[]{return Object.freeze([...this.records]);}
 toJSONL():string{return this.records.map(record=>JSON.stringify(record)).join('\n')+'\n';}
 get proof(){
  return Object.freeze({schema:PHYSICS_CAUSE_TRACE_SCHEMA,schemaVersion:PHYSICS_CAUSE_TRACE_VERSION,runId:this.runId,records:this.records.length,components:this.components.size,laws:this.laws.size,sealedBodies:this.sealedBodies.size,maxForceResidualN:this.maxForceResidual,maxTorqueResidualNm:this.maxTorqueResidual,maxEnergyResidualJ:this.maxEnergyResidual});
 }
}
