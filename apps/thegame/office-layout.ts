import type {OfficeObject, OfficeState} from './shared.js';

export type Bounds = {id:string;x:number;z:number;width:number;depth:number;height:number;rotation:number;kind:string;baseY?:number};
export type Opening = {id:string;objectId?:string;kind:'window'|'door';center:number;width:number;sill:number;height:number;color:string};
export type Wall = Bounds & {ownerId?:string;color:string;visibleHeight:number;glass:boolean;openings:Opening[]};
export type WallSolid = Bounds & {ownerId?:string;wallId:string};
export type OfficeLayout = {walls:Wall[];solids:WallSolid[];obstacles:Bounds[];corridors:Bounds[];objects:Map<string,Bounds>;entrances:Map<string,Bounds>;width?:number;depth?:number};
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
export const corridorWidth=1.65;
export function objectBounds(o:OfficeObject):Bounds {
 const sizes:Record<string,[number,number,number]>={desk:[2.45,1.35,1.7],chair:[.90,.90,1.4],beanbag:[1.45,1.45,.95],kitchen:[5.6,1.5,2.4],plant:[.88,.88,1.7],sofa:[3.1,1.2,1.2],table:[3.2,1.7,1.05],wall:[4,.18,2.8],window:[2.8,.18,2.75],door:[1.5,.20,2.7],corridor:[6,2,.13],room:[7,5,.12],server:[1.25,.95,2.2],aquarium:[2.4,.8,1.9],pet:[.85,.65,.65]};
 const [w,d,h]=sizes[o.kind]??[1,1,1];
 return{id:o.id,kind:o.kind,x:o.x,z:o.z,width:o.width??w,depth:o.depth??d,height:o.height??h,rotation:(o.rotation||0)*Math.PI/180};
}
export function localPoint(b:Bounds,x:number,z:number){return{x:b.x+Math.cos(b.rotation)*x+Math.sin(b.rotation)*z,z:b.z-Math.sin(b.rotation)*x+Math.cos(b.rotation)*z};}
export function toLocal(b:Bounds,p:{x:number;z:number}){const dx=p.x-b.x,dz=p.z-b.z;return{x:Math.cos(b.rotation)*dx-Math.sin(b.rotation)*dz,z:Math.sin(b.rotation)*dx+Math.cos(b.rotation)*dz};}
/** Visibility uses the same cut walls and real apertures as rendering. */
export function architectureOccludes(layout:OfficeLayout,origin:readonly[number,number,number],target:readonly[number,number,number]){
 for(const solid of layout.solids){
  const wall=layout.walls.find(w=>w.id===solid.wallId)!,base=solid.baseY??0;
  let height=Math.min(solid.height,wall.visibleHeight-base);if(wall.glass&&base<.8&&height>.8)height=.8-base;if(height<=0)continue;
  const a=toLocal(solid,{x:origin[0],z:origin[2]}),b=toLocal(solid,{x:target[0],z:target[2]}),p=[a.x,origin[1],a.z],d=[b.x-a.x,target[1]-origin[1],b.z-a.z],lo=[-solid.width/2,base,-solid.depth/2],hi=[solid.width/2,base+height,solid.depth/2];
  let near=0,far=1;
  for(let i=0;i<3;i++){if(Math.abs(d[i]!)<1e-8){if(p[i]!<lo[i]!||p[i]!>hi[i]!){near=2;break;}continue;}let x=(lo[i]!-p[i]!)/d[i]!,y=(hi[i]!-p[i]!)/d[i]!;if(x>y)[x,y]=[y,x];near=Math.max(near,x);far=Math.min(far,y);if(near>far)break;}
  if(near<=far&&near<.99)return true;
 }
 return false;
}
export function ringThickness(b:Bounds){return Math.min(1.15,Math.min(b.width,b.depth)*.18);}
export function inCorridor(b:Bounds,p:{x:number;z:number}){
 const q=toLocal(b,p),rx=b.width/2,rz=b.depth/2;
 if(b.kind!=='ring')return Math.abs(q.x)<=rx&&Math.abs(q.z)<=rz;
 const t=ringThickness(b);return(q.x/rx)**2+(q.z/rz)**2<=1&&(q.x/(rx-t))**2+(q.z/(rz-t))**2>=1;
}
function nearestPath(b:Bounds,p:{x:number;z:number}){
 const q=toLocal(b,p);
 if(b.kind!=='ring')return localPoint(b,clamp(q.x,-b.width/2,b.width/2),0);
 const t=ringThickness(b),rx=(b.width-t)/2,rz=(b.depth-t)/2;let best=localPoint(b,rx,0),cost=Infinity;
 for(let i=0;i<96;i++){const a=i*Math.PI*2/96,point=localPoint(b,rx*Math.cos(a),rz*Math.sin(a)),d=distance(point,p);if(d<cost){cost=d;best=point;}}
 return best;
}
function fitOpening(wall:Wall,center:number,width:number):{center:number;width:number}|null {
 let ranges:[number,number][]=[[-wall.width/2+.16,wall.width/2-.16]];
 for(const opening of wall.openings){const lo=opening.center-opening.width/2-.18,hi=opening.center+opening.width/2+.18;ranges=ranges.flatMap(([a,b])=>hi<=a||lo>=b?[[a,b] as [number,number]]:([[a,Math.min(b,lo)],[Math.max(a,hi),b]] as [number,number][]).filter(([a,b])=>b-a>.3));}
 let best:{center:number;width:number}|null=null,cost=Infinity;
 for(const [lo,hi]of ranges){const w=Math.min(width,hi-lo);if(w<.55)continue;const x=clamp(center,lo+w/2,hi-w/2),score=Math.abs(x-center)+(width-w)*3;if(score<cost){cost=score;best={center:x,width:w};}}
 return best;
}
function wallSolids(wall:Wall):WallSolid[]{
 const result:WallSolid[]=[];let cursor=-wall.width/2;
 const add=(x:number,width:number,baseY:number,height:number)=>{if(width<.001||height<.001)return;const p=localPoint(wall,x,0);result.push({id:`${wall.id}:solid:${result.length}`,wallId:wall.id,...(wall.ownerId?{ownerId:wall.ownerId}:{}),kind:'wall',...p,width,depth:wall.depth,height,baseY,rotation:wall.rotation});};
 for(const opening of [...wall.openings].sort((a,b)=>a.center-b.center)){
  const left=opening.center-opening.width/2,right=opening.center+opening.width/2;
  add((cursor+left)/2,left-cursor,0,wall.height);add(opening.center,opening.width,0,opening.sill);add(opening.center,opening.width,opening.sill+opening.height,wall.height-opening.sill-opening.height);cursor=right;
 }
 add((cursor+wall.width/2)/2,wall.width/2-cursor,0,wall.height);return result;
}
/** Shared construction plan: openings cut their host walls; corridors reach
 * room entrances; the same solids drive rendering, navigation and picking. */
