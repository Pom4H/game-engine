import type {Vec3} from '../math.js';
import {V3} from '../math.js';
import {AcousticWaveField} from '../physics/wave-field.js';
import type {AudioChannels} from './synth.js';

export interface AcousticArrival {
  readonly delayS:number;
  /** Linear amplitude relative to the same source in an empty field. */
  readonly gain:number;
  /** World-space direction from listener toward the arriving wave origin. */
  readonly direction:Vec3;
  /** Control-rate spectral proxy consumed by WebAudio/offline filters. */
  readonly lowpassHz:number;
}

export interface AcousticLateField {
  readonly gain:number;
  readonly rt60S:number;
  readonly damping:number;
  readonly diffusion:number;
}

export interface AcousticTransferObservation {
  readonly direct:AcousticArrival;
  readonly reflections:readonly AcousticArrival[];
  readonly late:AcousticLateField;
  readonly diagnostics:{
    readonly geometricDelayS:number;
    readonly sourcePeakPressurePa:number;
    readonly emptyFieldPeakPressurePa:number;
    readonly listenerPeakPressurePa:number;
    readonly extraDelayS:number;
    readonly sampleDtS:number;
    readonly samples:number;
  };
}

export interface AcousticTransferTraceOptions {
  readonly acousticEnergyJ?:number;
  readonly sourceRadiusM?:number;
  readonly durationS?:number;
  readonly dtS?:number;
  readonly earlyWindowS?:number;
  readonly maxReflections?:number;
  readonly arrivalThreshold?:number;
}

export interface AcousticRenderOptions {
  readonly listenerRight?:Vec3;
  readonly outputDurationS?:number;
  readonly level?:number;
}

const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));

/**
 * Convert the coarse pressure field into a control-rate transfer description.
 * The field is advanced at its stable physics rate; WebAudio never sees those
 * substeps. An empty field with identical numerical/medium parameters provides
 * the independent unobstructed amplitude reference.
 */
