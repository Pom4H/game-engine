export interface WorldTileId{
  readonly lod:number;
  readonly x:number;
  readonly z:number;
}
export interface WorldTileBounds{
  readonly minX:number;
  readonly minZ:number;
  readonly maxX:number;
  readonly maxZ:number;
}
export interface WorldTileDemand{
  readonly id:WorldTileId;
  readonly key:string;
  readonly bounds:WorldTileBounds;
  readonly sizeM:number;
  readonly distanceM:number;
  readonly priority:number;
}
export function worldTileKey(id:WorldTileId):string{
  validateTileId(id);
  return id.lod+':'+id.x+':'+id.z;
}
export function worldTileSize(baseTileSizeM:number,lod:number):number{
  if(!Number.isFinite(baseTileSizeM)||baseTileSizeM<=0)throw new RangeError('baseTileSizeM must be positive');
  if(!Number.isSafeInteger(lod)||lod<0||lod>30)throw new RangeError('tile lod must be an integer in [0, 30]');
  return baseTileSizeM*2**lod;
}
export function worldTileBounds(baseTileSizeM:number,id:WorldTileId):WorldTileBounds{
  validateTileId(id);
  const sizeM=worldTileSize(baseTileSizeM,id.lod),minX=id.x*sizeM,minZ=id.z*sizeM;
  if(![minX,minZ,minX+sizeM,minZ+sizeM].every(Number.isFinite))throw new RangeError('tile is outside finite world-coordinate range');
  return{minX,minZ,maxX:minX+sizeM,maxZ:minZ+sizeM};
}
export function worldTileAt(baseTileSizeM:number,lod:number,x:number,z:number):WorldTileId{
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new RangeError('world position must be finite');
  const sizeM=worldTileSize(baseTileSizeM,lod);
  return{lod,x:Math.floor(x/sizeM),z:Math.floor(z/sizeM)};
}
export function worldTileChildren(id:WorldTileId):readonly WorldTileId[]{
  validateTileId(id);
  if(id.lod===0)return[];
  const lod=id.lod-1,x=id.x*2,z=id.z*2;
  return Object.freeze([
    Object.freeze({lod,x,z}),
    Object.freeze({lod,x:x+1,z}),
    Object.freeze({lod,x,z:z+1}),
    Object.freeze({lod,x:x+1,z:z+1}),
  ]);
}
export function distanceToWorldTile(x:number,z:number,bounds:WorldTileBounds):number{
  if(!Number.isFinite(x)||!Number.isFinite(z))throw new RangeError('world position must be finite');
  return Math.hypot(Math.max(bounds.minX-x,0,x-bounds.maxX),Math.max(bounds.minZ-z,0,z-bounds.maxZ));
}
export function validateTileId(id:WorldTileId):void{
  if(!Number.isSafeInteger(id.lod)||id.lod<0||id.lod>30||!Number.isSafeInteger(id.x)||!Number.isSafeInteger(id.z))throw new RangeError('tile id must contain safe integer coordinates and lod');
}
