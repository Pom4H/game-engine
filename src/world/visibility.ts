import type {Vec3} from '../math.js';
import {distanceToWorldTile,worldTileAt,worldTileBounds,worldTileChildren,worldTileKey,worldTileSize,type WorldTileDemand,type WorldTileId,type WorldTileBounds} from './tiles.js';

export interface VisibilityObserver{
  readonly position:Vec3;
  readonly forward:Vec3;
  readonly groundY:number;
  readonly verticalFovDeg:number;
  readonly aspect:number;
  readonly velocity?:Vec3;
  /** Optional weather/atmosphere cap. Omit for a clear-air horizon. */
  readonly atmosphericVisibilityM?:number;
}
export interface VisibilityInterestConfig{
  readonly baseTileSizeM:number;
  readonly nearDetailDistanceM:number;
  readonly safetyRadiusM:number;
  readonly lookAheadSeconds:number;
  readonly maxDistanceM:number;
  /** Apparent-horizon radius. null means a flat world with no curvature horizon. */
  readonly horizonRadiusM:number|null;
  readonly maxLod:number;
  readonly coneMarginDeg:number;
  readonly maxTiles:number;
}
export interface VisibilityPlan{
  readonly altitudeM:number;
  readonly horizonDistanceM:number;
  readonly planningDistanceM:number;
  readonly rootLod:number;
  readonly demands:readonly WorldTileDemand[];
}
export const DEFAULT_VISIBILITY_INTEREST:VisibilityInterestConfig=Object.freeze({
  baseTileSizeM:128,
  nearDetailDistanceM:1024,
  safetyRadiusM:384,
  lookAheadSeconds:6,
  maxDistanceM:160_000,
  horizonRadiusM:6_371_000,
  maxLod:10,
  coneMarginDeg:10,
  maxTiles:4096,
});

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const degToRad=(value:number)=>value*Math.PI/180;

