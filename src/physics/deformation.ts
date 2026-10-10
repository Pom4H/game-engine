import {freezePrimitive} from '../procedural/mesh.js';
import {V3,type MutableVec3,type Vec3} from '../math.js';
import type {RuntimeEntity} from '../scene/scene.js';
import type {ContactCandidate} from './world.js';

export interface DeformableBodySpec {
  readonly bodyId:string;
  readonly visualIds:readonly string[];
  /** Optional subset of visualIds that receives plastic mesh deformation. Others only follow the body pose. */
  readonly deformVisualIds?:readonly string[];
  /** Effective sheet/skin thickness participating in local plastic work. */
  readonly skinThicknessM?:number;
  /** Base radius of a local crush zone. */
  readonly radiusM?:number;
  /** Maximum persistent local crush depth. */
  readonly maxDentM?:number;
  /** Ignore tiny contact-energy noise below this threshold. */
  readonly minEnergyJ?:number;
}
export interface SceneDeformationSpec {readonly bodies?:readonly DeformableBodySpec[]}
export interface PlasticDent {
  readonly point:Vec3;
  readonly outwardNormal:Vec3;
  radius:number;
  depth:number;
  energy:number;
}
interface VisualBinding {
  readonly id:string;
  readonly offset:Vec3;
  readonly rotation:Vec3;
  readonly scale:Vec3;
  readonly positions:readonly number[];
  readonly indices:readonly number[];
  readonly deform:boolean;
  readonly target:'mesh'|'renderMesh';
}
interface DeformableState {
  readonly spec:Required<Pick<DeformableBodySpec,'skinThicknessM'|'radiusM'|'maxDentM'|'minEnergyJ'>>&DeformableBodySpec;
  readonly visuals:readonly VisualBinding[];
  readonly dents:PlasticDent[];
}
interface PlasticContact {
  readonly state:DeformableState;
  readonly root:RuntimeEntity;
  readonly point:Vec3;
  readonly outwardNormal:Vec3;
  readonly radius:number;
  readonly baseRadius:number;
  readonly demandJ:number;
  readonly workPerMetre:number;
}

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/**
 * Reduced persistent deformation layer.
 *
 * Unlike a visual post-process, absorbContact() runs inside the authoritative
 * contact decision before the rigid impulse is applied. Plastic work therefore
 * comes out of the same normal-energy budget that drives rebound/penetration.
 *
 * This remains the cheap reduced LOD. High-detail structural motion belongs to
 * StructuralBody; once that solver settles, its permanent state can be baked
 * back down into a reduced representation like this one.
 */
export class PlasticDeformationSystem {
  private readonly states=new Map<string,DeformableState>();
  private readonly dirty=new Set<DeformableState>();
  private plasticWorkJ=0;

  attach(input:DeformableBodySpec,entities:ReadonlyMap<string,RuntimeEntity>):void{
    if(!input.bodyId||this.states.has(input.bodyId)||!input.visualIds.length)throw new TypeError('Deformable body requires a distinct bodyId and visualIds');
    const root=entities.get(input.bodyId);
    if(!root?.body||root.body.shape.kind!=='box')throw new TypeError('Deformable body requires a box physics body');
    const ids=new Set<string>(),deformIds=new Set(input.deformVisualIds??input.visualIds),visuals:VisualBinding[]=[];
    for(const id of deformIds)if(!input.visualIds.includes(id))throw new TypeError(`Deformable visual ${id} must also be listed in visualIds`);
    for(const id of input.visualIds){
      if(ids.has(id))throw new TypeError(`Duplicate deformable visual ${id}`);ids.add(id);
      const entity=entities.get(id),mesh=entity?.renderMesh??entity?.mesh;
      if(!entity||mesh?.kind!=='triangle-mesh')throw new TypeError(`Deformable visual ${id} must be a triangle mesh`);
      const offset=worldToLocal(root,V3.sub(entity.position,root.position));
      visuals.push(Object.freeze({
        id,
        offset:Object.freeze([...offset]) as Vec3,
        rotation:Object.freeze([
          entity.rotation[0]-root.rotation[0],
          entity.rotation[1]-root.rotation[1],
          entity.rotation[2]-root.rotation[2],
        ]) as Vec3,
        scale:Object.freeze([...entity.scale]) as Vec3,
        positions:Object.freeze([...mesh.positions]),
        indices:Object.freeze([...mesh.indices]),
        deform:deformIds.has(id),
        target:entity.renderMesh?'renderMesh':'mesh',
      }));
    }
    const spec=Object.freeze({
      ...input,
      visualIds:Object.freeze([...input.visualIds]),
      ...(input.deformVisualIds?{deformVisualIds:Object.freeze([...input.deformVisualIds])}:{}),
      skinThicknessM:clamp(input.skinThicknessM??.0009,.0002,.02),
      radiusM:clamp(input.radiusM??.58,.06,2.5),
      maxDentM:clamp(input.maxDentM??.72,.01,1.8),
      minEnergyJ:clamp(input.minEnergyJ??35,0,1e7),
    });
    this.states.set(input.bodyId,{spec,visuals:Object.freeze(visuals),dents:[]});
    this.syncState(this.states.get(input.bodyId)!,entities);
  }