export function buildOfficeLayout(state:OfficeState):OfficeLayout {
 const authored=state.objects.filter(o=>o.floor===state.activeFloor),objects=new Map(authored.map(o=>[o.id,objectBounds(o)])),walls:Wall[]=[],entrances=new Map<string,Bounds>();
 const byId=new Map(authored.map(o=>[o.id,o]));
 const resolve=(id:string):Bounds=>{const o=byId.get(id)!,b=objectBounds(o);if(o.parent){const p=resolve(o.parent);return{...b,...localPoint(p,b.x,b.z),rotation:p.rotation+b.rotation};}return b;};
 for(const o of authored)objects.set(o.id,resolve(o.id));
 const paper=state.floors.find(f=>f.id===state.activeFloor)?.wallpaper??'ivory';
 const addWall=(id:string,x:number,z:number,width:number,rotation:number,color:string,ownerId?:string,visibleHeight=3.1,glass=false):Wall=>{const wall:Wall={id,kind:'wall',x,z,width,depth:.18,height:3.1,rotation,color,visibleHeight,glass,openings:[],...(ownerId?{ownerId}:{})};walls.push(wall);return wall;};
 const width=state.placement?.width??28,depth=state.placement?.depth??20,halfX=width/2-.12,halfZ=depth/2-.12;
 const rear=addWall('shell:rear',0,-halfZ,width-.24,0,paper),west=addWall('shell:west',-halfX,0,depth-.24,Math.PI/2,paper);
 addWall('shell:front',0,halfZ,width-.24,0,paper,undefined,.22);addWall('shell:east',halfX,0,depth-.24,Math.PI/2,paper,undefined,.22);
 // The lift occupies this bay; glazing must never overlap its structural core.
 rear.openings.push({id:'shell:lift',kind:'door',center:0,width:state.placement?.entryWidth??3.85,sill:0,height:3.0,color:'graphite'});
 const corridors:Bounds[]=authored.filter(o=>o.kind==='corridor').map(o=>({...objects.get(o.id)!,kind:o.shape==='ring'?'ring':'corridor'}));
 for(const o of authored.filter(o=>o.kind==='corridor'&&o.from&&o.to)){
  const a=objects.get(o.from!)!,b=objects.get(o.to!)!,path=corridors.find(c=>c.id===o.id)!;
  const anchor=(room:Bounds,other:Bounds)=>{const q=toLocal(room,other),t=Math.min((room.width/2)/Math.max(.001,Math.abs(q.x)),(room.depth/2)/Math.max(.001,Math.abs(q.z)));return localPoint(room,q.x*t,q.z*t);};
  const p=anchor(a,b),q=anchor(b,a),dx=q.x-p.x,dz=q.z-p.z;
  Object.assign(path,{x:(p.x+q.x)/2,z:(p.z+q.z)/2,width:Math.max(.2,Math.hypot(dx,dz)+.6),depth:o.depth??corridorWidth,rotation:Math.atan2(-dz,dx)});objects.set(o.id,{...path});
 }
 for(const o of authored.filter(o=>o.kind==='wall')){const b=objects.get(o.id)!,w=addWall(`object/${o.id}:wall`,b.x,b.z,b.width,b.rotation,o.color,o.id,b.height);w.height=b.height;w.depth=b.depth;}
 for(const o of authored.filter(o=>o.kind==='room')){
  const b=objects.get(o.id)!,roomWalls=[
   {side:'north',x:0,z:-b.depth/2,width:b.width,rotation:0,height:3.1},
   {side:'east',x:b.width/2,z:0,width:b.depth,rotation:Math.PI/2,height:1.0},
   {side:'south',x:0,z:b.depth/2,width:b.width,rotation:0,height:1.0},
   {side:'west',x:-b.width/2,z:0,width:b.depth,rotation:Math.PI/2,height:3.1},
  ].map(edge=>{const p=localPoint(b,edge.x,edge.z);return addWall(`room/${o.id}:${edge.side}`,p.x,p.z,edge.width,b.rotation+edge.rotation,o.color,o.id,edge.height,/переговор|meeting/i.test(o.label)&&edge.side==='west');});
  let door:{wall:Wall;center:number;path:{x:number;z:number};point:{x:number;z:number};score:number}|null=null;
  for(const wall of roomWalls)for(const corridor of corridors){const path=nearestPath(corridor,wall),center=clamp(toLocal(wall,path).x,-wall.width/2+1.02,wall.width/2-1.02),point=localPoint(wall,center,0),score=distance(point,path);if(!door||score<door.score)door={wall,center,path,point,score};}
  if(door){
   const fitted=fitOpening(door.wall,door.center,Math.min(1.7,door.wall.width-.5));
   if(fitted){door.wall.openings.push({id:`room/${o.id}:entrance`,kind:'door',...fitted,sill:0,height:2.4,color:'ivory'});
    const point=localPoint(door.wall,fitted.center,0),entry:Bounds={id:o.id,kind:'entrance',...point,width:fitted.width,depth:.18,height:2.4,rotation:door.wall.rotation};entrances.set(o.id,entry);
    const dx=point.x-door.path.x,dz=point.z-door.path.z,length=Math.hypot(dx,dz);
    if(length>.08)corridors.push({id:`connection/${o.id}`,kind:'corridor',x:(point.x+door.path.x)/2,z:(point.z+door.path.z)/2,width:length+.32,depth:corridorWidth,height:.06,rotation:Math.atan2(-dz,dx)});
   }
  }
 }
 for(const o of authored.filter(o=>o.kind==='window'||o.kind==='door')){
  const b=objects.get(o.id)!,exterior=walls.filter(w=>w.id.startsWith('shell:')&&Math.abs(toLocal(w,b).z)<2.6),hosts=(o.host?walls.filter(w=>w.id===o.host||w.ownerId===o.host&&w.id.startsWith('object/')):exterior.length?exterior:walls).map(w=>({wall:w,q:toLocal(w,b)})).sort((a,b)=>Math.abs(a.q.z)+Math.max(0,Math.abs(a.q.x)-a.wall.width/2)-Math.abs(b.q.z)-Math.max(0,Math.abs(b.q.x)-b.wall.width/2));
  for(const {wall,q}of hosts){const fitted=fitOpening(wall,q.x,b.width);if(!fitted)continue;
   if(o.kind==='window')wall.visibleHeight=Math.max(wall.visibleHeight,3.1);
   const sill=o.kind==='window'?.9:0,height=o.kind==='window'?Math.min(b.height-sill,wall.height-sill-.20):Math.min(b.height,wall.height-.18);
   wall.openings.push({id:`object/${o.id}`,objectId:o.id,kind:o.kind as 'window'|'door',...fitted,sill,height:Math.max(.25,height),color:o.color});
   objects.set(o.id,{...b,...localPoint(wall,fitted.center,0),width:fitted.width,depth:wall.depth,rotation:wall.rotation});break;
  }
 }
 // Unauthored facade bays belong to the shell, rather than duplicate editable
 // windows. Editable rear windows above are the only glazing on that facade.
 for(const center of [-7.2,-2.8,1.6,6.0]){const fitted=fitOpening(west,center,3.2);if(fitted)west.openings.push({id:`shell:west:window:${center}`,kind:'window',...fitted,sill:.9,height:1.85,color:'ivory'});}
 const solids=walls.flatMap(wallSolids),obstacles:Bounds[]=solids.filter(s=>(s.baseY??0)<1.95);
 for(const wall of walls)for(const o of wall.openings)if(o.kind==='window')obstacles.push({id:o.id,kind:'window',...localPoint(wall,o.center,0),width:o.width,depth:wall.depth,height:wall.height,rotation:wall.rotation});
 for(const ring of corridors.filter(c=>c.kind==='ring')){const r=Math.min(ring.width/2,ring.depth/2)-ringThickness(ring)-.18;obstacles.push({id:`${ring.id}:garden`,kind:'island',x:ring.x,z:ring.z,width:r*2,depth:r*2,height:.4,rotation:ring.rotation});}
 return{walls,solids,obstacles,corridors,objects,entrances,width,depth};
}

