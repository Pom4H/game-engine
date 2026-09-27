import type {MutableVec3,Vec3} from '../math.js';
import {finiteVec3} from '../math.js';
import {ForceFrame} from '../physics/force-frame.js';
import type {DeformableBodySpec} from '../physics/deformation.js';
import type {Scene,RuntimeEntity,SceneProjection} from '../scene/scene.js';
import type {EntitySpec,MaterialSpec,Primitive} from '../scene/types.js';
import {validateEntity} from '../scene/validate.js';
import {freezeVehicleMesh} from './geometry.js';
import type {CompiledVehicleGeometry} from './framework.js';
import {Vehicle,type VehicleBlueprint,type VehiclePose,type PartSample} from './vehicle.js';

export interface SceneVehicleOptions extends VehiclePose {
  /** Origin of the physical chassis in the authored model's coordinates. */
  readonly modelOriginM:Vec3;
  readonly paint?:MaterialSpec;
  readonly damage?:false|Omit<DeformableBodySpec,'bodyId'|'visualIds'|'deformVisualIds'>;
  readonly reuseDerived?:boolean;
}
export interface SceneVehicle {
  readonly vehicle:Vehicle;
  readonly visualIds:readonly string[];
  readonly diagnostics:{readonly wingMeshBuilds:number};
  dispose():void;
}
type Mesh=Extract<Primitive,{kind:'triangle-mesh'}>;
type Visual={entity:RuntimeEntity;offset:Vec3;part?:PartSample;radius?:number;tire?:boolean;span?:number;chord?:number;key?:number[]};

/** Attach an ordinary Vehicle to the existing Scene. Geometry has NO extra masses
 * or glass colliders. Scene owns stepping/contact energy; its shared deformation
 * field also moves physical mounts. Projection runs once after Scene.step. */
