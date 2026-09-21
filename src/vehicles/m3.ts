import type {MechanicalMaterial} from '../materials/catalog.js';
import {bindStructuralSkin,type StructuralSkinBinding} from '../physics/structural-skin.js';
import type {StructuralDefinition} from '../physics/structure.js';
import type {BodySpec,Color,MaterialSpec} from '../scene/types.js';
import {M3_FBX_PARTS_FIDELITY,m3FbxParts} from './m3-fbx-parts.js';
import {passengerPartMaterial,passengerStructuralDefinition,type ParametricPassengerGeometry,type ParametricVehiclePart,type ParametricVehiclePartRole,type PassengerVehicleProfile} from './passenger.js';
import {M3_SHELL_FIDELITY,m3HighFidelityBody} from './m3-shell.js';
import {buildSmoothSubdivisionPlan,smoothCoincidentNormals,subdivideSmoothTriangleMesh,weldCoincidentTriangleMesh,type SmoothSubdivisionPlan,type TriangleMesh} from './render-subdivision.js';

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
  wheel:Object.freeze({width:.30,rimRatio:.80,spokes:10,dish:.032}),
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

function roundedRectPoint(width:number,height:number,radius:number,t:number):readonly[number,number]{
  const perimeter=2*(width+height-4*radius)+2*Math.PI*radius;
  let d=((t%1)+1)%1*perimeter;
  const straightW=width-2*radius,straightH=height-2*radius;
  const pieces:[number,()=>readonly[number,number]][]=[
    [straightW,()=>[-width/2+radius+d,height/2]],
    [Math.PI*radius/2,()=>{const a=Math.PI/2-d/radius;return[width/2-radius+Math.cos(a)*radius,height/2-radius+Math.sin(a)*radius];}],
    [straightH,()=>[width/2,height/2-radius-d]],
    [Math.PI*radius/2,()=>{const a=0-d/radius;return[width/2-radius+Math.cos(a)*radius,-height/2+radius+Math.sin(a)*radius];}],
    [straightW,()=>[width/2-radius-d,-height/2]],
    [Math.PI*radius/2,()=>{const a=-Math.PI/2-d/radius;return[-width/2+radius+Math.cos(a)*radius,-height/2+radius+Math.sin(a)*radius];}],
    [straightH,()=>[-width/2,-height/2+radius+d]],
    [Math.PI*radius/2,()=>{const a=Math.PI-d/radius;return[-width/2+radius+Math.cos(a)*radius,height/2-radius+Math.sin(a)*radius];}],
  ];
  for(const [length,fn] of pieces){if(d<=length)return fn();d-=length;}
  return[-width/2+radius,height/2];
}
function roundedRectFrameMesh(width:number,height:number,radius:number,border:number,segments=40):TriangleMesh{
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  const innerW=width-2*border,innerH=height-2*border,innerR=Math.max(.01,radius-border);
  for(let i=0;i<segments;i++){
    const t=i/segments,o=roundedRectPoint(width,height,radius,t),inn=roundedRectPoint(innerW,innerH,innerR,t);
    positions.push(0,o[1],o[0], 0,inn[1],inn[0]);
    normals.push(1,0,0, 1,0,0);
  }
  for(let i=0;i<segments;i++){const n=(i+1)%segments,a=i*2,b=a+1,c0=n*2,d=c0+1;indices.push(a,c0,d,a,d,b);}
  return{kind:'triangle-mesh',positions,normals,indices};
}

let renderSubdivisionPlan:SmoothSubdivisionPlan|undefined;
let renderSourceCache:TriangleMesh|undefined;
let renderBodyCache:TriangleMesh|undefined;
function m3RenderSource():TriangleMesh{return renderSourceCache??=weldCoincidentTriangleMesh(m3HighFidelityBody(),2e-5);}
export function m3RenderSubdivisionPlan():SmoothSubdivisionPlan{return renderSubdivisionPlan??=buildSmoothSubdivisionPlan(m3RenderSource(),62,.009,false);}
function smoothBodyTwice(mesh:TriangleMesh):TriangleMesh{
  // CarPaint is one continuous stamped shell. Source vertex duplication was an
  // encoding detail, not extra sheet-metal seams, so weld it before reconstructing
  // curvature. True open boundaries (arches, glazing openings, part borders) stay
  // fixed and therefore keep the characteristic silhouette.
  const source=mesh===m3HighFidelityBody()?m3RenderSource():weldCoincidentTriangleMesh(mesh,2e-5);
  const first=subdivideSmoothTriangleMesh(source,mesh===m3HighFidelityBody()?m3RenderSubdivisionPlan():buildSmoothSubdivisionPlan(source,62,.009,false));
  const second=subdivideSmoothTriangleMesh(first,buildSmoothSubdivisionPlan(first,66,.0030,false));
  const third=subdivideSmoothTriangleMesh(second,buildSmoothSubdivisionPlan(second,70,.0012,false));
  return smoothCoincidentNormals(third,70,1e-4);
}
export function m3SmoothRenderBody(mesh:TriangleMesh):TriangleMesh{
  const base=m3HighFidelityBody();
  if(mesh===base)return renderBodyCache??=smoothBodyTwice(mesh);
  return smoothBodyTwice(mesh);
}

