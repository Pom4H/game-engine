import {WalkerControls,type WalkerControlOptions} from './walker-controls.js';
import {V3} from '../math.js';
import type {FootstepSound} from '../audio/footsteps.js';
import {ProceduralAudio,type AmbientAudioState} from '../audio/browser.js';
import {eventAudioDuration} from '../audio/synth.js';
import {FixedClock} from '../core/fixed-clock.js';
import {runtimeMemorySnapshot,trackRuntimeInstance,trackRuntimeMemory} from '../core/runtime-memory.js';
import {beginRuntimeSpan,endRuntimeSpan,recordRuntimeEvent,runtimeTimelineEntry,runtimeTimelinePayload,runtimeTimelineSnapshot,type RuntimeTimelineEntry} from '../core/runtime-timeline.js';
import {Scene} from '../scene/scene.js';
import type {EngineEvent} from '../scene/events.js';
import type {AppearancePatch,CameraSpec,SceneSpec} from '../scene/types.js';
import {WebGPURenderer} from '../render/webgpu.js';
import type {EngineBridge,RenderStats,Renderer} from '../render/types.js';

export interface BrowserRuntimeOptions {tickRate?:number;autoplay?:boolean;exposeBridge?:boolean;audio?:boolean;resolution?:readonly [number,number];controlledWalker?:string;profiling?:boolean}
type TimelineAction=(entry:RuntimeTimelineEntry)=>unknown|Promise<unknown>;

export class BrowserRuntime {
  scene:Scene;
  readonly renderer:Renderer;
  readonly tickRate:number;
  readonly stepSeconds:number;
  readonly audio:ProceduralAudio|null;
  private initial:SceneSpec;
  private controls:WalkerControls|null=null;
  private readonly clock:FixedClock;
  private running=false;
  private raf=0;
  private disposed=false;
  private publishedBridge:EngineBridge|null=null;
  private readonly timelineActions=trackRuntimeMemory('BrowserRuntime','timelineActions','registry',new Map<string,TimelineAction>());

  private constructor(private readonly canvas:HTMLCanvasElement,scene:SceneSpec,renderer:Renderer,options:BrowserRuntimeOptions){
    trackRuntimeInstance('BrowserRuntime',this);this.initial=structuredClone(scene);this.scene=new Scene(this.initial);this.renderer=renderer;this.tickRate=options.tickRate??60;this.stepSeconds=1/this.tickRate;this.clock=new FixedClock(1000/this.tickRate);this.audio=options.audio===false?null:new ProceduralAudio();
    this.registerTimelineAction('highlight',entry=>{this.renderer.highlight?.(entry.refs);return this.render();});
    this.registerTimelineAction('rewind',entry=>this.seek(Math.max(0,entry.start-this.stepSeconds)));
    this.registerTimelineAction('audio.play-event',async entry=>{const event=runtimeTimelinePayload<EngineEvent>(entry.id);if(!event)throw new TypeError('Timeline sound has no engine event payload');await this.activateAudio();this.audio?.play([event]);});
    this.registerTimelineAction('audio.play-footstep',async entry=>{const event=runtimeTimelinePayload<FootstepSound>(entry.id);if(!event)throw new TypeError('Timeline footstep has no payload');await this.activateAudio();this.audio?.playFootsteps([event],this.scene.camera,event.time);});
  }

  static async create(canvas:HTMLCanvasElement,scene:SceneSpec,options:BrowserRuntimeOptions={}):Promise<BrowserRuntime>{
    const renderer=await WebGPURenderer.create(canvas,{profiling:options.profiling??false});let runtime:BrowserRuntime|undefined;
    try{
      runtime=new BrowserRuntime(canvas,scene,renderer,options);
      if(options.resolution)renderer.setResolution(...options.resolution);
      if(options.controlledWalker)runtime.controlWalker(options.controlledWalker);
      await renderer.prepareMaterials(runtime.scene);runtime.render();if(options.autoplay!==false)runtime.resume();
      // Publish only a usable runtime. Failed loading must not replace another
      // live runtime's bridge or retain its own GPU/audio/gesture resources.
      if(options.exposeBridge!==false){runtime.publishedBridge=runtime.bridge();(globalThis as any).__GAME_ENGINE__=runtime.publishedBridge;}
      return runtime;
    }catch(error){if(runtime)runtime.dispose();else renderer.dispose();throw error;}
  }