  /** Cheap conservative guard for domain-certified inert contact pairs.
   * This must be consulted live: plugin/scene operations can attach/remove
   * deformable bodies, changing which physical contacts have consequences. */
  hasContactBody(bodyId:string):boolean{return this.states.has(bodyId);}

  /**
   * Consume ductile plastic work from a contact before the rigid response.
   * For two deformable bodies the shared normal-energy budget is split in
   * proportion to each side's requested work and can never be spent twice.
   */
  absorbContact(contact:ContactCandidate,entities:ReadonlyMap<string,RuntimeEntity>):number{
    if(contact.normalEnergy<=0||contact.approachSpeed<=.15)return 0;
    const requests:PlasticContact[]=[];
    const a=this.states.get(contact.a.id),b=this.states.get(contact.b.id);
    if(a){const request=this.contactRequest(a,contact,entities,true);if(request)requests.push(request);}
    if(b){const request=this.contactRequest(b,contact,entities,false);if(request)requests.push(request);}
    if(!requests.length)return 0;
    const totalDemand=requests.reduce((sum,request)=>sum+request.demandJ,0);
    if(totalDemand<=0)return 0;
    const budget=Math.min(contact.normalEnergy,totalDemand);
    let consumed=0;
    for(const request of requests){
      const allocation=budget*request.demandJ/totalDemand;
      consumed+=this.applyPlasticWork(request,allocation);
    }
    this.plasticWorkJ+=consumed;
    return Math.min(contact.normalEnergy,consumed);
  }

  /** Commit deferred mesh work after physics; physics state was already changed causally. */
  step(entities:ReadonlyMap<string,RuntimeEntity>):boolean{
    const geometryChanged=this.dirty.size>0;
    for(const state of this.states.values())this.syncPose(state,entities);
    for(const state of this.dirty)this.syncState(state,entities);
    this.dirty.clear();
    return geometryChanged;
  }

  remove(id:string):void{
    const own=this.states.get(id);if(own)this.dirty.delete(own);
    this.states.delete(id);
    for(const [bodyId,state] of this.states)if(state.visuals.some(visual=>visual.id===id)){this.dirty.delete(state);this.states.delete(bodyId);}
  }

  visualEntityIds():ReadonlySet<string>{
    const ids=new Set<string>();
    for(const state of this.states.values())for(const visual of state.visuals)ids.add(visual.id);
    return ids;
  }

  dents(bodyId:string):readonly PlasticDent[]{return Object.freeze((this.states.get(bodyId)?.dents??[]).map(dent=>Object.freeze({...dent,point:Object.freeze([...dent.point]) as Vec3,outwardNormal:Object.freeze([...dent.outwardNormal]) as Vec3})));}
  inspect(){return{bodies:this.states.size,dents:[...this.states.values()].reduce((sum,state)=>sum+state.dents.length,0),plasticWorkJ:this.plasticWorkJ};}

