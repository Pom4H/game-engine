import type {Vec3} from '../math.js';
import {projection,buffer,identity,safeInteger,type Stamp,type NumericBuffer} from './projection.js';
import type {Sample} from './playback.js';
import {sceneMotion} from './scene-view.js';

/** Node coordinates and rest template share one space. Use identity pose for world-space nodes.
 * Local cages use their object's pose. Never apply rigid motion in both places. */
export interface StructuralSource {
 readonly id:string;readonly generation?:number;
 readonly position:Vec3;readonly rotation:Vec3;readonly scale:Vec3;
 readonly nodes:NumericBuffer;readonly broken:NumericBuffer;
}
/** Presentation buffers, NOT a solver checkpoint: no velocities, forces or plastic rest lengths. */
export interface StructuralView {
 readonly id:string;readonly epoch:number;readonly generation:number;
 readonly nodes:Float64Array;readonly broken:Uint8Array;
 visible:boolean;
}

/** Adapted from thegame's compact _frame + _beamBreak presentation contract.
 * A versioned template is installed once; pose/offsets/breakage share one Replica clock.
 * Reuses Projection, Publication, Replica and structural-skin; never simulates on receive.
 * RU: Каркас по сети; вершины меша, материалы и состояние решателя остаются вне пакета. */
export class StructuralProjection {
 readonly schema;
 readonly rest:Float64Array;
 private readonly offsets:Float64Array;
 private readonly masks:Uint32Array;
 private readonly shapeStart=sceneMotion.stride;
 private readonly breakStart:number;
 constructor(readonly templateId:string,rest:NumericBuffer,readonly constraintCount:number,limits:{maxEntities?:number;maxBytes?:number}={}){
  if(!identity(templateId)||rest.length%3||!safeInteger(rest.length/3,2,2048)||!safeInteger(constraintCount,1,16384))throw new RangeError('Invalid structural projection template');
  for(const n of rest)if(!Number.isFinite(n))throw new TypeError('Non-finite rest template');
  this.rest=new Float64Array(rest);
  this.offsets=new Float64Array(rest.length);this.masks=new Uint32Array(Math.ceil(constraintCount/32));this.breakStart=this.shapeStart+rest.length;
  this.schema=projection(templateId,{
   ...sceneMotion.fields,
   offsets:buffer(rest.length),broken:buffer(this.masks.length,{sample:'step',min:0,max:0xffffffff,integer:true}),
  },{maxEntities:limits.maxEntities??32,maxBytes:limits.maxBytes??2_000_000,maxStride:this.breakStart+this.masks.length});
 }
 /** Caller versions templateId when node order/rest/topology changes, even at the same counts.
  * Capture once per authority publication; Publication shares the encoded bytes per cohort. */
 capture(at:Stamp,sources:Iterable<StructuralSource>){return this.schema.capture(at,this.pack(sources));}
 private *pack(sources:Iterable<StructuralSource>){
  for(const source of sources){
   if(source.nodes.length!==this.rest.length||source.broken.length!==this.constraintCount)throw new RangeError('Structural state/template size mismatch');
   for(let k=0;k<this.offsets.length;k++){const n=source.nodes[k]!;if(!Number.isFinite(n))throw new TypeError('Non-finite structural node');this.offsets[k]=n-this.rest[k]!;}
   this.masks.fill(0);
   for(let k=0;k<this.constraintCount;k++){
    const broken=source.broken[k];if(broken!==0&&broken!==1)throw new TypeError('Broken constraints must be bits');
    if(broken)this.masks[k>>>5]=(this.masks[k>>>5]!|(1<<(k&31)))>>>0;
   }
   yield{id:source.id,generation:source.generation??0,data:{position:source.position,rotation:source.rotation,scale:source.scale,offsets:this.offsets,broken:this.masks}};
  }
 }
 bind(id:string,epoch:number,generation=0):StructuralView{
  if(!identity(id)||!safeInteger(epoch)||!safeInteger(generation))throw new TypeError('Invalid structural view identity');
  return{id,epoch,generation,nodes:this.rest.slice(),broken:new Uint8Array(this.constraintCount),visible:false};
 }
 /** Apply the SAME sampled frame as SceneReplicaView, then use applyStructuralSkin.
  * A missing/changed generation is hidden, never rebound to an unrelated rest cage.
  * Buffers survive seek and repeated samples; discrete fracture never interpolates. */
 apply(frame:Sample,view:StructuralView):boolean{
  if(view.nodes.length!==this.rest.length||view.broken.length!==this.constraintCount)throw new RangeError('Invalid structural view buffers');
  const row=frame.epoch===view.epoch?frame.rows.find(r=>r.id===view.id&&r.generation===view.generation):undefined;
  if(!row){view.visible=false;return false;}
  const values=row.values;
  if(values.length!==this.schema.stride)throw new RangeError('Structural sample layout mismatch');
  // Validate all channels before touching the caller-owned presentation buffers.
  for(const {offset,field} of this.schema.layout)for(let k=0;k<field.width;k++){
   const n=values[offset+k]!;
   if(!Number.isFinite(n)||n<field.min||n>field.max||field.integer&&!Number.isSafeInteger(n))throw new TypeError('Invalid structural sample');
  }
  const tail=this.constraintCount%32;
  if(tail&&values[values.length-1]!>=2**tail)throw new RangeError('Break mask exceeds template');
  for(let k=0;k<this.rest.length;k++)if(!Number.isFinite(this.rest[k]!+values[this.shapeStart+k]!))throw new RangeError('Non-finite reconstructed node');
  for(let k=0;k<this.rest.length;k++)view.nodes[k]=this.rest[k]!+values[this.shapeStart+k]!;
  for(let k=0;k<this.constraintCount;k++)view.broken[k]=(values[this.breakStart+(k>>>5)]!>>>(k&31))&1;
  view.visible=true;return true;
 }
}
