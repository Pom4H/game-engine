import type {MechanicalMaterial} from '../materials/catalog.js';
import type {Vec3} from '../math.js';
import type {MaterialSpec,Primitive} from '../scene/types.js';
import type {StructuralDefinition,StructuralConstraintSpec} from '../physics/structure.js';

export type PassengerSideSection=readonly [station:number,halfWidth:number,beltHeight:number,topWidth:number];
export type PassengerRoofSection=readonly [station:number,halfWidth:number,edgeHeight:number];

export interface PassengerVehicleProfile {
  readonly id:string;
  readonly dimensions:{
    readonly width:number;
    readonly length:number;
    readonly height:number;
    readonly wheelbase:number;
    readonly track:number;
    readonly wheelRadius:number;
    readonly axleOffset:number;
    readonly clearance:number;
  };
  readonly side:readonly PassengerSideSection[];
  readonly roof:readonly PassengerRoofSection[];
  readonly cowl:number;
  readonly rearGlassBase:number;
  readonly roofCrown:number;
  readonly hoodCrown:number;
  readonly shoulder:number;
  readonly lowerWidth:number;
  readonly wheel:{
    readonly width:number;
    readonly rimRatio:number;
    readonly spokes:number;
    readonly dish:number;
    readonly split?:number;
  };
}

export type ParametricVehiclePartRole='paint'|'glass'|'tire'|'rim'|'light'|'tail'|'dark'|'metal';

export interface ParametricVehiclePart {
  readonly id:string;
  readonly role:ParametricVehiclePartRole;
  /** Physical/fallback geometry. */
  readonly mesh:Primitive;
  /** Optional high-detail visual geometry consumed only by the renderer/deformation skin. */
  readonly renderMesh?:Primitive;
  readonly position:Vec3;
  readonly rotation?:Vec3;
  readonly wheel?:boolean;
  /** Semantic material defaults. Scene authoring may override color/emission without losing physical kind. */
  readonly material?:Omit<MaterialSpec,'color'>;
}

export interface ParametricPassengerGeometry {
  readonly profile:PassengerVehicleProfile;
  readonly parts:readonly ParametricVehiclePart[];
  readonly body:Extract<Primitive,{kind:'triangle-mesh'}>;
  readonly bodyTriangles:number;
  readonly generatedTriangles:number;
}

const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;

export function validatePassengerVehicleProfile(profile:PassengerVehicleProfile):PassengerVehicleProfile{
  const d=profile.dimensions;
  for(const [name,value,min,max] of [
    ['width',d.width,1.4,2.4],['length',d.length,3.2,5.8],['height',d.height,1.1,2],
    ['wheelbase',d.wheelbase,2,3.6],['track',d.track,1.1,2.1],['wheelRadius',d.wheelRadius,.24,.45],
    ['axleOffset',d.axleOffset,-.35,.35],['clearance',d.clearance,.07,.35],
  ] as const)if(!Number.isFinite(value)||value<min||value>max)throw new RangeError(`${name}: ${min}..${max}`);
  if(!profile.id||profile.side.length<3||profile.side.length>16||profile.roof.length<3||profile.roof.length>16)throw new RangeError('Invalid passenger profile');
  if(profile.side[0]![0]!==-.5||profile.side.at(-1)![0]!==.5)throw new RangeError('Side profile must span -0.5..0.5');
  for(const sections of [profile.side,profile.roof]){
    let previous=-Infinity;
    for(const section of sections){
      if(!section.every(Number.isFinite)||section[0]<=previous)throw new RangeError('Profile sections must be finite and strictly ordered');
      previous=section[0];
    }
  }
  if(!(profile.rearGlassBase<profile.roof[0]![0]&&profile.roof.at(-1)![0]<profile.cowl))throw new RangeError('Cabin ordering is invalid');
  if(d.wheelbase+2*d.wheelRadius>d.length+.05||d.track+profile.wheel.width>d.width+.14)throw new RangeError('Wheel package does not fit passenger body');
  return profile;
}

