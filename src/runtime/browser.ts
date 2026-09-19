import {ProceduralAudio,type AmbientAudioState} from '../audio/browser.js';
import {FixedClock} from '../core/fixed-clock.js';
import {Scene} from '../scene/scene.js';
import type {EngineEvent} from '../scene/events.js';
import type {CameraSpec,SceneSpec} from '../scene/types.js';
import {WebGPURenderer} from '../render/webgpu.js';
import type {EngineBridge,RenderStats,Renderer} from '../render/types.js';

export interface BrowserRuntimeOptions {tickRate?:number;autoplay?:boolean;exposeBridge?:boolean;audio?:boolean}

export class BrowserRuntime {
  scene:Scene;
  readonly renderer:Renderer;
  readonly tickRate:number;
  readonly stepSeconds:number;
  readonly audio:ProceduralAudio|null;
  private readonly initial:SceneSpec;
  private readonly clock:FixedClock;
  private running=false;
  private raf=0;
  private disposed=false;

  private constructor(private readonly canvas:HTMLCanvasElement,scene:SceneSpec,renderer:Renderer,options:BrowserRuntimeOptions){
    this.initial=structuredClone(scene);this.scene=new Scene(this.initial);this.renderer=renderer;this.tickRate=options.tickRate??60;this.stepSeconds=1/this.tickRate;this.clock=new FixedClock(1000/this.tickRate);this.audio=options.audio===false?null:new ProceduralAudio();
  }

  static async create(canvas:HTMLCanvasElement,scene:SceneSpec,options:BrowserRuntimeOptions={}):Promise<BrowserRuntime>{
    const renderer=await WebGPURenderer.create(canvas),runtime=new BrowserRuntime(canvas,scene,renderer,options);
    if(options.exposeBridge!==false)(globalThis as any).__GAME_ENGINE__=runtime.bridge();
    runtime.render();if(options.autoplay!==false)runtime.resume();return runtime;
  }

  pause():void{this.running=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;}
  async activateAudio():Promise<boolean>{const ready=this.audio?await this.audio.unlock():false;if(ready)this.audio?.updateAmbient(this.ambientAudioState());return ready;}
  resume():void{if(this.disposed||this.running)return;this.running=true;this.clock.reset(performance.now());this.raf=requestAnimationFrame(this.frame);}
  step(count=1){
    if(!Number.isSafeInteger(count)||count<1||count>1_000_000)throw new RangeError('step count must be an integer in [1, 1000000]');
    const events:EngineEvent[]=[];for(let i=0;i<count;i++){this.scene.step(this.stepSeconds);events.push(...this.scene.drainEvents());}
    this.audio?.play(events);this.audio?.updateAmbient(this.ambientAudioState());this.render();return this.scene.snapshot();
  }
  seek(seconds:number){
    if(!Number.isFinite(seconds)||seconds<0||seconds>86_400)throw new RangeError('seek time must be within one day');
    this.pause();if(seconds+1e-9<this.scene.time)this.reset();
    const target=Math.round(seconds*this.tickRate),remaining=Math.max(0,target-this.scene.tick);
    for(let i=0;i<remaining;i++){this.scene.step(this.stepSeconds);this.scene.drainEvents();}
    this.audio?.updateAmbient(this.ambientAudioState());this.render();return this.scene.snapshot();
  }
  reset():void{this.scene=new Scene(this.initial);this.render();}
  setCamera(camera:CameraSpec):void{this.scene.setCamera(camera);this.render();}
  render():RenderStats{this.renderer.render(this.scene);return this.renderer.inspect();}
  async flush():Promise<void>{await this.renderer.flush();}
  snapshot(){return this.scene.snapshot();}
  inspect(){return{time:this.scene.time,tick:this.scene.tick,environment:this.scene.environment,winter:{surfaces:[...this.scene.winter.surfaces.values()].map(state=>({...state})),bodies:[...this.scene.winter.bodies.values()].map(state=>({...state}))},physics:this.scene.physics.stats,renderer:this.renderer.inspect(),audio:this.audio?.inspect()??{enabled:false}};}
  async capture(type='image/png',quality?:number):Promise<Blob>{this.render();await this.renderer.flush();return await new Promise<Blob>((resolve,reject)=>this.canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Canvas capture failed')),type,quality));}
  dispose():void{this.pause();this.disposed=true;this.audio?.dispose();this.renderer.dispose();if((globalThis as any).__GAME_ENGINE__)delete (globalThis as any).__GAME_ENGINE__;}

  private ambientAudioState():AmbientAudioState{
    const windSpeed=Math.hypot(this.scene.environment.wind[0],this.scene.environment.wind[2]);
    const snowfall=Math.max(0,Math.min(1,this.scene.environment.snowfallRate/2.2e-5));
    let trafficCount=0,speedSum=0;
    for(const state of this.scene.winter.bodies.values()){
      const entity=this.scene.entities.get(state.id),body=entity?.body;if(!body)continue;
      const speed=Math.hypot(body.velocity[0],body.velocity[2]);if(speed>.4){trafficCount++;speedSum+=speed;}
    }
    let roadWetness=0,slush=0,roads=0;
    for(const state of this.scene.winter.surfaces.values())if(state.use==='road'){
      roads++;roadWetness+=Math.max(state.puddle,Math.min(1,state.waterDepthM/.004));slush+=state.slush;
    }
    return{
      windSpeed,
      snowfall,
      trafficCount,
      trafficSpeed:trafficCount?speedSum/trafficCount:0,
      roadWetness:roads?roadWetness/roads:0,
      slush:roads?slush/roads:0,
    };
  }

  bridge():EngineBridge{return{snapshot:()=>this.snapshot(),pause:()=>this.pause(),resume:()=>this.resume(),step:(count=1)=>this.step(count),seek:seconds=>this.seek(seconds),setCamera:camera=>this.setCamera(camera),render:()=>this.render(),flush:()=>this.flush(),inspect:()=>this.inspect()};}
  private frame=(now:number)=>{
    if(!this.running)return;
    const events:EngineEvent[]=[];
    this.clock.advance(now,()=>{this.scene.step(this.stepSeconds);events.push(...this.scene.drainEvents());});
    this.audio?.play(events);this.audio?.updateAmbient(this.ambientAudioState());this.render();this.raf=requestAnimationFrame(this.frame);
  };
}
