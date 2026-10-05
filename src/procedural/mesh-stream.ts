import type {Primitive} from '../scene/types.js';

export type TrianglePrimitive=Extract<Primitive,{kind:'triangle-mesh'}>;
/** Lookup only: each stream is owned by its scene system, never by this weak
 * index. Static primitives keep the existing immutable/render fast path. */
const streams=new WeakMap<Primitive,MeshStream>();
let nextIdentity=0;
export function meshStream(primitive:Primitive):MeshStream|undefined{return streams.get(primitive);}

/** Fixed-topology runtime geometry. Publish validates a complete staging frame
 * before changing any visible state. Authored inputs/topology are copied; one
 * position array and one GPU-layout buffer survive for the lifetime of a rig.
 * Runtime only: attach primitive as renderMesh AFTER scene instantiation.
 * Serializers read primitive's current arrays, not a process-local cache key. */
export class MeshStream {
  readonly primitive:TrianglePrimitive;
  readonly key='runtime-mesh:'+(++nextIdentity);
  readonly vertices:Float32Array;
  private readonly positions:number[];
  private readonly normals:number[];
  private generation=0;
  private alive=true;
  get revision():number{return this.generation;}
  constructor(source:TrianglePrimitive){
    const p=[...source.positions],n=[...source.normals],i=[...source.indices];
    if(!p.length||p.length%3||n.length!==p.length||i.length%3||i.some(v=>!Number.isInteger(v)||v<0||v>=p.length/3))throw new RangeError('Invalid stream topology');
    if([...p,...n].some(v=>!Number.isFinite(v)))throw new RangeError('Nonfinite stream geometry');
    const colors=source.colors?[...source.colors]:undefined;
    if(colors&&(colors.length!==p.length/3*4||colors.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new RangeError('Invalid stream colour');
    this.positions=p;this.normals=n;this.vertices=new Float32Array(p.length*2);
    this.primitive=Object.freeze({kind:'triangle-mesh',positions:p,normals:n,indices:Object.freeze(i),...(colors?{colors:Object.freeze(colors)}:{})});
    this.pack();streams.set(this.primitive,this);
  }
  private pack():void{for(let i=0;i<this.positions.length/3;i++)for(let c=0;c<3;c++){this.vertices[i*6+c]=this.positions[i*3+c]!;this.vertices[i*6+c+3]=this.normals[i*3+c]!;}}
  publish(positions:ArrayLike<number>,normals:ArrayLike<number>):void{
    if(!this.alive)throw new Error('Mesh stream is disposed');
    if(positions.length!==this.positions.length||normals.length!==this.normals.length)throw new RangeError('Stream topology cannot change');
    let changed=false;
    for(let i=0;i<positions.length;i++){
      if(!Number.isFinite(positions[i])||!Number.isFinite(normals[i])||Math.abs(positions[i]!)>1e8||Math.abs(normals[i]!)>2)throw new RangeError('Invalid stream frame');
      changed ||= positions[i]!==this.positions[i]||normals[i]!==this.normals[i];
    }
    if(!changed)return;
    for(let i=0;i<positions.length;i++){this.positions[i]=positions[i]!;this.normals[i]=normals[i]!;}
    this.pack();this.generation++;
  }
  inspect(){return{revision:this.revision,vertices:this.positions.length/3,triangles:this.primitive.indices.length/3,packedBytes:this.vertices.byteLength,topology:'fixed' as const,disposed:!this.alive};}
  dispose():void{streams.delete(this.primitive);this.alive=false;}
}
