/** Recovered from game-engine 9c564556275b1a50b366e92034910ade90b68986; current Engine adapter. */
import {hash32} from './world.js';

export type TransitMode='bus'|'tram'|'metro';
export type TransitPassengerState='waiting'|'boarding'|'riding'|'alighting';
export type TransitServicePhase='run'|'dwell';

export interface TransitStop {
 readonly id:string;
 readonly routeId:string;
 readonly index:number;
 readonly name:string;
 readonly position:readonly[number,number,number];
}
export interface TransitRoute {
 readonly id:string;
 readonly mode:TransitMode;
 readonly name:string;
 readonly color:readonly[number,number,number];
 readonly capacity:number;
 readonly cruiseMps:number;
 readonly dwellSeconds:number;
 readonly stops:readonly TransitStop[];
 readonly segmentMeters:readonly number[];
 readonly cycleSeconds:number;
 readonly headwaySeconds:number;
}
export interface TransitPassenger {
 readonly residentId:string;
 readonly routeId:string;
 readonly originStop:string;
 readonly destinationStop:string;
 state:TransitPassengerState;
 serviceId?:string;
 transitionStarted?:number;
 transitionStop?:string;
}
export interface TransitPassengerPose {
 readonly residentId:string;
 readonly state:TransitPassengerState;
 readonly routeId:string;
 readonly serviceId?:string;
 readonly position:readonly[number,number,number];
 readonly yaw:number;
 readonly speed:number;
 readonly progress:number;
}
export interface TransitServicePose {
 readonly position:readonly[number,number,number];
 readonly yaw:number;
 readonly speed:number;
}
export interface TransitServiceState {
 readonly id:string;
 readonly routeId:string;
 readonly mode:TransitMode;
 readonly phase:TransitServicePhase;
 readonly doors:number;
 readonly position:readonly[number,number,number];
 readonly yaw:number;
 readonly currentStop:number;
 readonly nextStop:number;
 readonly passengers:number;
 readonly capacity:number;
 readonly scheduledSeconds:number;
}

const START_HOUR_SECONDS=8*3600;
const SERVICE_COUNT=2;
const BOARD_SECONDS=1.2;
const ALIGHT_SECONDS=1.0;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const dist=(a:readonly[number,number,number],b:readonly[number,number,number])=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const wrap=(v:number,n:number)=>((v%n)+n)%n;
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const loopSegments=(stops:readonly TransitStop[])=>Object.freeze(stops.map((stop,i)=>dist(stop.position,stops[(i+1)%stops.length]!.position)));
const route=(input:Omit<TransitRoute,'segmentMeters'|'cycleSeconds'|'headwaySeconds'>):TransitRoute=>{
 const segmentMeters=loopSegments(input.stops);
 const travel=segmentMeters.reduce((n,m)=>n+m/input.cruiseMps,0);
 const cycleSeconds=Math.ceil((travel+input.stops.length*input.dwellSeconds)/10)*10;
 return Object.freeze({...input,segmentMeters,cycleSeconds,headwaySeconds:cycleSeconds/SERVICE_COUNT});
};
const stops=(routeId:string,names:readonly string[],points:readonly(readonly[number,number,number])[]):readonly TransitStop[]=>Object.freeze(
 points.map((position,index)=>Object.freeze({id:`${routeId}-S${index+1}`,routeId,index,name:names[index]!,position}))
);

/** Preserves the old fictional local network: two road loops plus tram and metro.
 * Routes are causal data. Physical vehicles materialize from service state later. */
