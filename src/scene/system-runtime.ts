import type {SystemAction} from './modules.js';

export interface SystemFrame {readonly dt:number;readonly at:number}
export type SystemHandler=(frame:SystemFrame)=>void;
export interface Cause {readonly type:SystemAction;readonly deltaSeconds:number}

/**
 * One attachment primitive for built-in simulation code.
 *
 * Kernel scheduling produces a Cause. This runtime is the only place where a
 * cause is attached to executable engine code. Systems never call each other:
 * ordering/data hazards stay in EngineKernel and consumers observe world state.
 */
export class CausalRuntime {
  private readonly effects=new Map<SystemAction,SystemHandler>();

  when(type:SystemAction,effect:SystemHandler):this{
    if(this.effects.has(type))throw new TypeError(`Effect already attached: ${type}`);
    this.effects.set(type,effect);return this;
  }

  apply(cause:Cause,at:number):void{
    const effect=this.effects.get(cause.type);
    if(!effect)throw new TypeError(`No effect for cause: ${cause.type}`);
    effect(Object.freeze({dt:cause.deltaSeconds,at}));
  }

  get causes():readonly SystemAction[]{return Object.freeze([...this.effects.keys()]);}
}

/** @deprecated Use CausalRuntime.when/apply. */
export class SceneSystemRuntime extends CausalRuntime {
  use(action:SystemAction,handler:SystemHandler):this{this.when(action,handler);return this;}
  run(action:SystemAction,dt:number,at:number):void{this.apply({type:action,deltaSeconds:dt},at);}
  get actions():readonly SystemAction[]{return this.causes;}
}