export function traceAcousticTransfer(
  field:AcousticWaveField,
  source:Vec3,
  listener:Vec3,
  options:AcousticTransferTraceOptions={},
):AcousticTransferObservation{
  if(!source.every(Number.isFinite)||!listener.every(Number.isFinite))throw new TypeError('Acoustic source/listener must be finite');
  const energy=options.acousticEnergyJ??1,radius=options.sourceRadiusM??Math.max(field.cellSizeM*.9,.2);
  const distance=V3.length(V3.sub(listener,source)),geometricDelayS=distance/field.waveSpeedMps;
  const durationS=options.durationS??Math.max(.18,geometricDelayS+.14);
  if(!Number.isFinite(durationS)||durationS<=geometricDelayS)throw new RangeError('Acoustic trace duration must exceed geometric arrival time');
  const dtS=Math.min(options.dtS??field.maxStableDt*.88,field.maxStableDt*.98);
  if(!Number.isFinite(dtS)||dtS<=0)throw new RangeError('Acoustic trace dt must be positive');
  const steps=Math.ceil(durationS/dtS),earlyWindow=options.earlyWindowS??.085,maxReflections=Math.max(0,Math.min(16,Math.floor(options.maxReflections??6)));
  const thresholdFraction=clamp(options.arrivalThreshold??.035,.001,.5);

  const reference=new AcousticWaveField({
    size:field.size,
    origin:field.origin,
    cellSizeM:field.cellSizeM,
    waveSpeedMps:field.waveSpeedMps,
    densityKgM3:field.densityKgM3,
    velocityDampingPerSecond:field.velocityDampingPerSecond,
  });
  field.clearWaveState();reference.clearWaveState();
  const actualSource=field.injectBlast({position:source,acousticEnergyJ:energy,radiusM:radius});
  const referenceSource=reference.injectBlast({position:source,acousticEnergyJ:energy,radiusM:radius});
  const actual=new Float64Array(steps),empty=new Float64Array(steps),directions:Array<Vec3>=Array.from({length:steps},()=>[0,0,0] as Vec3);
  for(let i=0;i<steps;i++){
    field.step(dtS);reference.step(dtS);
    actual[i]=field.pressureAt(listener);empty[i]=reference.pressureAt(listener);
    const velocity=field.velocityAt(listener);
    directions[i]=V3.length(velocity)>1e-10?V3.scale(V3.normalize(velocity),-1):V3.normalize(V3.sub(source,listener));
  }

  const geometricIndex=Math.max(1,Math.floor(geometricDelayS/dtS*.72));
  const referenceEnd=Math.min(steps,Math.ceil((geometricDelayS+.035)/dtS));
  let emptyPeak=0;for(let i=geometricIndex;i<referenceEnd;i++)emptyPeak=Math.max(emptyPeak,Math.abs(empty[i]!));
  if(emptyPeak<=1e-15)throw new Error('Empty acoustic reference did not reach the listener');
  let listenerPeak=0;for(const value of actual)listenerPeak=Math.max(listenerPeak,Math.abs(value));

  const threshold=emptyPeak*thresholdFraction;
  const directIndex=findPeak(actual,geometricIndex,steps,threshold,Math.max(1,Math.floor(.002/dtS)));
  const directPressure=directIndex>=0?Math.abs(actual[directIndex]!):0;
  const directDelay=directIndex>=0?(directIndex+1)*dtS:geometricDelayS;
  const directGain=clamp(directPressure/emptyPeak,0,2);
  const extraDelay=Math.max(0,directDelay-geometricDelayS);
  const direct:AcousticArrival=Object.freeze({
    delayS:directDelay,
    gain:directGain,
    direction:Object.freeze([...(directIndex>=0?directions[directIndex]!:V3.normalize(V3.sub(source,listener)))]) as Vec3,
    lowpassHz:cutoffFor(directGain,extraDelay),
  });

  const reflections:AcousticArrival[]=[];
  if(directIndex>=0&&maxReflections>0){
    const minGap=Math.max(1,Math.floor(.006/dtS)),end=Math.min(steps,directIndex+Math.ceil(earlyWindow/dtS));
    let cursor=directIndex+minGap;
    while(cursor<end&&reflections.length<maxReflections){
      const peak=findPeak(actual,cursor,end,emptyPeak*.02,minGap);
      if(peak<0)break;
      const amplitude=Math.abs(actual[peak]!)/emptyPeak,delay=(peak+1)*dtS;
      reflections.push(Object.freeze({
        delayS:delay,
        gain:clamp(amplitude,0,1.5),
        direction:Object.freeze([...directions[peak]!]) as Vec3,
        lowpassHz:cutoffFor(clamp(amplitude,0,1),Math.max(0,delay-geometricDelayS)),
      }));
      cursor=peak+minGap;
    }
  }

  const lateStart=directIndex>=0?Math.min(steps,directIndex+Math.ceil(earlyWindow/dtS)):steps;
  const late=estimateLate(actual,lateStart,dtS,emptyPeak,field.velocityDampingPerSecond,reflections.length);
  return Object.freeze({
    direct,
    reflections:Object.freeze(reflections),
    late,
    diagnostics:Object.freeze({
      geometricDelayS,
      sourcePeakPressurePa:Math.max(actualSource.peakPressurePa,referenceSource.peakPressurePa),
      emptyFieldPeakPressurePa:emptyPeak,
      listenerPeakPressurePa:listenerPeak,
      extraDelayS:extraDelay,
      sampleDtS:dtS,
      samples:steps,
    }),
  });
}

function findPeak(values:Float64Array,start:number,end:number,threshold:number,minGap:number):number{
  for(let i=Math.max(1,start);i<Math.min(values.length-1,end);i++){
    const a=Math.abs(values[i-1]!),b=Math.abs(values[i]!),c=Math.abs(values[i+1]!);
    if(b>=threshold&&b>=a&&b>=c){
      let best=i,bestValue=b,limit=Math.min(end,i+minGap);
      for(let j=i+1;j<limit;j++){const v=Math.abs(values[j]!);if(v>bestValue){bestValue=v;best=j;}}
      return best;
    }
  }
  return-1;
}

function cutoffFor(gain:number,extraDelay:number):number{
  if(gain<=1e-6)return 250;
  return Math.max(250,Math.min(18_000,250+17_750*Math.pow(clamp(gain),.32)*Math.exp(-extraDelay*10)));
}

