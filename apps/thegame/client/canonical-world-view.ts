import {Scene} from '../../../src/scene/scene.js';
import {RenderMeshQuery} from '../../../src/render/mesh-ray.js';
import type {CanonicalActors,CanonicalActorsFactory} from './canonical-actors.js';
import type {CanonicalUrbanAssets,CanonicalUrbanFactory} from './canonical-urban.js';
import type {CanonicalSceneryAssets,CanonicalSceneryFactory} from './canonical-scenery.js';
import type {CanonicalRoadAssets,CanonicalRoadFactory} from './canonical-roads.js';
import type {CanonicalTerrainAssets,CanonicalTerrainFactory} from './canonical-terrain.js';
import type {CanonicalLighting,CanonicalLightingSource} from './canonical-lighting.js';
import type {CanonicalSurfaceEffects,CanonicalSurfaceFactory} from './canonical-surface-effects.js';
import {batchStaticScenery} from '../../../src/procedural/static-batch.js';
import {resolveEnvironmentAt} from '../../../src/environment/types.js';
import type {Color,EntitySpec,MaterialSpec} from '../../../src/scene/types.js';
import type {Vec3} from '../shared.js';
import type {CanonicalBinding,CanonicalBox,CanonicalBuilding,CanonicalEntity,CanonicalFrame,CanonicalGeometry,CanonicalUrban} from './canonical-types.js';
export type {CanonicalFrame,CanonicalBinding,CanonicalGeometry} from './canonical-types.js';

type Mode='office'|'game';
const MAX_ENTITIES=150,MAX_BOXES=16000,MAX_STATIC_ENTITIES=2400;
const CITY_VIEW_RADIUS=420,SURFACE_VIEW_RADIUS=420,OFFICE_OUTSIDE_ACTORS=12;
const color=(c:Vec3,alpha=1):Color=>[c[0],c[1],c[2],alpha];
const finite=(v:readonly number[])=>v.every(Number.isFinite);
const box=(id:string,p:Vec3,size:Vec3,c:Color,rotation:Vec3=[0,0,0],material:MaterialSpec={}):EntitySpec=>({id,position:p,rotation,mesh:{kind:'box',size},material:{color:c,roughness:.76,...material},renderOnly:true});
const finish=(n:number):MaterialSpec=>n===14?{kind:'wood'}:n===5||n===8?{kind:'steel',metalness:.35}:n===2?{kind:'concrete',pattern:'brick'}:n===3?{kind:'concrete'}:n===10?{roughness:.22}:{};
const validBox=(b:CanonicalBox)=>finite([b.x,b.y,b.z,b.w,b.h,b.l,...b.color])&&b.w>.001&&b.h>.001&&b.l>.001&&Math.max(b.w,b.h,b.l)<=1024;
const interior=(p:CanonicalBuilding,b:CanonicalBox)=>b.role!=='shell'&&b.y<p.height-.15&&(b.role==='floor'||b.role==='ceiling'||Math.abs(b.x)+b.w/2<p.width/2-.03&&Math.abs(b.z)+b.l/2<p.depth/2-.03);
/** Passive Engine view of the full game's authority. Only supplied canonical
 * geometry and records are rendered; this class has no city/NPC simulation. */
