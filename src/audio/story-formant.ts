import {LfGlottalSource} from './lf-glottal.js';
import {storyArea,storyControlForConsonant,storyControlForVowel,STORY_NOMINAL_TRACT_LENGTH_CM,STORY_SECTIONS,type StoryAreaControl} from './story-area-model.js';
import type {AudioChannels} from './synth.js';

const C_CM_S=34300;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

export interface StoryFormant{
  readonly hz:number;
  readonly strength:number;
}
export interface StoryFormantAnalysis{
  readonly formants:readonly StoryFormant[];
  readonly tractLengthCm:number;
}
export interface StoryFormantRender{
  readonly audio:AudioChannels;
  readonly analysis:StoryFormantAnalysis;
  readonly phrase:string;
}

/**
 * Lossless 1-D tube transfer matrix. With an open lip termination p(L)=0,
 * volume-velocity transmission is proportional to 1/D of the cascaded matrix.
 * This is a cheap projection of the same MRI area function used by Story/VTL.
 */
function tubeResponse(area:readonly number[],frequencyHz:number,lengthCm:number):number{
  const n=area.length,dx=lengthCm/n,k=2*Math.PI*frequencyHz/C_CM_S;
  let A=1,Bi=0,Ci=0,D=1;
  for(let i=0;i<n;i++){
    const S=Math.max(1e-4,area[i]!),phase=k*dx,c=Math.cos(phase),s=Math.sin(phase);
    // Normalize rho*c away; only area ratios matter for resonance location.
    const bi=s/S,ci=s*S;
    const nA=A*c-Bi*ci;
    const nBi=A*bi+Bi*c;
    const nCi=Ci*c+D*ci;
    const nD=-Ci*bi+D*c;
    A=nA;Bi=nBi;Ci=nCi;D=nD;
  }
  return 1/Math.max(1e-8,Math.abs(D));
}

export function storyExtractFormants(
  control:StoryAreaControl,
  count=4,
  tractLengthCm=STORY_NOMINAL_TRACT_LENGTH_CM,
):StoryFormantAnalysis{
  const area=storyArea(control),peaks:{hz:number;strength:number}[]=[];
  let prev2=0,prev=0;
  for(let hz=100;hz<=5200;hz+=5){
    const value=Math.log1p(tubeResponse(area,hz,tractLengthCm));
    if(hz>105&&prev>prev2&&prev>=value)peaks.push({hz:hz-5,strength:prev});
    prev2=prev;prev=value;
  }
  peaks.sort((a,b)=>a.hz-b.hz);
  const chosen:{hz:number;strength:number}[]=[];
  for(const peak of peaks){
    if(peak.hz<150)continue;
    if(chosen.some(x=>Math.abs(x.hz-peak.hz)<160))continue;
    chosen.push(peak);
    if(chosen.length>=count)break;
  }
  return Object.freeze({
    formants:Object.freeze(chosen.map(x=>Object.freeze(x))),
    tractLengthCm,
  });
}

class Resonator{
  private y1=0;private y2=0;
  step(x:number,fHz:number,bwHz:number,fs:number):number{
    const r=Math.exp(-Math.PI*bwHz/fs),theta=2*Math.PI*fHz/fs;
    const a1=2*r*Math.cos(theta),a2=-r*r;
    const g=Math.max(.0001,1-r);
    const y=g*x+a1*this.y1+a2*this.y2;
    this.y2=this.y1;this.y1=y;return y;
  }
}
class Notch{
  private x1=0;private x2=0;private y1=0;private y2=0;
  step(x:number,fHz:number,bwHz:number,fs:number):number{
    const theta=2*Math.PI*fHz/fs,r=Math.exp(-Math.PI*bwHz/fs);
    const b1=-2*Math.cos(theta),b2=1,a1=-2*r*Math.cos(theta),a2=r*r;
    const y=x+b1*this.x1+b2*this.x2-a1*this.y1-a2*this.y2;
    this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y;
  }
}

function interpolate(a:number,b:number,u:number):number{return a+(b-a)*u;}
function smooth(t:number):number{const x=clamp(t,0,1);return x*x*(3-2*x);}

export function synthesizeStoryFormantMama(sampleRate=44_100):StoryFormantRender{
  if(sampleRate!==44_100&&sampleRate!==48_000&&sampleRate!==16_000)throw new RangeError('Unsupported Story formant sample rate');
  const vowel=storyExtractFormants(storyControlForVowel('aa'),4);
  if(vowel.formants.length<4)throw new Error('Story /aa/ did not expose four resonances');

  const vowelF=vowel.formants.map(x=>x.hz);
  const nasalF=[250,1020,2250,3150];
  const bwV=[70,90,120,180],bwN=[85,130,180,240];
  const duration=1.86,count=Math.ceil(duration*sampleRate),left=new Float32Array(count),right=new Float32Array(count);
  const lf=new LfGlottalSource(sampleRate),filters=[new Resonator(),new Resonator(),new Resonator(),new Resonator()],notch=new Notch();

  const stateAt=(t:number):{nasal:number;amp:number;f0:number;u:number}=>{
    if(t<.28)return{nasal:1,amp:0,f0:112,u:0};
    if(t<.49)return{nasal:1,amp:.52,f0:112,u:0};
    if(t<.84){const q=smooth((t-.49)/.055);return{nasal:1-q,amp:.72+.28*q,f0:112,u:q};}
    if(t<1.04){const q=smooth((t-.84)/.05);return{nasal:q,amp:1-.48*q,f0:110,u:1-q};}
    if(t<1.45){const q=smooth((t-1.04)/.055);return{nasal:1-q,amp:.72+.28*q,f0:108,u:q};}
    return{nasal:0,amp:0,f0:108,u:1};
  };

  for(let i=0;i<count;i++){
    const t=i/sampleRate,s=stateAt(t),src=lf.step({
      f0Hz:s.f0,amplitudeCm3S:300*s.amp,openQuotient:.5,speedQuotient:3,returnPhase:.02,voiced:s.amp>0?1:0,
    });
    // Radiated speech approximates the differentiated glottal-flow source.
    let x=src.derivativeCm3S2/(300*140);
    const mix=s.u;
    for(let k=0;k<4;k++){
      const f=interpolate(nasalF[k]!,vowelF[k]!,mix);
      const bw=interpolate(bwN[k]!,bwV[k]!,mix);
      x=filters[k]!.step(x,f,bw,sampleRate);
    }
    if(s.nasal>.05)x=notch.step(x,780,180,sampleRate);
    // /m/ is quieter and more low-passed than the following vowel.
    x*=interpolate(.34,1,mix);
    left[i]=x;right[i]=x;
  }

  let e=0,peak=0;for(const v of left){e+=v*v;peak=Math.max(peak,Math.abs(v));}
  const rms=Math.sqrt(e/Math.max(1,left.length)),scale=rms>1e-9?.19/rms:1;
  for(let i=0;i<left.length;i++){left[i]=Math.tanh(left[i]!*scale*1.22);right[i]=left[i]!;}
  return Object.freeze({
    audio:Object.freeze({left,right,sampleRate}),
    analysis:vowel,
    phrase:'mama',
  });
}