function estimateLate(values:Float64Array,start:number,dt:number,referencePeak:number,dampingPerSecond:number,reflectionCount:number):AcousticLateField{
  if(start>=values.length-4)return Object.freeze({gain:0,rt60S:0,damping:clamp(1-Math.exp(-dampingPerSecond*.12)),diffusion:0});
  let energy=0,count=0;for(let i=start;i<values.length;i++){const p=values[i]!;energy+=p*p;count++;}
  const gain=clamp(Math.sqrt(energy/Math.max(1,count))/referencePeak,0,1.5);
  const window=Math.max(2,Math.round(.008/dt)),xs:number[]=[],ys:number[]=[];
  for(let at=start;at+window<=values.length;at+=window){
    let e=0;for(let i=at;i<at+window;i++){const p=values[i]!;e+=p*p;}e/=window;
    if(e<=referencePeak*referencePeak*1e-10)continue;
    xs.push((at+window*.5)*dt);ys.push(10*Math.log10(e/(referencePeak*referencePeak)));
  }
  let rt60S=0;
  if(xs.length>=3){
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
    let covariance=0,variance=0;for(let i=0;i<xs.length;i++){const dx=xs[i]!-mx;covariance+=dx*(ys[i]!-my);variance+=dx*dx;}
    const slope=variance>1e-12?covariance/variance:0;
    if(slope<-.1)rt60S=clamp(-60/slope,.05,8);
  }
  return Object.freeze({
    gain,
    rt60S,
    damping:clamp(1-Math.exp(-dampingPerSecond*.12)),
    diffusion:clamp(reflectionCount/6+gain*.35),
  });
}

/**
 * Deterministic sample-rate rendering of the same transfer contract used by
 * WebAudio. Used by CI/replay evidence; the wave field itself is not evaluated
 * at audio sample rate.
 */
export function renderAcousticTransfer(source:AudioChannels,transfer:AcousticTransferObservation,options:AcousticRenderOptions={}):AudioChannels{
  const sampleRate=source.sampleRate,sourceDuration=Math.max(source.left.length,source.right.length)/sampleRate;
  const maxReflection=transfer.reflections.reduce((m,r)=>Math.max(m,r.delayS),transfer.direct.delayS);
  const tail=Math.min(4,Math.max(maxReflection,transfer.direct.delayS)+(transfer.late.rt60S||0));
  const duration=options.outputDurationS??Math.max(sourceDuration+maxReflection,sourceDuration+tail);
  const count=Math.max(1,Math.ceil(duration*sampleRate)),left=new Float32Array(count),right=new Float32Array(count);
  const mono=new Float32Array(Math.min(source.left.length,source.right.length));for(let i=0;i<mono.length;i++)mono[i]=(source.left[i]!+source.right[i]!)*.5;
  const rightAxis=V3.normalize(options.listenerRight??[1,0,0]),level=options.level??1;
  mixArrival(left,right,mono,sampleRate,transfer.direct,rightAxis,level);
  for(const reflection of transfer.reflections)mixArrival(left,right,mono,sampleRate,reflection,rightAxis,level*.72);
  if(transfer.late.gain>1e-5&&transfer.late.rt60S>.02)mixLate(left,right,mono,sampleRate,transfer,rightAxis,level);
  for(let i=0;i<count;i++){left[i]=Math.tanh(left[i]!*.92);right[i]=Math.tanh(right[i]!*.92);}
  return{left,right,sampleRate};
}

function mixArrival(left:Float32Array,right:Float32Array,mono:Float32Array,sampleRate:number,arrival:AcousticArrival,rightAxis:Vec3,level:number):void{
  if(arrival.gain<=1e-8)return;
  const filtered=lowpass(mono,sampleRate,arrival.lowpassHz),offset=Math.round(arrival.delayS*sampleRate),pan=clamp(V3.dot(arrival.direction,rightAxis),-1,1),gainL=Math.sqrt((1-pan)*.5),gainR=Math.sqrt((1+pan)*.5),gain=arrival.gain*level;
  for(let i=0;i<filtered.length&&i+offset<left.length;i++){const sample=filtered[i]!*gain;left[i+offset]!+=sample*gainL;right[i+offset]!+=sample*gainR;}
}

function lowpass(input:Float32Array,sampleRate:number,cutoffHz:number):Float32Array{
  const out=new Float32Array(input.length),cutoff=Math.max(20,Math.min(sampleRate*.45,cutoffHz)),alpha=1-Math.exp(-2*Math.PI*cutoff/sampleRate);let state=0;
  for(let i=0;i<input.length;i++){state+=alpha*(input[i]!-state);out[i]=state;}return out;
}