export function interpolateSection<T extends readonly number[]>(sections:readonly T[],station:number):number[]{
  const x=clamp(station,-.5,.5),hi=sections.findIndex(section=>section[0]!>=x);
  if(hi<=0)return [...sections[hi<0?sections.length-1:0]!];
  const a=sections[hi-1]!,b=sections[hi]!,t=(x-a[0]!)/(b[0]!-a[0]!);
  return a.map((value,index)=>index===0?x:mix(value,b[index]!,t));
}

function bodyCrossSection(profile:PassengerVehicleProfile,station:number):Vec3[]{
  const d=profile.dimensions,side=interpolateSection(profile.side,station),x=station*d.length;
  const floor=d.clearance,half=side[1]!*d.width/2,belt=side[2]!*d.height;
  const lower=half*profile.lowerWidth,midY=mix(floor,belt,clamp(profile.shoulder,.08,.75));
  const top=vehicleTop(profile,station,half,belt);
  return[
    [x,floor,-lower],
    [x,midY,-half],
    [x,belt,-half],
    [x,top.y,-top.half],
    [x,top.y,top.half],
    [x,belt,half],
    [x,midY,half],
    [x,floor,lower],
  ];
}

function vehicleTop(profile:PassengerVehicleProfile,station:number,halfWidth?:number,beltY?:number):{half:number;y:number}{
  const d=profile.dimensions,side=interpolateSection(profile.side,station),half=halfWidth??side[1]!*d.width/2,belt=beltY??side[2]!*d.height;
  const roofMin=profile.roof[0]![0],roofMax=profile.roof.at(-1)![0];
  if(station>=roofMin&&station<=roofMax){
    const roof=interpolateSection(profile.roof,station);
    return{half:roof[1]!*d.width/2,y:roof[2]!*d.height};
  }
  if(station<roofMin){
    const t=clamp((station-profile.rearGlassBase)/(roofMin-profile.rearGlassBase));
    const roof=profile.roof[0]!;
    return{half:mix(half*side[3]!,roof[1]!*d.width/2,t),y:mix(belt+.018,roof[2]!*d.height,t)};
  }
  const t=1-clamp((station-roofMax)/(profile.cowl-roofMax));
  const roof=profile.roof.at(-1)!;
  return{half:mix(half*side[3]!,roof[1]!*d.width/2,t),y:mix(belt+profile.hoodCrown,roof[2]!*d.height,t)};
}

function stationSamples(profile:PassengerVehicleProfile,spacing=.11):number[]{
  const count=Math.ceil(profile.dimensions.length/spacing),set=new Set<number>();
  for(let i=0;i<=count;i++)set.add(-.5+i/count);
  for(const section of profile.side)set.add(section[0]);
  for(const section of profile.roof)set.add(section[0]);
  set.add(profile.rearGlassBase);set.add(profile.cowl);
  const axleRear=(-profile.dimensions.wheelbase/2+profile.dimensions.axleOffset)/profile.dimensions.length;
  const axleFront=(profile.dimensions.wheelbase/2+profile.dimensions.axleOffset)/profile.dimensions.length;
  for(const axle of [axleRear,axleFront])for(let i=-5;i<=5;i++)set.add(clamp(axle+i*.018,-.5,.5));
  return[...set].sort((a,b)=>a-b).filter((value,index,array)=>!index||value-array[index-1]!>1e-6);
}

function meshFromRings(rings:readonly Vec3[][]):Extract<Primitive,{kind:'triangle-mesh'}>{
  const positions:number[]=[],indices:number[]=[];
  const ringSize=rings[0]?.length??0;
  if(rings.length<2||ringSize<3||rings.some(ring=>ring.length!==ringSize))throw new RangeError('Invalid vehicle rings');
  for(const ring of rings)for(const point of ring)positions.push(...point);
  for(let station=0;station<rings.length-1;station++)for(let side=0;side<ringSize;side++){
    const next=(side+1)%ringSize,a=station*ringSize+side,b=station*ringSize+next,c=(station+1)*ringSize+next,d=(station+1)*ringSize+side;
    indices.push(a,b,c,a,c,d);
  }
  for(const station of [0,rings.length-1]){
    const center=positions.length/3,ring=rings[station]!,x=ring.reduce((sum,p)=>sum+p[0],0)/ringSize,y=ring.reduce((sum,p)=>sum+p[1],0)/ringSize,z=ring.reduce((sum,p)=>sum+p[2],0)/ringSize;
    positions.push(x,y,z);
    for(let side=0;side<ringSize;side++){
      const next=(side+1)%ringSize,a=station*ringSize+side,b=station*ringSize+next;
      if(station===0)indices.push(center,b,a);else indices.push(center,a,b);
    }
  }
  return triangleMesh(positions,indices);
}