export function geometricHorizonDistance(altitudeM:number,radiusM=6_371_000):number{
  if(!Number.isFinite(altitudeM)||altitudeM<0||!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('horizon inputs must be finite and positive');
  return Math.sqrt(altitudeM*(2*radiusM+altitudeM));
}

function horizontalForward(forward:Vec3):readonly[number,number]{
  if(!forward.every(Number.isFinite))throw new RangeError('observer forward vector must be finite');
  const length=Math.hypot(forward[0],forward[2]);
  return length>1e-9?[forward[0]/length,forward[2]/length]:[0,1];
}
function boundsCenter(bounds:WorldTileBounds):readonly[number,number]{
  return[(bounds.minX+bounds.maxX)/2,(bounds.minZ+bounds.maxZ)/2];
}
function desiredLod(distanceM:number,config:VisibilityInterestConfig):number{
  if(distanceM<=config.nearDetailDistanceM)return 0;
  return clamp(Math.ceil(Math.log2(distanceM/config.nearDetailDistanceM)),0,config.maxLod);
}
function visibleInCone(
  bounds:WorldTileBounds,
  observerX:number,
  observerZ:number,
  forward:readonly[number,number],
  halfHorizontalFov:number,
  safetyRadiusM:number,
):boolean{
  const near=distanceToWorldTile(observerX,observerZ,bounds);
  if(near<=safetyRadiusM)return true;
  const [cx,cz]=boundsCenter(bounds),dx=cx-observerX,dz=cz-observerZ,distance=Math.hypot(dx,dz);
  if(distance<1e-9)return true;
  const tileRadius=Math.hypot(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)/2;
  const angularRadius=Math.asin(clamp(tileRadius/distance,0,1));
  const cosine=clamp((dx*forward[0]+dz*forward[1])/distance,-1,1),angle=Math.acos(cosine);
  return angle<=halfHorizontalFov+angularRadius;
}

export class VisibilityInterest{
  readonly config:VisibilityInterestConfig;
  constructor(config:Partial<VisibilityInterestConfig>={}){
    this.config=Object.freeze({...DEFAULT_VISIBILITY_INTEREST,...config});
    const c=this.config;
    if(![c.baseTileSizeM,c.nearDetailDistanceM,c.safetyRadiusM,c.lookAheadSeconds,c.maxDistanceM,c.coneMarginDeg].every(Number.isFinite)
      ||c.baseTileSizeM<=0||c.nearDetailDistanceM<c.baseTileSizeM||c.safetyRadiusM<c.baseTileSizeM||c.lookAheadSeconds<0||c.maxDistanceM<c.nearDetailDistanceM
      ||!Number.isSafeInteger(c.maxLod)||c.maxLod<0||c.maxLod>20||!Number.isSafeInteger(c.maxTiles)||c.maxTiles<16
      ||(c.horizonRadiusM!==null&&(!Number.isFinite(c.horizonRadiusM)||c.horizonRadiusM<=0)))throw new RangeError('Invalid visibility interest config');
  }

  plan(observer:VisibilityObserver):VisibilityPlan{
    const c=this.config,p=observer.position;
    if(!p.every(Number.isFinite)||!Number.isFinite(observer.groundY)||!Number.isFinite(observer.verticalFovDeg)||observer.verticalFovDeg<=1||observer.verticalFovDeg>=175||!Number.isFinite(observer.aspect)||observer.aspect<=0)throw new RangeError('Invalid visibility observer');
    if(observer.velocity&&!observer.velocity.every(Number.isFinite))throw new RangeError('observer velocity must be finite');
    if(observer.atmosphericVisibilityM!==undefined&&(!Number.isFinite(observer.atmosphericVisibilityM)||observer.atmosphericVisibilityM<=0))throw new RangeError('atmosphericVisibilityM must be positive');
    const altitudeM=Math.max(0,p[1]-observer.groundY);
    // Keep a normal eye-height horizon on flat ground so y==ground does not collapse visibility.
    const horizonAltitude=Math.max(1.7,altitudeM);
    const geometric=c.horizonRadiusM===null?c.maxDistanceM:geometricHorizonDistance(horizonAltitude,c.horizonRadiusM);
    const horizonDistanceM=Math.max(c.safetyRadiusM,Math.min(c.maxDistanceM,geometric,observer.atmosphericVisibilityM??Infinity));
    const speed=observer.velocity?Math.hypot(observer.velocity[0],observer.velocity[2]):0;
    const lookAheadM=Math.min(c.maxDistanceM-horizonDistanceM,Math.max(0,speed*c.lookAheadSeconds));
    const planningDistanceM=horizonDistanceM+lookAheadM;
    const rootLod=Math.min(c.maxLod,Math.max(0,desiredLod(planningDistanceM,c)+2));
    const rootSize=worldTileSize(c.baseTileSizeM,rootLod),margin=planningDistanceM+rootSize;
    const minRoot=worldTileAt(c.baseTileSizeM,rootLod,p[0]-margin,p[2]-margin),maxRoot=worldTileAt(c.baseTileSizeM,rootLod,p[0]+margin,p[2]+margin);
    const forward=horizontalForward(observer.forward),halfVertical=degToRad(observer.verticalFovDeg)/2;
    const halfHorizontal=Math.atan(Math.tan(halfVertical)*observer.aspect)+degToRad(c.coneMarginDeg);
    const demands:WorldTileDemand[]=[];
    const visit=(id:WorldTileId):void=>{
      const bounds=worldTileBounds(c.baseTileSizeM,id),distanceM=distanceToWorldTile(p[0],p[2],bounds);
      if(distanceM>planningDistanceM)return;
      if(!visibleInCone(bounds,p[0],p[2],forward,halfHorizontal,c.safetyRadiusM))return;
      const target=desiredLod(distanceM,c);
      if(id.lod>target){
        const children=[...worldTileChildren(id)].sort((a,b)=>distanceToWorldTile(p[0],p[2],worldTileBounds(c.baseTileSizeM,a))-distanceToWorldTile(p[0],p[2],worldTileBounds(c.baseTileSizeM,b))||a.x-b.x||a.z-b.z);
        for(const child of children)visit(child);
        return;
      }
      const sizeM=worldTileSize(c.baseTileSizeM,id.lod);
      // Near fine tiles are highest priority; coarse horizon tiles still rank ahead of
      // equally distant finer work because they cover more missing screen area per job.
      const priority=1/(1+distanceM)+id.lod*1e-9;
      demands.push(Object.freeze({id:Object.freeze({...id}),key:worldTileKey(id),bounds:Object.freeze(bounds),sizeM,distanceM,priority}));
      if(demands.length>c.maxTiles*2)throw new RangeError('visibility plan exceeded traversal budget');
    };
    for(let z=minRoot.z;z<=maxRoot.z;z++)for(let x=minRoot.x;x<=maxRoot.x;x++)visit({lod:rootLod,x,z});
    demands.sort((a,b)=>b.priority-a.priority||a.distanceM-b.distanceM||a.id.lod-b.id.lod||a.id.x-b.id.x||a.id.z-b.id.z);
    return Object.freeze({
      altitudeM,
      horizonDistanceM,
      planningDistanceM,
      rootLod,
      demands:Object.freeze(demands.slice(0,c.maxTiles)),
    });
  }
}