function mixLate(left:Float32Array,right:Float32Array,mono:Float32Array,sampleRate:number,transfer:AcousticTransferObservation,rightAxis:Vec3,level:number):void{
  const start=Math.round((transfer.direct.delayS+.055)*sampleRate),rt60=Math.max(.05,transfer.late.rt60S),lateGain=transfer.late.gain*level*.42;
  const delaysL=[.0297,.0371,.0411,.0533],delaysR=[.0311,.0397,.0437,.0593];
  const render=(out:Float32Array,delays:readonly number[])=>{
    for(const seconds of delays){
      const delay=Math.max(1,Math.round(seconds*sampleRate)),feedback=Math.min(.985,Math.pow(10,-3*seconds/rt60)),comb=new Float32Array(out.length);let damped=0;
      const damping=.18+.62*transfer.late.damping;
      for(let n=0;n<out.length;n++){
        const sourceIndex=n-start,input=sourceIndex>=0&&sourceIndex<mono.length?mono[sourceIndex]!*lateGain/delays.length:0;
        const delayed=n>=delay?comb[n-delay]!:0;damped+= (delayed-damped)*(1-damping*.65);comb[n]=input+damped*feedback;out[n]!+=comb[n]!;
      }
    }
  };
  render(left,delaysL);render(right,delaysR);
  // Preserve a weak directional bias of the room's first arrival without turning
  // the diffuse tail back into a point source.
  const pan=clamp(V3.dot(transfer.direct.direction,rightAxis),-1,1)*.18,lg=Math.sqrt((1-pan)*.5),rg=Math.sqrt((1+pan)*.5);
  for(let i=0;i<left.length;i++){left[i]=left[i]!*lg*Math.SQRT2;right[i]=right[i]!*rg*Math.SQRT2;}
}

export interface AcousticWebAudioGraph {
  readonly nodes:readonly AudioNode[];
  disconnect():void;
}

/**
 * Build a sample-rate WebAudio projection from one immutable transfer snapshot.
 * direction is world-space; listenerRight maps it to stereo. Moving sources may
 * rebuild/crossfade snapshots at control rate without running wave physics here.
 */
export function connectAcousticWebAudio(
  context:BaseAudioContext,
  source:AudioNode,
  destination:AudioNode,
  transfer:AcousticTransferObservation,
  options:{readonly listenerRight?:Vec3;readonly level?:number}={},
):AcousticWebAudioGraph{
  const nodes:AudioNode[]=[],rightAxis=V3.normalize(options.listenerRight??[1,0,0]),level=options.level??1;
  const path=(arrival:AcousticArrival,pathLevel:number)=>{
    if(arrival.gain<=1e-8)return;
    const delay=context.createDelay(Math.max(1,arrival.delayS+.1)),filter=context.createBiquadFilter(),gain=context.createGain(),pan=context.createStereoPanner();
    delay.delayTime.value=arrival.delayS;filter.type='lowpass';filter.frequency.value=arrival.lowpassHz;filter.Q.value=.3;gain.gain.value=arrival.gain*pathLevel;
    pan.pan.value=clamp(V3.dot(arrival.direction,rightAxis),-.95,.95);
    source.connect(delay);delay.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(destination);nodes.push(delay,filter,gain,pan);
  };
  path(transfer.direct,level);for(const reflection of transfer.reflections)path(reflection,level*.72);
  if(transfer.late.gain>1e-5&&transfer.late.rt60S>.02){
    const input=context.createGain();input.gain.value=transfer.late.gain*level*.32;source.connect(input);nodes.push(input);
    for(const seconds of [.0297,.0371,.0411,.0533]){
      const delay=context.createDelay(.2),filter=context.createBiquadFilter(),feedback=context.createGain(),out=context.createGain();
      delay.delayTime.value=seconds;filter.type='lowpass';filter.frequency.value=18_000-(14_000*transfer.late.damping);feedback.gain.value=Math.min(.985,Math.pow(10,-3*seconds/Math.max(.05,transfer.late.rt60S)));out.gain.value=.22;
      input.connect(delay);delay.connect(filter);filter.connect(feedback);feedback.connect(delay);filter.connect(out);out.connect(destination);nodes.push(delay,filter,feedback,out);
    }
  }
  return Object.freeze({nodes:Object.freeze(nodes),disconnect(){for(const node of nodes){try{node.disconnect();}catch{}}}});
}
