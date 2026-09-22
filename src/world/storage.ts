import type {LocationId,OwnerToken,TickToken} from './contracts.js';
import type {WorldMessage} from './messages.js';

export interface LocationSnapshot<State=unknown> extends OwnerToken{
  readonly schemaVersion:1;readonly revision:number;readonly tick:number;readonly simulatedTime:number;readonly leaseUntil:number;readonly state:State;
}
export interface LocationCommit<State=unknown>{
  readonly token:TickToken;readonly now:number;readonly simulatedTime:number;readonly state:State;
  readonly records?:readonly(readonly[string,unknown])[];readonly outbox?:readonly WorldMessage[];
}
export interface LocationStore{
  read(locationId:LocationId):LocationSnapshot|null;
  acquire(locationId:LocationId,ownerId:string,now:number,leaseMs:number):OwnerToken|null;
  renew(token:OwnerToken,now:number,leaseMs:number):boolean;
  release(token:OwnerToken):boolean;
  commitLocation<State>(commit:LocationCommit<State>):LocationSnapshot<State>|null;
  get(key:string):unknown;commit(entries:readonly(readonly[string,unknown])[]):void;
  scan(prefix:string,afterKey?:string,limit?:number):[string,unknown][];close():void;
}
export interface AsyncLocationStore{
  read(locationId:LocationId):Promise<LocationSnapshot|null>;
  acquire(locationId:LocationId,ownerId:string,now:number,leaseMs:number):Promise<OwnerToken|null>;
  renew(token:OwnerToken,now:number,leaseMs:number):Promise<boolean>;
  release(token:OwnerToken):Promise<boolean>;
  commitLocation<State>(commit:LocationCommit<State>):Promise<LocationSnapshot<State>|null>;
  get(key:string):Promise<unknown>;commit(entries:readonly(readonly[string,unknown])[]):Promise<void>;
  scan(prefix:string,afterKey?:string,limit?:number):Promise<[string,unknown][]>;close():Promise<void>;
}