export const THEGAME_TRANSIT_ROUTES:readonly TransitRoute[]=Object.freeze([
 route({
  id:'B01',mode:'bus',name:'Городское кольцо',color:[.10,.49,.44],capacity:68,cruiseMps:8,dwellSeconds:14,
  stops:stops('B01',['Западный проспект','Набережная','Университет','Музей','Порт','Южный мост','Вокзал','Парк'],[
   [-320,0,-64],[-128,0,-64],[64,0,-64],[256,0,-64],[320,0,128],[128,0,256],[-128,0,256],[-320,0,128],
  ]),
 }),
 route({
  id:'B02',mode:'bus',name:'Тоннель — Мастерские',color:[.68,.30,.14],capacity:68,cruiseMps:8,dwellSeconds:14,
  stops:stops('B02',['Вокзальная','Мастерские','Депо','Архитекторов','Парк','Тоннель / юг','Рынок','Университет'],[
   [-256,0,-192],[-64,0,-256],[192,0,-256],[320,0,-64],[256,0,192],[32,0,320],[-192,0,256],[-320,0,32],
  ]),
 }),
 route({
  id:'T01',mode:'tram',name:'Трамвай · Западное кольцо',color:[.72,.28,.12],capacity:84,cruiseMps:8.8,dwellSeconds:18,
  stops:stops('T01',['Вокзал','Мастерские','Архитекторов','Парк'],[
   [-256,0,-128],[-64,0,128],[-256,0,256],[-448,0,64],
  ]),
 }),
 route({
  id:'M01',mode:'metro',name:'Метро · Городское кольцо',color:[.18,.47,.78],capacity:180,cruiseMps:15,dwellSeconds:22,
  stops:stops('M01',['Северная','Западная','Портовая','Университет'],[
   [-240,-18,0],[-240,-18,245],[240,-18,245],[240,-18,-245],
  ]),
 }),
]);

const routeById=new Map(THEGAME_TRANSIT_ROUTES.map(r=>[r.id,r]));
const stopById=new Map(THEGAME_TRANSIT_ROUTES.flatMap(r=>r.stops).map(s=>[s.id,s]));

function scheduleOffsets(route:TransitRoute):readonly{arrival:number;departure:number}[]{
 let elapsed=0;
 return Object.freeze(route.stops.map((_,i)=>{
  if(i>0)elapsed+=route.segmentMeters[i-1]!/route.cruiseMps;
  const arrival=elapsed,departure=arrival+route.dwellSeconds;elapsed=departure;
  return Object.freeze({arrival,departure});
 }));
}
const schedules=new Map(THEGAME_TRANSIT_ROUTES.map(r=>[r.id,scheduleOffsets(r)]));

export function transitServiceTime(seconds:number):string{
 if(!Number.isFinite(seconds))throw new RangeError('Invalid service time');
 const t=wrap(Math.floor(seconds)+START_HOUR_SECONDS,86400);
 return [Math.floor(t/3600),Math.floor((t%3600)/60),t%60].map(v=>String(v).padStart(2,'0')).join(':');
}

export class TransitAuthority {
 private readonly passengers=new Map<string,TransitPassenger>();
 private boarded=0;
 private alighted=0;
 readonly routes=THEGAME_TRANSIT_ROUTES;

 constructor(options:{seedDemand?:boolean}={}){
  if(options.seedDemand!==false)this.seedDemand();
 }

 private queue(residentId:string,route:TransitRoute,origin:TransitStop,destination:TransitStop):TransitPassenger{
  const passenger:TransitPassenger={residentId,routeId:route.id,originStop:origin.id,destinationStop:destination.id,state:'waiting'};
  this.passengers.set(residentId,passenger);return passenger;
 }

 private seedDemand():void{
  const used=new Set<string>();
  for(const route of this.routes)for(const origin of route.stops){
   const destination=route.stops[(origin.index+1+hash32(origin.index,route.id.charCodeAt(0),route.id.charCodeAt(1),29)%Math.max(1,route.stops.length-1))%route.stops.length]!;
   const cx=Math.floor(origin.position[0]/128),cz=Math.floor(origin.position[2]/128);
   for(let slot=0;slot<4;slot++){
    const id=`crowd:${cx}:${cz}:${slot}`;
    if(used.has(id))continue;used.add(id);this.queue(id,route,origin,destination);break;
   }
  }
 }

