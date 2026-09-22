import {assertCounter,assertOwnerToken,ownerMatches,type LocationId,type OwnerToken} from './contracts.js';
export class InMemoryOwnership{
  private readonly owners=new Map<LocationId,OwnerToken>();
  constructor(readonly capacity=4096,initial:readonly OwnerToken[]=[]){
    if(!Number.isSafeInteger(capacity)||capacity<1||initial.length>capacity)throw new RangeError('Invalid ownership capacity');
    for(const token of initial){assertOwnerToken(token);if(this.owners.has(token.locationId))throw new Error('Duplicate location ownership');this.owners.set(token.locationId,{...token});}
  }
  get(locationId:LocationId):OwnerToken|undefined{const token=this.owners.get(locationId);return token&&{...token};}
  acquire(locationId:LocationId,ownerId:string,expectedEpoch=0):OwnerToken|null{
    assertCounter(expectedEpoch,'expected epoch');const current=this.owners.get(locationId);
    if((current?.epoch??0)!==expectedEpoch)return null;if(!current&&this.owners.size>=this.capacity)throw new RangeError('Ownership directory is full');
    const token={locationId,ownerId,epoch:expectedEpoch+1};assertOwnerToken(token);this.owners.set(locationId,token);return{...token};
  }
  transfer(expected:OwnerToken,nextOwnerId:string):OwnerToken|null{const current=this.owners.get(expected.locationId);if(!current||!ownerMatches(current,expected))return null;return this.acquire(expected.locationId,nextOwnerId,expected.epoch);}
  accepts(token:OwnerToken):boolean{const current=this.owners.get(token.locationId);return!!current&&ownerMatches(current,token);}
  snapshot():OwnerToken[]{return[...this.owners.values()].map(token=>({...token}));}
  get size():number{return this.owners.size;}
}
