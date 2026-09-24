import type {Vec3} from '../math.js';
import {StructuralBody} from './structure.js';

export interface PhysicalComponent<Event=never> {
  step(dt:number):void;
  drainEvents?():Event[];
}

export interface PhysicalCompositionOptions<Event=never> {
  readonly structure:StructuralBody;
  readonly components?:readonly PhysicalComponent<Event>[];
  readonly gravity?:Vec3;
}

/**
 * A physical object is a composition of one authoritative structure plus optional
 * mechanisms. "Vehicle", "door", "machine" and "prop" are authoring concepts,
 * not alternate simulation kernels.
 */
export class PhysicalComposition<Event=never> {
  readonly structure:StructuralBody;
  readonly components:readonly PhysicalComponent<Event>[];
  readonly gravity:Vec3;

  constructor(options:PhysicalCompositionOptions<Event>){
    this.structure=options.structure;
    this.components=Object.freeze([...(options.components??[])]);
    this.gravity=Object.freeze([...(options.gravity??[0,-9.81,0])]) as Vec3;
  }

  step(dt:number):void{
    for(const component of this.components)component.step(dt);
    this.structure.step(dt,this.gravity);
  }

  drainEvents():Event[]{
    const events:Event[]=[];
    for(const component of this.components)if(component.drainEvents)events.push(...component.drainEvents());
    return events;
  }
}
