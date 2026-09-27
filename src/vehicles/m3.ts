import type {MechanicalMaterial} from '../materials/catalog.js';
import {bindStructuralSkin,type StructuralSkinBinding} from '../physics/structural-skin.js';
import type {StructuralDefinition} from '../physics/structure.js';
import type {BodySpec,Color,MaterialSpec} from '../scene/types.js';
import {M3_FBX_PARTS_FIDELITY,m3FbxParts} from './m3-fbx-parts.js';
import {generatePassengerWheelParts,passengerPartMaterial,passengerStructuralDefinition,type ParametricPassengerGeometry,type ParametricVehiclePart,type ParametricVehiclePartRole,type PassengerVehicleProfile} from './passenger.js';
import {M3_SHELL_FIDELITY,m3HighFidelityBody} from './m3-shell.js';
import {detailedPassengerWheelMeshes} from './passenger-wheel.js';
import {M3_DETAILED_BODY_PARAMETERS} from './m3-detailed-procedural.js';
import type {ThreeBoxVehicleDefinition} from './framework.js';
import {buildSmoothSubdivisionPlan,smoothCoincidentNormals,subdivideSmoothTriangleMesh,type SmoothSubdivisionPlan,type TriangleMesh} from './render-subdivision.js';

/**
 * BMW M3 visual fidelity is sourced from the user-supplied FBX, while the load-bearing
 * structure stays compact and parametric. Render meshes never become physics masses.
 */
export const M3_REFERENCE_PROVENANCE=Object.freeze({
  source:'BMW M3.fbx',
  sha256:'9c03464b3407ff1ab45cf4b3b913ee108ed454e4d7e5a82da438667af8cc2d67',
  sourceBytes:241628,
  representation:'parametric structural model + packed original FBX render parts',
  origin:'User-supplied BMW M3 reference; material groups preserved and glazing split into local fracture components',
  parametricFallbackEnvelopeMeanErrorMm:Object.freeze({width:6.4,top:6.0,bottom:6.8}),
  highFidelity:Object.freeze({...M3_SHELL_FIDELITY,...M3_FBX_PARTS_FIDELITY}),
});

export const M3_PARAMETRIC_PROFILE:PassengerVehicleProfile=Object.freeze({
  id:'m3-procedural',
  dimensions:Object.freeze({
    width:1.888,
    length:4.796,
    height:1.462,
    wheelbase:2.837,
    track:1.574,
    wheelRadius:.346,
    axleOffset:.118,
    clearance:.16,
  }),
  side:Object.freeze([
    [-.5,.894,.715,.92],
    [-.40,.922,.725,.84],
    [-.28,.998,.715,.84],
    [-.08,.976,.68,.86],
    [.06,.976,.658,.875],
    [.1633,.970,.675,.80],
    [.32,1.006,.608,.935],
    [.46,.957,.522,.975],
    [.5,.888,.492,1],
  ] as const),
  roof:Object.freeze([
    [-.255,.60,.918],
    [-.19,.59,.947],
    [-.08,.58,.965],
    [0,.60,.945],
    [.0484,.628,.9034],
  ] as const),
  cowl:.1633,
  rearGlassBase:-.402,
  roofCrown:.050,
  hoodCrown:.030,
  shoulder:.20,
  lowerWidth:.964,
  wheel:Object.freeze({width:.30,rimRatio:.80,spokes:10,split:.016,dish:.032}),
});

export const M3_VEHICLE_DEFINITION:ThreeBoxVehicleDefinition=Object.freeze({
  id:'bmw-m3-g80',
  family:'three-box',
  body:M3_DETAILED_BODY_PARAMETERS,
  wheel:Object.freeze({...M3_PARAMETRIC_PROFILE.wheel}),
  reference:Object.freeze({sha256:M3_REFERENCE_PROVENANCE.sha256,sourceBytes:M3_REFERENCE_PROVENANCE.sourceBytes,triangles:9798}),
});

function sourceRole(sourceMaterial:string,id:string):ParametricVehiclePartRole{
  if(sourceMaterial==='Window')return'glass';
  if(sourceMaterial==='Tires')return'tire';
  if(sourceMaterial==='Rims')return id.endsWith('wheel-hardware')?'metal':'rim';
  if(sourceMaterial==='DayLights'||sourceMaterial==='Transparent')return'light';
  if(sourceMaterial==='RearLight'||sourceMaterial==='RedPart')return'tail';
  if(sourceMaterial==='Exhaust')return'metal';
  if(sourceMaterial==='Mirror'||sourceMaterial==='Plastic')return'dark';
  throw new TypeError(`Unknown M3 source material ${sourceMaterial} on ${id}`);
}

