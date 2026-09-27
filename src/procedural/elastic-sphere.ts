import type {Vec3} from '../math.js';
import {V3} from '../math.js';
import {material} from '../materials/catalog.js';
import type {StructuralConstraintSpec,StructuralDefinition} from '../physics/structure.js';

/** Closed octasphere + compliant tetrahedra. This is an elastic volume model,
 * not a gas-pressure law. Same topology supplies contacts and visible deformation. */
export function elasticSphere(radius=1.45,mass=30,subdivisions=2):{definition:StructuralDefinition;indices:number[];surfaceNodes:number}{
 if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(mass)||mass<=0||!Number.isInteger(subdivisions)||subdivisions<0||subdivisions>3)throw new RangeError('Invalid elastic sphere');
 const points:Vec3[]=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];let faces:[number,number,number][]=[];
 for(const x of [0,1])for(const y of [2,3])for(const z of [4,5]){
  const a=points[x]!,b=points[y]!,c=points[z]!;
  faces.push(V3.dot(V3.cross(V3.sub(b,a),V3.sub(c,a)),a)>0?[x,y,z]:[x,z,y]);
 }
 for(let level=0;level<subdivisions;level++){
  const edges=new Map<string,number>(),next:typeof faces=[];
  const midpoint=(a:number,b:number)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;let id=edges.get(key);if(id===undefined){id=points.length;points.push(V3.normalize(V3.add(points[a]!,points[b]!)));edges.set(key,id);}return id;};
  for(const [a,b,c] of faces){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);next.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);}faces=next;
 }
 const surfaceNodes=points.length;points.push([0,0,0]);const constraints:StructuralConstraintSpec[]=[],seen=new Set<string>();
 const rubber={...material('rubber').mechanical,plasticity:0,failureStrain:50};
 for(const [a,b,c] of faces){
  for(const [x,y] of [[a,b],[b,c],[c,a]]){const key=x!<y!?`${x}:${y}`:`${y}:${x}`;if(!seen.has(key)){seen.add(key);constraints.push({kind:'distance',a:x!,b:y!,areaM2:.0003*radius,material:rubber});}}
  constraints.push({kind:'volume',a,b,c,d:surfaceNodes,compliance:.000002,yieldRatio:20,breakRatio:50,plasticity:0});
 }
 return {definition:{nodes:points.map((v,i)=>({position:V3.scale(v,radius),mass:i===surfaceNodes?mass*.04:mass*.96/surfaceNodes})),constraints,collisionTriangles:faces,iterations:8,internalDamping:2},indices:faces.flat(),surfaceNodes};
}
