import type {EngineEvent} from '../scene/events.js';
import {synthesizeEvent} from './synth.js';

export class ProceduralAudio {
  private context:AudioContext|null=null;
  private unlocked=false;
  private disposed=false;
  constructor(){
    const unlock=()=>{if(this.disposed)return;this.ensure();void this.context?.resume();this.unlocked=true;};
    addEventListener('pointerdown',unlock,{once:true,capture:true});addEventListener('keydown',unlock,{once:true,capture:true});
  }
  play(events:readonly EngineEvent[]):void{
    if(!events.length||!this.unlocked||this.disposed)return;
    const context=this.ensure();if(context.state!=='running')return;
    for(const event of events){if(event.type==='impact'&&event.energy<.02)continue;const voice=synthesizeEvent(event,context.sampleRate),buffer=context.createBuffer(2,voice.left.length,context.sampleRate);buffer.getChannelData(0).set(voice.left);buffer.getChannelData(1).set(voice.right);const source=context.createBufferSource(),gain=context.createGain();gain.gain.value=.72;source.buffer=buffer;source.connect(gain).connect(context.destination);source.start();}
  }
  inspect(){return{enabled:true,unlocked:this.unlocked,state:this.context?.state??'locked'};}
  dispose():void{this.disposed=true;void this.context?.close();this.context=null;}
  private ensure():AudioContext{if(!this.context)this.context=new AudioContext({latencyHint:'interactive'});return this.context;}
}
