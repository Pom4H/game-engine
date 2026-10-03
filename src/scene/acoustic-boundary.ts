import type {Vec3} from '../math.js';
import {primitiveMesh} from '../procedural/mesh.js';
import type {RuntimeEntity} from './scene.js';
import {AcousticWaveField} from '../physics/wave-field.js';

export interface SceneAcousticBoundaryStats {
  readonly entities:number;
  readonly bodyObstacles:number;
  readonly meshObstacles:number;
  readonly triangles:number;
  readonly solidCells:number;
}

interface Bounds {readonly min:Vec3;readonly max:Vec3}
const CELL_EPSILON=1e-9;

/**
 * Rebuild hard acoustic boundaries from authoritative scene geometry.
 *
 * Ownership rule:
 * - a RuntimeEntity with a RigidBody uses its current collision shape;
 * - a body-less RuntimeEntity uses mesh;
 * - renderMesh is presentation-only and is intentionally ignored;
 * - micro-debris is ignored at this coarse acoustic tier.
 *
 * Call after geometry/pose changes and before the next acoustic step. Rebuilding
 * changes only boundary occupancy; pressure and medium velocity remain wave state.
 */
export function syncSceneAcousticBoundaries(
  field:AcousticWaveField,
  entities:Iterable<RuntimeEntity>,
):SceneAcousticBoundaryStats{
  field.clearSolidCells();
  let entityCount=0,bodyObstacles=0,meshObstacles=0,triangles=0;
  for(const entity of entities){
    entityCount++;
    if(entity.body){
      if(entity.body.collisionClass==='debris')continue;
      const body=entity.body;
      if(body.shape.kind==='sphere'){
        rasterSphere(field,body.position,body.shape.radius);
      }else{
        const half=body.collisionHalf??body.shape.half;
        const offset=rotate(body.rotation,body.collisionOffsetLocal);
        rasterBox(field,[
          body.position[0]+offset[0],
          body.position[1]+offset[1],
          body.position[2]+offset[2],
        ],body.rotation,half);
      }
      bodyObstacles++;
      continue;
    }
    if(!entity.mesh)continue;
    triangles+=rasterPrimitiveShell(field,entity);
    meshObstacles++;
  }
  return Object.freeze({
    entities:entityCount,
    bodyObstacles,
    meshObstacles,
    triangles,
    solidCells:field.solidCellCount,
  });
}

function rasterSphere(field:AcousticWaveField,center:Vec3,radius:number):void{
  const bounds:Bounds={
    min:[center[0]-radius,center[1]-radius,center[2]-radius],
    max:[center[0]+radius,center[1]+radius,center[2]+radius],
  };
  forCells(field,bounds,(x,y,z,cellMin,cellMax)=>{
    const px=clamp(center[0],cellMin[0],cellMax[0]);
    const py=clamp(center[1],cellMin[1],cellMax[1]);
    const pz=clamp(center[2],cellMin[2],cellMax[2]);
    const dx=px-center[0],dy=py-center[1],dz=pz-center[2];
    if(dx*dx+dy*dy+dz*dz<=radius*radius+CELL_EPSILON)field.setSolidCell(x,y,z);
  });
}

function rasterBox(field:AcousticWaveField,center:Vec3,rotation:Vec3,half:Vec3):void{
  const basis=rotationBasis(rotation);
  const worldHalf:Vec3=[
    Math.abs(basis[0][0])*half[0]+Math.abs(basis[1][0])*half[1]+Math.abs(basis[2][0])*half[2],
    Math.abs(basis[0][1])*half[0]+Math.abs(basis[1][1])*half[1]+Math.abs(basis[2][1])*half[2],
    Math.abs(basis[0][2])*half[0]+Math.abs(basis[1][2])*half[1]+Math.abs(basis[2][2])*half[2],
  ];
  const bounds:Bounds={
    min:[center[0]-worldHalf[0],center[1]-worldHalf[1],center[2]-worldHalf[2]],
    max:[center[0]+worldHalf[0],center[1]+worldHalf[1],center[2]+worldHalf[2]],
  };
  const cellHalf=field.cellSizeM*.5;
  forCells(field,bounds,(x,y,z,cellMin,cellMax)=>{
    const cellCenter:Vec3=[
      (cellMin[0]+cellMax[0])*.5,
      (cellMin[1]+cellMax[1])*.5,
      (cellMin[2]+cellMax[2])*.5,
    ];
    const delta:Vec3=[cellCenter[0]-center[0],cellCenter[1]-center[1],cellCenter[2]-center[2]];
    for(let axis=0;axis<3;axis++){
      const local=Math.abs(dot(delta,basis[axis]!));
      const projectedCellHalf=cellHalf*(Math.abs(basis[axis]![0])+Math.abs(basis[axis]![1])+Math.abs(basis[axis]![2]));
      if(local>half[axis]!+projectedCellHalf+CELL_EPSILON)return;
    }
    field.setSolidCell(x,y,z);
  });
}

function rasterPrimitiveShell(field:AcousticWaveField,entity:RuntimeEntity):number{
  const mesh=primitiveMesh(entity.mesh!);
  const intrinsic=primitiveIntrinsicScale(entity.mesh!);
  const scale:Vec3=[
    entity.scale[0]*intrinsic[0],
    entity.scale[1]*intrinsic[1],
    entity.scale[2]*intrinsic[2],
  ];
  const vertices=mesh.vertices,indices=mesh.indices;
  let triangles=0;
  for(let i=0;i+2<indices.length;i+=3){
    const a=worldVertex(vertices,indices[i]!,entity.position,entity.rotation,scale);
    const b=worldVertex(vertices,indices[i+1]!,entity.position,entity.rotation,scale);
    const c=worldVertex(vertices,indices[i+2]!,entity.position,entity.rotation,scale);
    rasterTriangle(field,a,b,c);triangles++;
  }
  return triangles;
}

