import {ProceduralAudio} from '../audio/browser.js';
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
  resume():void{if(this.disposed||this.running)return;this.running=true;this.clock.reset(performance.now());this.raf=requestAnimationFrame(this.frame);}
  step(count=1){
    if(!Number.isSafeInteger(count)||count<1||count>1_000_000)throw new RangeError('step count must be an integer in [1, 1000000]');
    const events:EngineEvent[]=[];for(let i=0;i<count;i++){this.scene.step(this.stepSeconds);events.push(...this.scene.drainEvents());}
    this.audio?.play(events);this.render();return this.scene.snapshot();
  }
  seek(seconds:number){
    if(!Number.isFinite(seconds)||seconds<0||seconds>86_400)throw new RangeError('seek time must be within one day');
    this.pause();if(seconds+1e-9<this.scene.time)this.reset();
    const target=Math.round(seconds*this.tickRate),remaining=Math.max(0,target-this.scene.tick);
    for(let i=0;i<remaining;i++){this.scene.step(this.stepSeconds);this.scene.drainEvents();}
    this.render();return this.scene.snapshot();
  }
  reset():void{this.scene=new Scene(this.initial);this.render();}
  setCamera(camera:CameraSpec):void{this.scene.setCamera(camera);this.render();}
  render():RenderStats{this.renderer.render(this.scene);return this.renderer.inspect();}
  async flush():Promise<void>{await this.renderer.flush();}
  snapshot(){return this.scene.snapshot();}
  inspect(){return{time:this.scene.time,tick:this.scene.tick,physics:this.scene.physics.stats,renderer:this.renderer.inspect(),audio:this.audio?.inspect()??{enabled:false}};}
  async capture(type='image/png',quality?:number):Promise<Blob>{this.render();await this.renderer.flush();return await new Promise<Blob>((resolve,reject)=>this.canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Canvas capture failed')),type,quality));}
  dispose():void{this.pause();this.disposed=true;this.audio?.dispose();this.renderer.dispose();if((globalThis as any).__GAME_ENGINE__)delete (globalThis as any).__GAME_ENGINE__;}

  bridge():EngineBridge{return{snapshot:()=>this.snapshot(),pause:()=>this.pause(),resume:()=>this.resume(),step:(count=1)=>this.step(count),seek:seconds=>this.seek(seconds),setCamera:camera=>this.setCamera(camera),render:()=>this.render(),flush:()=>this.flush(),inspect:()=>this.inspect()};}
  private frame=(now:number)=>{
    if(!this.running)return;
    const events:EngineEvent[]=[];
    this.clock.advance(now,()=>{this.scene.step(this.stepSeconds);events.push(...this.scene.drainEvents());});
    this.audio?.play(events);this.render();this.raf=requestAnimationFrame(this.frame);
  };
}