 private service(route:TransitRoute,slot:number,timeSeconds:number):TransitServiceState{
  const id=`${route.id}:${slot}`,offset=slot*route.headwaySeconds;
  const local=wrap(timeSeconds+offset,route.cycleSeconds),schedule=schedules.get(route.id)!;
  let cursor=0;
  for(let i=0;i<route.stops.length;i++){
   const call=schedule[i]!;
   if(local>=call.arrival&&local<call.departure){
    const stop=route.stops[i]!;
    return{id,routeId:route.id,mode:route.mode,phase:'dwell',doors:1,position:stop.position,yaw:0,currentStop:i,nextStop:(i+1)%route.stops.length,passengers:this.onboard(id),capacity:route.capacity,scheduledSeconds:local};
   }
   if(local>=call.departure)cursor=i;
  }
  const fromIndex=cursor,toIndex=(fromIndex+1)%route.stops.length,from=route.stops[fromIndex]!,to=route.stops[toIndex]!;
  const depart=schedule[fromIndex]!.departure;
  const arrival=toIndex===0?route.cycleSeconds: schedule[toIndex]!.arrival;
  const t=clamp((local-depart)/(arrival-depart),0,1);
  const dx=to.position[0]-from.position[0],dz=to.position[2]-from.position[2];
  return{id,routeId:route.id,mode:route.mode,phase:'run',doors:0,
   position:[mix(from.position[0],to.position[0],t),mix(from.position[1],to.position[1],t),mix(from.position[2],to.position[2],t)],
   yaw:Math.atan2(dx,dz),currentStop:fromIndex,nextStop:toIndex,passengers:this.onboard(id),capacity:route.capacity,scheduledSeconds:local};
 }

 services(timeSeconds:number):readonly TransitServiceState[]{
  if(!Number.isFinite(timeSeconds)||timeSeconds<0)throw new RangeError('Invalid transit clock');
  return Object.freeze(this.routes.flatMap(route=>Array.from({length:SERVICE_COUNT},(_,slot)=>this.service(route,slot,timeSeconds))));
 }

 private onboard(serviceId:string):number{
  let n=0;
  for(const passenger of this.passengers.values())if(
   passenger.serviceId===serviceId&&
   (passenger.state==='boarding'||passenger.state==='riding'||passenger.state==='alighting')
  )n++;
  return n;
 }
 private waiting(stopId:string,routeId:string):TransitPassenger[]{
  return [...this.passengers.values()].filter(p=>p.state==='waiting'&&p.originStop===stopId&&p.routeId===routeId).sort((a,b)=>a.residentId.localeCompare(b.residentId));
 }

 plan(residentId:string,from:readonly[number,number],to:readonly[number,number]):TransitPassenger|undefined{
  if(!residentId)throw new TypeError('Resident identity required');
  let best:{route:TransitRoute;origin:TransitStop;destination:TransitStop;cost:number}|undefined;
  for(const route of this.routes){
   if(route.mode==='metro'&&Math.max(Math.hypot(...from),Math.hypot(...to))>1200)continue;
   for(const origin of route.stops)for(const destination of route.stops){
    if(origin===destination)continue;
    const walk=Math.hypot(origin.position[0]-from[0],origin.position[2]-from[1])+Math.hypot(destination.position[0]-to[0],destination.position[2]-to[1]);
    const hops=wrap(destination.index-origin.index,route.stops.length),ride=Array.from({length:hops},(_,i)=>route.segmentMeters[(origin.index+i)%route.stops.length]!).reduce((a,b)=>a+b,0);
    const cost=walk+ride*.18+(route.mode==='metro'?80:route.mode==='tram'?45:20);
    if(!best||cost<best.cost)best={route,origin,destination,cost};
   }
  }
  if(!best||best.cost>900)return;
  return this.queue(residentId,best.route,best.origin,best.destination);
 }

