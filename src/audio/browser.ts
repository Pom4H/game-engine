import {mulberry32} from '../core/random.js';
import type {EngineEvent} from '../scene/events.js';
import {synthesizeEvent} from './synth.js';

export interface AmbientAudioState {
  windSpeed:number;
  snowfall:number;
  trafficCount:number;
  trafficSpeed:number;
  roadWetness:number;
  slush:number;
}

export class ProceduralAudio {
  private context:AudioContext|null=null;
  private unlocked=false;
  private disposed=false;
  private ambient:AmbientGraph|null=null;

  constructor(){
    const unlock=()=>{void this.unlock();};
    addEventListener('pointerdown',unlock,{once:true,capture:true});
    addEventListener('touchstart',unlock,{once:true,capture:true,passive:true});
    addEventListener('keydown',unlock,{once:true,capture:true});
  }

  async unlock():Promise<boolean>{
    if(this.disposed)return false;
    const context=this.ensure();
    this.ensureAmbient(context);
    // iOS/WebKit requires resume to happen directly from the user gesture.
    if(context.state!=='running')await context.resume();
    this.unlocked=context.state==='running';
    if(this.unlocked)this.confirmUnlocked(context);
    return this.unlocked;
  }

  updateAmbient(state:AmbientAudioState):void{
    if(!this.unlocked||this.disposed)return;
    const context=this.ensure();if(context.state!=='running')return;
    const graph=this.ensureAmbient(context),now=context.currentTime;
    const wind=Math.min(1,Math.max(0,state.windSpeed/12));
    const snow=Math.min(1,Math.max(0,state.snowfall));
    const traffic=Math.min(1,Math.max(0,state.trafficCount/5));
    const speed=Math.min(1,Math.max(0,state.trafficSpeed/18));
    const wet=Math.min(1,Math.max(0,state.roadWetness));
    const slush=Math.min(1,Math.max(0,state.slush));

    smooth(graph.windGain.gain,0.015+wind*.16,now,.18);
    smooth(graph.windFilter.frequency,420+wind*1250,now,.2);

    smooth(graph.snowGain.gain,snow*(.012+.032*wind),now,.22);
    smooth(graph.snowFilter.frequency,2200+snow*2200,now,.2);

    const rolling=traffic*speed;
    smooth(graph.roadGain.gain,rolling*(.025+wet*.09+slush*.08),now,.12);
    smooth(graph.roadFilter.frequency,420+speed*1050+wet*280,now,.12);
    smooth(graph.humGain.gain,rolling*.018,now,.2);
    smooth(graph.hum.frequency,54+speed*72,now,.18);

    // Wet/slushy surfaces add a softer broad splash layer instead of a sample.
    smooth(graph.slushGain.gain,rolling*(wet*.028+slush*.065),now,.1);
    smooth(graph.slushFilter.frequency,700+speed*850,now,.12);
  }

  play(events:readonly EngineEvent[]):void{
    if(!events.length||!this.unlocked||this.disposed)return;
    const context=this.ensure();if(context.state!=='running')return;
    for(const event of events){
      if(event.type==='impact'&&event.energy<.02)continue;
      const voice=synthesizeEvent(event,context.sampleRate),buffer=context.createBuffer(2,voice.left.length,context.sampleRate);
      buffer.getChannelData(0).set(voice.left);buffer.getChannelData(1).set(voice.right);
      const source=context.createBufferSource(),gain=context.createGain();
      gain.gain.value=.72;source.buffer=buffer;source.connect(gain).connect(context.destination);source.start();
    }
  }

  inspect(){return{enabled:true,unlocked:this.unlocked,state:this.context?.state??'locked',ambient:this.ambient!==null};}

  dispose():void{
    this.disposed=true;
    this.ambient?.wind.stop();this.ambient?.snow.stop();this.ambient?.road.stop();this.ambient?.slush.stop();this.ambient?.hum.stop();
    this.ambient=null;void this.context?.close();this.context=null;
  }

