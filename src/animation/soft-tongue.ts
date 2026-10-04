import type {MechanicalMaterial} from '../materials/catalog.js';
import type {MutableVec3,Vec3} from '../math.js';
import {applyStructuralSkin,bindStructuralSkin,type StructuralSkinBinding} from '../physics/structural-skin.js';
import {StructuralStaticContactSolver,type StructuralStaticBox} from '../physics/structural-contact.js';
import {StructuralBody,type StructuralConstraintSpec,type StructuralDefinition} from '../physics/structure.js';
import type {Primitive,SceneSpec} from '../scene/types.js';
import {Scene,type RuntimeEntity} from '../scene/scene.js';
import type {VocalArticulators} from '../audio/vocal-tract.js';
import {VOCAL_FACE_IDS,type VocalFacePose} from './vocal-face.js';

const NX=5;
const NZ=7;
const NY=3;
const SOFT_TONGUE_ID='vocal-face-soft-tongue';
const REST_CENTER:Vec3=[0,1.295,.505];
const REST_SIZE:Vec3=[.29,.105,.31];

const TONGUE_TISSUE:MechanicalMaterial=Object.freeze({
  youngModulusPa:38_000,
  yieldStressPa:180_000,
  failureStressPa:420_000,
  failureStrain:8,
  plasticity:.015,
  brittle:false,
});

interface TongueMeta{
  readonly ix:number;
  readonly iy:number;
  readonly iz:number;
  readonly x01:number;
  readonly y01:number;
  readonly z01:number;
}

export interface TongueAirwaySample{
  readonly zM:number;
  readonly topYM:number;
  readonly bottomYM:number;
  readonly widthM:number;
}

export interface SoftTongueDiagnostics{
  readonly nodes:number;
  readonly constraints:number;
  readonly surfaceVertices:number;
  readonly brokenConstraints:number;
  readonly kineticEnergyJ:number;
  readonly contacts:number;
  readonly maxTrialPenetrationM:number;
  readonly minNodeY:number;
  readonly maxNodeY:number;
  readonly minNodeZ:number;
  readonly maxNodeZ:number;
  readonly tipPosition:Vec3;
}

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const nodeId=(x:number,y:number,z:number)=>z*NX*NY+y*NX+x;

function restPoint(x01:number,y01:number,z01:number):Vec3{
  const x=(x01-.5)*REST_SIZE[0]*(1-.18*z01);
  const y=REST_CENTER[1]+(y01-.5)*REST_SIZE[1]+.018*Math.sin(Math.PI*z01);
  const z=REST_CENTER[2]+(z01-.5)*REST_SIZE[2];
  return[x,y,z];
}