function sourceMaterial(sourceMaterial:string,id:string):Omit<MaterialSpec,'color'>{
  if(sourceMaterial==='Window')return passengerPartMaterial('glass');
  if(sourceMaterial==='Tires')return passengerPartMaterial('tire');
  if(sourceMaterial==='Rims')return passengerPartMaterial('rim');
  if(sourceMaterial==='Exhaust')return passengerPartMaterial('metal');
  if(sourceMaterial==='Mirror')return{kind:'mirror',finish:'polished',roughness:.035,metalness:.94};
  if(sourceMaterial==='Plastic')return{kind:'plastic',finish:'smooth',roughness:.44,metalness:0};
  if(sourceMaterial==='DayLights'||sourceMaterial==='RearLight'||sourceMaterial==='RedPart'||sourceMaterial==='Transparent')return{kind:'plastic',finish:'smooth',roughness:sourceMaterial==='Transparent'?.09:.14,metalness:.02};
  throw new TypeError(`Unknown M3 source material ${sourceMaterial} on ${id}`);
}

let renderSubdivisionPlan:SmoothSubdivisionPlan|undefined;
let renderBodyCache:TriangleMesh|undefined;
export function m3RenderSubdivisionPlan():SmoothSubdivisionPlan{return renderSubdivisionPlan??=buildSmoothSubdivisionPlan(m3HighFidelityBody(),42,.006,true);}
function smoothBodyTwice(mesh:TriangleMesh):TriangleMesh{
  const first=subdivideSmoothTriangleMesh(mesh,mesh===m3HighFidelityBody()?m3RenderSubdivisionPlan():buildSmoothSubdivisionPlan(mesh,42,.006,true));
  const second=subdivideSmoothTriangleMesh(first,buildSmoothSubdivisionPlan(first,48,.002));
  // Final pass only resolves highlight continuity; the displacement is deliberately
  // sub-millimetre so the packed FBX surface remains the geometric authority.
  const third=subdivideSmoothTriangleMesh(second,buildSmoothSubdivisionPlan(second,52,.0005));
  return smoothCoincidentNormals(third,68,2e-5);
}
export function m3SmoothRenderBody(mesh:TriangleMesh):TriangleMesh{
  const base=m3HighFidelityBody();
  if(mesh===base)return renderBodyCache??=smoothBodyTwice(mesh);
  return smoothBodyTwice(mesh);
}

/** A thin, open semicircular fender detail: two concentric rings joined as quads. */
function wheelArchAccentMesh(axle:number):Extract<ParametricVehiclePart['mesh'],{kind:'triangle-mesh'}>{
  const outer=.388,inner=.374,segments=16,positions:number[]=[],normals:number[]=[],indices:number[]=[];
  for(let i=0;i<=segments;i++){
    const a=i/segments*Math.PI;
    const c=Math.cos(a),s=Math.sin(a);
    positions.push(axle+c*outer,M3_PARAMETRIC_PROFILE.dimensions.wheelRadius+s*outer,0);
    positions.push(axle+c*inner,M3_PARAMETRIC_PROFILE.dimensions.wheelRadius+s*inner,0);
    normals.push(0,0,-1,0,0,-1);
    if(i<segments){
      const o=i*2,n=i*2+1,on=(i+1)*2,nn=(i+1)*2+1;
      indices.push(o,n,nn,o,nn,on);
    }
  }
  return{kind:'triangle-mesh',positions,normals,indices};
}

/**
 * Complete compact M3 render geometry. The body shell remains bound to the structural
 * cage; trim, glazing, wheels, lights, mirrors and exhaust retain their FBX geometry.
 */
