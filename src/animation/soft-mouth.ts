import {material,type MechanicalMaterial} from '../materials/catalog.js';
import type {Vec3} from '../math.js';
import {applyStructuralSkin,bindStructuralSkin,type StructuralSkinBinding} from '../physics/structural-skin.js';
import {StructuralStaticContactSolver,type StructuralContactStats,type StructuralStaticBox} from '../physics/structural-contact.js';
import {StructuralBody,type StructuralDefinition,type StructuralConstraintSpec} from '../physics/structure.js';
import type {Primitive,SceneSpec} from '../scene/types.js';
import {Scene,type RuntimeEntity} from '../scene/scene.js';
import type {VocalArticulators} from '../audio/vocal-tract.js';
import {VocalFaceRig,VOCAL_FACE_IDS,vocalFaceSceneSpec,type VocalFacePose} from './vocal-face.js';

const CAGE_SLICES=24;
const CAGE_CROSS=4;
const RENDER_SLICES=48;
const RENDER_CROSS=8;
const SOFT_MOUTH_ID='vocal-face-soft-mouth';

const TISSUE:MechanicalMaterial=Object.freeze({
  youngModulusPa:85_000,
  yieldStressPa:62_000,
  failureStressPa:520_000,
  failureStrain:3.2,
  plasticity:.025,
  brittle:false,
});

interface CageMeta{
  readonly theta:number;
  readonly radial:number;
  readonly depth:number;
}

interface SurfaceTemplate{
  readonly positions:Float64Array;
  readonly normals:Float64Array;
  readonly indices:number[];
}

export interface SoftMouthDiagnostics{
  readonly nodes:number;
  readonly constraints:number;
  readonly kineticEnergyJ:number;
  readonly mouthGapM:number;
  readonly maxContactPenetrationM:number;
  readonly contacts:number;
  readonly brokenConstraints:number;
}

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

function ellipseNormal(theta:number,rx:number,ry:number):readonly[number,number]{
  const nx=Math.cos(theta)/Math.max(1e-6,rx),ny=Math.sin(theta)/Math.max(1e-6,ry),l=Math.hypot(nx,ny)||1;
  return[nx/l,ny/l];
}

function restPoint(theta:number,radial:number,depth:number):Vec3{
  const rx=.22,ry=.045,[nx,ny]=ellipseNormal(theta,rx,ry);
  return[
    rx*Math.cos(theta)+nx*radial,
    1.365+ry*Math.sin(theta)+ny*radial,
    .585+depth,
  ];
}

function buildDefinition():{definition:StructuralDefinition;meta:readonly CageMeta[]}{
  const nodes:{position:Vec3;mass:number}[]=[],meta:CageMeta[]=[];
  const cross:readonly (readonly[number,number])[]=[
    [.014,.018],[-.014,.018],[-.014,-.018],[.014,-.018],
  ];
  for(let slice=0;slice<CAGE_SLICES;slice++){
    const theta=slice/CAGE_SLICES*Math.PI*2;
    for(const [radial,depth] of cross){
      nodes.push({position:restPoint(theta,radial,depth),mass:.00038});
      meta.push(Object.freeze({theta,radial,depth}));
    }
  }

  const constraints:StructuralConstraintSpec[]=[];
  const pairs=new Set<string>();
  const addDistance=(a:number,b:number,areaM2=5e-6)=>{
    const lo=Math.min(a,b),hi=Math.max(a,b),key=lo+':'+hi;if(pairs.has(key))return;pairs.add(key);
    constraints.push({kind:'distance',a:lo,b:hi,areaM2,material:TISSUE});
  };
  const id=(slice:number,crossIndex:number)=>((slice+CAGE_SLICES)%CAGE_SLICES)*CAGE_CROSS+(crossIndex%CAGE_CROSS);
  const collisionTriangles:[number,number,number][]=[];

  for(let s=0;s<CAGE_SLICES;s++){
    const n=(s+1)%CAGE_SLICES;
    for(let c=0;c<CAGE_CROSS;c++){
      addDistance(id(s,c),id(s,(c+1)%CAGE_CROSS),7e-6);
      addDistance(id(s,c),id(n,c),6e-6);
      addDistance(id(s,c),id(n,(c+1)%CAGE_CROSS),3e-6);
      const c1=(c+1)%CAGE_CROSS;
      collisionTriangles.push([id(s,c),id(n,c),id(n,c1)],[id(s,c),id(n,c1),id(s,c1)]);
    }
    addDistance(id(s,0),id(s,2),3e-6);
    addDistance(id(s,1),id(s,3),3e-6);

    const v0=id(s,0),v1=id(s,1),v2=id(s,2),v3=id(s,3);
    const w0=id(n,0),w1=id(n,1),w2=id(n,2),w3=id(n,3);
    const volume=(a:number,b:number,c:number,d:number)=>constraints.push({
      kind:'volume',a,b,c,d,compliance:2.5e-8,yieldRatio:.65,breakRatio:2.8,plasticity:.015,
    });
    volume(v0,v1,v3,w0);
    volume(v1,v2,v3,w2);
    volume(v1,v3,w0,w2);
    volume(v1,w0,w1,w2);
    volume(v3,w0,w2,w3);
  }

  return{
    definition:Object.freeze({
      nodes:Object.freeze(nodes),
      constraints:Object.freeze(constraints),
      collisionTriangles:Object.freeze(collisionTriangles),
      iterations:12,
      internalDamping:28,
      sleepSpeed:.001,
      sleepDelay:1.5,
    }),
    meta:Object.freeze(meta),
  };
}

