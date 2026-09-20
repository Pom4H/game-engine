import {hashString,mulberry32} from '../core/random.js';
import {material} from '../materials/catalog.js';
import type {EngineEvent,FractureEvent,ImpactEvent} from '../scene/events.js';

export interface AudioChannels {left:Float32Array;right:Float32Array;sampleRate:number}

export function synthesizeEvent(event:EngineEvent,sampleRate=48_000):AudioChannels{
  const duration=event.type==='fracture'?Math.min(.85,.22+event.size*.08):impactDuration(event);
  const count=Math.max(1,Math.ceil(duration*sampleRate)),left=new Float32Array(count),right=new Float32Array(count);
  const rng=mulberry32((event.id^hashString(event.type))>>>0);
  const pan=Math.max(-.65,Math.min(.65,event.point[0]/25)),gainL=Math.sqrt((1-pan)/2),gainR=Math.sqrt((1+pan)/2);
  const amplitude=event.type==='fracture'?Math.min(.75,.11+Math.log1p(event.energy)*.075):Math.min(.55,.035+Math.log1p(event.energy)*.06);
  if(event.type==='fracture')fractureVoice(event,left,right,sampleRate,rng,amplitude,gainL,gainR);
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
  const profileA=material(event.materialA),profileB=material(event.materialB),surfaceDamping=((event.surfaceA?.damping??profileA.acoustic.damping)+(event.surfaceB?.damping??profileB.acoustic.damping))/2;
  const wetness=((event.surfaceA?.wetness??0)+(event.surfaceB?.wetness??0))/2,moss=((event.surfaceA?.moss??0)+(event.surfaceB?.moss??0))/2;
  const banks=[
    modalBank(profileA,event.dimensionsA??[event.size,event.size,event.size],rng,event.fixedA??false),
    ...(event.b==='ground'?[]:[modalBank(profileB,event.dimensionsB??[event.size,event.size,event.size],rng,event.fixedB??false)]),
  ];
  const hardness=Math.sqrt(Math.max(1e6,profileA.mechanical.youngModulusPa)*Math.max(1e6,profileB.mechanical.youngModulusPa));
  const hardnessNorm=clamp01((Math.log10(hardness)-7)/4),contactBrightness=Math.max(.03,(profileA.acoustic.brightness+profileB.acoustic.brightness)/2*(1-wetness*.30-moss*.55));
  const area=projectedArea(event.dimensionsA??[event.size,event.size,event.size],event.normal),air=clamp01(area*Math.max(0,event.speed)*.38),contactMs=.0015+.004*(1-hardnessNorm)+.0015*Math.min(1,event.size);
  let transientLow=0,airLow=0;
  for(let i=0;i<left.length;i++){
    const t=i/sampleRate,noise=rng()*2-1;
    transientLow+=(noise-transientLow)*(1-Math.exp(-2*Math.PI*(900+contactBrightness*4200)/sampleRate));
    airLow+=(noise-airLow)*(1-Math.exp(-2*Math.PI*(90+air*190)/sampleRate));
    const strike=Math.exp(-Math.pow(t/contactMs,1.35))*((noise*.45+transientLow*.55)*(0.22+.78*hardnessNorm));
    const thump=Math.sin(2*Math.PI*(72+event.size*18)*t)*Math.exp(-t*(42-14*Math.min(1,event.size)))*(.08+.14*Math.min(1,event.impulse/20));
    const puff=airLow*Math.exp(-t*(18+air*8))*air*.24;
    let sample=strike+thump+puff;
    for(const bank of banks){
      for(let m=0;m<bank.frequencies.length;m++){
        const frequency=bank.frequencies[m]!,env=Math.exp(-t*bank.decays[m]!);
        sample+=Math.sin(2*Math.PI*frequency*t+bank.phases[m]!)*env*bank.gains[m]!;
      }
    }
    sample*=amplitude*.42*(1-moss*.16)*(1-surfaceDamping*.08);left[i]=sample*gainL;right[i]=sample*gainR;
  }
}
function impactDuration(event:ImpactEvent):number{
  const profileA=material(event.materialA),profileB=material(event.materialB),damping=(profileA.acoustic.damping+profileB.acoustic.damping)*.5,dims=event.dimensionsA??[event.size,event.size,event.size],sorted=[...dims].sort((a,b)=>a-b),d0=sorted[0]??1,d1=sorted[1]??1,d2=sorted[2]??1,plate=d0/Math.max(.01,Math.sqrt(d1*d2))<.12;
  return Math.min(1.45,Math.max(.24,.32+(1-damping)*.36+(plate ? .42 : 0)+Math.log1p(event.energy)*.018));
}
function modalBank(profile:ReturnType<typeof material>,dimensions:readonly number[],rng:()=>number,fixed:boolean){
  const d=[...dimensions].map(value=>Math.max(.002,Math.abs(value))).sort((x,y)=>x-y),h=d[0]??.02,b=d[1]??h,a=d[2]??b,span=Math.sqrt(a*b),thin=h/Math.max(.002,span),plate=thin<.12,phases:number[]=[],frequencies:number[]=[],decays:number[]=[],gains:number[]=[];
  const push=(frequency:number,gain:number,decay:number)=>{if(frequency<28||frequency>18_000)return;frequencies.push(frequency);phases.push(rng()*Math.PI*2);decays.push(decay);gains.push(gain);};
  if(plate){
    const nu=poisson(profile.kind),factor=Math.PI/2*h*Math.sqrt(profile.mechanical.youngModulusPa/(12*profile.density*(1-nu*nu)))*(fixed?2.15:1);
    const modes:[[number,number],...Array<[number,number]>]=[[1,1],[2,1],[1,2],[2,2],[3,1],[1,3],[3,2],[2,3],[4,1],[1,4]];
    for(let i=0;i<modes.length;i++){const [m,n]=modes[i]!,f=factor*((m/a)**2+(n/b)**2),highBoost=Math.min(1.7,1+f/1800);push(f,(.12+profile.acoustic.brightness*.20)*highBoost/(1+i*.28),3.2+profile.acoustic.damping*24+i*.32);}
  }else{
    const nu=poisson(profile.kind),shear=Math.sqrt(profile.mechanical.youngModulusPa/(2*(1+nu)*profile.density)),longitudinal=Math.sqrt(profile.mechanical.youngModulusPa*(1-nu)/(profile.density*(1+nu)*(1-2*nu))),axes=[a,b,h];
    let index=0;
    for(const length of axes){
      push(shear/(2*length),(.04+profile.acoustic.brightness*.085)/(1+index*.2),10+profile.acoustic.damping*38);
      push(longitudinal/(2*length),(.025+profile.acoustic.brightness*.055)/(1+index*.2),12+profile.acoustic.damping*42);
      index++;
    }
  }
  return{frequencies,phases,decays,gains};
}
function projectedArea(dimensions:readonly number[],normal:readonly number[]):number{
  const dx=Math.max(.002,Math.abs(dimensions[0]??1)),dy=Math.max(.002,Math.abs(dimensions[1]??1)),dz=Math.max(.002,Math.abs(dimensions[2]??1)),nx=Math.abs(normal[0]??0),ny=Math.abs(normal[1]??0),nz=Math.abs(normal[2]??0);
  return dy*dz*nx+dx*dz*ny+dx*dy*nz;
}
function poisson(kind:string):number{return kind==='glass'?.23:kind==='steel'?.29:kind==='wood'?.34:kind==='concrete'?.20:kind==='asphalt'?.35:.30;}
function clamp01(value:number){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}