  pause():void{this.running=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;}
  controlWalker(id:string,options:WalkerControlOptions={}):WalkerControls{
    if(this.disposed)throw new Error('Runtime is disposed');
    const heading=this.scene.spec.animation?.walkers?.find(w=>w.id===id)?.heading;
    if(heading===undefined)throw new TypeError(`Unknown walker: ${id}`);
    this.scene.animation.driveWalker(id,0,heading);
    this.controls?.dispose();
    this.controls=new WalkerControls(this.canvas,id,options);
    return this.controls;
  }
  async activateAudio():Promise<boolean>{const ready=this.audio?await this.audio.unlock():false;if(ready)this.audio?.updateAmbient(this.ambientAudioState());return ready;}
  resume():void{if(this.disposed||this.running)return;this.running=true;this.clock.reset(performance.now());this.raf=requestAnimationFrame(this.frame);}
  step(count=1){
    if(!Number.isSafeInteger(count)||count<1||count>1_000_000)throw new RangeError('step count must be an integer in [1, 1000000]');
    this.advance(count,true);return this.scene.snapshot();
  }
  seek(seconds:number){
    if(!Number.isFinite(seconds)||seconds<0||seconds>86_400)throw new RangeError('seek time must be within one day');
    this.pause();if(seconds+1e-9<this.scene.time)this.reset();
    const target=Math.round(seconds*this.tickRate),remaining=Math.max(0,target-this.scene.tick);
    this.advance(remaining,false);return this.scene.snapshot();
  }
  reset():void{this.scene=new Scene(this.initial);this.render();}
  async replaceScene(scene:SceneSpec):Promise<void>{
    this.pause();
    this.controls?.dispose();this.controls=null;
    this.initial=structuredClone(scene);
    this.scene=new Scene(this.initial);
    await this.renderer.prepareMaterials?.(this.scene);
    this.render();await this.renderer.flush();
  }
  patchAppearance(patch:AppearancePatch):void{this.pause();this.scene.patchAppearance(patch);}
  setCamera(camera:CameraSpec):void{this.scene.setCamera(camera);this.render();}
  render():RenderStats{this.controls?.camera(this.scene);this.renderer.render(this.scene);return this.renderer.inspect();}
  async drain():Promise<void>{await this.renderer.flush();}
  async probeLinear(points:readonly (readonly [number,number])[],stage:import('../render/types.js').LinearPixelStage='hdr'){if(!this.renderer.sampleLinearPixels)throw new Error('Renderer does not support scene-linear pixel readback');await this.renderer.flush();return await this.renderer.sampleLinearPixels(points,stage);}
  async flush():Promise<void>{await this.renderer.prepareMaterials?.(this.scene);this.render();await this.renderer.flush();}
  profile(){return this.renderer.profile?.()??this.renderer.inspect().profile;}
  resetProfile():void{this.renderer.resetProfile?.();}
  snapshot(){return this.scene.snapshot();}
  timeline(){return runtimeTimelineSnapshot();}
  registerTimelineAction(id:string,handler:TimelineAction):()=>void{if(!id||this.timelineActions.has(id))throw new TypeError(`Duplicate timeline action ${id}`);this.timelineActions.set(id,handler);return()=>{if(this.timelineActions.get(id)===handler)this.timelineActions.delete(id);};}
  async act(recordId:number,capability:string):Promise<unknown>{const entry=runtimeTimelineEntry(recordId);if(!entry)throw new TypeError(`Unknown timeline record ${recordId}`);if(!entry.capabilities.some(item=>item.id===capability))throw new TypeError(`Timeline record ${recordId} does not expose ${capability}`);const action=this.timelineActions.get(capability);if(!action)throw new TypeError(`No runtime action registered for ${capability}`);return await action(entry);}
  inspect(){return{time:this.scene.time,tick:this.scene.tick,environment:this.scene.environment,surfaces:{surfaces:[...this.scene.surfaces.surfaces.values()].map(state=>({...state})),bodies:[...this.scene.surfaces.bodies.values()].map(state=>({...state}))},physics:this.scene.physics.stats,renderer:this.renderer.inspect(),audio:this.audio?.inspect()??{enabled:false},memory:{structures:runtimeMemorySnapshot()},timeline:{records:this.timeline()}};}
  async capture(type='image/png',quality?:number):Promise<Blob>{this.render();await this.renderer.flush();return await new Promise<Blob>((resolve,reject)=>this.canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Canvas capture failed')),type,quality));}
  dispose():void{if(this.disposed)return;this.pause();this.disposed=true;this.controls?.dispose();this.audio?.dispose();this.renderer.dispose();if(this.publishedBridge&&(globalThis as any).__GAME_ENGINE__===this.publishedBridge)delete (globalThis as any).__GAME_ENGINE__;this.publishedBridge=null;}

  private ambientAudioState():AmbientAudioState{
    const windSpeed=Math.hypot(this.scene.environment.wind[0],this.scene.environment.wind[2]);
    const snowfall=Math.max(0,Math.min(1,this.scene.environment.snowfallRate/2.2e-5));
    let trafficCount=0,speedSum=0,trafficGain=0,panSum=0;const right=V3.normalize(V3.cross(V3.sub(this.scene.camera.target,this.scene.camera.position),[0,1,0]));
    for(const state of this.scene.surfaces.bodies.values()){
      const entity=this.scene.entities.get(state.id),body=entity?.body;if(!body)continue;
      const speed=Math.hypot(body.velocity[0],body.velocity[2]);if(speed>.4){trafficCount++;speedSum+=speed;const delta=V3.sub(entity.position,this.scene.camera.position),distance=V3.length(delta),gain=1/(1+(distance/7)**1.4);trafficGain+=gain;panSum+=gain*V3.dot(V3.normalize(delta),right);}
    }
    let roadWetness=0,slush=0,roads=0;
    for(const state of this.scene.surfaces.surfaces.values())if(state.use==='road'){
      roads++;roadWetness+=Math.max(state.puddle,Math.min(1,state.waterDepthM/.004));slush+=state.slush;
    }
    return{
      windSpeed,
      snowfall,
      trafficCount,
      trafficSpeed:trafficCount?speedSum/trafficCount:0,
      trafficGain:trafficCount?trafficGain/trafficCount:0,trafficPan:trafficGain?panSum/trafficGain:0,
      ...(this.scene.contacts.inspect().wheelContacts?{contactWetness:this.scene.contacts.wetness}:{}),
      roadWetness:roads?roadWetness/roads:0,
      slush:roads?slush/roads:0,
    };
  }

  bridge():EngineBridge{return{timeline:()=>this.timeline(),act:(recordId,capability)=>this.act(recordId,capability),snapshot:()=>this.snapshot(),probeLinear:(points,stage)=>this.probeLinear(points,stage),pause:()=>this.pause(),resume:()=>this.resume(),step:(count=1)=>this.step(count),seek:seconds=>this.seek(seconds),replaceScene:scene=>this.replaceScene(scene),patchAppearance:patch=>this.patchAppearance(patch),setCamera:camera=>this.setCamera(camera),render:()=>this.render(),profile:()=>this.profile(),resetProfile:()=>this.resetProfile(),drain:()=>this.drain(),flush:()=>this.flush(),dispose:()=>this.dispose(),inspect:()=>this.inspect()};}
  /** One simulation path for live frames, deterministic stepping and replay seek. */
  private advance(count:number,publish:boolean):void{
    const events:EngineEvent[]=[],footsteps:FootstepSound[]=[];
    for(let i=0;i<count;i++){
      this.controls?.tick(this.scene,this.stepSeconds);this.scene.step(this.stepSeconds);
      const nextEvents=this.scene.drainEvents(),nextFootsteps=this.scene.contacts.drainFootsteps();
      if(publish){
        events.push(...nextEvents);footsteps.push(...nextFootsteps);
        if(this.audio){
          for(const event of nextEvents){
            const cause=event.trace,parent=cause!==undefined?runtimeTimelineEntry(cause):undefined,refs=parent?.refs??[];
            const sound=beginRuntimeSpan({owner:'ProceduralAudio',kind:'sound',name:`${event.type}:${event.id}`,at:event.time,...(cause!==undefined?{cause}:{}),refs,capabilities:[...(refs.length?[{id:'highlight',label:'Highlight'}]:[]),{id:'audio.play-event',label:'Play'},{id:'rewind',label:'Rewind here'}],data:{source:event.type},payload:event});
            endRuntimeSpan(sound,event.time+eventAudioDuration(event));
          }
          for(const footstep of nextFootsteps){
            const sound=beginRuntimeSpan({owner:'ProceduralAudio',kind:'sound',name:`footstep:${footstep.sequence}`,at:footstep.time,capabilities:[{id:'audio.play-footstep',label:'Play'},{id:'rewind',label:'Rewind here'}],data:{source:'footstep',depth:footstep.depth},payload:footstep});
            endRuntimeSpan(sound,footstep.time+.38);
          }
        }
      }
    }
    if(publish){this.audio?.play(events);this.audio?.playFootsteps(footsteps,this.scene.camera,this.scene.time);}
    this.audio?.updateAmbient(this.ambientAudioState());this.render();
  }
  private frame=(now:number)=>{
    if(!this.running)return;
    let count=0;this.clock.advance(now,()=>count++);if(count)this.advance(count,true);else this.render();
    this.raf=requestAnimationFrame(this.frame);
  };
}