 cancel(residentId:string):void{this.passengers.delete(residentId);}
 passenger(residentId:string):Readonly<TransitPassenger>|undefined{const p=this.passengers.get(residentId);return p?Object.freeze({...p}):undefined;}
 hasResident(residentId:string):boolean{return this.passengers.has(residentId);}
 ownedResidentIds():ReadonlySet<string>{return new Set(this.passengers.keys());}
 ridingCandidate(excluded:ReadonlySet<string>=new Set()):Readonly<TransitPassenger>|undefined{
  const priority:Record<TransitMode,number>={bus:0,tram:1,metro:2};
  const found=[...this.passengers.values()]
   .filter(p=>p.state==='riding'&&p.serviceId&&!excluded.has(p.residentId))
   .sort((a,b)=>{
    const am=routeById.get(a.routeId)?.mode??'metro',bm=routeById.get(b.routeId)?.mode??'metro';
    return priority[am]-priority[bm]||a.residentId.localeCompare(b.residentId);
   })[0];
  return found?Object.freeze({...found}):undefined;
 }
 serviceForPassenger(residentId:string,timeSeconds:number):TransitServiceState|undefined{
  const passenger=this.passengers.get(residentId);if(passenger?.state!=='riding'||!passenger.serviceId)return;
  return this.services(timeSeconds).find(service=>service.id===passenger.serviceId);
 }
 serviceForTransitResident(residentId:string,timeSeconds:number):TransitServiceState|undefined{
  const passenger=this.passengers.get(residentId);if(!passenger?.serviceId)return;
  return this.services(timeSeconds).find(service=>service.id===passenger.serviceId);
 }
 passengersState():readonly Readonly<TransitPassenger>[]{
  return Object.freeze([...this.passengers.values()].sort((a,b)=>a.residentId.localeCompare(b.residentId)).map(p=>Object.freeze({...p})));
 }
 private residentOrdinal(id:string):number{
  const match=/^crowd:(-?\d+):(-?\d+):(\d+)$/.exec(id);
  return match?hash32(Number(match[1]),Number(match[2]),Number(match[3]),29):hash32(id.length,id.charCodeAt(0)||0,id.charCodeAt(id.length-1)||0,29);
 }
 passengerPose(residentId:string,timeSeconds:number,servicePose?:TransitServicePose):TransitPassengerPose|undefined{
  const passenger=this.passengers.get(residentId);if(!passenger)return;
  const route=routeById.get(passenger.routeId);if(!route)return;
  const ordinal=this.residentOrdinal(residentId);
  const waitingPose=(stopId:string)=>{
   const stop=stopById.get(stopId);if(!stop)return;
   const next=route.stops[(stop.index+1)%route.stops.length]!,dx=next.position[0]-stop.position[0],dz=next.position[2]-stop.position[2],yaw=Math.atan2(dx,dz);
   const forwardX=Math.sin(yaw),forwardZ=Math.cos(yaw),rightX=Math.cos(yaw),rightZ=-Math.sin(yaw);
   const along=(ordinal%5-2)*.72,lateral=2.9+(ordinal%3)*.18;
   return{position:[stop.position[0]+forwardX*along+rightX*lateral,stop.position[1],stop.position[2]+forwardZ*along+rightZ*lateral] as const,yaw};
  };
  if(passenger.state==='waiting'){
   const pose=waitingPose(passenger.originStop);if(!pose)return;
   return{residentId,state:'waiting',routeId:route.id,position:pose.position,yaw:pose.yaw,speed:0,progress:0};
  }
  if(!passenger.serviceId)return;
  const service=this.services(timeSeconds).find(value=>value.id===passenger.serviceId);if(!service)return;
  const base=servicePose??{position:service.position,yaw:service.yaw,speed:service.phase==='run'?route.cruiseMps:0};
  const side=ordinal&1?1:-1,row=Math.floor((ordinal%24)/2),lateral=side*(route.mode==='metro'?.82:.68),longitudinal=(route.mode==='metro'?5.4:route.mode==='tram'?4.2:3.7)-row*.58;
  const forwardX=Math.sin(base.yaw),forwardZ=Math.cos(base.yaw),rightX=Math.cos(base.yaw),rightZ=-Math.sin(base.yaw);
  const cabinY=base.position[1]+(route.mode==='metro'?1.15:1.35);
  const seat=[base.position[0]+rightX*lateral+forwardX*longitudinal,cabinY,base.position[2]+rightZ*lateral+forwardZ*longitudinal] as const;
  if(passenger.state==='riding')return{residentId,state:'riding',routeId:route.id,serviceId:service.id,position:seat,yaw:base.yaw,speed:base.speed,progress:1};

  const width=route.mode==='metro'?2.7:route.mode==='tram'?2.45:2.5,length=route.mode==='metro'?15:route.mode==='tram'?12.5:10.8;
  const door=[base.position[0]-rightX*(width/2+.55)+forwardX*(length*.18-.55),base.position[1]+.08,base.position[2]-rightZ*(width/2+.55)+forwardZ*(length*.18-.55)] as const;
  const stopId=passenger.transitionStop??(passenger.state==='boarding'?passenger.originStop:passenger.destinationStop);
  const platform=waitingPose(stopId);if(!platform)return;
  const duration=passenger.state==='boarding'?BOARD_SECONDS:ALIGHT_SECONDS;
  const progress=clamp((timeSeconds-(passenger.transitionStarted??timeSeconds))/duration,0,1);
  const interpolate=(a:readonly[number,number,number],b:readonly[number,number,number],t:number):readonly[number,number,number]=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];
  if(passenger.state==='boarding'){
   const position=progress<.58?interpolate(platform.position,door,progress/.58):interpolate(door,seat,(progress-.58)/.42);
   return{residentId,state:'boarding',routeId:route.id,serviceId:service.id,position,yaw:base.yaw,speed:progress<.58?1:0,progress};
  }
  const position=progress<.42?interpolate(seat,door,progress/.42):interpolate(door,platform.position,(progress-.42)/.58);
  return{residentId,state:'alighting',routeId:route.id,serviceId:service.id,position,yaw:base.yaw,speed:progress>.42?1:0,progress};
 }

 step(timeSeconds:number):void{
  if(!Number.isFinite(timeSeconds)||timeSeconds<0)throw new RangeError('Invalid transit clock');
  for(const service of this.services(timeSeconds)){
   if(service.phase!=='dwell')continue;
   const route=routeById.get(service.routeId)!,stop=route.stops[service.currentStop]!;
   const transitions=[...this.passengers.values()]
    .filter(p=>p.serviceId===service.id&&(p.state==='boarding'||p.state==='alighting'))
    .sort((a,b)=>a.residentId.localeCompare(b.residentId));
   let active=false;
   for(const passenger of transitions){
    const duration=passenger.state==='boarding'?BOARD_SECONDS:ALIGHT_SECONDS;
    if(timeSeconds-(passenger.transitionStarted??timeSeconds)+1e-9<duration){active=true;continue;}
    if(passenger.state==='boarding'){
     passenger.state='riding';delete passenger.transitionStarted;delete passenger.transitionStop;this.boarded++;
    }else{
     this.passengers.delete(passenger.residentId);this.alighted++;
    }
   }
   if(active||[...this.passengers.values()].some(p=>p.serviceId===service.id&&(p.state==='boarding'||p.state==='alighting')))continue;

   const leaving=[...this.passengers.values()]
    .filter(p=>p.state==='riding'&&p.serviceId===service.id&&p.destinationStop===stop.id)
    .sort((a,b)=>a.residentId.localeCompare(b.residentId))[0];
   const call=schedules.get(route.id)![service.currentStop]!;
   const dwellRemaining=call.departure-service.scheduledSeconds;
   if(leaving){
    if(dwellRemaining>=ALIGHT_SECONDS+.05){
     leaving.state='alighting';leaving.transitionStarted=timeSeconds;leaving.transitionStop=stop.id;
    }
    continue;
   }


   if(route.capacity-this.onboard(service.id)<=0||dwellRemaining<BOARD_SECONDS+.05)continue;
   const waiting=this.waiting(stop.id,route.id)[0];
   if(waiting){
    waiting.state='boarding';waiting.serviceId=service.id;waiting.transitionStarted=timeSeconds;waiting.transitionStop=stop.id;
   }
  }
 }

 snapshot(timeSeconds:number){
  return Object.freeze({
   routes:this.routes.map(route=>({id:route.id,mode:route.mode,name:route.name,capacity:route.capacity,headway:route.headwaySeconds,stops:route.stops.map(stop=>({id:stop.id,name:stop.name}))})),
   fleet:this.services(timeSeconds).map(service=>({...service})),
   waiting:[...this.passengers.values()].filter(p=>p.state==='waiting').length,
   boarding:[...this.passengers.values()].filter(p=>p.state==='boarding').length,
   riding:[...this.passengers.values()].filter(p=>p.state==='riding').length,
   alighting:[...this.passengers.values()].filter(p=>p.state==='alighting').length,
   boarded:this.boarded,alighted:this.alighted,
   serviceTime:transitServiceTime(timeSeconds),
  });
 }

 /** Stable vehicle identity for later physical materialization near players. */
 vehicleSeed(serviceId:string):number{
  const [line,slot]=serviceId.split(':');return hash32(Number(slot??0),line?.charCodeAt(0)??0,line?.charCodeAt(1)??0,29);
 }
}
