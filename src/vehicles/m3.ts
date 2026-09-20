import type {MechanicalMaterial} from '../materials/catalog.js';
import {bindStructuralSkin,type StructuralSkinBinding} from '../physics/structural-skin.js';
import type {StructuralDefinition} from '../physics/structure.js';
import type {BodySpec,Color,MaterialSpec} from '../scene/types.js';
import {M3_FBX_PARTS_FIDELITY,m3FbxParts} from './m3-fbx-parts.js';
import {passengerPartMaterial,passengerStructuralDefinition,type ParametricPassengerGeometry,type ParametricVehiclePart,type ParametricVehiclePartRole,type PassengerVehicleProfile} from './passenger.js';
import {M3_SHELL_FIDELITY,m3HighFidelityBody} from './m3-shell.js';
import {buildSmoothSubdivisionPlan,subdivideSmoothTriangleMesh,type SmoothSubdivisionPlan,type TriangleMesh} from './render-subdivision.js';

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

let renderSubdivisionPlan:SmoothSubdivisionPlan|undefined;
let renderBodyCache:TriangleMesh|undefined;
export function m3RenderSubdivisionPlan():SmoothSubdivisionPlan{return renderSubdivisionPlan??=buildSmoothSubdivisionPlan(m3HighFidelityBody(),35,.018);}
function smoothBodyTwice(mesh:TriangleMesh):TriangleMesh{
  const first=subdivideSmoothTriangleMesh(mesh,mesh===m3HighFidelityBody()?m3RenderSubdivisionPlan():buildSmoothSubdivisionPlan(mesh,35,.018));
  // A second render-only PN pass is cheap for one hero vehicle (~18k body tris)
  // and removes the visible faceting left by the compact 1,126-triangle source.
  // Physics, structural binding and the packed source stay untouched.
  return subdivideSmoothTriangleMesh(first,buildSmoothSubdivisionPlan(first,42,.0075));
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
  const backingPosition=(source:(typeof sources)[number]):readonly[number,number,number]=>{
    const [x,y,z]=source.center;
    if(source.id==='windshield-front')return[x-.018,y-.004,z];
    if(source.id==='windshield-rear')return[x+.018,y-.004,z];
    if(source.id.includes('-left'))return[x,y,z+.012];
    if(source.id.includes('-right'))return[x,y,z-.012];
    return source.center;
  };
  const glazingBackers=sources.filter(source=>source.sourceMaterial==='Window').map(source=>Object.freeze({
    id:'interior-'+source.id,
    role:'dark' as const,
    mesh:source.mesh,
    position:backingPosition(source),
    material:{kind:'default' as const,finish:'smooth' as const,roughness:.48,metalness:0},
  }));
  const parts:ParametricVehiclePart[]=[
    Object.freeze({id:'body',role:'paint',mesh:renderBody,position:[0,0,0] as const,material:passengerPartMaterial('paint')}),
    ...sources.map(source=>Object.freeze({
      id:source.id,
      role:sourceRole(source.sourceMaterial,source.id),
      mesh:source.mesh,
      position:source.center,
      ...(source.wheel?{wheel:true}:{}),
      material:sourceMaterial(source.sourceMaterial,source.id),
    })),
    // Exterior FBX has no cabin. Reuse each glazing mesh a few millimetres inward
    // as a dark interior backing: no new geometry payload, no impossible sightline
    // through the entire car, and the transparent outer pane still owns reflections.
    ...glazingBackers,
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
  if(part.role==='paint')return{...base,color:paint,finish:'polished',treatment:'painted',roughness:.105,metalness:.055};
  if(part.role==='glass')return{...base,color:[.035,.055,.072,.34]};
  if(part.role==='tire')return{...base,color:[.018,.019,.020,1]};
  if(part.role==='rim')return{...base,color:[.30,.32,.35,1],roughness:.16,metalness:.96};
  if(part.role==='light')return{...base,color:[.76,.84,.94,1],emissive:lightsOn?[1.25,1.45,1.75]:[.018,.022,.028]};
  if(part.role==='tail')return{...base,color:[.34,.012,.008,1],emissive:lightsOn?[.7,.015,.006]:[.018,.001,.001]};
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
