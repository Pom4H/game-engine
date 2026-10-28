import type {SolidBody,SolidShape} from './compound.js';
import {trianglePrism,prismFeatureNormalAllowed,type TrianglePrism,type TrianglePrismAdjacency} from './triangle-prism.js';
type V=readonly number[];
type Vec=[number,number,number];
export type PrismMotionFeature={readonly normal:Vec;readonly halfWidth:number;readonly vertices:readonly Vec[]};
type Cause={shape:SolidShape;coordinates:number[];thickness:number;nodes:number[]|undefined};
type Cached={causes:Cause[];features:readonly PrismMotionFeature[]};
type Face={prism:TrianglePrism;adjacency?:TrianglePrismAdjacency;neighbors:number[][]};
const cache=new WeakMap<SolidBody,Cached>(),EPS=128*Number.EPSILON;
const dot=(a:V,b:V)=>a[0]!*b[0]!+a[1]!*b[1]!+a[2]!*b[2]!,sub=(a:V,b:V):Vec=>[a[0]!-b[0]!,a[1]!-b[1]!,a[2]!-b[2]!],cross=(a:V,b:V):Vec=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!],scale=(a:V,s:number):Vec=>[a[0]!*s,a[1]!*s,a[2]!*s];
function geometryScale(prism:TrianglePrism){return Math.max(Number.MIN_VALUE,...prism.bounds.map(Math.abs));}
function coplanar(a:TrianglePrism,b:TrianglePrism){const n=a.normals[0]!,m=b.normals[0]!;if(1-Math.abs(dot(n,m))>EPS)return false;const tolerance=EPS*Math.max(geometryScale(a),geometryScale(b));return b.triangle.every(p=>Math.abs(dot(sub(p,a.triangle[0]),n))<=tolerance);}
function same(old:Cached,shapes:readonly SolidShape[]){if(old.causes.length!==shapes.length)return false;for(let i=0;i<shapes.length;i++){const shape=shapes[i]!,cause=old.causes[i]!,nodes=shape.geometryNodes??shape.structureNodes;if(cause.shape!==shape||cause.thickness!==(shape.thickness??.0008)||!!nodes!==!!cause.nodes||!!shape.triangle!==(cause.coordinates.length===9))return false;if(nodes)for(let j=0;j<3;j++)if(nodes[j]!==cause.nodes![j])return false;if(shape.triangle)for(let j=0;j<9;j++)if(shape.triangle[Math.floor(j/3)]![j%3]!==cause.coordinates[j])return false;}return true;}
/** Intersect one in-plane ray with a triangle's three physical edge planes. */
function rayInterval(origin:V,direction:V,prism:TrianglePrism,tolerance:number):[number,number]|undefined{
 let lo=0,hi=Infinity;
 for(let edge=0;edge<3;edge++){const n=prism.normals[edge+1]!,gap=-dot(sub(origin,prism.triangle[edge]!),n),speed=dot(direction,n);if(Math.abs(speed)<=EPS){if(gap< -tolerance)return;continue;}const time=gap/speed;if(speed>0)hi=Math.min(hi,time);else lo=Math.max(lo,time);if(lo>hi+tolerance)return;}
 if(hi< -tolerance)return;return[Math.max(0,lo),Math.max(0,hi)];
}
/** Width until the first actual exit from material. A hole is an exit; an
 * internal triangulation edge is not. No filled component hull is substituted. */