function fractureVoice(event:FractureEvent,left:Float32Array,right:Float32Array,sampleRate:number,rng:()=>number,amplitude:number,gainL:number,gainR:number){
  const profile=material(event.material).acoustic,base=Math.max(240,profile.resonanceHz*Math.sqrt(Math.max(.25,event.thickness/.01))/Math.sqrt(Math.max(.65,event.size)));
  // The fracture event is only the rupture itself. Subsequent shard impacts are
  // real rigid-body contacts and synthesize their own clinks later in time.
  let low=0;
  for(let i=0;i<left.length;i++){
    const t=i/sampleRate,noise=rng()*2-1;low+=(noise-low)*(1-Math.exp(-2*Math.PI*(1800+profile.brightness*4200)/sampleRate));
    const crack=(noise*.65+low*.35)*Math.exp(-t*(62-profile.brightness*10));
    const release=Math.sin(2*Math.PI*base*t)*Math.exp(-t*(18+profile.damping*35))*.18+Math.sin(2*Math.PI*base*1.73*t+.7)*Math.exp(-t*(24+profile.damping*42))*.09;
    const sample=(crack*(.32+profile.noise*.75)+release)*amplitude*.44;left[i]=sample*gainL;right[i]=sample*gainR;
  }
}

function softLimit(data:Float32Array){for(let i=0;i<data.length;i++)data[i]=Math.tanh(data[i]!*.92);}
