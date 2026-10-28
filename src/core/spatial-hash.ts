export interface SpatialItem { x: number; z: number; w?: number; l?: number }
export const SPATIAL_QUERY_CAPACITY = 128;
export const SPATIAL_QUERY_REFERENCES = 16_384;
/** Oversized members are tested against query cells instead of duplicated into every cell. */
export const SPATIAL_MAX_ITEM_CELLS = 64;
/** X/Z broad phase with bounded query caching and batched invalidation. */
function defaultRadius(item:object):number{
  const width='w' in item&&typeof item.w==='number'?item.w:1,length='l' in item&&typeof item.l==='number'?item.l:1;
  return Math.hypot(width,length)/2;
}
type SpatialGroup={readonly active:boolean};
type LinkedBucket<T>={head:BucketReference<T>|null;tail:BucketReference<T>|null;size:number;key:string};
type BucketReference<T>={item:T;bucket:LinkedBucket<T>;previous:BucketReference<T>|null;next:BucketReference<T>|null};
export class SpatialHash<T extends object & Pick<SpatialItem,'x'|'z'> = SpatialItem & object> {
  private readonly buckets = new Map<string, T[]>(); private memberships = new WeakMap<T, string[]>();
  private readonly oversized = new Map<T,{minX:number;maxX:number;minZ:number;maxZ:number}>();
  private readonly queries = new Map<string, readonly T[]>(); private cachedReferences=0; private cacheHits=0; private cacheMisses=0; private batchDepth=0; private batchDirty=false;
  private groupedBuckets:Map<string,LinkedBucket<T>>|undefined;private groupedMemberships=new WeakMap<T,BucketReference<T>[]>();private itemGroups=new WeakMap<T,SpatialGroup>();
  private orderBounds=new WeakMap<T,{minX:number;minZ:number;serial:number}>();private nextSerial=0;
  // Reuse only the last access into the existing bounded cache. This is not
  // another membership cache: live buckets and uncached large results bypass it.
  #lastSource:readonly T[]|null=null;
  #lastMinX=0;#lastMaxX=0;#lastMinZ=0;#lastMaxZ=0;#lastOrderMinX=0;#lastOrderMinZ=0;
  #rememberSource(source:readonly T[],minX:number,maxX:number,minZ:number,maxZ:number,orderMinX:number,orderMinZ:number){
    this.#lastSource=source;this.#lastMinX=minX;this.#lastMaxX=maxX;this.#lastMinZ=minZ;this.#lastMaxZ=maxZ;this.#lastOrderMinX=orderMinX;this.#lastOrderMinZ=orderMinZ;
  }
  /** Cell order preserves sequential solver contact order even when large
   * members use bounded storage instead of being copied into every bucket. */
  constructor(readonly size=32,private readonly options:{cellOrder?:boolean}={}){if(!Number.isFinite(size)||size<=0)throw new RangeError('Spatial cell size must be positive and finite');}
  /** Explicit opt-in: linked references preserve order while cleanup can unlink
   * one bucket membership per operation after a lifetime is deactivated. */
  enableGroups():void{
    if(this.groupedBuckets)return;this.groupedBuckets=new Map();
    for(const [key,items]of this.buckets)for(const item of items)this.appendReference(key,item);
    this.buckets.clear();this.memberships=new WeakMap();this.invalidateQueries();
  }
  // Lifetime eligibility is an atomic publication boundary, including inside a
  // caller's ordinary membership batch. Preserve normal add/remove batching.
  invalidateGroup():void{this.queries.clear();this.#lastSource=null;this.cachedReferences=0;}
  private appendReference(key:string,item:T){let bucket=this.groupedBuckets!.get(key);if(!bucket){bucket={head:null,tail:null,size:0,key};this.groupedBuckets!.set(key,bucket);}const node:BucketReference<T>={item,bucket,previous:bucket.tail,next:null};if(bucket.tail)bucket.tail.next=node;else bucket.head=node;bucket.tail=node;bucket.size++;let nodes=this.groupedMemberships.get(item);if(!nodes)this.groupedMemberships.set(item,nodes=[]);nodes.push(node);}
  /** True means fully removed; each call unlinks at most one bucket reference. */
  removeReference(item:T):boolean{
    if(!this.groupedBuckets){this.remove(item);return true;}
    if(this.oversized.delete(item)){this.itemGroups.delete(item);this.invalidateQueries();return true;}
    const nodes=this.groupedMemberships.get(item),node=nodes?.pop();if(!node)return true;
    const bucket=node.bucket;if(node.previous)node.previous.next=node.next;else bucket.head=node.next;if(node.next)node.next.previous=node.previous;else bucket.tail=node.previous;
    if(!--bucket.size)this.groupedBuckets.delete(bucket.key);this.invalidateQueries();
    if(!nodes!.length){this.groupedMemberships.delete(item);this.itemGroups.delete(item);return true;}return false;
  }
  add(item:T,radius=defaultRadius(item),group?:SpatialGroup):void{
    this.validate(item.x,item.z,radius);if(group)this.enableGroups();this.remove(item);if(group)this.itemGroups.set(item,group);else this.itemGroups.delete(item);
    const minX=Math.floor((item.x-radius)/this.size),maxX=Math.floor((item.x+radius)/this.size);
    const minZ=Math.floor((item.z-radius)/this.size),maxZ=Math.floor((item.z+radius)/this.size);
    if(this.options.cellOrder)this.orderBounds.set(item,{minX,minZ,serial:++this.nextSerial});
    const width=maxX-minX+1,height=maxZ-minZ+1;
    if(width>SPATIAL_MAX_ITEM_CELLS/height){
      this.oversized.set(item,{minX,maxX,minZ,maxZ});this.invalidateQueries();return;
    }
    const keys:string[]=[];
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
      const key=`${x},${z}`;let bucket=this.buckets.get(key);
      if(this.groupedBuckets)this.appendReference(key,item);else{if(!bucket)this.buckets.set(key,bucket=[]);bucket.push(item);keys.push(key);}
    }
    if(!this.groupedBuckets)this.memberships.set(item,keys);this.invalidateQueries();
  }
  remove(item:T):boolean{
    if(this.groupedBuckets){const present=this.oversized.has(item)||this.groupedMemberships.has(item);while(!this.removeReference(item)){}return present;}
    if(this.oversized.delete(item)){this.invalidateQueries();return true;}
    const keys=this.memberships.get(item);if(!keys)return false;
    for(const key of keys){const bucket=this.buckets.get(key);if(!bucket)continue;const i=bucket.indexOf(item);if(i>=0)bucket.splice(i,1);if(!bucket.length)this.buckets.delete(key);}
    this.memberships.delete(item);this.invalidateQueries();return true;
  }
  clear():void{this.groupedBuckets?.clear();this.groupedMemberships=new WeakMap();this.itemGroups=new WeakMap();this.buckets.clear();this.oversized.clear();this.memberships=new WeakMap<T,string[]>();this.orderBounds=new WeakMap();this.nextSerial=0;this.invalidateQueries();}
  /** An enclosing orderRadius preserves the enumeration order of a wider query
   * while selecting only this query's cells, including coplanar ray-hit ties. */
  near(x:number,z:number,radius=8,out?:T[],orderRadius=radius):T[]{
    const source=this.#querySource(x,z,radius,orderRadius);
    if(!out)return source.slice();out.length=0;for(const item of source)out.push(item);return out;
  }
  /** @internal Copy into an Engine-owned ordinary array, never lend cache storage.
   * Custom public near implementations retain their instrumentation/semantics. */
  nearOwned(x:number,z:number,radius:number,out:T[],orderRadius=radius):T[]{
    const near=this.near;if(near!==nativeNear)return Reflect.apply(near,this,[x,z,radius,out,orderRadius]);
    const source=this.#querySource(x,z,radius,orderRadius);
    for(let i=0;i<source.length;i++)out[i]=source[i]!;out.length=source.length;return out;
  }
  #querySource(x:number,z:number,radius:number,orderRadius:number):readonly T[]{
    this.validate(x,z,radius);
    if(orderRadius!==radius){this.validate(x,z,orderRadius);if(orderRadius<radius)throw new RangeError('Order radius must enclose the query');if(!this.options.cellOrder)throw new Error('Enclosing query order requires cellOrder');}
    const minX=Math.floor((x-radius)/this.size),maxX=Math.floor((x+radius)/this.size);
    const minZ=Math.floor((z-radius)/this.size),maxZ=Math.floor((z+radius)/this.size);
    const orderMinX=orderRadius===radius?minX:Math.floor((x-orderRadius)/this.size),orderMinZ=orderRadius===radius?minZ:Math.floor((z-orderRadius)/this.size),reorder=orderMinX!==minX||orderMinZ!==minZ;
    const appendOversized=(result:T[])=>{
      for(const [item,bounds] of this.oversized)
        if(this.itemGroups.get(item)?.active!==false&&bounds.minX<=maxX&&bounds.maxX>=minX&&bounds.minZ<=maxZ&&bounds.maxZ>=minZ)result.push(item);
      if(this.options.cellOrder&&(this.oversized.size||reorder))result.sort((a,b)=>{
        const A=this.orderBounds.get(a)!,B=this.orderBounds.get(b)!;
        return Math.max(A.minX,orderMinX)-Math.max(B.minX,orderMinX)||Math.max(A.minZ,orderMinZ)-Math.max(B.minZ,orderMinZ)||A.serial-B.serial;
      });
      return result;
    };
    // A plain single bucket needs no deduplication or sorting. Queries that
    // merge oversized members or preserve an enclosing ray's order do: route
    // those through the same bounded cache as multi-cell queries.
    if(!this.groupedBuckets&&minX===maxX&&minZ===maxZ&&!this.oversized.size&&!reorder){
      const bucket=this.buckets.get(`${minX},${minZ}`)??[];
      this.#lastSource=null;return bucket;
    }
    const last=this.#lastSource;
    if(last!==null&&minX===this.#lastMinX&&maxX===this.#lastMaxX&&minZ===this.#lastMinZ&&maxZ===this.#lastMaxZ&&orderMinX===this.#lastOrderMinX&&orderMinZ===this.#lastOrderMinZ){this.cacheHits++;return last;}
    const key=`${minX},${minZ}:${maxX},${maxZ}${reorder?'@'+orderMinX+','+orderMinZ:''}`,cached=this.queries.get(key);
    if(cached){this.cacheHits++;this.#rememberSource(cached,minX,maxX,minZ,maxZ,orderMinX,orderMinZ);return cached;}
    this.#lastSource=null;this.cacheMisses++;const seen=new Set<T>();
    const occupied=this.groupedBuckets??this.buckets,width=maxX-minX+1,height=maxZ-minZ+1;
    if(width>occupied.size/height){
      // A finite large collider can enclose millions of empty cells. Visit the
      // occupied cells instead, in exactly the same X/Z order as the dense
      // loop. Bucket insertion order and first-seen deduplication stay intact.
      const cells:{x:number;z:number;key:string}[]=[];
      for(const key of occupied.keys()){const comma=key.indexOf(','),x=Number(key.slice(0,comma)),z=Number(key.slice(comma+1));if(x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ)cells.push({x,z,key});}
      cells.sort((a,b)=>a.x-b.x||a.z-b.z);
      for(const {key}of cells){if(this.groupedBuckets){for(let node=this.groupedBuckets.get(key)?.head;node;node=node.next??undefined)if(this.itemGroups.get(node.item)?.active!==false)seen.add(node.item);}else{const bucket=this.buckets.get(key);if(bucket)for(const item of bucket)seen.add(item);}}
    }else for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
      const cell=`${ix},${iz}`;if(this.groupedBuckets){for(let node=this.groupedBuckets.get(cell)?.head;node;node=node.next??undefined)if(this.itemGroups.get(node.item)?.active!==false)seen.add(node.item);}else{const bucket=this.buckets.get(cell);if(bucket)for(const item of bucket)seen.add(item);}
    }
    const result=appendOversized([...seen]);
    if(result.length<=SPATIAL_QUERY_REFERENCES){
      while(this.queries.size>=SPATIAL_QUERY_CAPACITY||this.cachedReferences+result.length>SPATIAL_QUERY_REFERENCES){
        const oldest=this.queries.keys().next().value as string|undefined;if(oldest===undefined)break;
        this.cachedReferences-=this.queries.get(oldest)?.length??0;this.queries.delete(oldest);
      }
      const stored=result.slice();this.queries.set(key,stored);this.cachedReferences+=result.length;this.#rememberSource(stored,minX,maxX,minZ,maxZ,orderMinX,orderMinZ);
    }
    else this.#lastSource=null;
    return result;
  }
  beginBatch():void{this.batchDepth++;} endBatch():void{if(this.batchDepth>0)this.batchDepth--;if(this.batchDepth===0&&this.batchDirty)this.invalidateQueries();}
  get diagnostics(){return{cells:this.groupedBuckets?.size??this.buckets.size,oversizedItems:this.oversized.size,cachedQueries:this.queries.size,cachedReferences:this.cachedReferences,cacheHits:this.cacheHits,cacheMisses:this.cacheMisses};}
  private validate(x:number,z:number,radius:number):void{if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(radius)||radius<0)throw new RangeError('Spatial bounds must be finite with a non-negative radius');if((Math.max(Math.abs(x),Math.abs(z))+radius)/this.size>Number.MAX_SAFE_INTEGER)throw new RangeError('Spatial coordinates exceed safe integer precision');}
  private invalidateQueries():void{if(this.batchDepth>0){this.batchDirty=true;return;}this.queries.clear();this.#lastSource=null;this.cachedReferences=0;this.batchDirty=false;}
}
const nativeNear=SpatialHash.prototype.near;