function materialWidth(origin:V,direction:V,faces:readonly Face[],component:readonly number[],tolerance:number){
 const intervals:Array<[number,number]>=[];for(const index of component){const interval=rayInterval(origin,direction,faces[index]!.prism,tolerance);if(interval)intervals.push(interval);}intervals.sort((a,b)=>a[0]-b[0]);let end=0;for(const [lo,hi]of intervals){if(lo>end+tolerance)break;end=Math.max(end,hi);}return Number.isFinite(end)?end:0;
}
type Boundary={normal:Vec;tangent:Vec;origin:Vec;offset:number;intervals:Array<[number,number]>;halfThickness:number};
function build(shapes:readonly SolidShape[]):readonly PrismMotionFeature[]{
 const faces:Face[]=[],indices:number[]=[],edgeMap=new Map<string,Array<{face:number;edge:number}>>(),vertexMap=new Map<number,number[]>();
 for(let source=0;source<shapes.length;source++){const shape=shapes[source]!,prism=trianglePrism(shape.triangle!,shape.thickness??.0008);if(!prism)continue;const index=faces.length;faces.push({prism,neighbors:[[],[],[]]});indices.push(source);const nodes=shape.geometryNodes??shape.structureNodes;if(nodes)for(let edge=0;edge<3;edge++){const a=nodes[edge]!,b=nodes[(edge+1)%3]!,key=Math.min(a,b)+':'+Math.max(a,b),edges=edgeMap.get(key)??[],vertices=vertexMap.get(a)??[];edges.push({face:index,edge});edgeMap.set(key,edges);vertices.push(index);vertexMap.set(a,vertices);}}
 for(const list of edgeMap.values())for(const a of list)faces[a.face]!.neighbors[a.edge]=list.filter(b=>b.face!==a.face).map(b=>b.face);
 for(let i=0;i<faces.length;i++){const nodes=shapes[indices[i]!]!.geometryNodes??shapes[indices[i]!]!.structureNodes;if(nodes)faces[i]!.adjacency={edges:faces[i]!.neighbors.map(list=>list.map(index=>faces[index]!.prism)),vertices:nodes.map(node=>(vertexMap.get(node)??[]).filter(index=>index!==i).map(index=>faces[index]!.prism))};}
 const features:PrismMotionFeature[]=[],visited=new Set<number>();
 for(let seed=0;seed<faces.length;seed++){
  if(visited.has(seed))continue;const component=[seed];visited.add(seed);for(let at=0;at<component.length;at++)for(const neighbor of faces[component[at]!]!.neighbors.flat())if(!visited.has(neighbor)&&coplanar(faces[seed]!.prism,faces[neighbor]!.prism)){visited.add(neighbor);component.push(neighbor);}
  const normal=faces[seed]!.prism.normals[0]!,allVertices=component.flatMap(i=>faces[i]!.prism.vertices),halfThickness=Math.min(...component.map(i=>faces[i]!.prism.halfThickness)),magnitude=Math.max(...component.map(i=>geometryScale(faces[i]!.prism))),tolerance=EPS*magnitude,boundaries:Boundary[]=[];
  features.push({normal,halfWidth:halfThickness,vertices:allVertices});
  for(const index of component){const face=faces[index]!,prism=face.prism;for(let edge=0;edge<3;edge++){
   const side=prism.normals[edge+1]!;if(!prismFeatureNormalAllowed({p:prism.center,axes:[],half:[],triangle:prism,...(face.adjacency?{triangleAdjacency:face.adjacency}:{})},side))continue;
   const a=prism.triangle[edge]!,b=prism.triangle[(edge+1)%3]!,tangent=cross(normal,side),length=Math.hypot(...tangent);if(!(length>0))continue;for(let k=0;k<3;k++)tangent[k]!/=length;const offset=dot(a,side);
   // Maximal straight exposed segments, rather than arbitrary triangle edges,
   // make the same boundary independent of subdivisions along that boundary.
   let boundary=boundaries.find(other=>1-dot(other.normal,side)<=EPS&&Math.abs(other.offset-offset)<=tolerance);if(!boundary){boundary={normal:[...side],tangent,origin:[...a],offset,intervals:[],halfThickness:0};boundaries.push(boundary);}const A=dot(sub(a,boundary.origin),boundary.tangent),B=dot(sub(b,boundary.origin),boundary.tangent);boundary.intervals.push([Math.min(A,B),Math.max(A,B)]);boundary.halfThickness=Math.max(boundary.halfThickness,prism.halfThickness);
  }}
  for(const boundary of boundaries){boundary.intervals.sort((a,b)=>a[0]-b[0]);const merged:Array<[number,number]>=[];for(const interval of boundary.intervals){const old=merged.at(-1);if(old&&interval[0]<=old[1]+tolerance)old[1]=Math.max(old[1],interval[1]);else merged.push([...interval]);}
   for(const [lo,hi]of merged){const midpoint=boundary.origin.map((n,k)=>n+boundary.tangent[k]!*(lo+hi)/2) as Vec,width=materialWidth(midpoint,scale(boundary.normal,-1),faces,component,tolerance),vertices:Vec[]=[];for(const t of [lo,hi])for(const sign of [-1,1])vertices.push(boundary.origin.map((n,k)=>n+boundary.tangent[k]!*t+normal[k]!*boundary.halfThickness*sign) as Vec);features.push({normal:boundary.normal,halfWidth:width/2,vertices});}
  }
 }
 return features;
}
/** Exact local-geometry cache. A rigid pose never re-walks the material mesh;
 * changed node coordinates, thickness, crack ownership or topology do. */
export function triangleAdaptiveFeatures(body:SolidBody):readonly PrismMotionFeature[]{
 const shapes=body.shapes;let stored=cache.get(body);if(stored&&same(stored,shapes))return stored.features;
 stored={causes:shapes.map(shape=>({shape,coordinates:shape.triangle?.flatMap(p=>[...p])??[],thickness:shape.thickness??.0008,nodes:(shape.geometryNodes??shape.structureNodes)?[...(shape.geometryNodes??shape.structureNodes)!]:undefined})),features:build(shapes.filter(shape=>shape.triangle!==undefined))};cache.set(body,stored);return stored.features;
}
/** Actual feature sweep under finite rigid rotation. Rodrigues' displacement
 * is affine in each material vertex, so its maximum is bounded at vertices. */
export function triangleAdaptiveMotion(body:SolidBody,dt:number):number{
 const features=triangleAdaptiveFeatures(body);if(!features.length)return 0;const speed=Math.hypot(...body.w),theta=speed*dt,rotation=speed>0?scale(body.w,1/speed):undefined,sine=theta>=Math.PI/2?1:Math.sin(theta),cosine=theta>=Math.PI?2:1-Math.cos(theta),axes=body.axes();let motion=0;
 const world=(p:V):Vec=>[axes[0][0]*p[0]!+axes[1][0]*p[1]!+axes[2][0]*p[2]!,axes[0][1]*p[0]!+axes[1][1]*p[1]!+axes[2][1]*p[2]!,axes[0][2]*p[0]!+axes[1][2]*p[1]!+axes[2][2]*p[2]!];
 for(const feature of features){const n=world(feature.normal);let angular=0;if(rotation)for(const point of feature.vertices){const r=world(point),tangent=cross(rotation,r),curved=sub(scale(rotation,dot(rotation,r)),r);angular=Math.max(angular,sine*Math.abs(dot(tangent,n))+cosine*Math.abs(dot(curved,n)));}const size=Math.max(.025,Math.min(.14,feature.halfWidth*.8));motion=Math.max(motion,(Math.abs(dot(body.v,n))*dt+angular)/size);}
 return motion;
}