function buildDefinition():{definition:StructuralDefinition;meta:readonly TongueMeta[]}{
  const nodes:{position:Vec3;mass:number}[]=[],meta:TongueMeta[]=[];
  for(let z=0;z<NZ;z++)for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){
    const x01=x/(NX-1),y01=y/(NY-1),z01=z/(NZ-1);
    nodes.push({position:restPoint(x01,y01,z01),mass:.00115});
    meta.push(Object.freeze({ix:x,iy:y,iz:z,x01,y01,z01}));
  }

  const constraints:StructuralConstraintSpec[]=[];
  const pairs=new Set<string>();
  const addDistance=(a:number,b:number,areaM2=1.2e-5)=>{
    const lo=Math.min(a,b),hi=Math.max(a,b),key=lo+':'+hi;if(pairs.has(key))return;pairs.add(key);
    constraints.push({kind:'distance',a:lo,b:hi,areaM2,material:TONGUE_TISSUE});
  };
  const addVolume=(a:number,b:number,c:number,d:number)=>constraints.push({
    kind:'volume',a,b,c,d,compliance:1.4e-8,yieldRatio:10,breakRatio:100,plasticity:0,
  });

  for(let z=0;z<NZ;z++)for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){
    const a=nodeId(x,y,z);
    if(x+1<NX)addDistance(a,nodeId(x+1,y,z));
    if(y+1<NY)addDistance(a,nodeId(x,y+1,z));
    if(z+1<NZ)addDistance(a,nodeId(x,y,z+1),1.5e-5);
    if(x+1<NX&&z+1<NZ)addDistance(a,nodeId(x+1,y,z+1),7e-6);
    if(y+1<NY&&z+1<NZ)addDistance(a,nodeId(x,y+1,z+1),7e-6);
  }

  for(let z=0;z<NZ-1;z++)for(let y=0;y<NY-1;y++)for(let x=0;x<NX-1;x++){
    const a=nodeId(x,y,z),b=nodeId(x+1,y,z),c=nodeId(x,y+1,z),d=nodeId(x+1,y+1,z);
    const e=nodeId(x,y,z+1),f=nodeId(x+1,y,z+1),g=nodeId(x,y+1,z+1),h=nodeId(x+1,y+1,z+1);
    addVolume(a,b,c,e);
    addVolume(b,d,c,h);
    addVolume(b,c,e,h);
    addVolume(b,e,f,h);
    addVolume(c,e,h,g);
  }

  const collisionTriangles:[number,number,number][]=[];
  for(let z=0;z<NZ-1;z++)for(let x=0;x<NX-1;x++){
    const a=nodeId(x,NY-1,z),b=nodeId(x+1,NY-1,z),c=nodeId(x,NY-1,z+1),d=nodeId(x+1,NY-1,z+1);
    collisionTriangles.push([a,b,c],[b,d,c]);
    const la=nodeId(x,0,z),lb=nodeId(x+1,0,z),lc=nodeId(x,0,z+1),ld=nodeId(x+1,0,z+1);
    collisionTriangles.push([la,lc,lb],[lb,lc,ld]);
  }
  return{
    definition:Object.freeze({
      nodes:Object.freeze(nodes),
      constraints:Object.freeze(constraints),
      collisionTriangles:Object.freeze(collisionTriangles),
      iterations:12,
      internalDamping:42,
      sleepSpeed:.001,
      sleepDelay:1.5,
    }),
    meta:Object.freeze(meta),
  };
}

function surfaceTemplate():{positions:Float64Array;normals:Float64Array;indices:number[]}{
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  const RX=11,RZ=17;
  const id=(x:number,z:number)=>z*RX+x;
  for(let z=0;z<RZ;z++)for(let x=0;x<RX;x++){
    const x01=x/(RX-1),z01=z/(RZ-1);
    const arch=Math.sin(Math.PI*x01);
    const p=restPoint(x01,.82+.16*arch,z01);
    positions.push(...p);normals.push(0,1,0);
  }
  for(let z=0;z<RZ-1;z++)for(let x=0;x<RX-1;x++){
    const a=id(x,z),b=id(x+1,z),c=id(x,z+1),d=id(x+1,z+1);
    indices.push(a,c,b,b,c,d);
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
    out[i]=out[i]!/l;out[i+1]=out[i+1]!/l;out[i+2]=out[i+2]!/l;
  }
}

function oralBoundaryBoxes(scene:Scene):StructuralStaticBox[]{
  const lower=scene.entities.get(VOCAL_FACE_IDS.lowerTeeth),upper=scene.entities.get(VOCAL_FACE_IDS.upperTeeth);
  const lowerY=lower?.position[1]??1.326,lowerZ=lower?.position[2]??.563;
  const upperY=upper?.position[1]??1.385,upperZ=upper?.position[2]??.566;
  return[
    // Floor of mouth / mandibular soft-tissue foundation. Its top stays inside
    // the oral cavity, so a tongue node cannot emerge through the chin.
    {id:'oral-floor',center:[0,lowerY-.186,lowerZ-.055],half:[.30,.075,.27]},
    // Upper dentition / anterior palate guards the tongue from leaving through
    // the upper face while still allowing ordinary palatal constrictions.
    {id:'upper-incisors',center:[0,upperY,upperZ+.002],half:[.18,.025,.022]},
    {id:'lower-incisors',center:[0,lowerY,lowerZ+.002],half:[.18,.023,.022]},
    {id:'hard-palate',center:[0,1.515,.465],half:[.29,.032,.22]},
    // Inner lip / anterior vestibule boundary. Russian speech never requires
    // the tongue tip to leave the oral cavity; it may press here and deform,
    // but cannot emerge through the lips or chin.
    {id:'anterior-oral-wall',center:[0,1.335,.742],half:[.30,.145,.027]},
    // Posterior wall keeps the root in the pharyngeal/oral volume.
    {id:'posterior-oral-wall',center:[0,1.31,.315],half:[.30,.16,.025]},
  ];
}

