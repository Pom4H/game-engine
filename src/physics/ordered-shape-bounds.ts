import type {BoxBounds} from './box-overlap.js';

type BoundedShape={bounds?:BoxBounds};
/** Read data descriptors without invoking custom geometry accessors. Such
 * geometry retains exhaustive narrow-phase enumeration instead. */
function passiveBounds(shape:BoundedShape):BoxBounds|undefined{
 if(!shape||typeof shape!=='object')return;
 const descriptor=Object.getOwnPropertyDescriptor(shape,'bounds');if(!descriptor||!('value'in descriptor)||!descriptor.value)return;
 const bounds=descriptor.value as BoxBounds;for(let i=0;i<6;i++){const value=Object.getOwnPropertyDescriptor(bounds,i);if(!value||!('value'in value)||!Number.isFinite(value.value))return;}
 return bounds[0]<=bounds[3]&&bounds[1]<=bounds[4]&&bounds[2]<=bounds[5]?bounds:undefined;
}

/** An index of ONE completed boxes() snapshot, never a body/shape-identity
 * cache. Contiguous source ranges keep candidates in original triangle order.
 * Recreate after prediction/correction; the existing narrow phase is unchanged. */
export class OrderedShapeBoundsIndex{
 readonly length:number;
 private readonly bounds:Float64Array;
 private readonly begin:Int32Array;
 private readonly end:Int32Array;
 private readonly left:Int32Array;
 private readonly right:Int32Array;
 private readonly leaves:Float64Array;
 private valid=true;
 private used=0;
 constructor(shapes:readonly BoundedShape[]){
  this.length=shapes.length;const capacity=Math.max(1,shapes.length*2);this.bounds=new Float64Array(capacity*6);this.begin=new Int32Array(capacity);this.end=new Int32Array(capacity);this.left=new Int32Array(capacity);this.right=new Int32Array(capacity);this.left.fill(-1);this.right.fill(-1);this.leaves=new Float64Array(shapes.length*6);
  for(let i=0;i<shapes.length;i++){const entry=Object.getOwnPropertyDescriptor(shapes,i),box=entry&&'value'in entry?passiveBounds(entry.value):undefined;if(!box){this.valid=false;return;}for(let k=0;k<6;k++)this.leaves[i*6+k]=box[k]!;}
  if(shapes.length)this.build(0,shapes.length);
 }
 private build(lo:number,hi:number):number{
  const node=this.used++,at=node*6;this.begin[node]=lo;this.end[node]=hi;
  if(hi-lo>4){const mid=(lo+hi)>>>1,a=this.build(lo,mid),b=this.build(mid,hi);this.left[node]=a;this.right[node]=b;for(let k=0;k<3;k++){this.bounds[at+k]=Math.min(this.bounds[a*6+k]!,this.bounds[b*6+k]!);this.bounds[at+k+3]=Math.max(this.bounds[a*6+k+3]!,this.bounds[b*6+k+3]!);}}
  else{for(let k=0;k<3;k++){let min=Infinity,max=-Infinity;for(let i=lo;i<hi;i++){min=Math.min(min,this.leaves[i*6+k]!);max=Math.max(max,this.leaves[i*6+k+3]!);}this.bounds[at+k]=min;this.bounds[at+k+3]=max;}}
  return node;
 }
 /** Caller-owned results make nested queries independent. Nonfinite/custom
  * geometry falls back conservatively, including the original getter reads. */
 candidates(query:BoundedShape,margin:number,out:number[]):number[]{
  out.length=0;const q=this.valid?passiveBounds(query):undefined;
  if(!q||!Number.isFinite(margin)){for(let i=0;i<this.length;i++)out.push(i);return out;}
  if(this.length)this.visit(0,q,Math.max(0,margin)*2,out);return out;
 }
 private overlaps(values:Float64Array,at:number,q:BoxBounds,padding:number){return q[0]<=values[at+3]!+padding&&values[at]!<=q[3]+padding&&q[1]<=values[at+4]!+padding&&values[at+1]!<=q[4]+padding&&q[2]<=values[at+5]!+padding&&values[at+2]!<=q[5]+padding;}
 private visit(node:number,q:BoxBounds,padding:number,out:number[]){
  if(!this.overlaps(this.bounds,node*6,q,padding))return;const a=this.left[node]!;if(a>=0){this.visit(a,q,padding,out);this.visit(this.right[node]!,q,padding,out);return;}
  for(let i=this.begin[node]!;i<this.end[node]!;i++)if(this.overlaps(this.leaves,i*6,q,padding))out.push(i);
 }
}
