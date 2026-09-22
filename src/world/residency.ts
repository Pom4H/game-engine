import {SIMULATION_TIERS,type SimulationTier} from '../core/kernel.js';

export interface ColdCodec<T>{readonly encode:(value:Readonly<T>)=>Uint8Array;readonly decode:(bytes:Uint8Array)=>T}
const encoder=new TextEncoder(),decoder=new TextDecoder();
export function jsonColdCodec<T>():ColdCodec<T>{return{encode:value=>encoder.encode(JSON.stringify(value)),decode:bytes=>JSON.parse(decoder.decode(bytes)) as T};}
interface Resident<T>{tier:SimulationTier;hot?:T;cold?:Uint8Array}
export class CompactResidencyStore<T>{
  private readonly entries=new Map<string,Resident<T>>();
  constructor(private readonly codec:ColdCodec<T>,readonly capacity=200_000){if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid residency capacity');}
  setHot(id:string,value:T,tier:SimulationTier='detailed'):void{this.validate(id,tier);if(!this.entries.has(id)&&this.entries.size>=this.capacity)throw new RangeError('Residency store is full');this.entries.set(id,{tier,hot:value});}
  hibernate(id:string,tier:Extract<SimulationTier,'aggregate'|'dormant'>='dormant'):boolean{const entry=this.entries.get(id);if(!entry)return false;this.validate(id,tier);if(entry.hot!==undefined){entry.cold=this.codec.encode(entry.hot);delete entry.hot;}entry.tier=tier;return true;}
  materialize(id:string,tier:Extract<SimulationTier,'detailed'|'active'>='active'):T|undefined{const entry=this.entries.get(id);if(!entry)return undefined;this.validate(id,tier);if(entry.hot===undefined&&entry.cold!==undefined)entry.hot=this.codec.decode(entry.cold);entry.tier=tier;return entry.hot;}
  setTier(id:string,tier:SimulationTier):boolean{const entry=this.entries.get(id);if(!entry)return false;this.validate(id,tier);entry.tier=tier;return true;}
  get(id:string):T|undefined{return this.entries.get(id)?.hot;}
  tier(id:string):SimulationTier|undefined{return this.entries.get(id)?.tier;}
  isMaterialized(id:string):boolean{return this.entries.get(id)?.hot!==undefined;}
  coldBytes(id:string):number{return this.entries.get(id)?.cold?.byteLength??0;}
  delete(id:string):boolean{return this.entries.delete(id);}
  get size():number{return this.entries.size;}
  get hotCount():number{let n=0;for(const entry of this.entries.values())if(entry.hot!==undefined)n++;return n;}
  private validate(id:string,tier:SimulationTier):void{if(!id||id.length>180)throw new TypeError('Residency entries need stable IDs');if(!SIMULATION_TIERS.includes(tier))throw new TypeError('Unknown simulation tier');}
}