/** Shared logical collision envelopes for both game visitors and Office routes. */
export function officeObstacles(layout:OfficeLayout,state:OfficeState,ignored:ReadonlySet<string>=new Set()):Bounds[]{
 const solid=[...layout.obstacles.filter(b=>!ignored.has(b.id)),...[...layout.objects.values()].filter(b=>!ignored.has(b.id)&&!['room','corridor','door','window','wall'].includes(b.kind))];
 for(const room of state.objects.filter(o=>o.floor===state.activeFloor&&o.kind==='room')){
  const b=layout.objects.get(room.id)!;
  if(/кух|kitchen|cafe/i.test(room.label)){const p={x:b.x+Math.sin(b.rotation)*(-b.depth/2+.65),z:b.z+Math.cos(b.rotation)*(-b.depth/2+.65)};solid.push({...b,...p,id:room.id+':counter',kind:'wall',width:Math.max(.7,Math.min(b.width-1.25,5.6)),depth:1.15,height:1.12});}
  else if(/лаунж|lounge|отдых/i.test(room.label)){const p={x:b.x+Math.cos(b.rotation)*(b.width/2-.28),z:b.z-Math.sin(b.rotation)*(b.width/2-.28)};solid.push({...b,...p,id:room.id+':shelf',kind:'wall',width:.38,depth:Math.min(2.6,b.depth-.5),height:2.35});}
 }
 return solid;
}