function surfaceTemplate():SurfaceTemplate{
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  const rx=.22,ry=.045;
  for(let s=0;s<RENDER_SLICES;s++){
    const theta=s/RENDER_SLICES*Math.PI*2,[nx,ny]=ellipseNormal(theta,rx,ry);
    for(let c=0;c<RENDER_CROSS;c++){
      const phi=c/RENDER_CROSS*Math.PI*2,radial=.014*Math.cos(phi),depth=.018*Math.sin(phi);
      positions.push(rx*Math.cos(theta)+nx*radial,1.365+ry*Math.sin(theta)+ny*radial,.585+depth);
      normals.push(nx*Math.cos(phi),ny*Math.cos(phi),Math.sin(phi));
    }
  }
  const id=(s:number,c:number)=>((s+RENDER_SLICES)%RENDER_SLICES)*RENDER_CROSS+(c%RENDER_CROSS);
  for(let s=0;s<RENDER_SLICES;s++)for(let c=0;c<RENDER_CROSS;c++){
    const n=(s+1)%RENDER_SLICES,c1=(c+1)%RENDER_CROSS;
    indices.push(id(s,c),id(n,c),id(n,c1),id(s,c),id(n,c1),id(s,c1));
  }
  return{positions:new Float64Array(positions),normals:new Float64Array(normals),indices};
}

function computeNormals(positions:Float64Array,indices:readonly number[],out:Float64Array):void{
  out.fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]!*3,ib=indices[i+1]!*3,ic=indices[i+2]!*3;
    const ax=positions[ia]!,ay=positions[ia+1]!,az=positions[ia+2]!;
    const bx=positions[ib]!,by=positions[ib+1]!,bz=positions[ib+2]!;
    const cx=positions[ic]!,cy=positions[ic+1]!,cz=positions[ic+2]!;
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const k of [ia,ib,ic]){out[k]=out[k]!+nx;out[k+1]=out[k+1]!+ny;out[k+2]=out[k+2]!+nz;}
  }
  for(let i=0;i<out.length;i+=3){
    const l=Math.hypot(out[i]!,out[i+1]!,out[i+2]!)||1;
    out[i]/=l;out[i+1]/=l;out[i+2]/=l;
  }
}

function rotatedHalf(entity:RuntimeEntity,base:Vec3):Vec3{
  const a=Math.abs(entity.rotation[0]),c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
  return[base[0],base[1]*c+base[2]*s,base[1]*s+base[2]*c];
}

function contactBoxes(scene:Scene):StructuralStaticBox[]{
  const upper=scene.entities.get(VOCAL_FACE_IDS.upperTeeth),lower=scene.entities.get(VOCAL_FACE_IDS.lowerTeeth);
  const out:StructuralStaticBox[]=[];
  if(upper)out.push({id:'upper-teeth',center:[...upper.position],half:rotatedHalf(upper,[.165,.0275,.014])});
  if(lower)out.push({id:'lower-teeth',center:[...lower.position],half:rotatedHalf(lower,[.16,.025,.013])});
  return out;
}

export function softVocalFaceSceneSpec():SceneSpec{
  const base=vocalFaceSceneSpec();
  const template=surfaceTemplate();
  const soft:Primitive={kind:'triangle-mesh',positions:[...template.positions],normals:[...template.normals],indices:[...template.indices]};
  return{
    ...base,
    entities:[
      ...base.entities,
      {
        id:SOFT_MOUTH_ID,
        mesh:soft,
        material:{kind:'default',color:[.48,.095,.12,1],roughness:.54,metalness:0},
      },
    ],
  };
}

export class SoftMouthRig{
  readonly structure:StructuralBody;
  readonly skin:StructuralSkinBinding;
  readonly surface:SurfaceTemplate;
  private readonly meta:readonly CageMeta[];
  private readonly entity:RuntimeEntity;
  private readonly deformed:Float64Array;
  private readonly normals:Float64Array;
  private contacts:StructuralContactStats={contacts:0,maxPenetration:0,projectedSamples:0};

  constructor(readonly scene:Scene){
    const built=buildDefinition();
    this.meta=built.meta;
    this.structure=new StructuralBody(built.definition);
    this.structure.activateFromRigid(this.structure.centerOfMass(),[0,0,0],[0,0,0]);
    this.surface=surfaceTemplate();
    this.skin=bindStructuralSkin(this.surface.positions,this.structure.originalPosition,4);
    this.deformed=new Float64Array(this.surface.positions.length);
    this.normals=new Float64Array(this.surface.normals.length);
    const entity=scene.entities.get(SOFT_MOUTH_ID);if(!entity)throw new TypeError('Soft mouth entity missing');
    this.entity=entity;
    this.projectSurface();
  }

