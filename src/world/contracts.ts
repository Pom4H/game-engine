import type {SimulationTier} from '../core/kernel.js';

export type LocationId=string;
export interface OwnerToken{readonly locationId:LocationId;readonly ownerId:string;readonly epoch:number}
export interface TickToken extends OwnerToken{readonly tick:number;readonly revision:number}
export interface WorkerJob<T>{readonly token:TickToken;readonly input:T}
export interface WorkerResult<T>{readonly token:TickToken;readonly output:T}
export interface WorldPoint{readonly x:number;readonly z:number}
export interface WorldPoint3 extends WorldPoint{readonly y:number}

export function ownerMatches(a:OwnerToken,b:OwnerToken):boolean{
  return a.locationId===b.locationId&&a.ownerId===b.ownerId&&a.epoch===b.epoch;
}
export function tokenMatches(a:TickToken,b:TickToken):boolean{
  return ownerMatches(a,b)&&a.tick===b.tick&&a.revision===b.revision;
}
export function assertCounter(value:number,label:string):void{
  if(!Number.isSafeInteger(value)||value<0)throw new RangeError(label+' must be a non-negative safe integer');
}
export function assertOwnerToken(token:OwnerToken):void{
  if(!token.locationId||!token.ownerId||token.locationId.length>180||token.ownerId.length>180)throw new TypeError('Invalid owner identity');
  assertCounter(token.epoch,'epoch');
  if(token.epoch===0)throw new RangeError('An acquired ownership epoch starts at one');
}
export function assertTickToken(token:TickToken):void{
  assertOwnerToken(token);assertCounter(token.tick,'tick');assertCounter(token.revision,'revision');
}
export type {SimulationTier};
