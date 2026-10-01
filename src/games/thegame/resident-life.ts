import {hash01,hash32} from './world.js';

export type ResidentActivity='sleep'|'breakfast'|'commute-work'|'work'|'lunch'|'commute-home'|'shopping'|'leisure'|'home';
export type ResidentJob='shop'|'office'|'maintenance'|'delivery'|'hospitality'|'services';
export type CommuteMode='walk'|'car';

export interface ResidentProfile {
 readonly id:string;
 readonly job:ResidentJob;
 readonly home:readonly[number,number];
 readonly work:readonly[number,number];
 readonly leisure:readonly[number,number];
 readonly commute:CommuteMode;
 readonly shiftOffsetHours:number;
}

export interface ResidentIntent {
 readonly activity:ResidentActivity;
 readonly destination:readonly[number,number];
 readonly speed:number;
 readonly meaningful:true;
}

const CELL_M=128;
const jobs:readonly ResidentJob[]=['shop','office','maintenance','delivery','hospitality','services'];

export function parseResidentId(id:string):{cx:number;cz:number;slot:number}|undefined{
 const match=/^crowd:(-?\d+):(-?\d+):(\d+)$/.exec(id);if(!match)return;
 const cx=Number(match[1]),cz=Number(match[2]),slot=Number(match[3]);
 if(!Number.isSafeInteger(cx)||!Number.isSafeInteger(cz)||!Number.isSafeInteger(slot)||slot<0||slot>1024)return;
 return{cx,cz,slot};
}
const point=(seed:number,cx:number,cz:number,slot:number,salt:number,radius:number):readonly[number,number]=>{
 const x=cx*CELL_M+64+(hash01(cx,slot,salt,seed)-.5)*radius*2;
 const z=cz*CELL_M+64+(hash01(cz,slot,salt+1,seed)-.5)*radius*2;
 return[x,z];
};
export function residentProfile(seed:number,id:string):ResidentProfile{
 const parsed=parseResidentId(id);if(!parsed)throw new TypeError('Invalid resident identity');
 const {cx,cz,slot}=parsed,job=jobs[hash32(cx,cz,slot,seed)%jobs.length]!;
 const home=point(seed,cx,cz,slot,301,42);
 const workCellX=cx+((hash32(cx,slot,401,seed)%5)-2),workCellZ=cz+((hash32(cz,slot,402,seed)%5)-2);
 const work=point(seed,workCellX,workCellZ,slot,403,34);
 const leisure=point(seed,cx,cz,slot,501,55);
 const commute:CommuteMode=hash01(cx,cz,slot+601,seed)>.72?'car':'walk';
 const shiftOffsetHours=(hash01(cx,cz,slot+701,seed)-.5)*1.5;
 return Object.freeze({id,job,home,work,leisure,commute,shiftOffsetHours});
}
const progress=(hour:number,a:number,b:number)=>Math.max(0,Math.min(1,(hour-a)/(b-a)));
export function residentIntent(seed:number,id:string,tick:number,stepSeconds=1/60):ResidentIntent{
 if(!Number.isSafeInteger(tick)||tick<0||!Number.isFinite(stepSeconds)||stepSeconds<=0)throw new RangeError('Invalid resident clock');
 const profile=residentProfile(seed,id);
 const hour=((tick*stepSeconds/3600)+profile.shiftOffsetHours+24)%24;
 let activity:ResidentActivity,destination:readonly[number,number],speed=0;
 if(hour<6){activity='sleep';destination=profile.home;}
 else if(hour<7){activity='breakfast';destination=profile.home;}
 else if(hour<9){activity='commute-work';destination=profile.work;speed=profile.commute==='car'?7:1.35;}
 else if(hour<12){activity='work';destination=profile.work;}
 else if(hour<13){activity='lunch';destination=profile.leisure;speed=1.1;}
 else if(hour<17){activity='work';destination=profile.work;}
 else if(hour<19){activity='commute-home';destination=profile.home;speed=profile.commute==='car'?7:1.35;}
 else if(hour<20.5){activity='shopping';destination=profile.leisure;speed=1.05;}
 else if(hour<22){activity='leisure';destination=profile.leisure;}
 else {activity='home';destination=profile.home;}
 return Object.freeze({activity,destination,speed,meaningful:true});
}
