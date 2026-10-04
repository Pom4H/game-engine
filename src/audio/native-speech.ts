/** Native articulatory synthesis: no subprocess, WASM, recordings or neural
 * model. Measured MRI vowel areas plus contextual constrictions feed a
 * pressure-driven geometric glottis and passive tract. Not tissue dynamics.
 * Units: area[cm²], pressure[Pa], volume flow[m³/s], length[m].
 */
import {storyControlForConsonant,STORY_SECTIONS,STORY_NOMINAL_TRACT_LENGTH_CM,type StoryConsonant} from './story-area-model.js';
import {nativeVowelArea,type MeasuredVowel} from './native-vowels.js';
import {NativeVocalTract} from './native-tract.js';
export {NativeVocalTract} from './native-tract.js';
export interface SpeechSegment {readonly phone:string;readonly durationS:number;}
export interface SpeechPitch {readonly timeS:number;readonly hz:number;}
export interface SpeechPressure {readonly timeS:number;readonly pa:number;}
export interface NativeSpeechTurn {
  readonly id:string;readonly speakerId:string;readonly text:string;readonly startS:number;
  readonly segments:readonly SpeechSegment[];readonly pitch:readonly SpeechPitch[];readonly pressure:readonly SpeechPressure[];
}
export interface NativeSpeechVoice {readonly id:string;readonly name:string;readonly tractLengthM:number;readonly pan:number;readonly breathiness?:number;readonly glottalAreaM2?:number;}
export interface NativeSpeechPlan {readonly schemaVersion:1;readonly speakers:readonly NativeSpeechVoice[];readonly turns:readonly NativeSpeechTurn[];}
export interface VocalMotorFrame {
  /** Mutable caller-owned frame. Do not retain without cloning. */
  timeS:number;phone:string;active:number;pitchHz:number;lungPressurePa:number;
  voicing:number;frication:number;aspiration:number;nasalPortAreaCm2:number;
  tractLengthM:number;oralAreaCm2:Float64Array;constrictionSection:number;
  jawAngleRad:number;lipWidthM:number;lipGapM:number;lipProtrusionM:number;
  tongueTip:number;labiodental:number;round:number;spread:number;closure:number;
}
interface Target {area:Float64Array;nasal:number;voicing:number;frication:number;aspiration:number;jaw:number;round:number;spread:number;closure:number;labiodental:number;tip:number;}
interface TimedPhone {start:number;end:number;phone:string;a:Target;b:Target;}
interface CompiledTurn {source:NativeSpeechTurn;phones:TimedPhone[];end:number;}
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=(v:number)=>{const u=clamp(v);return u*u*(3-2*u);};
const TAU=2*Math.PI,CM2=1e-4;
const VOWEL:Record<string,MeasuredVowel|'schwa'>={a:'aa','a:':'aa',A:'aa',ae:'ae',E:'eh',e:'e','e:':'e',i:'i','i:':'i',I:'ih',o:'o','o:':'o',O:'aw',u:'u','u:':'u',U:'uu','@':'schwa','6':'schwa',V:'uh',y:'u',Y:'uu','2':'o','9':'o'};
const CONSONANT:Record<string,StoryConsonant>={p:'p',b:'p',t:'t',d:'t',k:'k',g:'k',m:'m',n:'n',N:'ng',f:'f',v:'f',T:'th',D:'th',s:'s',z:'s',S:'sh',Z:'sh',C:'sh',l:'l',tS:'sh',dZ:'sh',ts:'s',pf:'f'};
const DIPH:Record<string,readonly[string,string]>={aI:['a','I'],aU:['a','U'],OY:['O','I'],eI:['e','I'],oU:['o','U']};
function target(phone:string,context?:Float64Array):Target {
  const vowel=VOWEL[phone],consonant=CONSONANT[phone];
  const round=['u','u:','U','o','o:','O','w','y','Y','2','9'].includes(phone)?(['U','O'].includes(phone)?.65:.9):0;
  const spread=['i','i:','I','j','e','e:','E','ae'].includes(phone)?.65:0;
  const tip=['t','d','n','l','T','D'].includes(phone)?1:0;
  const closure=['p','b','m'].includes(phone)?1:0,labiodental=['f','v'].includes(phone)?1:0;
  const jaw=['a','a:','A','ae'].includes(phone)?.1:['E','O'].includes(phone)?.07:.03;
  const control=consonant?storyControlForConsonant(consonant):undefined;
  if(!vowel&&!consonant&&!['w','j','h','r','R','?',''].includes(phone))throw new RangeError('No native articulatory target for phone '+JSON.stringify(phone));
  const area=vowel?nativeVowelArea(vowel):phone==='w'?nativeVowelArea('u'):phone==='j'?nativeVowelArea('i'):Float64Array.from(context??nativeVowelArea('schwa'));
  // A consonant changes local passage over its surrounding vowel substrate.
  for(const c of control?.constrictions??[]){
    const base=area[Math.round(c.location)-1]!,degree=1-clamp(c.areaCm2/Math.max(.0001,base));
    for(let i=0;i<44;i++){
      const range=c.range*(i+1<c.location?1:c.skew)/(1+c.skew),g=Math.exp(-Math.log(16)*((i+1-c.location)/range)**2);
      area[i]=Math.max(.0001,area[i]!*Math.max(0,1-c.magnitude*degree*g));
    }
  }
  if(phone==='r'||phone==='R')for(let i=0;i<area.length;i++)area[i]=Math.max(.03,area[i]!*(1-.82*Math.exp(-(((i-31)/4)**2)))*(1-.65*Math.exp(-(((i-10)/4)**2))));
  return{area,nasal:control?.nasalPortAreaCm2??0,
    voicing:!phone||['p','t','k','f','T','s','S','C','h','tS','ts','pf','?'].includes(phone)?0:1,
    frication:['f','v','T','D','s','z','S','Z','C','tS','dZ','ts','pf'].includes(phone)?1:0,
    aspiration:phone==='h'?1:0,jaw,round,spread,closure,labiodental,tip};
}
function finite(value:number,lo:number,hi:number,label:string):void{if(!Number.isFinite(value)||value<lo||value>hi)throw new RangeError(label+' must be finite within '+lo+'..'+hi);}
function id(value:string,label:string):void{if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))throw new TypeError('Invalid '+label);}
function validateContour(points:readonly {timeS:number}[],end:number,label:string):void{
  if(!points.length||points[0]!.timeS!==0)throw new TypeError(label+' must begin at zero');
  let previous=-1;for(const p of points){finite(p.timeS,0,end,label+' time');if(p.timeS<=previous)throw new RangeError(label+' times must increase');previous=p.timeS;}
}
export function nativeSpeechPlan(speakers:readonly NativeSpeechVoice[],turns:readonly NativeSpeechTurn[]):NativeSpeechPlan{
  if(speakers.length<1||speakers.length>32||!turns.length||turns.length>256)throw new RangeError('Speech plan size outside limits');
  const voices=new Set<string>(),ids=new Set<string>(),ends=new Map<string,number>();
  for(const voice of speakers){id(voice.id,'voice ID');if(voices.has(voice.id))throw new TypeError('Duplicate voice');voices.add(voice.id);finite(voice.tractLengthM,.12,.24,'tract length');finite(voice.pan,-1,1,'pan');finite(voice.breathiness??.03,0,.3,'breathiness');finite(voice.glottalAreaM2??.000018,.000001,.00005,'glottal area');}
  for(const turn of turns){
    id(turn.id,'turn ID');if(ids.has(turn.id))throw new TypeError('Duplicate turn');ids.add(turn.id);
    if(!voices.has(turn.speakerId))throw new TypeError('Unknown speaker '+turn.speakerId);
    finite(turn.startS,0,600,'turn start');if(!turn.text.trim()||!turn.segments.length)throw new TypeError('Turn needs transcript and articulation');
    let duration=0;
    for(const segment of turn.segments){finite(segment.durationS,.005,2,'phone duration');duration+=segment.durationS;const pair=DIPH[segment.phone];if(pair){target(pair[0]);target(pair[1]);}else target(segment.phone);}
    finite(duration,.005,55,'turn duration');finite(turn.startS+duration,0,600,'plan end');
    if(turn.startS<(ends.get(turn.speakerId)??0)-1e-9)throw new RangeError('One voice cannot overlap its own turns');ends.set(turn.speakerId,turn.startS+duration);
    validateContour(turn.pitch,duration,'pitch');validateContour(turn.pressure,duration,'pressure');
    for(const p of turn.pitch)finite(p.hz,45,450,'pitch');for(const p of turn.pressure)finite(p.pa,0,1600,'lung pressure');
  }
  return structuredClone({schemaVersion:1,speakers,turns}) as NativeSpeechPlan;
}
export function createVocalMotorFrame(tractLengthM=STORY_NOMINAL_TRACT_LENGTH_CM/100):VocalMotorFrame{
  return{timeS:0,phone:'',active:0,pitchHz:120,lungPressurePa:0,voicing:0,frication:0,aspiration:0,nasalPortAreaCm2:0,
    tractLengthM,oralAreaCm2:nativeVowelArea('schwa'),constrictionSection:0,jawAngleRad:0,lipWidthM:.047,lipGapM:0,lipProtrusionM:0,tongueTip:0,labiodental:0,round:0,spread:0,closure:1};
}
function contour<T extends {timeS:number}>(points:readonly T[],time:number,value:(p:T)=>number):number{
  for(let i=1;i<points.length;i++)if(time<points[i]!.timeS){const a=points[i-1]!,b=points[i]!,u=clamp((time-a.timeS)/(b.timeS-a.timeS));return value(a)+(value(b)-value(a))*u;}
  return value(points[points.length-1]!);
}
/** Compile once; sampling is random-access and mutates only the output frame. */
export class NativeSpeechMotor {
  readonly voice:NativeSpeechVoice;readonly durationS:number;
  private readonly turns:CompiledTurn[];private readonly rest=target('');
  constructor(plan:NativeSpeechPlan,speakerId:string){
    plan=nativeSpeechPlan(plan.speakers,plan.turns);
    const voice=plan.speakers.find(v=>v.id===speakerId);if(!voice)throw new TypeError('Unknown native voice');this.voice=voice;
    this.turns=plan.turns.filter(t=>t.speakerId===speakerId).map(source=>{
      const vowelNear=(index:number,direction:number):Float64Array|undefined=>{
        for(let i=index+direction;i>=0&&i<source.segments.length;i+=direction){
          const symbol=source.segments[i]!.phone;if(!symbol)break;
          const pair=DIPH[symbol],vowel=VOWEL[pair?.[direction<0?1:0]??symbol];if(vowel)return nativeVowelArea(vowel);
        }
        return undefined;
      };
      let cursor=0;const phones=source.segments.map((segment,index)=>{
        const start=cursor;cursor+=segment.durationS;const pair=DIPH[segment.phone],before=vowelNear(index,-1),after=vowelNear(index,1);
        return{start,end:cursor,phone:segment.phone,a:target(pair?.[0]??segment.phone,before??after),b:target(pair?.[1]??segment.phone,after??before)};
      });
      return{source,phones,end:source.startS+cursor};
    });this.durationS=Math.max(0,...this.turns.map(t=>t.end));
  }
  sample(timeS:number,out:VocalMotorFrame=createVocalMotorFrame(this.voice.tractLengthM)):VocalMotorFrame{
    finite(timeS,0,601,'motor time');if(out.oralAreaCm2.length!==STORY_SECTIONS)throw new RangeError('Motor frame needs 44 sections');
    let a=this.rest,b=this.rest,mix=0,next=this.rest,anticipation=0,active=0,nextActive=0,phone='',pressure=0,pitch=120;
    const turn=this.turns.find(t=>timeS>=t.source.startS&&timeS<t.end);
    if(turn){
      const local=timeS-turn.source.startS,index=turn.phones.findIndex(p=>local<p.end),p=turn.phones[index]!;
      a=p.a;b=p.b;mix=ease(((local-p.start)/(p.end-p.start)-.2)/.7);
      const following=turn.phones[index+1];next=following?.a??this.rest;nextActive=following?.phone?1:0;
      const transition=Math.min(p.end-p.start,.036,(following?.end??p.end+.08)-(following?.start??p.end));anticipation=ease((local-p.end+transition)/transition);
      phone=p.phone;active=phone?1:0;
      if(phone==='h'){a={...next,voicing:0,aspiration:1};b=a;}
      pitch=Math.exp(contour(turn.source.pitch,local,p=>Math.log(p.hz)));
      pressure=contour(turn.source.pressure,local,p=>p.pa)*ease((local-turn.phones[0]!.start)/.012)*ease((turn.end-timeS)/.025);
    }
    const scalar=(key:keyof Omit<Target,'area'>)=>{const x=a[key]+(b[key]-a[key])*mix;return x+(next[key]-x)*anticipation;};
    const areaScale=(this.voice.tractLengthM/(STORY_NOMINAL_TRACT_LENGTH_CM/100))**2;
    let minimum=Infinity,section=0;
    for(let i=0;i<STORY_SECTIONS;i++){
      const x=a.area[i]!+(b.area[i]!-a.area[i]!)*mix,area=(x+(next.area[i]!-x)*anticipation)*areaScale;
      out.oralAreaCm2[i]=Math.max(.0001,area);if(area<minimum){minimum=area;section=i;}
    }
    const energyGate=active+(nextActive-active)*anticipation;
    out.timeS=timeS;out.phone=phone;out.active=energyGate;out.pitchHz=pitch;out.lungPressurePa=pressure*energyGate;
    out.voicing=scalar('voicing');out.frication=scalar('frication');out.aspiration=scalar('aspiration');out.tractLengthM=this.voice.tractLengthM;
    out.nasalPortAreaCm2=scalar('nasal')*areaScale;out.constrictionSection=section;
    out.round=scalar('round');out.spread=scalar('spread');out.closure=scalar('closure');out.labiodental=scalar('labiodental');out.tongueTip=scalar('tip');
    out.jawAngleRad=scalar('jaw')*energyGate;out.lipWidthM=(.047-.015*out.round+.005*out.spread)*Math.sqrt(areaScale);out.lipProtrusionM=.0045*out.round;
    out.lipGapM=4*out.oralAreaCm2[STORY_SECTIONS-1]!*CM2/(Math.PI*out.lipWidthM);return out;
  }
}
export function scatterNativeJunction(incoming:ArrayLike<number>,areas:ArrayLike<number>,out:Float64Array):void{
  if(incoming.length!==areas.length||out.length!==areas.length)throw new RangeError('Junction dimensions');
  let sum=0,weighted=0;for(let i=0;i<areas.length;i++){if(!Number.isFinite(areas[i])||areas[i]!<0||!Number.isFinite(incoming[i]))throw new RangeError('Nonfinite junction state');sum+=areas[i]!;weighted+=areas[i]!*incoming[i]!;}
  if(sum<=0)throw new RangeError('Junction needs one open port');const pressure=2*weighted/sum;for(let i=0;i<out.length;i++)out[i]=pressure-incoming[i]!;
}
export interface NativeSpeechDiagnostics {readonly backend:'native-typescript';readonly sampleRate:number;readonly frames:number;readonly durationS:number;readonly peakBeforeGain:number;readonly gain:number;readonly clippedSamples:0;readonly voices:readonly {id:string;internalRate:number;tractLengthM:number;maxRadiatedPressurePa:number}[];}
const MOTOR_SCALARS=['pitchHz','lungPressurePa','voicing','frication','aspiration','nasalPortAreaCm2'] as const;
/** Absolute sample indices own phase/noise/control across arbitrary blocks. */
export class NativeSpeechStream {
  private readonly motor:NativeSpeechMotor;private readonly tract:NativeVocalTract;private readonly state:VocalMotorFrame;
  private readonly controlA:VocalMotorFrame;private readonly controlB:VocalMotorFrame;private controlIndex=-1;
  private outputIndex=0;private internalIndex=0;private previous=0;private next=0;private lowpass=0;
  readonly voice:NativeSpeechVoice;readonly sampleRate:number;
  constructor(plan:NativeSpeechPlan,speakerId:string,sampleRate=44100,seed=0x51ee){
    finite(sampleRate,16000,96000,'sample rate');if(!Number.isInteger(sampleRate))throw new RangeError('Sample rate must be integer');
    this.sampleRate=sampleRate;this.motor=new NativeSpeechMotor(plan,speakerId);this.voice=this.motor.voice;this.tract=new NativeVocalTract(this.voice.tractLengthM,seed);this.state=createVocalMotorFrame(this.voice.tractLengthM);
    this.controlA=createVocalMotorFrame(this.voice.tractLengthM);this.controlB=createVocalMotorFrame(this.voice.tractLengthM);
  }
  render(output:Float32Array):void{
    const ratio=this.tract.internalRate/this.sampleRate,alpha=1-Math.exp(-TAU*Math.min(11000,this.sampleRate*.4)/this.tract.internalRate);
    for(let i=0;i<output.length;i++){
      const target=this.outputIndex++*ratio;
      while(this.internalIndex<=target){
        this.previous=this.next;
        const time=this.internalIndex/this.tract.internalRate,control=Math.floor(time*240),u=time*240-control;
        if(control!==this.controlIndex){this.motor.sample(control/240,this.controlA);this.motor.sample((control+1)/240,this.controlB);this.controlIndex=control;}
        const a=this.controlA,b=this.controlB,state=this.state;state.timeS=time;state.phone=a.phone;state.constrictionSection=a.constrictionSection;
        for(const key of MOTOR_SCALARS)state[key]=a[key]+(b[key]-a[key])*u;
        for(let j=0;j<44;j++)state.oralAreaCm2[j]=a.oralAreaCm2[j]!+(b.oralAreaCm2[j]!-a.oralAreaCm2[j]!)*u;
        this.tract.setGeometry(state);const raw=this.tract.step(state,this.voice);this.lowpass+=alpha*(raw-this.lowpass);this.next=this.lowpass;this.internalIndex++;
      }
      const u=target-(this.internalIndex-1);output[i]=this.previous+(this.next-this.previous)*u;
    }
  }
  inspect(){return{id:this.voice.id,internalRate:this.tract.internalRate,tractLengthM:this.voice.tractLengthM,maxRadiatedPressurePa:this.tract.maxPressurePa};}
}
export function renderNativeSpeech(plan:NativeSpeechPlan,{sampleRate=44100,durationS,seed=20261005}:{sampleRate?:number;durationS?:number;seed?:number}={}){
  plan=nativeSpeechPlan(plan.speakers,plan.turns);finite(sampleRate,16000,96000,'sample rate');if(!Number.isInteger(sampleRate))throw new RangeError('Sample rate must be integer');
  const end=Math.max(...plan.turns.map(t=>t.startS+t.segments.reduce((sum,s)=>sum+s.durationS,0)))+.15,duration=durationS??end;finite(duration,end,601,'output duration');
  const frames=Math.ceil(duration*sampleRate),left=new Float32Array(frames),right=new Float32Array(frames),block=new Float32Array(1024),voices=[];
  for(let vi=0;vi<plan.speakers.length;vi++){
    const voice=plan.speakers[vi]!,stream=new NativeSpeechStream(plan,voice.id,sampleRate,seed+vi*7919),theta=(voice.pan+1)*Math.PI/4,gl=Math.cos(theta),gr=Math.sin(theta);
    for(let offset=0;offset<frames;offset+=block.length){const output=block.subarray(0,Math.min(block.length,frames-offset));stream.render(output);for(let i=0;i<output.length;i++){left[offset+i]=left[offset+i]!+output[i]!*gl;right[offset+i]=right[offset+i]!+output[i]!*gr;}}
    voices.push(stream.inspect());
  }
  let peak=0;for(let i=0;i<frames;i++){if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw new Error('Nonfinite native mix');peak=Math.max(peak,Math.abs(left[i]!),Math.abs(right[i]!));}
  if(peak<1e-12)throw new Error('Native speech output is silent');const gain=.92/peak;
  for(let i=0;i<frames;i++){left[i]=left[i]!*gain;right[i]=right[i]!*gain;}
  const diagnostics:NativeSpeechDiagnostics={backend:'native-typescript',sampleRate,frames,durationS:frames/sampleRate,peakBeforeGain:peak,gain,clippedSamples:0,voices};return{audio:{sampleRate,left,right},diagnostics};
}