function rootTarget(meta:TongueMeta,pose:VocalFacePose):Vec3{
  const rest=restPoint(meta.x01,meta.y01,meta.z01);
  const jawOpen=clamp(pose.jawAngleRad/.12,0,1);
  return[rest[0],rest[1]-pose.jawDropM*.52,rest[2]+.010*jawOpen];
}

export function softTonguePrimitive():Primitive{
  const s=surfaceTemplate();
  return{kind:'triangle-mesh',positions:[...s.positions],normals:[...s.normals],indices:[...s.indices]};
}

export class SoftTongueRig{
  readonly structure:StructuralBody;
  readonly skin:StructuralSkinBinding;
  private readonly meta:readonly TongueMeta[];
  private readonly surface=surfaceTemplate();
  private readonly deformed=new Float64Array(this.surface.positions.length);
  private readonly normals=new Float64Array(this.surface.normals.length);
  private readonly entity:RuntimeEntity;
  private contacts=0;
  private maxTrialPenetration=0;

  constructor(readonly scene:Scene){
    const built=buildDefinition();this.meta=built.meta;
    this.structure=new StructuralBody(built.definition);
    this.structure.activateFromRigid(this.structure.centerOfMass(),[0,0,0],[0,0,0]);
    this.skin=bindStructuralSkin(this.surface.positions,this.structure.originalPosition,6);
    const entity=scene.entities.get(SOFT_TONGUE_ID);if(!entity)throw new TypeError('Soft tongue entity missing');
    this.entity=entity;this.projectSurface();
  }

  private target(meta:TongueMeta,a:VocalArticulators,pose:VocalFacePose):Vec3{
    const root=rootTarget(meta,pose);
    const centerWeight=Math.sin(Math.PI*meta.x01);

    // Tongue body is a moving muscular hump, not a "front rises with height"
    // slider. Back vowels/stops lift the dorsum; front vowels lift the blade.
    const bodyCenter=.26+.52*a.tonguePosition;
    const bodyWidth=.17+.07*(1-a.tongueHeight);
    const bodyWeight=Math.exp(-(((meta.z01-bodyCenter)/bodyWidth)**2));
    const tipWeight=Math.exp(-(((meta.z01-.96)/.11)**2));

    const longitudinalPull=(a.tonguePosition-.45)*.060*(.20+.80*meta.z01);
    const tipForward=.018*a.tongueTip*tipWeight;
    const bodyLift=(a.tongueHeight-.35)*.145*bodyWeight;
    const tipLift=.070*a.tongueTip*tipWeight;

    const narrow=.030*a.tongueHeight*bodyWeight*(1-centerWeight);
    const x=root[0]*(1-narrow);
    return[
      x,
      root[1]+bodyLift+tipLift,
      root[2]+longitudinalPull+tipForward,
    ];
  }

  private attachRoot(body:StructuralBody,pose:VocalFacePose):void{
    for(let node=0;node<body.nodeCount;node++){
      const meta=this.meta[node]!;if(meta.z01>.18)continue;
      const target=rootTarget(meta,pose),j=node*3;
      body.position[j]=target[0];body.position[j+1]=target[1];body.position[j+2]=target[2];
    }
  }