  private target(meta:CageMeta,a:VocalArticulators,pose:VocalFacePose):Vec3{
    const lower=Math.max(0,-Math.sin(meta.theta));
    const rx=.22*(1-.24*a.lipRound-.065*a.labiodental);
    const ry=.014+.071*a.jawOpen*(1-a.lipClosure);
    const centerY=1.365-pose.jawDropM*.28-lower*pose.jawDropM*.30;
    const centerZ=.585+.064*a.lipRound+.012*a.labiodental+lower*.010*a.jawOpen;
    const [nx,ny]=ellipseNormal(meta.theta,Math.max(.12,rx),Math.max(.01,ry));
    let y=centerY+ry*Math.sin(meta.theta)+ny*meta.radial;
    let z=centerZ+meta.depth*(1+.22*a.lipRound);
    if(lower&&a.labiodental>.01){y+=.032*a.labiodental;z+=.010*a.labiodental;}
    return[
      rx*Math.cos(meta.theta)+nx*meta.radial,
      y,
      z,
    ];
  }

  step(a:VocalArticulators,pose:VocalFacePose,dt:number):SoftMouthDiagnostics{
    if(!Number.isFinite(dt)||dt<=0||dt>.1)throw new RangeError('Soft mouth dt must be within (0,.1]');
    let remaining=dt;
    let maxPen=0,contacts=0;
    while(remaining>1e-9){
      const h=Math.min(remaining,1/240);
      for(let node=0;node<this.structure.nodeCount;node++){
        const target=this.target(this.meta[node]!,a,pose),j=node*3;
        const dx=target[0]-this.structure.position[j]!,dy=target[1]-this.structure.position[j+1]!,dz=target[2]-this.structure.position[j+2]!;
        const vx=this.structure.velocity[j]!,vy=this.structure.velocity[j+1]!,vz=this.structure.velocity[j+2]!;
        const corner=Math.abs(Math.cos(this.meta[node]!.theta)),stiffness=1.9+1.1*corner,damping=.052;
        let fx=stiffness*dx-damping*vx,fy=stiffness*dy-damping*vy,fz=stiffness*dz-damping*vz;
        const f=Math.hypot(fx,fy,fz),limit=.19;if(f>limit){const q=limit/f;fx*=q;fy*=q;fz*=q;}
        this.structure.addForce(node,[fx,fy,fz]);
      }
      const contact=new StructuralStaticContactSolver(contactBoxes(this.scene),this.structure.definition.collisionTriangles??[]);
      contact.resetStats();
      this.structure.step(h,[0,0,0],body=>contact.project(body));
      maxPen=Math.max(maxPen,contact.stats.maxPenetration);contacts+=contact.stats.contacts;
      remaining-=h;
    }
    this.contacts={contacts,maxPenetration:maxPen,projectedSamples:contacts};
    this.projectSurface();
    return this.diagnostics;
  }

  private projectSurface():void{
    applyStructuralSkin(this.skin,this.structure.originalPosition,this.structure.position,this.deformed);
    computeNormals(this.deformed,this.surface.indices,this.normals);
    this.entity.mesh={
      kind:'triangle-mesh',
      positions:[...this.deformed],
      normals:[...this.normals],
      indices:[...this.surface.indices],
    };
  }

  get diagnostics():SoftMouthDiagnostics{
    let broken=0;for(const value of this.structure.broken)broken+=value?1:0;
    const upperSlice=Math.round(CAGE_SLICES*.25),lowerSlice=Math.round(CAGE_SLICES*.75);
    const avgY=(slice:number)=>{
      let y=0;for(let c=0;c<CAGE_CROSS;c++)y+=this.structure.position[(slice*CAGE_CROSS+c)*3+1]!;
      return y/CAGE_CROSS;
    };
    return Object.freeze({
      nodes:this.structure.nodeCount,
      constraints:this.structure.constraintCount,
      kineticEnergyJ:this.structure.kineticEnergy(),
      mouthGapM:Math.max(0,avgY(upperSlice)-avgY(lowerSlice)),
      maxContactPenetrationM:this.contacts.maxPenetration,
      contacts:this.contacts.contacts,
      brokenConstraints:broken,
    });
  }
}

export class SoftVocalFaceRig{
  readonly rigid:VocalFaceRig;
  readonly mouth:SoftMouthRig;

  constructor(readonly scene:Scene){
    this.rigid=new VocalFaceRig(scene);
    this.mouth=new SoftMouthRig(scene);
    this.hideLegacyLips();
  }

  private hideLegacyLips():void{
    for(const id of [VOCAL_FACE_IDS.upperLip,VOCAL_FACE_IDS.lowerLip]){
      const entity=this.scene.entities.get(id);if(entity)entity.scale.splice(0,3,.001,.001,.001);
    }
  }

  step(a:VocalArticulators,dt:number):{readonly pose:VocalFacePose;readonly mouth:SoftMouthDiagnostics}{
    const pose=this.rigid.step(a,dt);
    this.hideLegacyLips();
    const mouth=this.mouth.step(a,pose,dt);
    return Object.freeze({pose,mouth});
  }
}
