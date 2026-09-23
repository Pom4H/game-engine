/**
 * Canonical causal vocabulary of the engine.
 *
 * Modules may live in physics/render/audio/vehicles folders, but they communicate
 * through these domain facts instead of inventing subsystem-local resource names.
 */
export const STATE = Object.freeze({
  world:Object.freeze({time:'world.time'}),
  environment:Object.freeze({weather:'environment.weather'}),
  entity:Object.freeze({
    existence:'entity.existence',
    transform:'entity.transform',
    motion:'entity.motion',
    animation:'entity.animation',
  }),
  material:Object.freeze({
    constitution:'material.constitution',
    surface:'material.surface',
  }),
  surface:Object.freeze({
    state:'surface.state',
    contact:'surface.contact',
  }),
  interaction:Object.freeze({contact:'interaction.contact'}),
  structure:Object.freeze({
    state:'structure.state',
    deformation:'structure.deformation',
    fracture:'structure.fracture',
  }),
  event:Object.freeze({stream:'event.stream'}),
  observation:Object.freeze({
    visual:'observation.visual',
    acoustic:'observation.acoustic',
  }),
} as const);

type Leaf<T>=T extends string?T:{[K in keyof T]:Leaf<T[K]>}[keyof T];
export type StateChannel=Leaf<typeof STATE>;
export type CausalChannel=StateChannel|'*'|`${StateChannel}.${string}`;

/** Parent channels overlap descendants, so semantic refinement stays safe. */
export function channelsOverlap(a:CausalChannel,b:CausalChannel):boolean{
  if(a==='*'||b==='*')return true;
  return a===b||a.startsWith(b+'.')||b.startsWith(a+'.');
}

/** Runtime systems are laws: they observe world facts and affect world facts.
 * Rendering and audio produce observations; they are not alternate world states. */
export interface CausalLaw {
  readonly id:string;
  readonly observes:readonly CausalChannel[];
  readonly affects:readonly CausalChannel[];
}