export function generateM3Vehicle():ParametricPassengerGeometry{
  const body=m3HighFidelityBody(),renderBody=m3SmoothRenderBody(body),sources=m3FbxParts();
  // Front fascia surface remains the packed FBX `plastic-trim`. These are only
  // recessed vertical inlays inside its two existing openings, not a second fascia.
  const grilleSlats:ParametricVehiclePart[]=[];
  // G80 M3 kidneys: tall openings filled with closely spaced horizontal aero slats.
  for(const side of [-1,1] as const)for(let row=0;row<11;row++){
    const y=.365+row*.033;
    const t=row/10;
    const span=.180+.085*Math.sin(Math.PI*t);
    grilleSlats.push(Object.freeze({
      id:`grille-inlay-${side<0?'left':'right'}-${row}`,
      role:'dark' as const,
      mesh:{kind:'box' as const,size:[.012,.022,span] as const},
      position:[2.375,y,side*(.185+.008*Math.cos(Math.PI*t))] as const,
      material:{kind:'plastic' as const,finish:'polished' as const,roughness:.11,metalness:.16,clearcoat:.72,clearcoatRoughness:.045},
    }));
  }
  // Exactly two thin polygon meshes, one per wheel: an open band following only
  // the upper semicircle. It is an accent on the arch, never a wheel cover.
  const wheelArchAccents:ParametricVehiclePart[]=[];
  for(const [id,axle] of [['front',M3_PARAMETRIC_PROFILE.dimensions.wheelbase/2+M3_PARAMETRIC_PROFILE.dimensions.axleOffset],['rear',-M3_PARAMETRIC_PROFILE.dimensions.wheelbase/2+M3_PARAMETRIC_PROFILE.dimensions.axleOffset]] as const){
    wheelArchAccents.push(Object.freeze({
      id:`wheel-arch-${id}-accent`,
      role:'paint' as const,
      mesh:wheelArchAccentMesh(axle),
      position:[0,0,-.956] as const,
      material:{kind:'plastic' as const,finish:'polished' as const,roughness:.075,metalness:.045,clearcoat:.96,clearcoatRoughness:.03},
    }));
  }
  // BMW roundel: use Y-axis cylinders so the emblem can tilt toward the front
  // camera without the polygon-prism extrusion producing a distorted wedge.
  const badgeTilt=-.48;
  const badge:ParametricVehiclePart[]=[
    Object.freeze({id:'hood-roundel-ring',role:'dark' as const,mesh:{kind:'cylinder' as const,radius:.086,height:.010,segments:48},position:[1.86,1.018,0] as const,rotation:[0,0,badgeTilt] as const,material:{kind:'plastic' as const,finish:'polished' as const,roughness:.045,metalness:.30,clearcoat:.94,clearcoatRoughness:.03}}),
    Object.freeze({id:'hood-roundel-white-disc',role:'dark' as const,mesh:{kind:'cylinder' as const,radius:.071,height:.011,segments:48},position:[1.86,1.024,0] as const,rotation:[0,0,badgeTilt] as const,material:{kind:'default' as const,finish:'polished' as const,roughness:.05,metalness:.02,clearcoat:.78,clearcoatRoughness:.03}}),
    Object.freeze({id:'hood-roundel-blue-disc',role:'dark' as const,mesh:{kind:'cylinder' as const,radius:.056,height:.012,segments:48},position:[1.86,1.030,0] as const,rotation:[0,0,badgeTilt] as const,material:{kind:'plastic' as const,finish:'polished' as const,roughness:.045,metalness:.10,clearcoat:.92,clearcoatRoughness:.025}}),
    Object.freeze({id:'hood-roundel-white-cross-x',role:'dark' as const,mesh:{kind:'box' as const,size:[.075,.006,.010] as const},position:[1.86,1.037,0] as const,rotation:[0,0,badgeTilt] as const,material:{kind:'default' as const,finish:'polished' as const,roughness:.05,metalness:.02,clearcoat:.78,clearcoatRoughness:.03}}),
    Object.freeze({id:'hood-roundel-white-cross-z',role:'dark' as const,mesh:{kind:'box' as const,size:[.010,.006,.075] as const},position:[1.86,1.038,0] as const,rotation:[0,0,badgeTilt] as const,material:{kind:'default' as const,finish:'polished' as const,roughness:.05,metalness:.02,clearcoat:.78,clearcoatRoughness:.03}}),
  ];
  const frontDetail:ParametricVehiclePart[]=[
    Object.freeze({id:'hood-seam-left',role:'dark' as const,mesh:{kind:'box' as const,size:[1.26,.006,.008] as const},position:[1.32,1.012,-.704] as const,rotation:[0,0,-.022] as const,material:{kind:'plastic' as const,finish:'smooth' as const,roughness:.55,metalness:0}}),
    Object.freeze({id:'hood-seam-right',role:'dark' as const,mesh:{kind:'box' as const,size:[1.26,.006,.008] as const},position:[1.32,1.012,.704] as const,rotation:[0,0,-.022] as const,material:{kind:'plastic' as const,finish:'smooth' as const,roughness:.55,metalness:0}}),
  ];
  const interior:ParametricVehiclePart[]=[
    Object.freeze({id:'interior-dashboard',role:'dark' as const,mesh:{kind:'box' as const,size:[.62,.18,1.42] as const},position:[.72,.84,0] as const,material:{kind:'default' as const,finish:'smooth' as const,roughness:.62,metalness:0}}),
    Object.freeze({id:'interior-console',role:'dark' as const,mesh:{kind:'box' as const,size:[.94,.18,.19] as const},position:[.10,.67,0] as const,material:{kind:'default' as const,finish:'smooth' as const,roughness:.72,metalness:0}}),
    Object.freeze({id:'interior-rear-bench',role:'dark' as const,mesh:{kind:'box' as const,size:[.48,.28,1.28] as const},position:[-.88,.63,0] as const,material:{kind:'default' as const,finish:'smooth' as const,roughness:.90,metalness:0}}),
  ];
  for(const side of [-1,1] as const){
    interior.push(Object.freeze({id:`interior-seat-${side<0?'left':'right'}`,role:'dark' as const,mesh:{kind:'box' as const,size:[.38,.58,.43] as const},position:[.02,.78,side*.37] as const,rotation:[0,0,-.10] as const,material:{kind:'default' as const,finish:'rough' as const,roughness:.92,metalness:0}}));
    interior.push(Object.freeze({id:`interior-headrest-${side<0?'left':'right'}`,role:'dark' as const,mesh:{kind:'box' as const,size:[.22,.22,.30] as const},position:[-.05,1.14,side*.37] as const,material:{kind:'default' as const,finish:'rough' as const,roughness:.88,metalness:0}}));
  }
  const parts:ParametricVehiclePart[]=[
    Object.freeze({id:'body',role:'paint',mesh:body,renderMesh:renderBody,position:[0,0,0] as const,material:passengerPartMaterial('paint')}),
    ...frontDetail,
    ...wheelArchAccents,
    ...grilleSlats,
    ...badge,
    ...interior,
    ...sources.map(source=>Object.freeze({
      id:source.id,
      role:sourceRole(source.sourceMaterial,source.id),
      mesh:source.mesh,
      position:source.center,
      ...(source.wheel?{wheel:true}:{}),
      material:sourceMaterial(source.sourceMaterial,source.id),
    })),
  ];
  const generatedTriangles=body.indices.length/3+sources.reduce((sum,source)=>sum+source.mesh.indices.length/3,0);
  return Object.freeze({
    profile:M3_PARAMETRIC_PROFILE,
    parts:Object.freeze(parts),
    body,
    bodyTriangles:body.indices.length/3,
    generatedTriangles,
  });
}