function sideGlass(profile:PassengerVehicleProfile,sideSign:-1|1):Extract<Primitive,{kind:'triangle-mesh'}>{
  const positions:number[]=[],indices:number[]=[],count=12,start=profile.rearGlassBase,end=profile.cowl;
  for(let i=0;i<=count;i++){
    const station=mix(start,end,i/count),d=profile.dimensions,section=interpolateSection(profile.side,station),half=section[1]!*d.width/2,belt=section[2]!*d.height,top=vehicleTop(profile,station,half,belt);
    const surface=sideSign*(half+.004);
    positions.push(station*d.length,belt+.035,surface, station*d.length,Math.max(belt+.08,top.y-.035),sideSign*(top.half+.004));
  }
  for(let i=0;i<count;i++){const a=i*2,b=a+1,c=a+3,d=a+2;if(sideSign<0)indices.push(a,c,b,a,d,c);else indices.push(a,b,c,a,c,d);}
  return triangleMesh(positions,indices);
}

function windshield(profile:PassengerVehicleProfile,front:boolean):Extract<Primitive,{kind:'triangle-mesh'}>{
  const d=profile.dimensions,roofStation=front?profile.roof.at(-1)![0]:profile.roof[0]![0],deckStation=front?profile.cowl:profile.rearGlassBase;
  const positions:number[]=[],indices:number[]=[],columns=4,rows=2;
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
    const v=row/rows,u=column/columns*2-1,station=mix(deckStation,roofStation,v),section=interpolateSection(profile.side,station),half=section[1]!*d.width/2,belt=section[2]!*d.height,top=vehicleTop(profile,station,half,belt);
    const width=mix(half*.88,top.half,v),crown=profile.roofCrown*(1-u*u)*v;
    positions.push(station*d.length,mix(belt+.025,top.y-.018,v)+crown,u*width);
  }
  const stride=columns+1;
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const a=row*stride+column,b=a+1,c=a+stride+1,d0=a+stride;
    if(front)indices.push(a,b,c,a,c,d0);else indices.push(a,c,b,a,d0,c);
  }
  return triangleMesh(positions,indices);
}

function triangleMesh(positions:number[],indices:number[]):Extract<Primitive,{kind:'triangle-mesh'}>{
  const normals=Array<number>(positions.length).fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]!*3,ib=indices[i+1]!*3,ic=indices[i+2]!*3;
    const ax=positions[ia]!,ay=positions[ia+1]!,az=positions[ia+2]!,bx=positions[ib]!,by=positions[ib+1]!,bz=positions[ib+2]!,cx=positions[ic]!,cy=positions[ic+1]!,cz=positions[ic+2]!;
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const base of [ia,ib,ic]){normals[base]=normals[base]!+nx;normals[base+1]=normals[base+1]!+ny;normals[base+2]=normals[base+2]!+nz;}
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!)||1;normals[i]=normals[i]!/length;normals[i+1]=normals[i+1]!/length;normals[i+2]=normals[i+2]!/length;}
  return{kind:'triangle-mesh',positions,normals,indices};
}

export function passengerPartMaterial(role:ParametricVehiclePartRole):Omit<MaterialSpec,'color'>{
  if(role==='paint')return{kind:'steel',treatment:'painted',finish:'smooth',roughness:.22,metalness:.18,clearcoat:.78,clearcoatRoughness:.095};
  if(role==='glass')return{kind:'glass',finish:'polished',roughness:.07,metalness:0,pattern:'window'};
  if(role==='tire')return{kind:'rubber',finish:'rough',roughness:.94,metalness:0,pattern:'rubber'};
  if(role==='rim')return{kind:'aluminum',finish:'polished',roughness:.19,metalness:.95};
  if(role==='light'||role==='tail')return{kind:'plastic',finish:'smooth',roughness:.14,metalness:.02};
  if(role==='metal')return{kind:'steel',finish:'smooth',roughness:.27,metalness:.92};
  return{kind:'plastic',finish:'smooth',roughness:.44,metalness:0};
}