/**
 * Complete compact M3 render geometry. The body shell remains bound to the structural
 * cage; trim, glazing, wheels, lights, mirrors and exhaust retain their FBX geometry.
 */
export function generateM3Vehicle():ParametricPassengerGeometry{
  const body=m3HighFidelityBody(),renderBody=m3SmoothRenderBody(body),sources=m3FbxParts();
  // The grille used to be authored as an independent oversized prop. Keep one
  // fascia envelope tied to the vehicle dimensions so the recess, frame and slats
  // cannot outgrow the bumper/hood opening independently.
  const fascia=Object.freeze({
    x:M3_PARAMETRIC_PROFILE.dimensions.length*.5,
    centerY:M3_PARAMETRIC_PROFILE.dimensions.height*.430,
    centerZ:M3_PARAMETRIC_PROFILE.dimensions.width*.091,
    kidneyWidth:M3_PARAMETRIC_PROFILE.dimensions.width*.134,
    kidneyHeight:M3_PARAMETRIC_PROFILE.dimensions.height*.280,
    radius:M3_PARAMETRIC_PROFILE.dimensions.height*.046,
    border:M3_PARAMETRIC_PROFILE.dimensions.width*.0068,
  });
  const recessWidth=fascia.kidneyWidth-fascia.border*2.2;
  const recessHeight=fascia.kidneyHeight-fascia.border*2.4;
  const slatSpan=recessWidth-fascia.border*1.4;
  const slatStep=recessHeight/7.0;
  const grilleSlats:ParametricVehiclePart[]=[];
  for(const side of [-1,1] as const)for(let row=1;row<=6;row++)grilleSlats.push(Object.freeze({
    id:`kidney-${side<0?'left':'right'}-slat-${row-1}`,
    role:'dark' as const,
    mesh:{kind:'box' as const,size:[.022,.012,slatSpan] as const},
    position:[fascia.x-.010,fascia.centerY-recessHeight*.5+slatStep*row,side*fascia.centerZ] as const,
    material:{kind:'plastic' as const,finish:'smooth' as const,roughness:.72,metalness:.01},
  }));
  const lowerIntake:ParametricVehiclePart[]=Array.from({length:5},(_,row)=>Object.freeze({
    id:`lower-intake-slat-${row}`,
    role:'dark' as const,
    mesh:{kind:'box' as const,size:[.032,.014,.69] as const},
    position:[2.365,.225+row*.043,0] as const,
    material:{kind:'plastic' as const,finish:'smooth' as const,roughness:.78,metalness:.01},
  }));
  const badge:ParametricVehiclePart[]=[
    Object.freeze({id:'hood-roundel-ring',role:'dark' as const,mesh:{kind:'cylinder' as const,radius:.052,height:.006,segments:32},position:[1.83,.985,0] as const,rotation:[0,0,.10] as const,material:{kind:'plastic' as const,finish:'polished' as const,roughness:.16,metalness:.10}}),
    Object.freeze({id:'hood-roundel-blue-a',role:'dark' as const,mesh:{kind:'polygon-prism' as const,axis:1 as const,points:[[0,0],[.034,0],[.034,.034],[0,.034]] as const,thickness:.006},position:[1.83,.990,0] as const,rotation:[0,0,.10] as const,material:{kind:'plastic' as const,finish:'polished' as const,roughness:.18,metalness:.02}}),
    Object.freeze({id:'hood-roundel-blue-b',role:'dark' as const,mesh:{kind:'polygon-prism' as const,axis:1 as const,points:[[0,0],[-.034,0],[-.034,-.034],[0,-.034]] as const,thickness:.006},position:[1.83,.990,0] as const,rotation:[0,0,.10] as const,material:{kind:'plastic' as const,finish:'polished' as const,roughness:.18,metalness:.02}}),
    Object.freeze({id:'hood-roundel-white-a',role:'dark' as const,mesh:{kind:'polygon-prism' as const,axis:1 as const,points:[[0,0],[-.034,0],[-.034,.034],[0,.034]] as const,thickness:.006},position:[1.83,.990,0] as const,rotation:[0,0,.10] as const,material:{kind:'default' as const,finish:'polished' as const,roughness:.18,metalness:.01}}),
    Object.freeze({id:'hood-roundel-white-b',role:'dark' as const,mesh:{kind:'polygon-prism' as const,axis:1 as const,points:[[0,0],[.034,0],[.034,-.034],[0,-.034]] as const,thickness:.006},position:[1.83,.990,0] as const,rotation:[0,0,.10] as const,material:{kind:'default' as const,finish:'polished' as const,roughness:.18,metalness:.01}}),
  ];
  const frontDetail:ParametricVehiclePart[]=[
    Object.freeze({id:'kidney-recess-left',role:'dark' as const,mesh:{kind:'box' as const,size:[.014,recessHeight,recessWidth] as const},position:[fascia.x-.012,fascia.centerY,-fascia.centerZ] as const,material:{kind:'plastic' as const,finish:'rough' as const,roughness:.92,metalness:0}}),
    Object.freeze({id:'kidney-recess-right',role:'dark' as const,mesh:{kind:'box' as const,size:[.014,recessHeight,recessWidth] as const},position:[fascia.x-.012,fascia.centerY,fascia.centerZ] as const,material:{kind:'plastic' as const,finish:'rough' as const,roughness:.92,metalness:0}}),
    Object.freeze({id:'lower-intake-recess',role:'dark' as const,mesh:{kind:'box' as const,size:[.026,.205,.82] as const},position:[2.372,.305,0] as const,material:{kind:'plastic' as const,finish:'rough' as const,roughness:.94,metalness:0}}),
    Object.freeze({id:'kidney-frame-left',role:'dark' as const,mesh:roundedRectFrameMesh(fascia.kidneyWidth,fascia.kidneyHeight,fascia.radius,fascia.border),position:[fascia.x+.004,fascia.centerY,-fascia.centerZ] as const,material:{kind:'plastic' as const,finish:'smooth' as const,roughness:.18,metalness:.08}}),
    Object.freeze({id:'kidney-frame-right',role:'dark' as const,mesh:roundedRectFrameMesh(fascia.kidneyWidth,fascia.kidneyHeight,fascia.radius,fascia.border),position:[fascia.x+.004,fascia.centerY,fascia.centerZ] as const,material:{kind:'plastic' as const,finish:'smooth' as const,roughness:.18,metalness:.08}}),
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
  const glazingBackings:ParametricVehiclePart[]=sources
    .filter(source=>source.sourceMaterial==='Window')
    .map(source=>Object.freeze({
      id:`interior-${source.id}`,
      role:'dark' as const,
      mesh:source.mesh,
      position:source.center,
      material:{kind:'default' as const,finish:'rough' as const,roughness:.88,metalness:0},
    }));
  const parts:ParametricVehiclePart[]=[
    Object.freeze({id:'body',role:'paint',mesh:body,renderMesh:renderBody,position:[0,0,0] as const,material:passengerPartMaterial('paint')}),
    ...grilleSlats,
    ...lowerIntake,
    ...frontDetail,
    ...badge,
    ...interior,
    ...glazingBackings,
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

/** Material descriptor consumed by Scene: visual overrides never discard the physical material kind. */
export function m3PartMaterial(part:ParametricVehiclePart,paint:Color=[.10,.11,.13,1],lightsOn=false):MaterialSpec{
  const base=part.material??passengerPartMaterial(part.role);
  if(part.id==='transparent-lenses')return{...base,color:[.42,.50,.55,.22]};
  if(part.id.startsWith('mirror-'))return{...base,color:[.30,.34,.38,1]};
  if(part.id==='red-reflectors')return{...base,color:[.30,.012,.008,1]};
  if(part.id.startsWith('hood-roundel-blue-'))return{...base,color:[.015,.19,.58,1]};
  if(part.id.startsWith('hood-roundel-white-'))return{...base,color:[.86,.89,.93,1]};
  if(part.id==='hood-roundel-ring')return{...base,color:[.012,.015,.020,1]};
  if(part.role==='paint')return{...base,color:paint,finish:'polished',treatment:'painted',roughness:.165,metalness:.025,clearcoat:.88,clearcoatRoughness:.082};
  if(part.role==='glass')return{...base,color:[.065,.075,.085,.24],roughness:.095};
  if(part.id.startsWith('interior-seat-')||part.id.startsWith('interior-headrest-'))return{...base,color:[.065,.070,.075,1],roughness:.92,metalness:0};
  if(part.id==='interior-dashboard'||part.id==='interior-console'||part.id==='interior-rear-bench')return{...base,color:[.030,.033,.036,1],roughness:.70,metalness:0};
  if(part.role==='tire')return{...base,color:[.018,.019,.020,1]};
  if(part.role==='rim')return{...base,color:[.30,.32,.35,1],roughness:.16,metalness:.96};
  if(part.role==='light')return{...base,color:[.74,.82,.92,1],emissive:lightsOn?[.11,.14,.20]:[.008,.010,.014],roughness:.14};
  if(part.role==='tail')return{...base,color:[.30,.010,.007,1],emissive:lightsOn?[.22,.010,.004]:[.012,.001,.001]};
  if(part.role==='metal')return{...base,color:[.16,.17,.18,1]};
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
