import {hashString,mulberry32} from '../core/random.js';
import {material} from '../materials/catalog.js';
import type {EngineEvent,FractureEvent,ImpactEvent,MechanismEvent} from '../scene/events.js';

export interface AudioChannels {left:Float32Array;right:Float32Array;sampleRate:number}

export function synthesizeEvent(event:EngineEvent,sampleRate=48_000):AudioChannels{
  const duration=event.type==='fracture'?Math.min(1.25,.32+event.size*.12):event.type==='mechanism'?Math.min(.9,.12+event.size*.08+Math.log1p(event.energy)*.02):Math.min(.55,.09+event.size*.045+Math.log1p(event.energy)*.018);
  const count=Math.max(1,Math.ceil(duration*sampleRate)),left=new Float32Array(count),right=new Float32Array(count);
  const rng=mulberry32((event.id^hashString(event.type))>>>0);
  const pan=Math.max(-.65,Math.min(.65,event.point[0]/25)),gainL=Math.sqrt((1-pan)/2),gainR=Math.sqrt((1+pan)/2);
  const amplitude=event.type==='fracture'?Math.min(.75,.11+Math.log1p(event.energy)*.075):event.type==='mechanism'?Math.min(.5,.03+Math.log1p(event.energy)*.052):Math.min(.55,.035+Math.log1p(event.energy)*.06);
  if(event.type==='fracture')fractureVoice(event,left,right,sampleRate,rng,amplitude,gainL,gainR);
  else if(event.type==='mechanism')mechanismVoice(event,left,right,sampleRate,rng,amplitude,gainL,gainR);
  else impactVoice(event,left,right,sampleRate,rng,amplitude,gainL,gainR);
  softLimit(left);softLimit(right);return{left,right,sampleRate};
}

export function renderAudio(events:readonly EngineEvent[],duration:number,sampleRate=48_000,startTime=0):AudioChannels{
  const count=Math.max(1,Math.ceil(duration*sampleRate)),left=new Float32Array(count),right=new Float32Array(count);
  for(const event of events){const offset=Math.round((event.time-startTime)*sampleRate);if(offset>=count)continue;const voice=synthesizeEvent(event,sampleRate);for(let i=Math.max(0,-offset);i<voice.left.length&&offset+i<count;i++){const at=offset+i;if(at>=0){left[at]!+=voice.left[i]!;right[at]!+=voice.right[i]!;}}}
  softLimit(left);softLimit(right);return{left,right,sampleRate};
}

export function wavBytes(audio:AudioChannels):Uint8Array{
  const frames=Math.min(audio.left.length,audio.right.length),bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer);
  const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,36+frames*4,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,audio.sampleRate,true);view.setUint32(28,audio.sampleRate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*4,true);
  for(let i=0;i<frames;i++){view.setInt16(44+i*4,Math.round(Math.max(-1,Math.min(1,audio.left[i]!))*32767),true);view.setInt16(46+i*4,Math.round(Math.max(-1,Math.min(1,audio.right[i]!))*32767),true);}
  return bytes;
}

function impactVoice(event:ImpactEvent,left:Float32Array,right:Float32Array,sampleRate:number,rng:()=>number,amplitude:number,gainL:number,gainR:number){
  const a=material(event.materialA).acoustic,b=material(event.materialB).acoustic;
  const surfaceDamping=((event.surfaceA?.damping??a.damping)+(event.surfaceB?.damping??b.damping))/2;
  const wetness=((event.surfaceA?.wetness??0)+(event.surfaceB?.wetness??0))/2,moss=((event.surfaceA?.moss??0)+(event.surfaceB?.moss??0))/2;
  const damping=Math.max(.025,surfaceDamping),brightness=Math.max(.06,(a.brightness+b.brightness)/2*(1-wetness*.28-moss*.52));
  const geometryScale=Math.max(.35,Math.sqrt(Math.max(.04,event.size))),base=Math.max(85,Math.sqrt(a.resonanceHz*b.resonanceHz)/geometryScale);
  const glass=event.materialA==='glass'||event.materialB==='glass',metal=event.materialA==='steel'||event.materialB==='steel';
  // Real body impacts are dominated by a broadband onset and rapidly decorrelating
  // sheet/cavity motion. Keep modal ringing subtle and deliberately inharmonic so a
  // sequence of kicks does not turn into a tuned percussion instrument.
  const ratios=glass?[1,1.71,2.93,4.21]:[1,1.58,2.37,3.61];
  const frequencies=ratios.map(r=>base*r*(.94+rng()*.12)),phases=ratios.map(()=>rng()*Math.PI*2);
  const modalStrength=glass?.105:metal?.052:.026;
  let fast=0,slow=0,body=0;
  for(let i=0;i<left.length;i++){
    const t=i/sampleRate,white=rng()*2-1;
    fast+=.22*(white-fast);slow+=.028*(white-slow);body+=.010*(white-body);
    const band=fast-slow,edge=white-fast;
    const onset=(edge*.72+band*.38)*Math.exp(-t*(82+wetness*24))*(.38+brightness*.34);
    const cavity=body*Math.exp(-t*(17+10*damping))*(metal?.68:.44);
    const buckle=metal?band*Math.exp(-t*(24+18*damping))*.28:0;
    let modal=0;
    for(let m=0;m<frequencies.length;m++)modal+=Math.sin(2*Math.PI*frequencies[m]!*t+phases[m]!)*Math.exp(-t*(34+10*m+40*damping))*(modalStrength/(1+m*.8));
    const sample=(onset+cavity+buckle+modal)*amplitude*(1-moss*.18);
    left[i]=sample*gainL;right[i]=sample*gainR;
  }
}