export function generatePassengerWheelParts(profileInput:PassengerVehicleProfile):readonly ParametricVehiclePart[]{
  const profile=validatePassengerVehicleProfile(profileInput),d=profile.dimensions,parts:ParametricVehiclePart[]=[];
  const front=d.wheelbase/2+d.axleOffset,rear=-d.wheelbase/2+d.axleOffset,major=d.wheelRadius*(1+profile.wheel.rimRatio)/2,tube=d.wheelRadius*(1-profile.wheel.rimRatio)/2;
  for(const [axle,x] of [['front',front],['rear',rear]] as const)for(const [side,z] of [['left',-d.track/2],['right',d.track/2]] as const){
    const key=`${axle}-${side}`,rotation:[number,number,number]=[Math.PI/2,0,0],wheel=true;
    parts.push({id:`tire-${key}`,role:'tire',mesh:{kind:'torus',radius:major,tube:Math.max(.018,tube),segments:32},position:[x,d.wheelRadius,z],rotation,wheel});
    parts.push({id:`rim-${key}`,role:'rim',mesh:{kind:'torus',radius:d.wheelRadius*profile.wheel.rimRatio*.78,tube:d.wheelRadius*.055,segments:profile.wheel.spokes*4},position:[x,d.wheelRadius,z],rotation,wheel});
    parts.push({id:`hub-${key}`,role:'metal',mesh:{kind:'cylinder',radius:d.wheelRadius*.14,height:profile.wheel.width*.65,segments:20},position:[x,d.wheelRadius,z],rotation,wheel});
  }
  return Object.freeze(parts.map(part=>Object.freeze({...part,material:passengerPartMaterial(part.role)})));
}

export function generatePassengerVehicle(profileInput:PassengerVehicleProfile):ParametricPassengerGeometry{
  const profile=validatePassengerVehicleProfile(profileInput),stations=stationSamples(profile),rings=stations.map(station=>bodyCrossSection(profile,station)),body=meshFromRings(rings);
  const parts:ParametricVehiclePart[]=[
    {id:'body',role:'paint',mesh:body,position:[0,0,0]},
    {id:'glass-left',role:'glass',mesh:sideGlass(profile,-1),position:[0,0,0]},
    {id:'glass-right',role:'glass',mesh:sideGlass(profile,1),position:[0,0,0]},
    {id:'windshield',role:'glass',mesh:windshield(profile,true),position:[0,0,0]},
    {id:'rear-glass',role:'glass',mesh:windshield(profile,false),position:[0,0,0]},
  ];
  parts.push(...generatePassengerWheelParts(profile));
  const d=profile.dimensions,lampY=interpolateSection(profile.side,.43)[2]!*d.height-.06,tailY=interpolateSection(profile.side,-.43)[2]!*d.height-.05;
  for(const side of [-1,1] as const){
    parts.push({id:`headlight-${side}`,role:'light',mesh:{kind:'box',size:[.05,.12,.42]},position:[d.length*.488,lampY,side*d.width*.29]});
    parts.push({id:`taillight-${side}`,role:'tail',mesh:{kind:'box',size:[.05,.11,.38]},position:[-d.length*.488,tailY,side*d.width*.29]});
    parts.push({id:`mirror-${side}`,role:'dark',mesh:{kind:'box',size:[.18,.10,.22]},position:[d.length*.085,d.height*.72,side*d.width*.53]});
  }
  for(const side of [-1,1] as const)parts.push({id:`exhaust-${side}`,role:'metal',mesh:{kind:'cylinder',radius:.035,height:.16,segments:16},position:[-d.length*.492,d.clearance+.08,side*d.width*.28],rotation:[0,0,Math.PI/2]});
  const primitiveTriangles=(mesh:Primitive)=>mesh.kind==='triangle-mesh'?mesh.indices.length/3:mesh.kind==='torus'?(mesh.segments??16)*8:mesh.kind==='cylinder'?(mesh.segments??16)*4:mesh.kind==='box'?12:0;
  const authoredParts=parts.map(part=>Object.freeze({...part,material:part.material??passengerPartMaterial(part.role)}));
  return Object.freeze({profile,parts:Object.freeze(authoredParts),body,bodyTriangles:body.indices.length/3,generatedTriangles:authoredParts.reduce((sum,part)=>sum+primitiveTriangles(part.mesh),0)});
}

