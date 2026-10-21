import type {Vec3} from '../math.js';
import {V3} from '../math.js';
import {StructuralBody} from './structure.js';

export interface StructuralStaticBox {
  readonly id?:string;
  readonly center:Vec3;
  readonly half:Vec3;
}

export interface StructuralContactStats {
  readonly contacts:number;
  readonly maxPenetration:number;
  readonly projectedSamples:number;
  readonly deepestBoxId?:string;
  readonly deepestPoint?:Vec3;
}

type Binding={nodes:readonly number[];weights:readonly number[]};

/**
 * Coarse structural collision projection against static axis-aligned boxes.
 *
 * Samples are the actual cage nodes plus triangle centroids bound to the same
 * mass nodes. Contact corrections therefore deform the structure itself; there
 * is no shrinking rigid collision box and no second collision mesh with its own
 * mass. The class is allocation-free after construction.
 */
export class StructuralStaticContactSolver {
  private readonly samples:readonly Binding[];
  private contactsValue=0;
  private maxPenetrationValue=0;
  private projectedValue=0;
  private deepestBoxIdValue:string|undefined;
  private deepestPointValue:Vec3|undefined;

  constructor(readonly boxes:readonly StructuralStaticBox[],collisionTriangles:readonly (readonly [number,number,number])[]=[]){
    for(const box of boxes){
      if(!box.center.every(Number.isFinite)||!box.half.every(value=>Number.isFinite(value)&&value>0))throw new TypeError('Structural static box must be finite with positive half extents');
    }
    const samples:Binding[]=[];
    const nodeIds=new Set<number>();
    for(const triangle of collisionTriangles){
      if(new Set(triangle).size!==3||triangle.some(index=>!Number.isInteger(index)||index<0))throw new RangeError('Invalid structural collision triangle');
      for(const node of triangle)nodeIds.add(node);
      samples.push({nodes:[triangle[0],triangle[1],triangle[2]],weights:[1/3,1/3,1/3]});
    }
    for(const node of [...nodeIds].sort((a,b)=>a-b))samples.push({nodes:[node],weights:[1]});
    this.samples=Object.freeze(samples);
  }

  resetStats():void{this.contactsValue=0;this.maxPenetrationValue=0;this.projectedValue=0;this.deepestBoxIdValue=undefined;this.deepestPointValue=undefined;}

  project(body:StructuralBody):void{
    if(!this.samples.length)return;
    for(const binding of this.samples){
      if(binding.nodes.some(node=>node>=body.nodeCount))throw new RangeError('Structural collision binding exceeds node count');
      const point=this.point(body.position,binding),previous=this.point(body.previous,binding);
      for(const box of this.boxes){
        const hit=insideBox(point,previous,box);if(!hit)continue;
        const effective=this.effectiveInverseMass(body,binding);if(effective<=1e-14)continue;
        const lambda=hit.penetration/effective;
        for(let i=0;i<binding.nodes.length;i++){
          const node=binding.nodes[i]!,weight=binding.weights[i]!,j=node*3,scale=body.inverseMass[node]!*weight*lambda;
          body.position[j]=body.position[j]!+hit.normal[0]*scale;
          body.position[j+1]=body.position[j+1]!+hit.normal[1]*scale;
          body.position[j+2]=body.position[j+2]!+hit.normal[2]*scale;
        }
        this.contactsValue++;this.projectedValue++;
        if(hit.penetration>this.maxPenetrationValue){
          this.maxPenetrationValue=hit.penetration;
          this.deepestBoxIdValue=box.id;
          this.deepestPointValue=[...point];
        }
      }
    }
  }

  get stats():StructuralContactStats{return{
    contacts:this.contactsValue,
    maxPenetration:this.maxPenetrationValue,
    projectedSamples:this.projectedValue,
    ...(this.deepestBoxIdValue?{deepestBoxId:this.deepestBoxIdValue}:{}),
    ...(this.deepestPointValue?{deepestPoint:this.deepestPointValue}:{}),
  };}

  private point(buffer:Float64Array,binding:Binding):Vec3{
    let x=0,y=0,z=0;
    for(let i=0;i<binding.nodes.length;i++){
      const node=binding.nodes[i]!,weight=binding.weights[i]!,j=node*3;
      x+=buffer[j]!*weight;y+=buffer[j+1]!*weight;z+=buffer[j+2]!*weight;
    }
    return[x,y,z];
  }

  private effectiveInverseMass(body:StructuralBody,binding:Binding):number{
    let value=0;
    for(let i=0;i<binding.nodes.length;i++)value+=binding.weights[i]!**2*body.inverseMass[binding.nodes[i]!]!;
    return value;
  }
}

function insideBox(point:Vec3,previous:Vec3,box:StructuralStaticBox):{normal:Vec3;penetration:number}|undefined{
  const local:Vec3=[point[0]-box.center[0],point[1]-box.center[1],point[2]-box.center[2]];
  if(Math.abs(local[0])>box.half[0]||Math.abs(local[1])>box.half[1]||Math.abs(local[2])>box.half[2])return;

  // Prefer the actual crossed face from the prior predicted position. This keeps
  // a fast node from being projected through the far side of a thin wall.
  let crossedAxis:-1|0|1|2=-1,crossedSign=0;
  for(const axis of [0,1,2] as const){
    const prev=previous[axis]-box.center[axis],half=box.half[axis];
    if(prev>half&&point[axis]-box.center[axis]<=half){crossedAxis=axis;crossedSign=1;break;}
    if(prev<-half&&point[axis]-box.center[axis]>=-half){crossedAxis=axis;crossedSign=-1;break;}
  }
  let axis:0|1|2,sign:number;
  if(crossedAxis>=0){axis=crossedAxis as 0|1|2;sign=crossedSign;}
  else{
    const gaps:[number,number,number]=[
      box.half[0]-Math.abs(local[0]),
      box.half[1]-Math.abs(local[1]),
      box.half[2]-Math.abs(local[2]),
    ];
    axis=gaps[0]<=gaps[1]&&gaps[0]<=gaps[2]?0:gaps[1]<=gaps[2]?1:2;
    sign=local[axis]>=0?1:-1;
  }
  const face=box.center[axis]+sign*box.half[axis],penetration=Math.abs(face-point[axis]);
  const normal:[number,number,number]=[0,0,0];normal[axis]=sign;
  return{normal,penetration:Math.max(0,penetration)};
}