function mechanismVoice(event:MechanismEvent,left:Float32Array,right:Float32Array,sampleRate:number,rng:()=>number,amplitude:number,gainL:number,gainR:number){
  const suspension=event.mechanism==='suspension',latch=event.mechanism==='door-latch',stop=event.mechanism==='door-stop',panel=event.mechanism==='panel-flex';
  const microBursts=panel?Array.from({length:3},(_,i)=>.010+i*.014+rng()*.007):[];
  let fast=0,mid=0,slow=0,previous=0;
  for(let i=0;i<left.length;i++){
    const t=i/sampleRate,white=rng()*2-1;
    fast+=.25*(white-fast);mid+=.055*(white-mid);slow+=.008*(white-slow);
    const edge=white-fast,band=fast-mid,low=mid-slow;
    let sample=0;
    if(latch){
      // Latch: metal click + door-cavity thump + a very short seal/rattle tail.
      sample=edge*Math.exp(-t*135)*.84+low*Math.exp(-t*24)*.64+band*Math.exp(-t*48)*.22;
    }else if(stop){
      sample=edge*Math.exp(-t*105)*.48+low*Math.exp(-t*18)*.82+band*Math.exp(-t*34)*.18;
    }else if(suspension){
      // Damper/chassis movement is mostly low, noisy mechanical energy, not a pitch.
      sample=low*Math.exp(-t*13)*.72+band*Math.exp(-t*24)*.16+(white-previous)*Math.exp(-t*70)*.08;
    }else if(panel){
      // Oil-canning/flex: broadband buckle with several tiny stochastic releases.
      sample=band*Math.exp(-t*30)*.62+low*Math.exp(-t*20)*.30;
      for(const at of microBursts){const age=t-at;if(age>=0&&age<.026)sample+=edge*Math.exp(-age*115)*.20;}
    }else{
      sample=edge*Math.exp(-t*95)*.38+band*Math.exp(-t*31)*.34+low*Math.exp(-t*18)*.22;
    }
    previous=white;
    sample*=amplitude*(.72+Math.min(1,event.speed)*.24);
    left[i]=sample*gainL;right[i]=sample*gainR;
  }
}

function fractureVoice(event:FractureEvent,left:Float32Array,right:Float32Array,sampleRate:number,rng:()=>number,amplitude:number,gainL:number,gainR:number){
  const profile=material(event.material).acoustic,thicknessScale=Math.sqrt(Math.max(.25,event.thickness/.01)),sizeScale=Math.max(.65,event.size),base=Math.max(260,profile.resonanceHz*thicknessScale/Math.sqrt(sizeScale));
  const modes=[1,1.31,1.77,2.36,3.12],phases=modes.map(()=>rng()*Math.PI*2),tinks=Math.min(18,Math.max(4,Math.round(event.shardCount*.45)));
  const tinkTimes=Array.from({length:tinks},()=>.015+rng()*.38).sort((a,b)=>a-b),tinkFreq=tinkTimes.map(()=>base*(1.2+rng()*2.8));
  for(let i=0;i<left.length;i++){const t=i/sampleRate,crack=Math.exp(-t*48),ring=Math.exp(-t*(7+profile.damping*22));let sample=(rng()*2-1)*crack*(.32+profile.noise*.85);for(let m=0;m<modes.length;m++)sample+=Math.sin(2*Math.PI*base*modes[m]!*t+phases[m]!)*ring*(.48/(1+m*.62));for(let k=0;k<tinkTimes.length;k++){const age=t-tinkTimes[k]!;if(age>=0&&age<.18)sample+=Math.sin(2*Math.PI*tinkFreq[k]!*age)*Math.exp(-age*38)*(.08+rng()*.025);}sample*=amplitude*.34;left[i]=sample*gainL;right[i]=sample*gainR;}
}

function softLimit(data:Float32Array){for(let i=0;i<data.length;i++)data[i]=Math.tanh(data[i]!*.92);}