  step(a:VocalArticulators,pose:VocalFacePose,dt:number):SoftTongueDiagnostics{
    if(!Number.isFinite(dt)||dt<=0||dt>.1)throw new RangeError('Soft tongue dt must be within (0,.1]');
    let remaining=dt,contacts=0,maxPen=0;
    while(remaining>1e-9){
      const h=Math.min(remaining,1/240);
      for(let node=0;node<this.structure.nodeCount;node++){
        const meta=this.meta[node]!;if(meta.z01<=.18)continue;
        const target=this.target(meta,a,pose),j=node*3;
        const dx=target[0]-this.structure.position[j]!,dy=target[1]-this.structure.position[j+1]!,dz=target[2]-this.structure.position[j+2]!;
        const vx=this.structure.velocity[j]!,vy=this.structure.velocity[j+1]!,vz=this.structure.velocity[j+2]!;
        const drive=.48+1.35*meta.z01;
        let fx=drive*dx-.085*vx,fy=drive*dy-.105*vy,fz=drive*dz-.085*vz;
        const f=Math.hypot(fx,fy,fz),limit=.034;if(f>limit){const q=limit/f;fx*=q;fy*=q;fz*=q;}
        this.structure.addForce(node,[fx,fy,fz]);
      }
      const contact=new StructuralStaticContactSolver(oralBoundaryBoxes(this.scene),this.structure.definition.collisionTriangles??[]);
      contact.resetStats();
      this.structure.step(h,[0,0,0],body=>{this.attachRoot(body,pose);contact.project(body);});
      contacts+=contact.stats.contacts;maxPen=Math.max(maxPen,contact.stats.maxPenetration);
      remaining-=h;
    }
    this.contacts=contacts;this.maxTrialPenetration=maxPen;this.projectSurface();
    return this.diagnostics;
  }

  private projectSurface():void{
    applyStructuralSkin(this.skin,this.structure.originalPosition,this.structure.position,this.deformed);
    computeNormals(this.deformed,this.surface.indices,this.normals);
    this.entity.mesh={kind:'triangle-mesh',positions:[...this.deformed],normals:[...this.normals],indices:[...this.surface.indices]};
  }

  airwayProfile():readonly TongueAirwaySample[]{
    const out:TongueAirwaySample[]=[];
    for(let iz=0;iz<NZ;iz++){
      let z=0,top=-Infinity,bottom=Infinity,minX=Infinity,maxX=-Infinity,count=0;
      for(let node=0;node<this.meta.length;node++){
        const meta=this.meta[node]!;if(meta.iz!==iz)continue;
        const j=node*3,x=this.structure.position[j]!,y=this.structure.position[j+1]!,zz=this.structure.position[j+2]!;
        z+=zz;top=Math.max(top,y);bottom=Math.min(bottom,y);minX=Math.min(minX,x);maxX=Math.max(maxX,x);count++;
      }
      out.push(Object.freeze({zM:z/Math.max(1,count),topYM:top,bottomYM:bottom,widthM:maxX-minX}));
    }
    return Object.freeze(out);
  }

  get diagnostics():SoftTongueDiagnostics{
    let broken=0,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const value of this.structure.broken)broken+=value?1:0;
    for(let i=0;i<this.structure.nodeCount;i++){
      const j=i*3,y=this.structure.position[j+1]!,z=this.structure.position[j+2]!;
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
    const tipNodes=[] as number[];
    for(let i=0;i<this.meta.length;i++)if(this.meta[i]!.z01>.95)tipNodes.push(i);
    const tip:MutableVec3=[0,0,0];
    for(const i of tipNodes){const j=i*3;tip[0]+=this.structure.position[j]!;tip[1]+=this.structure.position[j+1]!;tip[2]+=this.structure.position[j+2]!;}
    const n=Math.max(1,tipNodes.length);tip[0]/=n;tip[1]/=n;tip[2]/=n;
    return Object.freeze({
      nodes:this.structure.nodeCount,
      constraints:this.structure.constraintCount,
      surfaceVertices:this.surface.positions.length/3,
      brokenConstraints:broken,
      kineticEnergyJ:this.structure.kineticEnergy(),
      contacts:this.contacts,
      maxTrialPenetrationM:this.maxTrialPenetration,
      minNodeY:minY,maxNodeY:maxY,minNodeZ:minZ,maxNodeZ:maxZ,
      tipPosition:Object.freeze(tip) as Vec3,
    });
  }
}

export function addSoftTongueToScene(spec:SceneSpec):SceneSpec{
  return{
    ...spec,
    entities:[
      ...spec.entities,
      {
        id:SOFT_TONGUE_ID,
        mesh:softTonguePrimitive(),
        material:{kind:'default',color:[.55,.14,.17,1],roughness:.72,metalness:0},
      },
    ],
  };
}

export function hideLegacyTongue(scene:Scene):void{
  const tongue=scene.entities.get(VOCAL_FACE_IDS.tongue);
  if(tongue)tongue.scale.splice(0,3,.001,.001,.001);
}