  private contactRequest(state:DeformableState,contact:ContactCandidate,entities:ReadonlyMap<string,RuntimeEntity>,isA:boolean):PlasticContact|undefined{
    const root=entities.get(state.spec.bodyId);if(!root?.body)return;
    if(contact.normalEnergy<=state.spec.minEnergyJ)return;
    const mechanical=root.body.material.mechanical;
    if(mechanical.brittle||mechanical.plasticity<=.01||!Number.isFinite(mechanical.yieldStressPa))return;
    const point=worldPointToLocal(root,contact.point);
    const outwardWorld=isA?contact.normal:V3.scale(contact.normal,-1),outwardNormal=V3.normalize(worldToLocal(root,outwardWorld));
    const energy=contact.normalEnergy,baseRadius=state.spec.radiusM,threshold=Math.max(1,state.spec.minEnergyJ);
    const radius=clamp(baseRadius*(.78+Math.pow(Math.max(1,energy/threshold),.18)*.22),baseRadius*.65,baseRadius*1.75);
    const area=Math.PI*radius*radius,volume=area*state.spec.skinThicknessM;
    const elasticYieldEnergy=.5*mechanical.yieldStressPa*mechanical.yieldStressPa/Math.max(1,mechanical.youngModulusPa)*volume;
    const workPerMetre=Math.max(1,mechanical.yieldStressPa*area*state.spec.skinThicknessM/Math.max(.04,radius));
    const existing=this.findDent(state,point,outwardNormal,radius),remainingDepth=Math.max(0,state.spec.maxDentM-(existing?.depth??0));
    const capacityJ=remainingDepth*workPerMetre/.85;
    const demandJ=Math.min(Math.max(0,energy-elasticYieldEnergy)*mechanical.plasticity,capacityJ);
    if(demandJ<=0)return;
    return{state,root,point:Object.freeze([...point]) as Vec3,outwardNormal:Object.freeze([...outwardNormal]) as Vec3,radius,baseRadius,demandJ,workPerMetre};
  }

  private applyPlasticWork(request:PlasticContact,energy:number):number{
    if(energy<=0)return 0;
    const {state,root,point,outwardNormal,radius,baseRadius,workPerMetre}=request;
    const depthIncrement=energy/workPerMetre*.85;
    if(depthIncrement<.002)return 0;

    let dent=this.findDent(state,point,outwardNormal,radius);
    if(dent){
      dent.energy+=energy;
      dent.depth=clamp(dent.depth+depthIncrement,0,state.spec.maxDentM);
      dent.radius=clamp(Math.max(dent.radius,radius)*(1+Math.min(.08,energy/100000)),baseRadius*.65,baseRadius*1.9);
    }else{
      dent={point,outwardNormal,radius,depth:clamp(depthIncrement,0,state.spec.maxDentM),energy};
      state.dents.push(dent);if(state.dents.length>20)state.dents.shift();
    }
    root.body!.applyLocalCrush(outwardNormal,depthIncrement*.72);
    this.dirty.add(state);
    return energy;
  }

  private findDent(state:DeformableState,point:Vec3,outwardNormal:Vec3,radius:number):PlasticDent|undefined{
    return state.dents.find(existing=>
      V3.length(V3.sub(existing.point,point))<Math.min(existing.radius,radius)*.48&&
      V3.dot(existing.outwardNormal,outwardNormal)>.72
    );
  }

  private syncPose(state:DeformableState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    const root=entities.get(state.spec.bodyId);if(!root)return;
    for(const visual of state.visuals){
      const entity=entities.get(visual.id);if(!entity)continue;
      const offset=localToWorld(root,visual.offset);
      entity.position.splice(0,3,root.position[0]+offset[0],root.position[1]+offset[1],root.position[2]+offset[2]);
      entity.rotation.splice(0,3,root.rotation[0]+visual.rotation[0],root.rotation[1]+visual.rotation[1],root.rotation[2]+visual.rotation[2]);
    }
  }