const isReferenceWheelPart=(part:{id:string;wheel?:boolean})=>!!part.wheel||part.id==='front-wheel-hardware'||part.id==='rear-wheel-hardware';

/**
 * Experimental representation that moves repeated wheel geometry from the FBX residual
 * into the shared passenger generator. The reference-wheel M3 remains the default.
 */
export function generateM3ProceduralWheelVehicle():ParametricPassengerGeometry{
  const reference=generateM3Vehicle(),parts:ParametricVehiclePart[]=[...reference.parts.filter(part=>!isReferenceWheelPart(part))];
  const d=M3_PARAMETRIC_PROFILE.dimensions,front=d.wheelbase/2+d.axleOffset,rear=-d.wheelbase/2+d.axleOffset;
  for(const [axle,x] of [['front',front],['rear',rear]] as const)for(const [side,z,sign] of [['left',-d.track/2,-1],['right',d.track/2,1]] as const){
    const wheel=detailedPassengerWheelMeshes(M3_PARAMETRIC_PROFILE,sign);
    parts.push(Object.freeze({id:`tire-${axle}-${side}`,role:'tire' as const,mesh:wheel.tire,position:[x,d.wheelRadius,z] as const,wheel:true,material:passengerPartMaterial('tire')}));
    parts.push(Object.freeze({id:`rim-${axle}-${side}`,role:'rim' as const,mesh:wheel.rim,position:[x,d.wheelRadius,z] as const,wheel:true,material:passengerPartMaterial('rim')}));
  }
  const primitiveTriangles=(part:ParametricVehiclePart)=>part.mesh.kind==='triangle-mesh'?part.mesh.indices.length/3:part.mesh.kind==='torus'?(part.mesh.segments??16)*8:part.mesh.kind==='cylinder'?(part.mesh.segments??16)*4:part.mesh.kind==='box'?12:0;
  return Object.freeze({profile:reference.profile,parts:Object.freeze(parts),body:reference.body,bodyTriangles:reference.bodyTriangles,generatedTriangles:parts.reduce((sum,part)=>sum+primitiveTriangles(part),0)});
}