  private ensure():AudioContext{
    if(this.context)return this.context;
    const AudioContextCtor=globalThis.AudioContext??(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!AudioContextCtor)throw new Error('WebAudio is unavailable');
    this.context=new AudioContextCtor({latencyHint:'interactive'});
    return this.context;
  }

  private ensureAmbient(context:AudioContext):AmbientGraph{
    if(this.ambient)return this.ambient;
    const master=context.createGain();master.gain.value=.72;master.connect(context.destination);

    const wind=noiseSource(context,11),windFilter=context.createBiquadFilter(),windGain=context.createGain();
    windFilter.type='lowpass';windFilter.frequency.value=650;windGain.gain.value=0;
    wind.connect(windFilter).connect(windGain).connect(master);

    const snow=noiseSource(context,29),snowFilter=context.createBiquadFilter(),snowGain=context.createGain();
    snowFilter.type='highpass';snowFilter.frequency.value=2600;snowGain.gain.value=0;
    snow.connect(snowFilter).connect(snowGain).connect(master);

    const road=noiseSource(context,47),roadFilter=context.createBiquadFilter(),roadGain=context.createGain();
    roadFilter.type='bandpass';roadFilter.frequency.value=720;roadFilter.Q.value=.55;roadGain.gain.value=0;
    road.connect(roadFilter).connect(roadGain).connect(master);

    const slush=noiseSource(context,73),slushFilter=context.createBiquadFilter(),slushGain=context.createGain();
    slushFilter.type='lowpass';slushFilter.frequency.value=1250;slushGain.gain.value=0;
    slush.connect(slushFilter).connect(slushGain).connect(master);

    const hum=context.createOscillator(),humGain=context.createGain();
    hum.type='triangle';hum.frequency.value=62;humGain.gain.value=0;
    hum.connect(humGain).connect(master);

    wind.start();snow.start();road.start();slush.start();hum.start();
    this.ambient={master,wind,windFilter,windGain,snow,snowFilter,snowGain,road,roadFilter,roadGain,slush,slushFilter,slushGain,hum,humGain};
    return this.ambient;
  }

  private confirmUnlocked(context:AudioContext):void{
    // A very short low-level chime confirms to the user that iOS actually opened audio.
    const oscillator=context.createOscillator(),gain=context.createGain(),now=context.currentTime;
    oscillator.type='sine';oscillator.frequency.setValueAtTime(520,now);oscillator.frequency.exponentialRampToValueAtTime(660,now+.045);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.022,now+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+.07);
    oscillator.connect(gain).connect(context.destination);oscillator.start(now);oscillator.stop(now+.075);
  }
}

interface AmbientGraph {
  master:GainNode;
  wind:AudioBufferSourceNode;windFilter:BiquadFilterNode;windGain:GainNode;
  snow:AudioBufferSourceNode;snowFilter:BiquadFilterNode;snowGain:GainNode;
  road:AudioBufferSourceNode;roadFilter:BiquadFilterNode;roadGain:GainNode;
  slush:AudioBufferSourceNode;slushFilter:BiquadFilterNode;slushGain:GainNode;
  hum:OscillatorNode;humGain:GainNode;
}

function noiseSource(context:AudioContext,seed:number):AudioBufferSourceNode{
  const seconds=3,count=Math.round(context.sampleRate*seconds),buffer=context.createBuffer(1,count,context.sampleRate),data=buffer.getChannelData(0),rng=mulberry32(seed);
  let brown=0;
  for(let i=0;i<count;i++){const white=rng()*2-1;brown=(brown*.965+white*.035);data[i]=white*.58+brown*.72;}
  const source=context.createBufferSource();source.buffer=buffer;source.loop=true;return source;
}

function smooth(param:AudioParam,value:number,now:number,time:number){param.setTargetAtTime(value,now,time);}
