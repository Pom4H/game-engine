import type {MechanicalMaterial} from '../materials/catalog.js';
import type {MutableVec3,Vec3} from '../math.js';
import {applyStructuralSkin,bindStructuralSkin,type StructuralSkinBinding} from '../physics/structural-skin.js';
import {StructuralStaticContactSolver,type StructuralContactStats,type StructuralStaticBox} from '../physics/structural-contact.js';
import {StructuralBody,type StructuralConstraintSpec,type StructuralDefinition} from '../physics/structure.js';
import type {Color,Primitive,SceneSpec} from '../scene/types.js';
import {Scene,type RuntimeEntity} from '../scene/scene.js';
import type {VocalArticulators} from '../audio/vocal-tract.js';
import {VocalFaceRig,VOCAL_FACE_IDS,vocalFaceSceneSpec,type VocalFacePose} from './vocal-face.js';

const CAGE_ANGLES=24;
const CAGE_RINGS=5;
const CAGE_LAYERS=2;
const RENDER_ANGLES=48;
const RENDER_RINGS=9;
const SOFT_FACE_ID='vocal-face-soft-perioral';
const MIN_LIP_CONTACT_GAP_M=.0015;

const SKIN:Color=[.62,.39,.30,1];
const VERMILION:Color=[.62,.13,.16,1];
const MUCOSA:Color=[.39,.055,.075,1];

const TISSUE:MechanicalMaterial=Object.freeze({
  youngModulusPa:55_000,
  yieldStressPa:220_000,
  failureStressPa:480_000,
  failureStrain:7.5,
  plasticity:.02,
  brittle:false,
});

interface CageMeta{
  readonly angle:number;
  readonly ring:number;
  readonly radial:number;
  readonly layer:0|1;
  readonly lower:number;
  readonly side:number;
}

interface SurfaceTemplate{
  readonly positions:Float64Array;
  readonly normals:Float64Array;
  readonly colors:Float64Array;
  readonly indices:number[];
}