export function spawnVehicle(scene:Scene,blueprint:VehicleBlueprint,geometry:CompiledVehicleGeometry,options:SceneVehicleOptions):SceneVehicle {
  finiteVec3(options.modelOriginM,'Model origin');
  const id=blueprint.source.id,com=blueprint.centerOfMass,position=options.position??[0,0,0],rotation=options.rotation??[0,0,0];
  finiteVec3(position,'Vehicle position');finiteVec3(rotation,'Vehicle rotation');
  const frame=new ForceFrame(),offset:MutableVec3=[0,0,0];frame.update(rotation);frame.rotate(com,offset);
  const size=blueprint.source.chassis.sizeM;
  const rootSpec:EntitySpec={id,position:[position[0]+offset[0],position[1]+offset[1],position[2]+offset[2]],rotation,
    material:{kind:'steel'},body:{mass:blueprint.massKg,collisionSize:size,friction:.5,restitution:.05,...(options.velocity?{velocity:options.velocity}:{}),...(options.angularVelocity?{angularVelocity:options.angularVelocity}:{})}};
  const descriptions=geometry.parts.map(p=>{
    const spec:EntitySpec={id:`${id}/${p.id}`,collision:'none',mesh:p.mesh,position:[0,0,0],
      material:p.role==='paint'?{...p.material,...options.paint}:p.material??{}};
    return {spec,part:p};
  });
  for(const p of blueprint.parts)if(p.source.kind==='wing')descriptions.push({
    spec:{id:`${id}/${p.source.id}`,collision:'none',material:{kind:'aluminum',color:[.72,.76,.8,1],roughness:.3},mesh:{kind:'box',size:[1,.04,1]}},
    part:{id:p.source.id,role:'paint',position:[0,0,0],mesh:{kind:'triangle-mesh',positions:[],normals:[],indices:[]},material:{}},
  });
  // Fail before modifying the scene. Data-only render descriptions do not execute code.
  const ids=new Set<string>();for(const spec of [rootSpec,...descriptions.map(p=>p.spec)]){
    validateEntity(spec);if(ids.has(spec.id)||scene.entities.has(spec.id)||scene.physics.bodies.has(spec.id))throw new TypeError(`Duplicate vehicle scene id ${spec.id}`);ids.add(spec.id);
  }
  const created:RuntimeEntity[]=[],visuals:Visual[]=[],byComponent=new Map(blueprint.parts.map(p=>[p.source.id,p.source]));
  let runtime:Vehicle|undefined,release:()=>void=()=>{},disposed=false;
  const diagnostics={wingMeshBuilds:0};
  const dispose=()=>{
    if(disposed)return;disposed=true;release();runtime?.dispose();
    for(const entity of [...created].reverse())if(scene.entities.get(entity.id)===entity)scene.remove(entity.id);
  };
  try{
    const root=scene.add(rootSpec);created.push(root);
    runtime=new Vehicle(scene.physics,blueprint,{}, {body:root.body!,...(options.reuseDerived!==undefined?{reuseDerived:options.reuseDerived}:{})});
    for(const d of descriptions){
      const e=scene.add(d.spec);created.push(e);
      const wheel=/^(tire|rim)-(front|rear)-(left|right)$/.exec(d.part.id),component=byComponent.get(d.part.id);
      const local:Vec3=[d.part.position[0]-options.modelOriginM[0]-com[0],d.part.position[1]-options.modelOriginM[1]-com[1],d.part.position[2]-options.modelOriginM[2]-com[2]];
      if(wheel){
        const componentId=`${wheel[2]}.${wheel[3]}`,source=byComponent.get(componentId);
        if(source?.kind!=='wheel')throw new TypeError(`Geometry wheel ${componentId} has no physical component`);
        visuals.push({entity:e,offset:local,part:runtime.part(componentId),radius:source.radiusM,tire:wheel[1]==='tire'});
      }else if(component?.kind==='wing')visuals.push({entity:e,offset:local,part:runtime.part(component.id),span:component.spanM,chord:component.chordM});
      else visuals.push({entity:e,offset:local});
    }
    const visualIds=Object.freeze(visuals.map(v=>v.entity.id)),scratch:MutableVec3=[0,0,0],worldBasis=new Float64Array(9);
    const sync=()=>{
      if(disposed)return;
      const car=runtime!,body=car.body;frame.update(body.rotation);
      for(const v of visuals){
        const e=v.entity;if(scene.entities.get(e.id)!==e)continue;
        if(v.part?.kind==='wheel'){
          const p=v.part,source=byComponent.get(p.id)!;
          if(source.kind!=='wheel')continue;
          const length=source.suspension.restM-p.compressionM;
          for(let k=0;k<3;k++)scratch[k]=p.localPosition[k]!-p.localNormal[k]!*length;
          frame.rotate(scratch,scratch);
          for(let k=0;k<3;k++)e.position[k]=body.position[k]!+scratch[k]!;
          const c=Math.cos(-p.spinRad),s=Math.sin(-p.spinRad),ch=p.localChord,n=p.localNormal;
          for(let axis=0;axis<3;axis++){
            for(let k=0;k<3;k++)scratch[k]=axis===0?ch[k]!*c+n[k]!*s:axis===1?n[k]!*c-ch[k]!*s:ch[(k+1)%3]!*n[(k+2)%3]!-ch[(k+2)%3]!*n[(k+1)%3]!;
            frame.rotate(scratch,scratch);worldBasis.set(scratch,axis*3);
          }
          euler(worldBasis,e.rotation);
          if(v.tire){e.scale[0]=e.scale[1]=p.effectiveRadiusM/v.radius!;}
        }else if(v.part?.kind==='wing'){
          const p=v.part;let changed=!v.key;
          for(let k=0;k<9&&!changed;k++)changed=v.key![k]!==(k<3?p.localPosition[k]:k<6?p.localChord[k-3]:p.localNormal[k-6]);
          if(changed){
            e.mesh=wingMesh(p,v.span!,v.chord!);v.key??=Array<number>(9);
            for(let k=0;k<9;k++)v.key[k]=(k<3?p.localPosition[k]:k<6?p.localChord[k-3]:p.localNormal[k-6])!;
            diagnostics.wingMeshBuilds++;scene.renderStructureRevision++;
          }
          e.position.splice(0,3,...body.position);e.rotation.splice(0,3,...body.rotation);
        }else{
          // PlasticDeformationSystem owns the skin's deformed vertices, not this projection.
          frame.rotate(v.offset,scratch);for(let k=0;k<3;k++)e.position[k]=body.position[k]!+scratch[k]!;
          e.rotation.splice(0,3,...body.rotation);
        }
      }
    };
    sync();
    if(options.damage!==false){
      const skins=visuals.filter(v=>!v.part).map(v=>v.entity.id);
      if(!skins.length)throw new TypeError('Vehicle damage requires a chassis skin');
      scene.deformation.attach({bodyId:id,visualIds:skins,...options.damage},scene.entities);
      runtime.bindDeformation(scene.deformation.field(id));
    }
    const projection:SceneProjection={ownerId:id,visualIds,sync,dispose};release=scene.project(projection);
    return Object.freeze({vehicle:runtime,visualIds,diagnostics,dispose});
  }catch(error){dispose();throw error;}
}

/** A wing's vertices use exactly the local frame consumed by aerodynamics. */
function wingMesh(p:PartSample,span:number,chord:number):Mesh {
  const c=p.localChord,n=p.localNormal,z:Vec3=[c[1]*n[2]-c[2]*n[1],c[2]*n[0]-c[0]*n[2],c[0]*n[1]-c[1]*n[0]];
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  const points:MutableVec3[]=[];
  for(const x of [-.5,.5])for(const y of [-.02,.02])for(const w of [-.5,.5])points.push([0,1,2].map(k=>p.localPosition[k]!+c[k]!*x*chord+n[k]!*y+z[k]!*w*span) as MutableVec3);
  for(const face of [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]){
    const a=points[face[0]!]!,b=points[face[1]!]!,d=points[face[2]!]!,u=b.map((v,k)=>v-a[k]!),v=d.map((x,k)=>x-a[k]!);
    const nn=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!],length=Math.hypot(...nn),base=positions.length/3;
    for(const index of face){positions.push(...points[index]!);normals.push(...nn.map(x=>x/length));}indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const mesh:Mesh={kind:'triangle-mesh',positions,normals,indices};freezeVehicleMesh(mesh);return mesh;
}
function euler(b:Float64Array,out:MutableVec3):void{
  out[1]=Math.asin(Math.max(-1,Math.min(1,b[6]!)));
  if(Math.abs(Math.cos(out[1]))>1e-7){out[0]=Math.atan2(-b[7]!,b[8]!);out[2]=Math.atan2(-b[3]!,b[0]!);}
  else {out[0]=Math.sign(b[6]!)*Math.atan2(b[1]!,b[4]!);out[2]=0;}
}