export function passengerStructuralDefinition(
  profileInput:PassengerVehicleProfile,
  massKg:number,
  material:MechanicalMaterial,
):StructuralDefinition{
  const profile=validatePassengerVehicleProfile(profileInput);
  if(!Number.isFinite(massKg)||massKg<=0)throw new RangeError('Passenger structural mass must be positive');
  const d=profile.dimensions,rearAxle=(-d.wheelbase/2+d.axleOffset)/d.length,frontAxle=(d.wheelbase/2+d.axleOffset)/d.length;
  const stations=[-.47,rearAxle,-.19,0,.10,frontAxle,.47].sort((a,b)=>a-b);
  const nodes:{position:Vec3;mass:number}[]=[],constraints:StructuralConstraintSpec[]=[],collisionTriangles:[number,number,number][]=[];
  const nodeMass=massKg/(stations.length*4);
  for(const station of stations){
    const section=interpolateSection(profile.side,station),half=section[1]!*d.width/2,belt=section[2]!*d.height,top=vehicleTop(profile,station,half,belt),x=station*d.length;
    nodes.push(
      {position:[x,d.clearance,-half*profile.lowerWidth],mass:nodeMass},
      {position:[x,d.clearance,half*profile.lowerWidth],mass:nodeMass},
      {position:[x,top.y,-top.half],mass:nodeMass},
      {position:[x,top.y,top.half],mass:nodeMass},
    );
  }
  const addDistance=(a:number,b:number,areaM2:number)=>constraints.push({kind:'distance',a,b,areaM2,material});
  for(let station=0;station<stations.length;station++){
    const n=station*4;
    addDistance(n,n+1,.0012);addDistance(n+2,n+3,.00065);
    addDistance(n,n+2,.0008);addDistance(n+1,n+3,.0008);
    addDistance(n,n+3,.00052);addDistance(n+1,n+2,.00052);
  }
  for(let station=0;station<stations.length-1;station++){
    const a=station*4,b=(station+1)*4;
    for(let corner=0;corner<4;corner++)addDistance(a+corner,b+corner,corner<2?.00135:.00072);
    addDistance(a,b+1,.00062);addDistance(a+1,b,.00062);
    addDistance(a+2,b+3,.00045);addDistance(a+3,b+2,.00045);
    addDistance(a,b+2,.00048);addDistance(a+1,b+3,.00048);
    collisionTriangles.push(
      [a,a+1,b+1],[a,b+1,b],
      [a,a+2,b+2],[a,b+2,b],
      [a+2,a+3,b+3],[a+2,b+3,b+2],
      [a+1,b+1,b+3],[a+1,b+3,a+3],
    );
    const tets:[number,number,number,number][]=[
      [a,a+1,a+2,b],[a+1,a+2,a+3,b+3],[a+1,a+2,b,b+3],[a+1,b,b+1,b+3],[a+2,b,b+2,b+3],
    ];
    for(const [i,j,k,l] of tets)constraints.push({kind:'volume',a:i,b:j,c:k,d:l,compliance:2.5e-10,yieldRatio:.10,breakRatio:.55,plasticity:.22});
  }
  collisionTriangles.push([0,3,1],[0,2,3]);
  const front=(stations.length-1)*4;collisionTriangles.push([front,front+1,front+3],[front,front+3,front+2]);
  return{nodes,constraints,collisionTriangles,iterations:10,sleepSpeed:.025,sleepDelay:.18,internalDamping:11};
}