function rasterTriangle(field:AcousticWaveField,a:Vec3,b:Vec3,c:Vec3):void{
  const bounds:Bounds={
    min:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.min(a[2],b[2],c[2])],
    max:[Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1]),Math.max(a[2],b[2],c[2])],
  };
  forCells(field,bounds,(x,y,z,cellMin,cellMax)=>{
    const center:Vec3=[
      (cellMin[0]+cellMax[0])*.5,
      (cellMin[1]+cellMax[1])*.5,
      (cellMin[2]+cellMax[2])*.5,
    ];
    const half:Vec3=[
      (cellMax[0]-cellMin[0])*.5,
      (cellMax[1]-cellMin[1])*.5,
      (cellMax[2]-cellMin[2])*.5,
    ];
    if(triangleIntersectsAabb(a,b,c,center,half))field.setSolidCell(x,y,z);
  });
}

function triangleIntersectsAabb(a:Vec3,b:Vec3,c:Vec3,center:Vec3,half:Vec3):boolean{
  const A=sub(a,center),B=sub(b,center),C=sub(c,center);
  const e0=sub(B,A),e1=sub(C,B),e2=sub(A,C);
  const axes:Vec3[]=[
    [1,0,0],[0,1,0],[0,0,1],
    cross(e0,e1),
    cross(e0,[1,0,0]),cross(e0,[0,1,0]),cross(e0,[0,0,1]),
    cross(e1,[1,0,0]),cross(e1,[0,1,0]),cross(e1,[0,0,1]),
    cross(e2,[1,0,0]),cross(e2,[0,1,0]),cross(e2,[0,0,1]),
  ];
  for(const axis of axes){
    const length2=dot(axis,axis);if(length2<1e-20)continue;
    const pa=dot(A,axis),pb=dot(B,axis),pc=dot(C,axis);
    const radius=half[0]*Math.abs(axis[0])+half[1]*Math.abs(axis[1])+half[2]*Math.abs(axis[2]);
    if(Math.min(pa,pb,pc)>radius+CELL_EPSILON||Math.max(pa,pb,pc)<-radius-CELL_EPSILON)return false;
  }
  return true;
}

function forCells(
  field:AcousticWaveField,
  bounds:Bounds,
  visit:(x:number,y:number,z:number,min:Vec3,max:Vec3)=>void,
):void{
  const h=field.cellSizeM,o=field.origin,[nx,ny,nz]=field.size;
  const minX=Math.max(0,Math.floor((bounds.min[0]-o[0])/h));
  const maxX=Math.min(nx-1,Math.floor((bounds.max[0]-o[0])/h));
  const minY=Math.max(0,Math.floor((bounds.min[1]-o[1])/h));
  const maxY=Math.min(ny-1,Math.floor((bounds.max[1]-o[1])/h));
  const minZ=Math.max(0,Math.floor((bounds.min[2]-o[2])/h));
  const maxZ=Math.min(nz-1,Math.floor((bounds.max[2]-o[2])/h));
  if(minX>maxX||minY>maxY||minZ>maxZ)return;
  for(let z=minZ;z<=maxZ;z++)for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const min:Vec3=[o[0]+x*h,o[1]+y*h,o[2]+z*h];
    const max:Vec3=[min[0]+h,min[1]+h,min[2]+h];
    visit(x,y,z,min,max);
  }
}

function primitiveIntrinsicScale(primitive:RuntimeEntity['mesh']):Vec3{
  if(!primitive)return[1,1,1];
  if(primitive.kind==='box')return primitive.size??[1,1,1];
  if(primitive.kind==='sphere'){const d=(primitive.radius??.5)*2;return[d,d,d];}
  if(primitive.kind==='plane')return[primitive.size?.[0]??1,1,primitive.size?.[1]??1];
  if(primitive.kind==='shard')return primitive.size;
  return[1,1,1];
}

function worldVertex(vertices:Float32Array,index:number,position:Vec3,rotation:Vec3,scale:Vec3):Vec3{
  const i=index*6;
  const local:Vec3=[vertices[i]!*scale[0],vertices[i+1]!*scale[1],vertices[i+2]!*scale[2]];
  const rotated=rotate(rotation,local);
  return[position[0]+rotated[0],position[1]+rotated[1],position[2]+rotated[2]];
}

function rotationBasis(rotation:Vec3):readonly[Vec3,Vec3,Vec3]{
  const [rx,ry,rz]=rotation,sx=Math.sin(rx),cx=Math.cos(rx),sy=Math.sin(ry),cy=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
  return[
    [cy*cz,sx*sy*cz+cx*sz,-cx*sy*cz+sx*sz],
    [-cy*sz,-sx*sy*sz+cx*cz,cx*sy*sz+sx*cz],
    [sy,-sx*cy,cx*cy],
  ];
}
function rotate(rotation:Vec3,v:Vec3):Vec3{
  const b=rotationBasis(rotation);
  return[
    b[0][0]*v[0]+b[1][0]*v[1]+b[2][0]*v[2],
    b[0][1]*v[0]+b[1][1]*v[1]+b[2][1]*v[2],
    b[0][2]*v[0]+b[1][2]*v[1]+b[2][2]*v[2],
  ];
}
function sub(a:Vec3,b:Vec3):Vec3{return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function dot(a:Vec3,b:Vec3):number{return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a:Vec3,b:Vec3):Vec3{return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function clamp(value:number,min:number,max:number):number{return Math.max(min,Math.min(max,value));}
