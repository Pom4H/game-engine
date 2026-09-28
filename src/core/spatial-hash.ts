import {trackRuntimeMemory,trackRuntimeInstance} from './runtime-memory.js';
export interface SpatialItem { x: number; z: number; w?: number; l?: number }
export const SPATIAL_QUERY_CAPACITY = 128;
export const SPATIAL_QUERY_REFERENCES = 16_384;
/** Oversized members are tested against query cells instead of duplicated into every cell. */
export const SPATIAL_MAX_ITEM_CELLS = 64;
/** X/Z broad phase with bounded query caching and batched invalidation. */
export class SpatialHash<T extends object & SpatialItem = SpatialItem & object> {
  private readonly buckets = trackRuntimeMemory('SpatialHash','buckets','index',new Map<string, T[]>()); private memberships = trackRuntimeMemory('SpatialHash','memberships','index',new WeakMap<T, string[]>());
  private readonly oversized = trackRuntimeMemory('SpatialHash','oversized','index',new Map<T,{minX:number;maxX:number;minZ:number;maxZ:number}>());
  private readonly queries = trackRuntimeMemory('SpatialHash','queries','cache',new Map<string, readonly T[]>(),SPATIAL_QUERY_CAPACITY); private cachedReferences=0; private cacheHits=0; private cacheMisses=0; private batchDepth=0; private batchDirty=false;
  constructor(readonly size=32){trackRuntimeInstance('SpatialHash',this);if(!Number.isFinite(size)||size<=0)throw new RangeError('Spatial cell size must be positive and finite');}
  add(item:T,radius=Math.hypot(item.w??1,item.l??1)/2):void{
    this.validate(item.x,item.z,radius);this.remove(item);
    const minX=Math.floor((item.x-radius)/this.size),maxX=Math.floor((item.x+radius)/this.size);
    const minZ=Math.floor((item.z-radius)/this.size),maxZ=Math.floor((item.z+radius)/this.size);
    const width=maxX-minX+1,height=maxZ-minZ+1;
    if(width>SPATIAL_MAX_ITEM_CELLS/height){
      this.oversized.set(item,{minX,maxX,minZ,maxZ});this.invalidateQueries();return;
    }
    const keys:string[]=[];
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
      const key=`${x},${z}`;let bucket=this.buckets.get(key);
      if(!bucket)this.buckets.set(key,bucket=[]);bucket.push(item);keys.push(key);
    }
    this.memberships.set(item,keys);this.invalidateQueries();
  }
  remove(item:T):boolean{
    if(this.oversized.delete(item)){this.invalidateQueries();return true;}
    const keys=this.memberships.get(item);if(!keys)return false;
    for(const key of keys){const bucket=this.buckets.get(key);if(!bucket)continue;const i=bucket.indexOf(item);if(i>=0)bucket.splice(i,1);if(!bucket.length)this.buckets.delete(key);}
    this.memberships.delete(item);this.invalidateQueries();return true;
  }
  clear():void{this.buckets.clear();this.oversized.clear();this.memberships=trackRuntimeMemory('SpatialHash','memberships','index',new WeakMap<T,string[]>());this.invalidateQueries();}
  near(x:number,z:number,radius=8,out?:T[]):T[]{
    this.validate(x,z,radius);
    const minX=Math.floor((x-radius)/this.size),maxX=Math.floor((x+radius)/this.size);
    const minZ=Math.floor((z-radius)/this.size),maxZ=Math.floor((z+radius)/this.size);
    const fill=(source:readonly T[])=>{if(!out)return source.slice();out.length=0;out.push(...source);return out;};
    const appendOversized=(result:T[])=>{
      for(const [item,bounds] of this.oversized)
        if(bounds.minX<=maxX&&bounds.maxX>=minX&&bounds.minZ<=maxZ&&bounds.maxZ>=minZ)result.push(item);
      return result;
    };
    if(minX===maxX&&minZ===maxZ){
      const bucket=this.buckets.get(`${minX},${minZ}`)??[];
      return fill(this.oversized.size?appendOversized([...bucket]):bucket);
    }
    const key=`${minX},${minZ}:${maxX},${maxZ}`,cached=this.queries.get(key);
    if(cached){this.cacheHits++;return fill(cached);}
    this.cacheMisses++;const seen=new Set<T>();
    for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
      const bucket=this.buckets.get(`${ix},${iz}`);if(bucket)for(const item of bucket)seen.add(item);
    }
    const result=appendOversized([...seen]);
    if(result.length<=SPATIAL_QUERY_REFERENCES){
      while(this.queries.size>=SPATIAL_QUERY_CAPACITY||this.cachedReferences+result.length>SPATIAL_QUERY_REFERENCES){
        const oldest=this.queries.keys().next().value as string|undefined;if(oldest===undefined)break;
        this.cachedReferences-=this.queries.get(oldest)?.length??0;this.queries.delete(oldest);
      }
      this.queries.set(key,result.slice());this.cachedReferences+=result.length;
    }
    return fill(result);
  }
  beginBatch():void{this.batchDepth++;} endBatch():void{if(this.batchDepth>0)this.batchDepth--;if(this.batchDepth===0&&this.batchDirty)this.invalidateQueries();}
  get diagnostics(){return{cells:this.buckets.size,oversizedItems:this.oversized.size,cachedQueries:this.queries.size,cachedReferences:this.cachedReferences,cacheHits:this.cacheHits,cacheMisses:this.cacheMisses};}
  private validate(x:number,z:number,radius:number):void{if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(radius)||radius<0)throw new RangeError('Spatial bounds must be finite with a non-negative radius');if((Math.max(Math.abs(x),Math.abs(z))+radius)/this.size>Number.MAX_SAFE_INTEGER)throw new RangeError('Spatial coordinates exceed safe integer precision');}
  private invalidateQueries():void{if(this.batchDepth>0){this.batchDirty=true;return;}this.queries.clear();this.cachedReferences=0;this.batchDirty=false;}
}
