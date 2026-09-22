import {assertCounter,assertOwnerToken,ownerMatches,type OwnerToken} from './contracts.js';
import {compareIds} from './locations.js';
export interface WorldMessage<T=unknown>{readonly id:string;readonly source:OwnerToken;readonly target:OwnerToken;readonly tick:number;readonly sequence:number;readonly type:string;readonly payload:T}
export type EnqueueOutcome='accepted'|'duplicate'|'stale-owner'|'full';
export class WorldMailbox<T=unknown>{
  private pending=new Map<string,WorldMessage<T>>();
  constructor(readonly capacity=1024){if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid mailbox capacity');}
  enqueue(message:WorldMessage<T>,source:OwnerToken,target:OwnerToken):EnqueueOutcome{
    assertOwnerToken(message.source);assertOwnerToken(message.target);assertCounter(message.tick,'message tick');assertCounter(message.sequence,'message sequence');
    if(!message.id||!message.type)throw new TypeError('Messages require identity and type');
    if(!ownerMatches(message.source,source)||!ownerMatches(message.target,target))return'stale-owner';
    if(this.pending.has(message.id))return'duplicate';if(this.pending.size>=this.capacity)return'full';
    this.pending.set(message.id,structuredClone(message));return'accepted';
  }
  drain(owner:OwnerToken,tick:number,limit=this.capacity):WorldMessage<T>[]{
    assertOwnerToken(owner);assertCounter(tick,'drain tick');assertCounter(limit,'drain limit');const ready:WorldMessage<T>[]=[];
    for(const [id,message] of this.pending){if(message.target.locationId!==owner.locationId)continue;if(!ownerMatches(message.target,owner)){this.pending.delete(id);continue;}if(message.tick<=tick)ready.push(message);}
    ready.sort((a,b)=>a.tick-b.tick||compareIds(a.source.locationId,b.source.locationId)||a.source.epoch-b.source.epoch||a.sequence-b.sequence||compareIds(a.id,b.id));
    const result=ready.slice(0,limit);for(const message of result)this.pending.delete(message.id);return result;
  }
  get size():number{return this.pending.size;}
}
