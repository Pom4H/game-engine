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
  private readonly handlers=new Map<SystemAction,SystemHandler>();

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
    handler(Object.freeze({dt,at}));
  }

  get actions():readonly SystemAction[]{return Object.freeze([...this.handlers.keys()]);}
}
