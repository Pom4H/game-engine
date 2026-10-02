/** Stable domain/slot names shared by built-ins and third-party plugins.
 * Axes decide fidelity; slots decide ownership. Neither implies gameplay semantics. */
export const ENGINE_DOMAINS=Object.freeze({
 core:'core',
 world:'world',
 physics:'physics',
 collision:'collision',
 destruction:'destruction',
 agents:'agents',
 economics:'economics',
 network:'network',
 audio:'audio',
 render:'render',
} as const);

export const ENGINE_SLOTS=Object.freeze({
 clock:'core.clock',
 worldMaterialize:'world.materialize',
 physicsStep:'physics.step',
 collisionSolve:'collision.solve',
 destructionResolve:'destruction.resolve',
 agentsSimulate:'agents.simulate',
 economicsSimulate:'economics.simulate',
 networkProject:'network.project',
 audioMix:'audio.mix',
 renderFrame:'render.frame',
} as const);
