import type {LocationId,WorldPoint} from './contracts.js';

export const LOCATION_SIZE=256;
export const LOCATION_SCHEMA_VERSION=1;
export interface WorldLocation{
  readonly id:LocationId;readonly seed:number;readonly cellX:number;readonly cellZ:number;
  readonly minX:number;readonly minZ:number;readonly maxX:number;readonly maxZ:number;
}
function integer(value:number,label:string):void{if(!Number.isSafeInteger(value))throw new RangeError(label+' must be a safe integer');}
function fromCell(seed:number,cellX:number,cellZ:number):WorldLocation{
  integer(seed,'seed');integer(cellX,'cellX');integer(cellZ,'cellZ');
  const minX=cellX*LOCATION_SIZE,minZ=cellZ*LOCATION_SIZE;
  if(![minX,minZ,minX+LOCATION_SIZE,minZ+LOCATION_SIZE].every(Number.isSafeInteger))throw new RangeError('Location is outside the exact coordinate range');
  return{id:'loc:v1:'+seed+':'+cellX+':'+cellZ,seed,cellX,cellZ,minX,minZ,maxX:minX+LOCATION_SIZE,maxZ:minZ+LOCATION_SIZE};
}
export function locationAt(seed:number,x:number,z:number):WorldLocation{
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new RangeError('World coordinates must be finite');
  return fromCell(seed,Math.floor(x/LOCATION_SIZE),Math.floor(z/LOCATION_SIZE));
}
export function locationIdAt(seed:number,x:number,z:number):LocationId{return locationAt(seed,x,z).id;}
export function locationBounds(id:LocationId):WorldLocation{
  const match=/^loc:v1:(-?(?:0|[1-9]\d*)):(-?(?:0|[1-9]\d*)):(-?(?:0|[1-9]\d*))$/.exec(id);
  if(!match)throw new TypeError('Unknown or malformed location ID');
  const value=fromCell(Number(match[1]),Number(match[2]),Number(match[3]));
  if(value.id!==id)throw new TypeError('Location ID must use its canonical representation');
  return value;
}
export function distanceToLocation(point:WorldPoint,location:WorldLocation):number{
  return Math.hypot(Math.max(location.minX-point.x,0,point.x-location.maxX),Math.max(location.minZ-point.z,0,point.z-location.maxZ));
}
export function locationsInRadius(seed:number,point:WorldPoint,radius:number,limit=256):WorldLocation[]{
  if(!Number.isFinite(radius)||radius<0||!Number.isSafeInteger(limit)||limit<1)throw new RangeError('Invalid location query budget');
  const low=locationAt(seed,point.x-radius,point.z-radius),high=locationAt(seed,point.x+radius,point.z+radius);
  const candidates=(high.cellX-low.cellX+1)*(high.cellZ-low.cellZ+1);
  if(candidates>limit*2)throw new RangeError('Location query exceeds its scan budget');
  const result:WorldLocation[]=[];
  for(let x=low.cellX;x<=high.cellX;x++)for(let z=low.cellZ;z<=high.cellZ;z++){
    const location=fromCell(seed,x,z);
    if(distanceToLocation(point,location)<=radius)result.push(location);
    if(result.length>limit)throw new RangeError('Location query exceeds its result budget');
  }
  return result.sort((a,b)=>distanceToLocation(point,a)-distanceToLocation(point,b)||compareIds(a.id,b.id));
}
export function compareIds(a:string,b:string):number{return a<b?-1:a>b?1:0;}