/** Material descriptor consumed by Scene: visual overrides never discard the physical material kind. */
export function m3PartMaterial(part:ParametricVehiclePart,paint:Color=[.10,.11,.13,1],lightsOn=false):MaterialSpec{
  const base=part.material??passengerPartMaterial(part.role);
  if(part.id==='transparent-lenses')return{...base,color:[.42,.50,.55,.22]};
  if(part.id.startsWith('mirror-'))return{...base,color:[.30,.34,.38,1]};
  if(part.id==='red-reflectors')return{...base,color:[.30,.012,.008,1]};
  if(part.id.startsWith('hood-roundel-blue-'))return{...base,color:[.015,.19,.58,1]};
  if(part.id.startsWith('hood-roundel-white-'))return{...base,color:[.86,.89,.93,1]};
  if(part.id==='hood-roundel-ring')return{...base,color:[.012,.015,.020,1]};
  if(part.role==='paint')return{...base,color:paint,finish:'polished',treatment:'painted',roughness:.115,metalness:.045,clearcoat:.90,clearcoatRoughness:.045};
  if(part.role==='glass')return{...base,color:[.13,.18,.23,.20],roughness:.055};
  if(part.id.startsWith('interior-seat-')||part.id.startsWith('interior-headrest-'))return{...base,color:[.065,.070,.075,1],roughness:.92,metalness:0};
  if(part.id==='interior-dashboard'||part.id==='interior-console'||part.id==='interior-rear-bench')return{...base,color:[.030,.033,.036,1],roughness:.70,metalness:0};
  if(part.role==='tire')return{...base,color:[.018,.019,.020,1]};
  if(part.role==='rim')return{...base,color:[.34,.36,.39,1],roughness:.19,metalness:.94};
  if(part.role==='light')return{...base,color:[.54,.68,.86,1],emissive:lightsOn?[.34,.46,.70]:[.012,.016,.022],roughness:.11};
  if(part.role==='tail')return{...base,color:[.34,.012,.008,1],emissive:lightsOn?[.7,.015,.006]:[.018,.001,.001]};
  if(part.role==='metal')return{...base,color:[.22,.24,.27,1],roughness:.24,metalness:.88};
  return{...base,color:[.026,.029,.032,1]};
}

/**
 * Only brittle attached parts need their own contact body. Moving glazing/mirrors are
 * kinematic so fracture sees their true relative velocity; ductile trim stays on the
 * parent vehicle collision/structural model instead of duplicating mass.
 */
function partMeshSize(part:ParametricVehiclePart):readonly[number,number,number]{
  if(part.mesh.kind!=='triangle-mesh')return[1,1,1];
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<part.mesh.positions.length;i+=3)for(let axis=0;axis<3;axis++){const value=part.mesh.positions[i+axis]!;lo[axis]=Math.min(lo[axis]!,value);hi[axis]=Math.max(hi[axis]!,value);}
  return[hi[0]!-lo[0]!,hi[1]!-lo[1]!,hi[2]!-lo[2]!] as const;
}

function brittleCollisionSize(part:ParametricVehiclePart):readonly[number,number,number]{
  const size=partMeshSize(part);
  if(part.id.startsWith('windshield-'))return[.005,Math.max(.05,size[1]),Math.max(.05,size[2])];
  if(part.id.startsWith('window-'))return[Math.max(.05,size[0]),Math.max(.05,size[1]),.0045];
  if(part.id.startsWith('mirror-'))return[.004,Math.max(.04,size[1]),Math.max(.04,size[2])];
  return size;
}

export function m3PartBody(part:ParametricVehiclePart,moving=false):BodySpec|undefined{
  const kind=part.material?.kind;
  if(kind!=='glass'&&kind!=='mirror')return;
  const collisionSize=brittleCollisionSize(part);
  return moving?{mass:kind==='mirror'?.45:7.5,motion:'kinematic',collisionSize}:{mass:0,collisionSize};
}

export interface M3StructuralBlueprint {
  readonly definition:StructuralDefinition;
  readonly skin:StructuralSkinBinding;
}

/**
 * The detailed physics cage and the high-fidelity render shell share one authored
 * macro profile. The shell never becomes 700 physics masses; it is sparsely bound
 * to the 28-node structural graph.
 */
export function m3StructuralBlueprint(massKg:number,material:MechanicalMaterial):M3StructuralBlueprint{
  const definition=passengerStructuralDefinition(M3_PARAMETRIC_PROFILE,massKg,material),body=m3HighFidelityBody();
  const nodeRest=new Float64Array(definition.nodes.length*3);
  for(let i=0;i<definition.nodes.length;i++)nodeRest.set(definition.nodes[i]!.position,i*3);
  return Object.freeze({definition,skin:bindStructuralSkin(body.positions,nodeRest,4)});
}
