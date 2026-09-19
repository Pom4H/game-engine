import type {SystemAction} from './modules.js';

export interface SystemFrame {
  readonly dt:number;
  readonly at:number;
}
export type SystemHandler=(frame:SystemFrame)=>void;

/** Runtime dispatch for built-in engine systems.
 * EngineKernel owns scheduling; this registry owns implementations. Scene only
 * reduces public commands and delegates system commands here.
 */
export class SceneSystemRuntime {
  private readonly handlers=new Map<SystemAction,SystemHandler>();

  use(action:SystemAction,handler:SystemHandler):this{
    if(this.handlers.has(action))throw new TypeError(`System handler already registered: ${action}`);
    this.handlers.set(action,handler);
    return this;
  }

  run(action:SystemAction,dt:number,at:number):void{
    const handler=this.handlers.get(action);
    if(!handler)throw new TypeError(`No system implementation: ${action}`);
    handler(Object.freeze({dt,at}));
  }

  get actions():readonly SystemAction[]{return Object.freeze([...this.handlers.keys()]);}
}