export class CanonicalWorldLayer{
 private mode:Mode;private binding:CanonicalBinding|null=null;private selectedFloor:number|null=null;private cityVisible=true;private disposed=false;
 private geometry:CanonicalGeometry|null=null;private geometryObject:CanonicalGeometry|null=null;private geometryKey='';private staticDirty=true;
 private cityIds:string[]=[];private buildingIds:string[]=[];private liftIds:string[]=[];private actorRenderer:CanonicalActors|null=null;private actorFactory:CanonicalActorsFactory|undefined;private groundQuery:RenderMeshQuery;
 private last:CanonicalFrame|null=null;private localMarkers:{id:string;position:Vec3;name:string}[]=[];private lightingKey='';private weatherKey='';
 private subjectId:string|null=null;private clipCenter:readonly[number,number]=[0,0];
 private urbanRenderer:CanonicalUrbanAssets|null=null;private urbanFactory:CanonicalUrbanFactory|undefined;
 private sceneryRenderer:CanonicalSceneryAssets|null=null;private sceneryFactory:CanonicalSceneryFactory|undefined;
 private roadRenderer:CanonicalRoadAssets|null=null;private roadFactory:CanonicalRoadFactory|undefined;
 private terrainRenderer:CanonicalTerrainAssets|null=null;private terrainFactory:CanonicalTerrainFactory|undefined;
 private lightingSource:CanonicalLightingSource|undefined;
 private surfaceRenderer:CanonicalSurfaceEffects|null=null;private surfaceFactory:CanonicalSurfaceFactory|undefined;
 readonly diagnostics={surfaceEffects:null as ReturnType<CanonicalSurfaceEffects['inspect']>|null,lightingSource:'legacy' as 'legacy'|'thegame',lighting:null as CanonicalLighting|null,source:'thegame' as const,chunks:0,actors:0,traffic:0,facade:0,core:0,cityVisible:true,presentedTime:0,lightingUpdates:0,geometryKey:'',view:'office' as 'office'|'controller',terrainBounds:null as {minX:number;minZ:number;maxX:number;maxZ:number}|null,subjectVisible:false,subjectPresent:false,subjectFirstPerson:false,subjectSuppressedMeshes:0,terrainPatches:0,assets:'loading' as 'loading'|'ready',assetMeshes:0,assetGeometryBuilds:0,urbanAssets:'loading' as 'loading'|'ready',urbanRecords:0,urbanMeshes:0,urbanGeometryBuilds:0,scenery:null as ReturnType<CanonicalSceneryAssets['inspect']>|null,roads:null as ReturnType<CanonicalRoadAssets['inspect']>|null,terrainSource:null as ReturnType<CanonicalTerrainAssets['inspect']>|null};
 constructor(private readonly scene:Scene,options:{mode:Mode;actorFactory?:CanonicalActorsFactory;urbanFactory?:CanonicalUrbanFactory;sceneryFactory?:CanonicalSceneryFactory;roadFactory?:CanonicalRoadFactory;terrainFactory?:CanonicalTerrainFactory;lightingSource?:CanonicalLightingSource;surfaceFactory?:CanonicalSurfaceFactory}={mode:'office'}){this.mode=options.mode;this.groundQuery=new RenderMeshQuery(scene);if(options.actorFactory)this.setActorFactory(options.actorFactory);if(options.urbanFactory)this.setUrbanFactory(options.urbanFactory);if(options.sceneryFactory)this.setSceneryFactory(options.sceneryFactory);if(options.roadFactory)this.setRoadFactory(options.roadFactory);if(options.terrainFactory)this.setTerrainFactory(options.terrainFactory);if(options.lightingSource)this.setLightingSource(options.lightingSource);if(options.surfaceFactory)this.setSurfaceFactory(options.surfaceFactory);}
 setActorFactory(factory:CanonicalActorsFactory):void{if(this.disposed||this.actorFactory===factory)return;this.actorRenderer?.dispose();this.actorFactory=factory;this.actorRenderer=factory(this.scene);this.diagnostics.assets='ready';if(this.last)this.update(this.last);}
 setUrbanFactory(factory:CanonicalUrbanFactory):void{if(this.disposed||this.urbanFactory===factory)return;this.urbanRenderer?.dispose();this.urbanFactory=factory;this.urbanRenderer=factory(this.scene);this.diagnostics.urbanAssets='ready';this.staticDirty=true;if(this.last)this.update(this.last);}
 inspectUrban(){return this.urbanRenderer?.inspect()??{source:'thegame' as const,meshes:0,records:0,geometryBuilds:0};}
 setSceneryFactory(factory:CanonicalSceneryFactory):void{if(this.disposed||this.sceneryFactory===factory)return;this.sceneryRenderer?.dispose();this.sceneryFactory=factory;this.sceneryRenderer=factory(this.scene);this.staticDirty=true;if(this.last)this.update(this.last);}
 inspectScenery(){return this.sceneryRenderer?.inspect()??null;}
 setRoadFactory(factory:CanonicalRoadFactory):void{if(this.disposed||this.roadFactory===factory)return;this.roadRenderer?.dispose();this.roadFactory=factory;this.roadRenderer=factory(this.scene);this.staticDirty=true;if(this.last)this.update(this.last);}
 inspectRoads(){return this.roadRenderer?.inspect()??null;}
 setTerrainFactory(factory:CanonicalTerrainFactory):void{if(this.disposed||this.terrainFactory===factory)return;this.terrainRenderer?.dispose();this.terrainFactory=factory;this.terrainRenderer=factory(this.scene);this.staticDirty=true;if(this.last)this.update(this.last);}
 setSurfaceFactory(factory:CanonicalSurfaceFactory):void{if(this.disposed||this.surfaceFactory===factory)return;this.surfaceRenderer?.dispose();this.surfaceFactory=factory;this.surfaceRenderer=factory(this.scene);if(this.last)this.update(this.last);}
 setLightingSource(source:CanonicalLightingSource):void{if(this.disposed||this.lightingSource===source)return;this.lightingSource=source;this.lightingKey='';if(this.last)this.update(this.last);}
 inspectTerrain(){return this.terrainRenderer?.inspect()??null;}
 isActorMesh(id:string):boolean{return this.actorRenderer?.isActorMesh(id)??false;}
 private cameraVehicle:string|null=null;
 private cameraVehicleActive=false;
 get cameraExclusion(){return{vehicle:this.cameraVehicle,occupied:this.cameraVehicleActive};}
 private hiddenSubject:string|null=null;
 cameraSubjectHead():Vec3|null{return !this.cameraVehicleActive&&this.subjectId&&this.actorRenderer?.setHiddenOwner?this.actorRenderer.headPosition?.(this.subjectId)??null:null;}
 setFirstPerson(enabled:boolean):void{this.hiddenSubject=enabled?this.subjectId:null;this.actorRenderer?.setHiddenOwner?.(this.hiddenSubject);this.diagnostics.subjectFirstPerson=this.hiddenSubject!==null;this.diagnostics.subjectSuppressedMeshes=this.actorRenderer?.inspect().hiddenMeshes??0;this.diagnostics.subjectVisible=this.diagnostics.subjectPresent&&!this.diagnostics.subjectFirstPerson;}
 /** Release the exited vehicle after the near plane plus one metre of subject
  * viewing space clear it. Near-plane clearance alone allowed a 24 cm boom at
  * the ordinary car side, hiding the character immediately after dismounting.
  * Other vehicles and walls remain ordinary camera obstacles throughout. */
 prepareCamera(anchor:Vec3,nearClearance:number):void{if(!this.cameraVehicleActive&&this.cameraVehicle){const id=this.cameraVehicle;if(!this.groundQuery.withinDistance(anchor,nearClearance+1,e=>e.material.color[3]>=.5&&(this.actorRenderer?.isOwnedMesh(e.id,id)??false)))this.cameraVehicle=null;}}
 ignoreCameraMesh(id:string):boolean{return (this.surfaceRenderer?.isEffectMesh(id)??false)||this.isActorMesh(id)||this.cameraVehicle!==null&&(this.actorRenderer?.isOwnedMesh(id,this.cameraVehicle)??false);}
 hasActor(id:string):boolean{return this.actorRenderer?.hasActor(id)??false;}
 toLocal(p:Vec3):Vec3{const b=this.binding;if(!b)return p;const x=p[0]-b.origin[0],z=p[2]-b.origin[2],c=Math.cos(b.yaw),s=Math.sin(b.yaw);return[c*x-s*z,p[1]-b.origin[1]-(this.selectedFloor??b.officeFloor)*b.floorHeight,s*x+c*z-(b.placement?.offsetZ??0)];}
 toWorld(p:Vec3):Vec3{const b=this.binding;if(!b)return p;const z=p[2]+(b.placement?.offsetZ??0),c=Math.cos(b.yaw),s=Math.sin(b.yaw);return[b.origin[0]+c*p[0]+s*z,b.origin[1]+(this.selectedFloor??b.officeFloor)*b.floorHeight+p[1],b.origin[2]-s*p[0]+c*z];}
 /** Reuse the presented frame after camera collision, without sampling the
  * network again. The first call also supplies rooms to camera/feet queries. */
 updateInteriors():void{
  const b=this.binding,frame=this.last;if(this.disposed||!b||!frame||!this.sceneryRenderer?.updateInteriors)return;
  const subject=frame.entities.find(e=>e.id===this.subjectId),observer=subject??{x:b.origin[0],y:b.origin[1]+(this.selectedFloor??b.officeFloor)*b.floorHeight,z:b.origin[2]};
  this.sceneryRenderer.updateInteriors(frame,{geometry:this.geometry,visible:this.cityVisible,origin:[b.origin[0],b.origin[1]+(this.selectedFloor??b.officeFloor)*b.floorHeight,b.origin[2]],yaw:b.yaw,offsetZ:b.placement?.offsetZ??0,center:this.clipCenter,radius:CITY_VIEW_RADIUS,officeBuilding:b.buildingId,mode:this.mode},{eye:this.toWorld(this.scene.camera.position),target:this.toWorld(this.scene.camera.target),observer,blocked:(a,b)=>{
   const from=this.toLocal(a),to=this.toLocal(b),d:Vec3=[to[0]-from[0],to[1]-from[1],to[2]-from[2]],length=Math.hypot(...d);if(length<=.25)return false;
   return this.groundQuery.cast(from,[d[0]/length,d[1]/length,d[2]/length],length-.25,e=>e.material.color[3]>=.5&&!this.isActorMesh(e.id)&&!(this.surfaceRenderer?.isEffectMesh(e.id)??false))!==null;
  }});this.diagnostics.scenery=this.inspectScenery();
 }
 isOfficeFloor(floor:number):boolean{return this.binding!==null&&floor===(this.selectedFloor??this.binding.officeFloor);}
 audioGeometry(){return this.geometry;}
 audioBlocked(from:Vec3,to:Vec3,owner?:string):boolean{const a=this.toLocal(from),b=this.toLocal(to),d:Vec3=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],length=Math.hypot(...d);if(length<=.1)return false;return this.groundQuery.cast(a,[d[0]/length,d[1]/length,d[2]/length],Math.max(0,length-.15),e=>!e.id.startsWith('actor/')&&!this.isActorMesh(e.id)&&!(this.surfaceRenderer?.isEffectMesh(e.id)??false)&&!(owner&&this.actorRenderer?.isOwnedMesh(e.id,owner))&&e.material.color[3]>=.5)!==null;}
 /** Draw source rain after the final camera and interior selection. No new
  * network sample, physics body or independent weather clock is introduced. */
 updateWeather():void{
  if(this.disposed||!this.last||!this.binding||!this.geometry||!this.surfaceRenderer?.updateWeather)return;
  this.surfaceRenderer.updateWeather({eye:this.toWorld(this.scene.camera.position),terrain:(x,z)=>this.heightAt(x,z),...(this.geometry?{building:this.geometry.building}:{}),floor:(x,y,z,range)=>{
   const hit=this.groundQuery.cast(this.toLocal([x,y,z]),[0,-1,0],range,e=>!e.id.startsWith('actor/')&&!this.isActorMesh(e.id)&&!(this.surfaceRenderer?.isEffectMesh(e.id)??false)&&e.material.color[3]>=.5);
   return hit?this.toWorld(hit.point)[1]:null;
  }});this.diagnostics.surfaceEffects=this.surfaceRenderer.inspect();const rain=this.diagnostics.surfaceEffects.rain;if(!rain)return;const weather=this.scene.spec.rendering?.surfaceWeather;if(weather?.rain!==rain.intensity)this.scene.patchAppearance({rendering:{surfaceWeather:{...weather,rain:rain.intensity}}});this.scene.environment={...this.scene.environment,precipitation:rain.intensity>.4?'frequent':rain.intensity>.01?'occasional':'rare'};
 }
 setMode(mode:Mode):void{if(this.disposed||this.mode===mode)return;this.mode=mode;this.staticDirty=true;if(this.last)this.update(this.last);}
 setActiveFloor(floor:number):void{if(this.disposed||!Number.isInteger(floor)||floor<0||floor>63)return;const selected=this.binding?Math.min(floor,this.binding.floorCount-1):floor;if(this.selectedFloor===selected)return;this.selectedFloor=selected;this.staticDirty=true;if(this.last)this.update(this.last);}
 setCityVisible(visible:boolean):void{if(this.disposed||visible===this.cityVisible)return;this.cityVisible=visible;this.diagnostics.cityVisible=visible;this.staticDirty=true;if(this.last)this.update(this.last);}
 setSubject(id:string|null):void{if(id!==null&&(typeof id!=='string'||!id||id.length>160))throw new TypeError('Invalid presented subject');if(id!==this.subjectId){this.setFirstPerson(false);this.cameraVehicle=null;this.cameraVehicleActive=false;}this.subjectId=id;}
 private add(e:EntitySpec){this.scene.add({...e,renderOnly:true});return e.id;}
 private remove(ids:Iterable<string>){for(const id of ids)this.scene.remove(id);}
 private clearStatic(){this.remove(this.cityIds);this.remove(this.buildingIds);this.remove(this.liftIds);this.cityIds=[];this.buildingIds=[];this.liftIds=[];this.diagnostics.chunks=this.diagnostics.facade=this.diagnostics.core=this.diagnostics.terrainPatches=0;}
 private emitBatch(specs:EntitySpec[],destination:string[],alpha?:number){for(const e of batchStaticScenery(specs,x=>!!x.mesh&&!x.id.startsWith('canonical:terrain:'),128).slice(0,Math.max(0,MAX_STATIC_ENTITIES-destination.length))){const c=e.material?.color??[1,1,1,1];destination.push(this.add(alpha===undefined?e:{...e,material:{...e.material,color:[c[0],c[1],c[2],alpha]}}));}}
 private buildingBox(plan:CanonicalBuilding,b:CanonicalBox,prefix:string):EntitySpec{
  const c=Math.cos(plan.yaw),s=Math.sin(plan.yaw),p=this.toLocal([plan.x+c*b.x+s*b.z,plan.y+b.y,plan.z-s*b.x+c*b.z]);
  return box(prefix+b.id,p,[b.w,b.h,b.l],color(b.color),[0,plan.yaw-(this.binding?.yaw??0),0],finish(b.material));
 }
 private rebuildStatic():void{
  if(!this.staticDirty||!this.geometry||!this.binding)return;this.staticDirty=false;this.clearStatic();const g=this.geometry,b=this.binding,selected=this.selectedFloor??b.officeFloor,building=g.building;
  const nativeOffice=this.mode==='game'&&this.sceneryRenderer?.inspect().nativeOffice?.available===true;
  if(b.layoutStatus==='bound'&&!nativeOffice){const core=[...building.boxes.filter(v=>v.role==='floor'&&Math.round(v.y/b.floorHeight)===selected),...(g.officeCore?.find(f=>f.index===selected)?.boxes??[])];this.emitBatch(core.filter(validBox).map(v=>this.buildingBox(building,v,'canonical:core:')),this.liftIds);this.diagnostics.core=this.liftIds.length;}
  if(!this.cityVisible){if(!nativeOffice)this.makeLift();return;}
  if(this.mode==='game'&&!nativeOffice)this.emitBatch(building.boxes.filter(validBox).slice(0,MAX_BOXES).map(v=>this.buildingBox(building,v,'canonical:building:')),this.buildingIds);
  else if(!nativeOffice){
   const groups=new Map<string,{alpha:number;boxes:EntitySpec[]}>();
   for(const v of building.boxes.slice(0,MAX_BOXES)){
    if(!validBox(v))continue;const floor=Math.floor((v.y+.02)/b.floorHeight),nearLift=b.core.lift&&Math.abs(v.x-b.core.lift.x)<2.1&&Math.abs(v.z-b.core.lift.z)<2.6;
    if(interior(building,v)&&!(nearLift&&floor===selected&&v.role==='wall'))continue;
    const alpha=nearLift&&floor===selected ? .82 : v.role==='detail'&&v.material!==10 ? .34 : floor===selected ? .09 : .14,key=`${floor}:${alpha}`;
    let group=groups.get(key);if(!group){group={alpha,boxes:[]};groups.set(key,group);}group.boxes.push(this.buildingBox(building,v,'canonical:facade:'));
   }
   for(const {alpha,boxes}of groups.values())this.emitBatch(boxes,this.buildingIds,alpha);
  }
  this.diagnostics.facade=this.buildingIds.length;if(!nativeOffice)this.makeLift();
  if(!this.cityVisible)return;
  const specs:EntitySpec[]=this.inspectTerrain()?.available?[]:this.terrainMeshes(),seen=new Set<string>(),center=this.clipCenter;
  if(!this.sceneryRenderer)for(const p of g.nearbyBuildings.slice(0,32)){seen.add(p.id);if(Math.hypot(p.x-center[0],p.z-center[1])>CITY_VIEW_RADIUS)continue;for(const v of p.boxes.filter(validBox).slice(0,MAX_BOXES-specs.length))specs.push(this.buildingBox(p,v,'canonical:city:'));}
  for(const chunk of g.chunks.slice(0,9)){
   if(!this.sceneryRenderer){for(const p of chunk.buildings){if(seen.has(p.id)||p.id===building.id)continue;seen.add(p.id);if(Math.hypot(p.x-center[0],p.z-center[1])>CITY_VIEW_RADIUS)continue;specs.push(box(`canonical:city:chunk:${p.id}`,this.toLocal([p.x,p.y+p.h/2,p.z]),[p.w,p.h,p.l],color(p.color)));}
   for(const p of chunk.props.slice(0,128))this.prop(specs,p.id,p.kind,[p.x,p.y,p.z],p.scale,[.28,.39,.16]);}
   if(chunk.urban&&!this.urbanRenderer)this.urban(specs,chunk.urban,seen);
  }
  if(!this.urbanRenderer)this.urban(specs,g.urban,seen);
  if(!this.sceneryRenderer)for(const tree of g.trees.slice(0,512))this.prop(specs,`tree:${tree.x}:${tree.z}`,'tree',[tree.x,this.heightAt(tree.x,tree.z),tree.z],tree.h,[.28,.39,.16]);
  if(!this.inspectRoads()?.available)for(const road of g.roads.slice(0,128)){const samples=road.samples.slice(0,4096);if(samples.length<2||!samples.every(p=>finite(p))||!Number.isFinite(road.width)||road.width<=0)continue;const spans:number[][]=[],radius=128+road.width;let span:number[]=[];
   const flush=()=>{if(span.length>1)spans.push(span);span=[];};for(let i=1;i<samples.length;i++){const a=samples[i-1]!,p=samples[i]!,near=Math.max(a[0],p[0])>=center[0]-radius&&Math.min(a[0],p[0])<=center[0]+radius&&Math.max(a[2],p[2])>=center[1]-radius&&Math.min(a[2],p[2])<=center[1]+radius;if(!near){flush();continue;}if(!span.length)span.push(i-1);span.push(i);if(span.length===17){flush();span=[i];}}flush();
   for(const span of spans){const positions:number[]=[],normals:number[]=[],indices:number[]=[],base=this.toLocal(samples[span[Math.floor(span.length/2)]!]!);
    span.forEach((index,i)=>{const p=samples[index]!,a=samples[Math.max(0,index-1)]!,z=samples[Math.min(samples.length-1,index+1)]!,dx=z[0]-a[0],dz=z[2]-a[2],len=Math.hypot(dx,dz)||1;for(const side of [-1,1]){const q=this.toLocal([p[0]-side*dz/len*road.width/2,p[1]+.018,p[2]+side*dx/len*road.width/2]);positions.push(q[0]-base[0],q[1]-base[1],q[2]-base[2]);normals.push(0,1,0);}if(i){const n=i*2;indices.push(n-2,n-1,n,n,n-1,n+1);}});
    specs.push({id:`canonical:road:${road.id}:${span[0]}`,position:base,mesh:{kind:'triangle-mesh',positions,normals,indices},material:{kind:'asphalt',color:[.17,.20,.20,1]},renderOnly:true});
   }
  }
  this.emitBatch(specs.slice(0,MAX_BOXES),this.cityIds);this.diagnostics.chunks=Math.min(9,g.chunks.length);this.diagnostics.terrainPatches=this.cityIds.filter(id=>id.startsWith("canonical:terrain:")).length;
 }
 private heightAt(x:number,z:number):number{const t=this.geometry?.terrain;if(!t||t.width<2||t.depth<2||!Number.isFinite(t.step)||t.step<=0)return 0;const u=(x-t.startX)/t.step,v=(z-t.startZ)/t.step,ix=Math.min(t.width-2,Math.max(0,Math.floor(u))),iz=Math.min(t.depth-2,Math.max(0,Math.floor(v))),fx=Math.min(1,Math.max(0,u-ix)),fz=Math.min(1,Math.max(0,v-iz)),a=t.heights[iz*t.width+ix]??0,c=t.heights[(iz+1)*t.width+ix]??a,b=t.heights[iz*t.width+ix+1]??a,d=t.heights[(iz+1)*t.width+ix+1]??a;return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);}
 private terrainMeshes():EntitySpec[]{const t=this.geometry!.terrain,center=this.clipCenter;if(!Number.isInteger(t.width)||!Number.isInteger(t.depth)||t.width<2||t.depth<2||t.width>65||t.depth>65||t.heights.length!==t.width*t.depth||!finite(t.heights)||!finite([t.step,t.startX,t.startZ])||t.step<=0)return[];
  const x0=Math.max(0,Math.ceil((center[0]-128-t.startX)/t.step)),x1=Math.min(t.width-1,Math.floor((center[0]+128-t.startX)/t.step)),z0=Math.max(0,Math.ceil((center[1]-128-t.startZ)/t.step)),z1=Math.min(t.depth-1,Math.floor((center[1]+128-t.startZ)/t.step)),result:EntitySpec[]=[];
  for(let iz=z0;iz<z1;iz+=8)for(let ix=x0;ix<x1;ix+=8){const width=Math.min(8,x1-ix)+1,depth=Math.min(8,z1-iz)+1,base=this.toLocal([t.startX+ix*t.step,0,t.startZ+iz*t.step]),positions:number[]=[],normals:number[]=[],indices:number[]=[];
   for(let z=0;z<depth;z++)for(let x=0;x<width;x++){const h=t.heights[(iz+z)*t.width+ix+x]!,p=this.toLocal([t.startX+(ix+x)*t.step,h,t.startZ+(iz+z)*t.step]);positions.push(p[0]-base[0],p[1]-base[1],p[2]-base[2]);normals.push(0,1,0);if(z<depth-1&&x<width-1){const a=z*width+x;indices.push(a,a+width,a+1,a+1,a+width,a+width+1);}}
   result.push({id:`canonical:terrain:${ix}:${iz}`,position:base,mesh:{kind:'triangle-mesh',positions,normals,indices},material:{kind:'concrete',color:[.43,.45,.42,1],roughness:.95},renderOnly:true});
  }return result;
 }
 private prop(out:EntitySpec[],id:string,kind:string,absolute:Vec3,scale:number,c:Vec3){if(out.length>MAX_BOXES||!finite([...absolute,scale])||scale<=0||this.binding&&Math.hypot(absolute[0]-this.clipCenter[0],absolute[2]-this.clipCenter[1])>CITY_VIEW_RADIUS)return;const p=this.toLocal(absolute),prefix=`canonical:prop:${id}:`;if(kind==='tree'){
   out.push(box(prefix+'trunk',[p[0],p[1]+scale*.36,p[2]],[.28,scale*.72,.28],[.24,.18,.12,1]));out.push({id:prefix+'crown',position:[p[0],p[1]+scale*.76,p[2]],scale:[scale*.30,scale*.37,scale*.30],mesh:{kind:'sphere',radius:1,segments:8},material:{color:color(c)},renderOnly:true});
  }else if(kind==='lamp'){out.push(box(prefix+'post',[p[0],p[1]+2.8,p[2]],[.1,5.6,.1],[.15,.20,.22,1]),box(prefix+'head',[p[0],p[1]+5.55,p[2]+.8],[.35,.06,.48],[1,.83,.55,1]));}
  else if(kind==='bench'){out.push(box(prefix+'seat',[p[0],p[1]+.49,p[2]],[1.8,.08,.62],[.45,.30,.17,1]),box(prefix+'back',[p[0],p[1]+.83,p[2]-.31],[1.8,.55,.10],[.49,.34,.20,1]));}
  else if(kind==='rock')out.push({id:prefix+'rock',position:[p[0],p[1]+scale*.35,p[2]],scale:[scale*.65,scale*.45,scale*.55],mesh:{kind:'sphere',radius:1,segments:6},material:{color:[.43,.43,.37,1]},renderOnly:true});
  else out.push(box(prefix+'body',[p[0],p[1]+scale*.4,p[2]],[scale*.3,scale*.8,scale*.3],color(c)));
 }
 private urban(out:EntitySpec[],urban:CanonicalUrban,seen:Set<string>){for(const v of urban.boxes){if(seen.has(v.id)||!validBox(v)||out.length>=MAX_BOXES)continue;seen.add(v.id);out.push(box(`canonical:urban:${v.id}`,this.toLocal([v.x,v.y,v.z]),[v.w,v.h,v.l],color(v.color),[0,-(this.binding?.yaw??0),0],finish(v.material)));}for(const p of urban.props.slice(0,1024)){if(seen.has(p.id))continue;seen.add(p.id);this.prop(out,p.id,p.kind,[p.x,p.y,p.z],p.scale,p.color);}
  // Rounded canonical junctions retain their clipping rectangle and annulus.
  for(const arc of urban.junctions??[]){if(seen.has(arc.id)||!finite([arc.x,arc.y,arc.z,arc.inner,arc.outer,arc.start,arc.end,...arc.clip])||arc.outer<=arc.inner)continue;seen.add(arc.id);const positions:number[]=[],normals:number[]=[],indices:number[]=[];
   const clip=(poly:number[][],axis:0|1,bound:number,greater:boolean)=>{const result:number[][]=[];for(let i=0;i<poly.length;i++){const a=poly[i]!,b=poly[(i+1)%poly.length]!,ai=greater?a[axis]!>=bound:a[axis]!<=bound,bi=greater?b[axis]!>=bound:b[axis]!<=bound;if(ai)result.push(a);if(ai!==bi){const t=(bound-a[axis]!)/(b[axis]!-a[axis]!);result.push([a[0]!+(b[0]!-a[0]!)*t,a[1]!+(b[1]!-a[1]!)*t]);}}return result;};
   for(let i=0;i<8;i++){const a=arc.start+(arc.end-arc.start)*i/8,b=arc.start+(arc.end-arc.start)*(i+1)/8;let poly=[[arc.inner,a],[arc.inner,b],[arc.outer,b],[arc.outer,a]].map(([r,v])=>[arc.x+Math.cos(v!)*r!,arc.z+Math.sin(v!)*r!]);for(const [axis,bound,greater]of [[0,arc.clip[0],true],[0,arc.clip[1],false],[1,arc.clip[2],true],[1,arc.clip[3],false]] as const)poly=clip(poly,axis,bound,greater);const offset=positions.length/3;for(const p of poly){positions.push(...this.toLocal([p[0]!,arc.y+arc.h/2,p[1]!]));normals.push(0,1,0);}for(let j=1;j<poly.length-1;j++)indices.push(offset,offset+j,offset+j+1);}
   if(indices.length)out.push({id:`canonical:junction:${arc.id}`,mesh:{kind:'triangle-mesh',positions,normals,indices},material:{color:color(arc.color),kind:'concrete'},renderOnly:true});
  }
 }
 private makeLift(){const b=this.binding!,raw=b.core.lift,s=raw?{...raw,z:raw.z-(b.placement?.offsetZ??0),doorZ:raw.doorZ-(b.placement?.offsetZ??0)}:undefined;if(!s)return;const selected=this.selectedFloor??b.officeFloor;
  for(let floor=0;floor<b.floorCount;floor++){if(this.mode==='office'&&floor!==selected)continue;for(const side of [-1,1])this.liftIds.push(this.add(box(`canonical:gate:${floor}:${side}`,[s.x+side*.35,(floor-selected)*b.floorHeight+1.34,s.doorZ],[.69,2.6,.10],[.44,.51,.52,1])));}
  const parts:[string,Vec3,Vec3,Color][]=[['floor',[s.x,-.06,s.z],[s.width,.20,s.depth],[.30,.34,.33,1]],['ceiling',[s.x,2.6,s.z],[s.width,.14,s.depth],[.62,.65,.60,1]],['back',[s.x,1.3,s.z-s.depth/2+.04],[s.width,2.6,.13],[.50,.55,.53,1]]];
  for(const side of [-1,1])parts.push([`side:${side}`,[s.x+side*(s.width/2-.03),1.3,s.z],[.13,2.6,s.depth],[.53,.49,.38,1]]);
  for(const [name,p,size,c]of parts)this.liftIds.push(this.add(box(`canonical:cabin:${name}`,p,size,c)));
 }
 private inside(e:CanonicalEntity){const p=this.toLocal([e.x,e.y,e.z]),b=this.binding!;return Math.abs(p[0])<=b.width/2&&Math.abs(p[2]+(b.placement?.offsetZ??0))<=b.depth/2+.2;}
 update(frame:CanonicalFrame):void{
  if(this.disposed||frame.source!=='thegame'||frame.schema!=='thegame-office/1')return;
  if(!Number.isFinite(frame.time)||frame.time<0)return;
  const b=frame.binding;if(!finite([...b.origin,b.yaw,b.floorHeight,b.floorCount,b.width,b.depth])||b.floorHeight<=0||!Number.isInteger(b.floorCount)||b.floorCount<1||b.floorCount>64)return;
  if(this.last&&(frame.epoch!==this.last.epoch||frame.seed!==this.last.seed||frame.revision!==this.last.revision)){this.cameraVehicle=null;this.cameraVehicleActive=false;}
  this.scene.time=frame.time;
  const changed=!this.binding||this.binding.worldId!==b.worldId||this.binding.buildingId!==b.buildingId||JSON.stringify(this.binding)!==JSON.stringify(b);
  if(changed){if(this.binding&&(this.binding.worldId!==b.worldId||this.binding.buildingId!==b.buildingId)){this.clearStatic();this.geometry=null;this.geometryObject=null;this.geometryKey='';}this.binding=structuredClone(b);this.selectedFloor=Math.min(b.floorCount-1,this.selectedFloor??b.officeFloor);this.staticDirty=true;}
  this.last=frame;if(frame.geometry&&frame.geometry!==this.geometryObject){this.geometryObject=frame.geometry;const key=JSON.stringify(frame.geometry);if(key!==this.geometryKey){this.geometry=frame.geometry;this.geometryKey=key;this.staticDirty=true;}}
  if(this.geometry){const t=this.geometry.terrain;this.diagnostics.geometryKey=this.geometry.key??'';this.diagnostics.terrainBounds={minX:t.startX,minZ:t.startZ,maxX:t.startX+(t.width-1)*t.step,maxZ:t.startZ+(t.depth-1)*t.step};if(!frame.view)this.diagnostics.view='office';else if(this.geometry.key===frame.view.geometryKey)this.diagnostics.view=frame.view.kind;}
  if(!frame.view||frame.view.kind==="office")this.clipCenter=[b.origin[0],b.origin[2]];else if(this.geometry?.key===frame.view.geometryKey)this.clipCenter=[frame.view.center[0],frame.view.center[2]];
  const urbanOrigin:Vec3=[b.origin[0],b.origin[1]+(this.selectedFloor??b.officeFloor)*b.floorHeight,b.origin[2]];
  const hadRoads=this.inspectRoads()?.available??false;
  this.roadRenderer?.update(frame,{geometry:this.geometry,visible:this.cityVisible,origin:urbanOrigin,yaw:b.yaw,offsetZ:b.placement?.offsetZ??0,center:this.clipCenter,radius:SURFACE_VIEW_RADIUS});
  if(hadRoads!==(this.inspectRoads()?.available??false))this.staticDirty=true;
  this.diagnostics.roads=this.inspectRoads();
  const hadTerrain=this.inspectTerrain()?.available??false;
  this.terrainRenderer?.update(frame,{geometry:this.geometry,visible:this.cityVisible,origin:urbanOrigin,yaw:b.yaw,offsetZ:b.placement?.offsetZ??0,center:this.clipCenter,radius:SURFACE_VIEW_RADIUS});
  if(hadTerrain!==(this.inspectTerrain()?.available??false))this.staticDirty=true;
  this.diagnostics.terrainSource=this.inspectTerrain();
  this.urbanRenderer?.update(frame,{geometry:this.geometry,visible:this.cityVisible,origin:urbanOrigin,yaw:b.yaw,offsetZ:b.placement?.offsetZ??0,center:this.clipCenter,radius:CITY_VIEW_RADIUS});
  const streets=this.inspectUrban();this.diagnostics.urbanRecords=streets.records;this.diagnostics.urbanMeshes=streets.meshes;this.diagnostics.urbanGeometryBuilds=streets.geometryBuilds;
  const hadOffice=this.diagnostics.scenery?.nativeOffice?.available??false;
  this.sceneryRenderer?.update(frame,{geometry:this.geometry,visible:this.cityVisible,origin:urbanOrigin,yaw:b.yaw,offsetZ:b.placement?.offsetZ??0,center:this.clipCenter,radius:CITY_VIEW_RADIUS,officeBuilding:b.buildingId,mode:this.mode});
  if(hadOffice!==(this.sceneryRenderer?.inspect().nativeOffice?.available??false))this.staticDirty=true;
  this.rebuildStatic();
  if(this.diagnostics.terrainSource?.available)this.diagnostics.terrainPatches=this.diagnostics.terrainSource.cells;
  this.updateInteriors();
  this.diagnostics.scenery=this.inspectScenery();
  this.localMarkers=[];const visibleEntities:CanonicalEntity[]=[];
  // Exterior pedestrian detail has a view budget. Every person on the office
  // floor keeps their full identity and model, independent of this budget.
  const subject=frame.entities.find(e=>e.id===this.subjectId),focus=subject??{x:b.origin[0],z:b.origin[2]};
  const boarding=subject?.extra?.boarding as {vehicleId?:unknown}|undefined,occupied=typeof subject?.extra?.seat==='string'?subject.extra.seat:typeof boarding?.vehicleId==='string'?boarding.vehicleId:null;this.cameraVehicleActive=occupied!==null;if(occupied)this.cameraVehicle=occupied;
  const outside=new Set(frame.entities.filter(e=>(e.kind==='player'||e.kind==='pedestrian')&&!this.inside(e)).sort((a,c)=>Number(c.id===this.subjectId)-Number(a.id===this.subjectId)||Math.hypot(a.x-focus.x,a.z-focus.z)-Math.hypot(c.x-focus.x,c.z-focus.z)||a.id.localeCompare(c.id)).slice(0,this.mode==='office'?OFFICE_OUTSIDE_ACTORS:24).map(e=>e.id));
  for(const e of frame.entities.slice(0,MAX_ENTITIES)){
   if(!finite([e.x,e.y,e.z,e.yaw,e.vx,e.vy,e.vz,e.phase]))continue;
   const inside=this.inside(e),floor=Math.floor((e.y-b.origin[1]+.06)/b.floorHeight);
   if(!this.cityVisible&&!inside&&e.id!==this.subjectId||this.mode==='office'&&inside&&floor!==(this.selectedFloor??b.officeFloor))continue;
   if(e.kind==='vehicle'){if(this.cityVisible)visibleEntities.push(e);continue;}
   if(e.kind!=='player'&&e.kind!=='pedestrian'&&e.kind!=='ragdoll'||e.extra?.alive===false&&e.kind!=='ragdoll'||!inside&&!outside.has(e.id)&&e.kind!=='ragdoll')continue;
   visibleEntities.push(e);if(inside||e.kind==='player'){const p=this.toLocal([e.x,e.y,e.z]);this.localMarkers.push({id:e.id,position:[p[0],p[1]+2.02,p[2]],name:typeof e.extra?.name==='string'?e.extra.name:e.kind==='player'?'Игрок':'Житель'});}
  }
  const floor=this.selectedFloor??b.officeFloor,origin:Vec3=[b.origin[0],b.origin[1]+floor*b.floorHeight,b.origin[2]];
  this.actorRenderer?.update(frame,visibleEntities,{origin,yaw:b.yaw,offsetZ:b.placement?.offsetZ??0,focus:subject?[subject.x,subject.y,subject.z]:[b.origin[0],origin[1],b.origin[2]],...(subject?{subjectId:subject.id}:{}),groundAt:(x,y,z)=>{
   const p=this.toLocal([x,y,z]),hit=this.groundQuery.cast(p,[0,-1,0],6,e=>!e.id.startsWith('actor/')&&!this.isActorMesh(e.id)&&!(this.surfaceRenderer?.isEffectMesh(e.id)??false)&&e.material.color[3]>=.5);return hit?hit.point[1]+origin[1]:null;
  }});
  this.surfaceRenderer?.update(frame,{origin,yaw:b.yaw,offsetZ:b.placement?.offsetZ??0,focus:subject?[subject.x,subject.y,subject.z]:[b.origin[0],origin[1],b.origin[2]],visible:this.cityVisible});this.diagnostics.surfaceEffects=this.surfaceRenderer?.inspect()??null;
  this.actorRenderer?.setHiddenOwner?.(this.hiddenSubject);const assets=this.actorRenderer?.inspect();this.diagnostics.actors=assets?.actors??0;this.diagnostics.traffic=assets?.vehicles??0;this.diagnostics.assetMeshes=assets?.meshes??0;this.diagnostics.assetGeometryBuilds=assets?.geometryBuilds??0;this.diagnostics.subjectPresent=this.subjectId!==null&&(this.actorRenderer?.hasActor(this.subjectId)??false);this.diagnostics.subjectVisible=this.diagnostics.subjectPresent&&!this.diagnostics.subjectFirstPerson;
  const lift=frame.lifts.find(l=>l.id===b.buildingId),raw=b.core.lift,s=raw?{...raw,z:raw.z-(b.placement?.offsetZ??0),doorZ:raw.doorZ-(b.placement?.offsetZ??0)}:undefined,selected=this.selectedFloor??b.officeFloor;if(lift&&s){for(let floor=0;floor<b.floorCount;floor++)for(const side of [-1,1]){const id=`canonical:gate:${floor}:${side}`;if(this.scene.entities.has(id))this.scene.setVisualTransform(id,[s.x+side*(.35+(floor===lift.floor?lift.door:0)*.70),(floor-selected)*b.floorHeight+1.34,s.doorZ]);}for(const id of this.liftIds){if(!id.startsWith('canonical:cabin:'))continue;const entity=this.scene.entities.get(id)!;this.scene.setVisualTransform(id,[entity.position[0],lift.elevation-selected*b.floorHeight+(id.endsWith(':floor')?-.06:id.endsWith(':ceiling')?2.6:1.3),entity.position[2]]);}}
  const env=frame.environment,v=env.visual,celestial=env.celestial,azimuth=celestial?.azimuth??env.sunAzimuth,elevation=celestial?.elevation??v.sunElevation,intensity=celestial?.intensity??v.sunIntensity,sunColor:Vec3=celestial?.color??[1,.95,.85],sun:Vec3=[Math.sin(azimuth-b.yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth-b.yaw)*Math.cos(elevation)],sky:Vec3=[.18*v.skyIntensity,.29*v.skyIntensity,.43*v.skyIntensity],lighting=[...sun.map(n=>Math.round(n*100)),...sunColor.map(n=>Math.round(n*100)),Math.round(intensity*100),Math.round(v.skyIntensity*100),Math.round(v.fogDensity*10000)].join(':');const sourceLighting=this.lightingSource?.(frame,b.yaw),lightKey=sourceLighting?JSON.stringify(sourceLighting):lighting;this.diagnostics.lightingSource=sourceLighting?'thegame':'legacy';this.diagnostics.lighting=sourceLighting??null;if(lightKey!==this.lightingKey){this.lightingKey=lightKey;this.scene.patchAppearance({rendering:sourceLighting??{sunDirection:sun,sunColor,sunIntensity:intensity,skyColor:sky,ambientIrradiance:[.23*v.skyIntensity,.27*v.skyIntensity,.28*v.skyIntensity],fogDensity:v.fogDensity,shadowExtent:90}});this.diagnostics.lightingUpdates++;}
  const c=Math.cos(b.yaw),sine=Math.sin(b.yaw),wind:Vec3=[c*frame.air.wind[0]-sine*frame.air.wind[1],0,sine*frame.air.wind[0]+c*frame.air.wind[1]];this.scene.environment=resolveEnvironmentAt({temperatureC:frame.air.temperatureC,humidity:frame.weather.humidity,wind:[wind[0],0,wind[2]],groundMoisture:frame.weather.wetness,precipitation:frame.weather.rain>.4?'frequent':frame.weather.rain>.01?'occasional':'rare',snowfall:(env.snow??0)>.7?'heavy':(env.snow??0)>.3?'moderate':(env.snow??0)>.01?'light':'none',sunlight:Math.max(0,Math.min(1,v.sunIntensity/4.2)),clock:{startHour:(frame.worldMinute%1440)/60,hoursPerSecond:0}},0);const rendering={facadeNight:Math.max(0,Math.min(1,v.artificialLightIntensity)),surfaceWeather:{rain:env.rain,origin:[c*origin[0]-sine*origin[2],origin[1],sine*origin[0]+c*origin[2]+(b.placement?.offsetZ??0)] as Vec3,litter:true,groundWind:[wind[0],wind[2]] as readonly[number,number]}},weatherKey=JSON.stringify(rendering);if(weatherKey!==this.weatherKey){this.scene.patchAppearance({rendering});this.weatherKey=weatherKey;}this.diagnostics.presentedTime=frame.time;
 }
 markers(){return this.localMarkers;}
 dispose():void{if(this.disposed)return;this.disposed=true;this.surfaceRenderer?.dispose();this.surfaceRenderer=null;this.surfaceFactory=undefined;this.diagnostics.surfaceEffects=null;this.clearStatic();this.actorRenderer?.dispose();this.actorRenderer=null;this.urbanRenderer?.dispose();this.urbanRenderer=null;this.sceneryRenderer?.dispose();this.sceneryRenderer=null;this.roadRenderer?.dispose();this.roadRenderer=null;this.terrainRenderer?.dispose();this.terrainRenderer=null;this.geometry=null;this.geometryObject=null;this.last=null;this.localMarkers=[];this.diagnostics.actors=this.diagnostics.traffic=this.diagnostics.assetMeshes=this.diagnostics.urbanRecords=this.diagnostics.urbanMeshes=0;}

}