  private syncState(state:DeformableState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    this.syncPose(state,entities);
    for(const visual of state.visuals){
      if(!visual.deform)continue;
      const entity=entities.get(visual.id);if(!entity)continue;
      const positions=[...visual.positions];
      for(let i=0;i<positions.length;i+=3){
        const local:Vec3=[positions[i]!,positions[i+1]!,positions[i+2]!];
        const scaled:Vec3=[local[0]*visual.scale[0],local[1]*visual.scale[1],local[2]*visual.scale[2]];
        let rootPoint=V3.add(visual.offset,rotateLocal(visual.rotation,scaled));
        for(const dent of state.dents){
          const relative=V3.sub(rootPoint,dent.point),axial=V3.dot(relative,dent.outwardNormal),radial=V3.sub(relative,V3.scale(dent.outwardNormal,axial)),r=V3.length(radial);
          if(r>dent.radius*1.55||Math.abs(axial)>dent.radius*1.15)continue;
          const radialWeight=Math.exp(-2.6*(r/dent.radius)**2),axialWeight=Math.exp(-3.4*Math.abs(axial)/dent.radius),weight=radialWeight*axialWeight;
          const displacement=V3.scale(dent.outwardNormal,-dent.depth*weight);
          rootPoint=V3.add(rootPoint,displacement);
        }
        const visualPoint=rotateWorldToLocal(visual.rotation,V3.sub(rootPoint,visual.offset));
        positions[i]=visualPoint[0]/visual.scale[0];positions[i+1]=visualPoint[1]/visual.scale[1];positions[i+2]=visualPoint[2]/visual.scale[2];
      }
      const normals=recomputeNormals(positions,visual.indices);
      const deformed=freezePrimitive({kind:'triangle-mesh',positions,normals,indices:[...visual.indices]});
      if(visual.target==='renderMesh')entity.renderMesh=deformed;else entity.mesh=deformed;
    }
  }
}

function recomputeNormals(positions:readonly number[],indices:readonly number[]):number[]{
  const normals=Array<number>(positions.length).fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]!*3,ib=indices[i+1]!*3,ic=indices[i+2]!*3;
    const a:Vec3=[positions[ia]!,positions[ia+1]!,positions[ia+2]!],b:Vec3=[positions[ib]!,positions[ib+1]!,positions[ib+2]!],c:Vec3=[positions[ic]!,positions[ic+1]!,positions[ic+2]!];
    const n=V3.cross(V3.sub(b,a),V3.sub(c,a));
    for(const base of [ia,ib,ic]){normals[base]!+=n[0];normals[base+1]!+=n[1];normals[base+2]!+=n[2];}
  }
  for(let i=0;i<normals.length;i+=3){const n=V3.normalize([normals[i]!,normals[i+1]!,normals[i+2]!]);normals[i]=n[0];normals[i+1]=n[1];normals[i+2]=n[2];}
  return normals;
}

function basis(rotation:Vec3):readonly[Vec3,Vec3,Vec3]{
  const [rx,ry,rz]=rotation,sx=Math.sin(rx),cx=Math.cos(rx),sy=Math.sin(ry),cy=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
  return[
    [cy*cz,sx*sy*cz+cx*sz,-cx*sy*cz+sx*sz],
    [-cy*sz,-sx*sy*sz+cx*cz,cx*sy*sz+sx*cz],
    [sy,-sx*cy,cx*cy],
  ];
}
function rotateLocal(rotation:Vec3,v:Vec3):MutableVec3{const b=basis(rotation);return[b[0][0]*v[0]+b[1][0]*v[1]+b[2][0]*v[2],b[0][1]*v[0]+b[1][1]*v[1]+b[2][1]*v[2],b[0][2]*v[0]+b[1][2]*v[1]+b[2][2]*v[2]];}
function rotateWorldToLocal(rotation:Vec3,v:Vec3):MutableVec3{const b=basis(rotation);return[V3.dot(v,b[0]),V3.dot(v,b[1]),V3.dot(v,b[2])];}
function worldToLocal(root:RuntimeEntity,v:Vec3):MutableVec3{return rotateWorldToLocal(root.rotation,v);}
function localToWorld(root:RuntimeEntity,v:Vec3):MutableVec3{return rotateLocal(root.rotation,v);}
function worldPointToLocal(root:RuntimeEntity,p:Vec3):MutableVec3{return worldToLocal(root,V3.sub(p,root.position));}
