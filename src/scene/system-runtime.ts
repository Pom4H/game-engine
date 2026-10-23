import type {SystemAction} from './modules.js';

export interface SystemFrame {
  readonly dt:number;
  readonly at:number;
}
export type SystemHandler=(frame:SystemFrame)=>void;
export interface SystemRegistration{readonly id:string;readonly handler:SystemHandler}

/** Runtime dispatch for built-in engine systems.
 * EngineKernel owns scheduling; this registry owns implementations. Scene only
 * reduces public commands and delegates system commands here.
 */
export class SceneSystemRuntime {
  observe: ((action:string,milliseconds:number)=>void)|undefined;
  private readonly handlers=new Map<SystemAction,SystemHandler>();
  private measure:((action:SystemAction,ms:number)=>void)|undefined;
  /** Only sampled ticks install a callback; the default path reads no clocks. */
  measureSystems(callback:((action:SystemAction,ms:number)=>void)|undefined):void{this.measure=callback;}

  assertAvailable(actions:readonly SystemAction[]):void{
    const seen=new Set<string>();
    for(const action of actions){
      if(typeof action!=='string'||!action||action.length>180||seen.has(action))throw new TypeError('System handlers require distinct stable IDs');
      if(this.handlers.has(action))throw new TypeError(`System handler already registered: ${action}`);
      seen.add(action);
    }
  }
  use(action:SystemAction,handler:SystemHandler):this{return this.useMany([{id:action,handler}]);}
  useMany(registrations:readonly SystemRegistration[]):this{
    this.assertAvailable(registrations.map(registration=>registration.id));
    for(const registration of registrations)if(typeof registration.handler!=='function')throw new TypeError('System handler requires an implementation');
    for(const registration of registrations)this.handlers.set(registration.id,registration.handler);
    return this;
  }

  run(action:SystemAction,dt:number,at:number):void{
    const handler=this.handlers.get(action);
    if(!handler)throw new TypeError(`No system implementation: ${action}`);
    const frame=Object.freeze({dt,at}),probe=this.measure,observe=this.observe;
    if(!probe&&!observe){handler(frame);return;}
    const start=performance.now();
    try{handler(frame);}finally{const ms=performance.now()-start;probe?.(action,ms);observe?.(action,ms);}
  }

  get actions():readonly SystemAction[]{return Object.freeze([...this.handlers.keys()]);}
}