export interface SoftMouthDiagnostics{
  readonly nodes:number;
  readonly constraints:number;
  readonly surfaceVertices:number;
  readonly apertureBoundaryNodes:number;
  readonly outerAttachmentNodes:number;
  readonly cheekNodes:number;
  readonly chinNodes:number;
  readonly orbicularisConstraints:number;
  readonly orbicularisRestScale:number;
  readonly kineticEnergyJ:number;
  readonly mouthGapM:number;
  readonly maxContactPenetrationM:number;
  readonly remainingToothPenetrationM:number;
  readonly contacts:number;
  readonly deepestContactBox?:string;
  readonly deepestContactPoint?:Vec3;
  readonly brokenConstraints:number;
}

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(t:number)=>{const x=clamp(t,0,1);return x*x*(3-2*x);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;

function outerRadiusY(angle:number):number{
  const lower=Math.max(0,-Math.sin(angle)),upper=Math.max(0,Math.sin(angle));
  return .165+.075*lower+.012*upper;
}

function restPoint(radial:number,angle:number,layer:0|1):Vec3{
  const r=smooth(radial);
  const innerRx=.172,innerRy=.021,outerRx=.405,outerRy=outerRadiusY(angle);
  const rx=mix(innerRx,outerRx,r),ry=mix(innerRy,outerRy,r);
  const lower=Math.max(0,-Math.sin(angle)),side=Math.abs(Math.cos(angle));
  const y=1.365+ry*Math.sin(angle)-.012*r*lower;
  const frontZ=.615-.078*r-.026*r*lower-.010*r*side;
  const thickness=mix(.020,.030,r);
  return[rx*Math.cos(angle),y,frontZ-(layer===1?thickness:0)];
}

function cageId(layer:number,ring:number,angle:number):number{
  const a=(angle+CAGE_ANGLES)%CAGE_ANGLES;
  return layer*CAGE_RINGS*CAGE_ANGLES+ring*CAGE_ANGLES+a;
}

function buildDefinition():{definition:StructuralDefinition;meta:readonly CageMeta[]}{
  const nodes:{position:Vec3;mass:number}[]=[],meta:CageMeta[]=[];
  for(let layer=0;layer<CAGE_LAYERS;layer++)for(let ring=0;ring<CAGE_RINGS;ring++)for(let angleIndex=0;angleIndex<CAGE_ANGLES;angleIndex++){
    const angle=angleIndex/CAGE_ANGLES*Math.PI*2,radial=ring/(CAGE_RINGS-1);
    const lower=Math.max(0,-Math.sin(angle)),side=Math.abs(Math.cos(angle));
    nodes.push({position:restPoint(radial,angle,layer as 0|1),mass:mix(.00042,.00082,radial)});
    meta.push(Object.freeze({angle,ring,radial,layer:layer as 0|1,lower,side}));
  }

  const constraints:StructuralConstraintSpec[]=[];
  const pairs=new Set<string>();
  const addDistance=(a:number,b:number,areaM2:number)=>{
    const lo=Math.min(a,b),hi=Math.max(a,b),key=lo+':'+hi;if(pairs.has(key))return;pairs.add(key);
    constraints.push({kind:'distance',a:lo,b:hi,areaM2,material:TISSUE});
  };
  const addVolume=(a:number,b:number,c:number,d:number)=>constraints.push({
    kind:'volume',a,b,c,d,compliance:1.2e-8,yieldRatio:10,breakRatio:100,plasticity:0,
  });

  const collisionTriangles:[number,number,number][]=[];
  for(let layer=0;layer<CAGE_LAYERS;layer++)for(let ring=0;ring<CAGE_RINGS;ring++)for(let a=0;a<CAGE_ANGLES;a++){
    const n=(a+1)%CAGE_ANGLES,current=cageId(layer,ring,a),around=cageId(layer,ring,n);
    addDistance(current,around,ring<=1?8e-6:12e-6);
    if(ring<CAGE_RINGS-1){
      const out=cageId(layer,ring+1,a),outAround=cageId(layer,ring+1,n);
      addDistance(current,out,ring<=1?10e-6:16e-6);
      addDistance(current,outAround,6e-6);
      addDistance(around,out,6e-6);
      if(ring<=1)collisionTriangles.push([current,out,around],[around,out,outAround]);
    }
    if(layer===0)addDistance(current,cageId(1,ring,a),9e-6);
  }

  for(let ring=0;ring<CAGE_RINGS-1;ring++)for(let a=0;a<CAGE_ANGLES;a++){
    const n=(a+1)%CAGE_ANGLES;
    const f00=cageId(0,ring,a),f10=cageId(0,ring+1,a),f01=cageId(0,ring,n),f11=cageId(0,ring+1,n);
    const b00=cageId(1,ring,a),b10=cageId(1,ring+1,a),b01=cageId(1,ring,n),b11=cageId(1,ring+1,n);
    addVolume(f00,f10,f01,b00);
    addVolume(f10,f11,f01,b11);
    addVolume(f10,f01,b00,b11);
    addVolume(f10,b00,b10,b11);
    addVolume(f01,b00,b11,b01);
  }

  for(let a=0;a<CAGE_ANGLES;a++){
    const n=(a+1)%CAGE_ANGLES;
    const f0=cageId(0,0,a),f1=cageId(0,0,n),b0=cageId(1,0,a),b1=cageId(1,0,n);
    collisionTriangles.push([f0,b0,f1],[f1,b0,b1]);
  }

  return{
    definition:Object.freeze({
      nodes:Object.freeze(nodes),
      constraints:Object.freeze(constraints),
      collisionTriangles:Object.freeze(collisionTriangles),
      iterations:14,
      internalDamping:34,
      sleepSpeed:.001,
      sleepDelay:1.5,
    }),
    meta:Object.freeze(meta),
  };
}

function colorAt(radial:number,inner=false):Color{
  if(inner)return MUCOSA;
  if(radial<.10)return VERMILION;
  if(radial<.26){
    const t=(radial-.10)/.16;
    return[
      mix(VERMILION[0],SKIN[0],t),
      mix(VERMILION[1],SKIN[1],t),
      mix(VERMILION[2],SKIN[2],t),
      1,
    ];
  }
  return SKIN;
}

function surfaceTemplate():SurfaceTemplate{
  const positions:number[]=[],normals:number[]=[],colors:number[]=[],indices:number[]=[];
  const frontId=(ring:number,a:number)=>ring*RENDER_ANGLES+(a+RENDER_ANGLES)%RENDER_ANGLES;
  for(let ring=0;ring<RENDER_RINGS;ring++)for(let a=0;a<RENDER_ANGLES;a++){
    const radial=ring/(RENDER_RINGS-1),angle=a/RENDER_ANGLES*Math.PI*2,p=restPoint(radial,angle,0),c=colorAt(radial);
    positions.push(...p);normals.push(0,0,1);colors.push(...c);
  }
  for(let ring=0;ring<RENDER_RINGS-1;ring++)for(let a=0;a<RENDER_ANGLES;a++){
    const n=(a+1)%RENDER_ANGLES;
    indices.push(frontId(ring,a),frontId(ring+1,a),frontId(ring,n));
    indices.push(frontId(ring,n),frontId(ring+1,a),frontId(ring+1,n));
  }

  const wallFrontBase=positions.length/3;
  for(let a=0;a<RENDER_ANGLES;a++){
    const angle=a/RENDER_ANGLES*Math.PI*2,p=restPoint(0,angle,0);
    positions.push(...p);normals.push(0,0,1);colors.push(...VERMILION);
  }
  const wallBackBase=positions.length/3;
  for(let a=0;a<RENDER_ANGLES;a++){
    const angle=a/RENDER_ANGLES*Math.PI*2,p=restPoint(0,angle,1);
    positions.push(...p);normals.push(0,0,-1);colors.push(...MUCOSA);
  }
  for(let a=0;a<RENDER_ANGLES;a++){
    const n=(a+1)%RENDER_ANGLES,f0=wallFrontBase+a,f1=wallFrontBase+n,b0=wallBackBase+a,b1=wallBackBase+n;
    indices.push(f0,b0,f1,f1,b0,b1);
  }
  return{
    positions:new Float64Array(positions),
    normals:new Float64Array(normals),
    colors:new Float64Array(colors),
    indices,
  };
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

function rotatedHalf(entity:RuntimeEntity,base:Vec3):Vec3{
  const a=Math.abs(entity.rotation[0]),c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
  return[base[0],base[1]*c+base[2]*s,base[1]*s+base[2]*c];
}

const DENTAL_X=Object.freeze([-.132,-.096,-.061,-.021,.021,.061,.096,.132] as const);

function transformDentalOffset(entity:RuntimeEntity,offset:Vec3):Vec3{
  const a=entity.rotation[0],cs=Math.cos(a),sn=Math.sin(a);
  return[
    entity.position[0]+offset[0],
    entity.position[1]+offset[1]*cs-offset[2]*sn,
    entity.position[2]+offset[1]*sn+offset[2]*cs,
  ];
}

function dentalArchBoxes(entity:RuntimeEntity,arch:'upper'|'lower'):StructuralStaticBox[]{
  const out:StructuralStaticBox[]=[];
  for(let i=0;i<DENTAL_X.length;i++){
    const x=DENTAL_X[i]!,side=Math.abs(x)/.132;
    // Real incisors lead the arch; canine/lateral teeth recede posteriorly.
    const z=.008-.012*side**1.65;
    const y=(arch==='upper'?-.001:.001)+.002*side;
    const center=transformDentalOffset(entity,[x,y,z]);
    const toothHalfX=(i===0||i===7)?.0155:.0175;
    const half=rotatedHalf(entity,[toothHalfX,.0215,.0105]);
    out.push({id:arch+'-tooth-'+i,center,half});
  }
  return out;
}

function framePoint(rest:Vec3,restFrame:Vec3,current:RuntimeEntity):Vec3{
  const dx=rest[0]-restFrame[0],dy=rest[1]-restFrame[1],dz=rest[2]-restFrame[2];
  const a=current.rotation[0],cs=Math.cos(a),sn=Math.sin(a);
  return[
    current.position[0]+dx,
    current.position[1]+dy*cs-dz*sn,
    current.position[2]+dy*sn+dz*cs,
  ];
}

function isBoneAttached(meta:CageMeta):boolean{
  if(meta.layer!==1)return false;
  if(meta.radial>=.98)return true;
  return meta.radial>=.25&&(meta.lower>.28||Math.sin(meta.angle)>.28);
}

function contactBoxes(scene:Scene):StructuralStaticBox[]{
  const upper=scene.entities.get(VOCAL_FACE_IDS.upperTeeth),lower=scene.entities.get(VOCAL_FACE_IDS.lowerTeeth);
  return[
    ...(upper?dentalArchBoxes(upper,'upper'):[]),
    ...(lower?dentalArchBoxes(lower,'lower'):[]),
  ];
}

function remainingBoxPenetration(body:StructuralBody,boxes:readonly StructuralStaticBox[]):number{
  let max=0;
  for(let node=0;node<body.nodeCount;node++){
    const j=node*3,x=body.position[j]!,y=body.position[j+1]!,z=body.position[j+2]!;
    for(const box of boxes){
      const dx=box.half[0]-Math.abs(x-box.center[0]),dy=box.half[1]-Math.abs(y-box.center[1]),dz=box.half[2]-Math.abs(z-box.center[2]);
      if(dx>=0&&dy>=0&&dz>=0)max=Math.max(max,Math.min(dx,dy,dz));
    }
  }
  return max;
}

function projectLipContact(body:StructuralBody):void{
  for(let a=1;a<CAGE_ANGLES/2;a++){
    const mirror=(CAGE_ANGLES-a)%CAGE_ANGLES;
    for(let layer=0;layer<CAGE_LAYERS;layer++){
      const top=cageId(layer,0,a),bottom=cageId(layer,0,mirror),T=top*3,B=bottom*3;
      const gap=body.position[T+1]!-body.position[B+1]!;
      if(gap>=MIN_LIP_CONTACT_GAP_M)continue;
      const wi=body.inverseMass[top]!,wj=body.inverseMass[bottom]!,denom=wi+wj;if(denom<=1e-12)continue;
      const correction=(MIN_LIP_CONTACT_GAP_M-gap)/denom;
      body.position[T+1]=body.position[T+1]!+wi*correction;
      body.position[B+1]=body.position[B+1]!-wj*correction;
    }
  }
}

export function softVocalFaceSceneSpec():SceneSpec{
  const base=vocalFaceSceneSpec(),template=surfaceTemplate();
  const soft:Primitive={
    kind:'triangle-mesh',
    positions:[...template.positions],
    normals:[...template.normals],
    colors:[...template.colors],
    indices:[...template.indices],
  };
  return{
    ...base,
    entities:[
      ...base.entities,
      {
        id:SOFT_FACE_ID,
        mesh:soft,
        material:{kind:'default',color:[1,1,1,1],roughness:.62,metalness:0},
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
  private readonly orbicularis:readonly number[];
  private orbicularisScale=1;
  private readonly deformed:Float64Array;
  private readonly normals:Float64Array;
  private readonly lowerTeethRestFrame:Vec3;
  private contacts:StructuralContactStats={contacts:0,maxPenetration:0,projectedSamples:0};
  private remainingPenetration=0;

  constructor(readonly scene:Scene){
    const built=buildDefinition();
    this.meta=built.meta;
    this.structure=new StructuralBody(built.definition);
    this.structure.activateFromRigid(this.structure.centerOfMass(),[0,0,0],[0,0,0]);
    const orbicularis:number[]=[];
    for(let i=0;i<built.definition.constraints.length;i++){
      const constraint=built.definition.constraints[i]!;
      if(constraint.kind!=='distance')continue;
      const a=this.meta[constraint.a]!,b=this.meta[constraint.b]!;
      const circumferential=a.ring===b.ring&&a.layer===b.layer;
      const lipFiber=a.ring<=1&&(a.layer===0||a.ring===0);
      if(circumferential&&lipFiber)orbicularis.push(i);
    }
    this.orbicularis=Object.freeze(orbicularis);
    this.surface=surfaceTemplate();
    this.skin=bindStructuralSkin(this.surface.positions,this.structure.originalPosition,6);
    this.deformed=new Float64Array(this.surface.positions.length);
    this.normals=new Float64Array(this.surface.normals.length);
    const entity=scene.entities.get(SOFT_FACE_ID);if(!entity)throw new TypeError('Soft perioral entity missing');
    this.entity=entity;
    const lowerTeeth=scene.entities.get(VOCAL_FACE_IDS.lowerTeeth);if(!lowerTeeth)throw new TypeError('Lower teeth frame missing');
    this.lowerTeethRestFrame=Object.freeze([...lowerTeeth.position]) as Vec3;
    this.projectSurface();
  }

  private target(meta:CageMeta,a:VocalArticulators,pose:VocalFacePose):Vec3{
    const rest=restPoint(meta.radial,meta.angle,meta.layer);
    const lipWeight=(1-smooth(meta.radial))**2;
    const outerWeight=smooth(meta.radial)**2;
    const upper=Math.max(0,Math.sin(meta.angle)),lower=meta.lower;
    const innerRx=.172*(1-.27*a.lipRound-.07*a.labiodental);
    const innerRy=.003+.063*a.jawOpen*(1-a.lipClosure);
    const centerY=1.365-pose.jawDropM*.08;
    const inner:MutableVec3=[
      innerRx*Math.cos(meta.angle),
      centerY+innerRy*Math.sin(meta.angle),
      .615+(meta.layer===1?-.020:0)+.050*a.lipRound,
    ];

    if(lower&&a.labiodental>.001){
      inner[1]+=lower*.032*a.labiodental;
      const pulledZ=inner[2]-lower*.022*a.labiodental;
      const incisorContactZ=meta.layer===1?.584:.598;
      inner[2]=Math.max(pulledZ,incisorContactZ);
    }

    const jawFollow=lower*(.25+.75*outerWeight)*(1-lipWeight*a.lipClosure*.90);
    const attached:MutableVec3=[
      rest[0],
      rest[1]-pose.jawDropM*.62*jawFollow,
      rest[2]+.010*a.jawOpen*jawFollow,
    ];

    const target:MutableVec3=[
      mix(attached[0],inner[0],lipWeight),
      mix(attached[1],inner[1],lipWeight),
      mix(attached[2],inner[2],lipWeight),
    ];

    if(meta.side>.70&&meta.radial>.55){
      const buccinator=.006*a.lipRound*meta.side*outerWeight;
      target[0]-=Math.sign(Math.cos(meta.angle))*buccinator;
      target[2]-=.004*a.lipRound*outerWeight;
    }
    if(lower>.65&&meta.radial>.55){
      target[1]-=.010*a.jawOpen*outerWeight;
      target[2]+=.004*a.jawOpen*outerWeight;
    }
    if(upper>.7&&meta.radial>.70)target[1]+=pose.jawDropM*.04*outerWeight;
    return target;
  }

  private projectBoneAttachments(body:StructuralBody):void{
    const lowerFrame=this.scene.entities.get(VOCAL_FACE_IDS.lowerTeeth);
    if(!lowerFrame)throw new TypeError('Lower teeth frame missing');
    for(let node=0;node<body.nodeCount;node++){
      const meta=this.meta[node]!;if(!isBoneAttached(meta))continue;
      const j=node*3,rest:Vec3=[body.originalPosition[j]!,body.originalPosition[j+1]!,body.originalPosition[j+2]!];
      let target:Vec3;
      if(meta.lower>.28)target=framePoint(rest,this.lowerTeethRestFrame,lowerFrame);
      else target=rest;
      body.position[j]=target[0];body.position[j+1]=target[1];body.position[j+2]=target[2];
    }
  }

  step(a:VocalArticulators,pose:VocalFacePose,dt:number):SoftMouthDiagnostics{
    if(!Number.isFinite(dt)||dt<=0||dt>.1)throw new RangeError('Soft mouth dt must be within (0,.1]');
    this.orbicularisScale=clamp(1-.40*a.lipClosure-.10*a.lipRound,.48,1);
    for(const index of this.orbicularis)this.structure.setDistanceRestScale(index,this.orbicularisScale);
    let remaining=dt,maxPen=0,contacts=0,deepestBox:string|undefined,deepestPoint:Vec3|undefined;
    while(remaining>1e-9){
      const h=Math.min(remaining,1/240);
      for(let node=0;node<this.structure.nodeCount;node++){
        const meta=this.meta[node]!;
        if(isBoneAttached(meta))continue;
        const target=this.target(meta,a,pose),j=node*3;
        const dx=target[0]-this.structure.position[j]!,dy=target[1]-this.structure.position[j+1]!,dz=target[2]-this.structure.position[j+2]!;
        const vx=this.structure.velocity[j]!,vy=this.structure.velocity[j+1]!,vz=this.structure.velocity[j+2]!;
        const lipWeight=(1-smooth(meta.radial))**2,outerWeight=smooth(meta.radial)**2;
        const stiffness=1.25+2.6*outerWeight+1.45*lipWeight,damping=.055+.025*outerWeight;
        let fx=stiffness*dx-damping*vx,fy=stiffness*dy-damping*vy,fz=stiffness*dz-damping*vz;
        const force=Math.hypot(fx,fy,fz),limit=.035+.045*outerWeight;
        if(force>limit){const q=limit/force;fx*=q;fy*=q;fz*=q;}
        this.structure.addForce(node,[fx,fy,fz]);

        // Fast marginal orbicularis / incisivus bundle: speech closures last
        // only ~70-100 ms, so the free vermilion border needs a dedicated
        // contractile drive rather than waiting for cheek attachment forces.
        if(a.lipClosure>.15&&meta.layer===0&&meta.ring<=1&&Math.abs(Math.sin(meta.angle))>.28){
          const closureGain=meta.ring===0?1:.48;
          const desiredY=target[1],errorY=desiredY-this.structure.position[j+1]!;
          const maxClosureForce=.060*a.lipClosure*closureGain;
          const closeFy=clamp(errorY*3.2-this.structure.velocity[j+1]!*0.040,-maxClosureForce,maxClosureForce);
          this.structure.addForce(node,[0,closeFy,0]);
        }
      }
      const boxes=contactBoxes(this.scene),contact=new StructuralStaticContactSolver(boxes,this.structure.definition.collisionTriangles??[]);
      contact.resetStats();
      this.structure.step(h,[0,0,0],body=>{this.projectBoneAttachments(body);contact.project(body);projectLipContact(body);});
      if(contact.stats.maxPenetration>maxPen){
        maxPen=contact.stats.maxPenetration;
        deepestBox=contact.stats.deepestBoxId;
        deepestPoint=contact.stats.deepestPoint;
      }
      contacts+=contact.stats.contacts;
      this.remainingPenetration=Math.max(this.remainingPenetration,remainingBoxPenetration(this.structure,boxes));
      remaining-=h;
    }
    this.contacts={
      contacts,maxPenetration:maxPen,projectedSamples:contacts,
      ...(deepestBox?{deepestBoxId:deepestBox}:{}),
      ...(deepestPoint?{deepestPoint}:{}),
    };
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
      colors:[...this.surface.colors],
      indices:[...this.surface.indices],
    };
  }

  get diagnostics():SoftMouthDiagnostics{
    let broken=0;for(const value of this.structure.broken)broken+=value?1:0;
    const top=cageId(0,0,CAGE_ANGLES/4),bottom=cageId(0,0,CAGE_ANGLES*3/4);
    const mouthGap=Math.max(0,this.structure.position[top*3+1]!-this.structure.position[bottom*3+1]!);
    const apertureBoundaryNodes=CAGE_ANGLES*CAGE_LAYERS,outerAttachmentNodes=CAGE_ANGLES*CAGE_LAYERS;
    let cheekNodes=0,chinNodes=0;
    for(const meta of this.meta){
      if(meta.radial>.55&&meta.side>.55)cheekNodes++;
      if(meta.radial>.55&&meta.lower>.55)chinNodes++;
    }
    return Object.freeze({
      nodes:this.structure.nodeCount,
      constraints:this.structure.constraintCount,
      surfaceVertices:this.surface.positions.length/3,
      apertureBoundaryNodes,
      outerAttachmentNodes,
      cheekNodes,
      chinNodes,
      orbicularisConstraints:this.orbicularis.length,
      orbicularisRestScale:this.orbicularisScale,
      kineticEnergyJ:this.structure.kineticEnergy(),
      mouthGapM:mouthGap,
      maxContactPenetrationM:this.contacts.maxPenetration,
      remainingToothPenetrationM:this.remainingPenetration,
      contacts:this.contacts.contacts,
      ...(this.contacts.deepestBoxId?{deepestContactBox:this.contacts.deepestBoxId}:{}),
      ...(this.contacts.deepestPoint?{deepestContactPoint:this.contacts.deepestPoint}:{}),
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
    this.hideLegacyMouthParts();
  }

  private hideLegacyMouthParts():void{
    for(const id of [VOCAL_FACE_IDS.upperLip,VOCAL_FACE_IDS.lowerLip]){
      const entity=this.scene.entities.get(id);if(entity)entity.scale.splice(0,3,.001,.001,.001);
    }
  }

  step(a:VocalArticulators,dt:number):{readonly pose:VocalFacePose;readonly mouth:SoftMouthDiagnostics}{
    const pose=this.rigid.step(a,dt);
    this.hideLegacyMouthParts();
    const mouth=this.mouth.step(a,pose,dt);
    return Object.freeze({pose,mouth});
  }
}
