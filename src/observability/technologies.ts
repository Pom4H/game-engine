/** Revisioned inventory of implementations, not a claim that every backend is active. */
export const ENGINE_TECHNOLOGY_REVISION='engine-technologies.v1';
export const ENGINE_TECHNOLOGIES=Object.freeze([
  {id:'scheduler',execution:'cpu',status:'implemented',source:'src/core/kernel.ts',verification:'test/kernel-cadence-order.test.mjs'},
  {id:'scene',execution:'cpu',status:'implemented',source:'src/scene/scene.ts',verification:'test/scene-performance.test.mjs'},
  {id:'rigid-ts',execution:'cpu',status:'implemented',source:'src/physics/world.ts',verification:'test/contact-laws.test.mjs'},
  {id:'compound-ts',execution:'cpu',status:'implemented',source:'src/physics/compound.ts',verification:'test/compound-physics.test.mjs'},
  {id:'rigid-wasm',execution:'wasm',status:'opt-in',source:'src/physics/rigid-wasm.ts',verification:'test/rigid-wasm.test.mjs'},
  {id:'structure-wasm',execution:'wasm',status:'opt-in',source:'src/physics/structure-wasm.ts',verification:'test/structure-rust-wasm.test.mjs'},
  {id:'webgpu',execution:'gpu',status:'implemented',source:'src/render/webgpu.ts',verification:'tools/render-stability/verify.mjs'},
  {id:'gpu-visibility',execution:'gpu',status:'opt-in',source:'src/render/gpu-visibility.ts',verification:'tools/gpu-visibility/benchmark.mjs'},
  {id:'cpu-renderer',execution:'cpu',status:'implemented',source:'src/render/cpu.ts',verification:'test/render-pipeline-readiness.test.mjs'},
  {id:'audio',execution:'audio',status:'implemented',source:'src/audio/browser.ts',verification:'test/browser-audio.test.mjs'},
  {id:'network',execution:'io',status:'implemented',source:'src/network/causal-authority.ts',verification:'docs/NETWORK_FOUNDATION.md'},
  {id:'execution',execution:'worker',status:'opt-in',source:'src/execution/index.ts',verification:'docs/EMERGENT_EXECUTION.md'},
  {id:'storage',execution:'io',status:'implemented',source:'src/storage/index.ts',verification:'docs/CAUSAL_STORAGE.md'},
  {id:'cause-trace',execution:'cpu',status:'opt-in',source:'src/physics/cause-trace.ts',verification:'test/proving-ground.test.mjs'},
  {id:'performance-trace',execution:'cpu',status:'opt-in',source:'src/observability/trace.ts',verification:'test/engine-trace.test.mjs'},
  {id:'soil-hydrology',execution:'cpu',status:'implemented',source:'src/environment/soil-hydrology.ts',verification:'test/soil-hydrology.test.mjs'},
  {id:'surface-contacts',execution:'cpu',status:'opt-in',source:'src/environment/surface-contacts.ts',verification:'test/surface-water.test.mjs'},
  {id:'body-deposits',execution:'cpu',status:'opt-in',source:'src/environment/surface-state.ts',verification:'test/surface-water.test.mjs'},
  {id:'water-surface',execution:'cpu',status:'implemented',source:'src/procedural/water-surface.ts',verification:'test/water-surface.test.mjs'},
  {id:'compact-triangles',execution:'cpu',status:'opt-in',source:'src/procedural/mesh.ts',verification:'test/compact-triangle-storage.test.mjs'},
  {id:'staged-mesh-preparation',execution:'cpu',status:'implemented',source:'src/render/mesh-preparation.ts',verification:'test/staged-triangle-preparation.test.mjs'},
  {id:'staged-entity-preparation',execution:'cpu',status:'implemented',source:'src/scene/render-entity-preparation.ts',verification:'test/staged-entity-preparation.test.mjs'},
  {id:'host-frame-stalls',execution:'cpu',status:'opt-in',source:'src/observability/frame-stalls.ts',verification:'test/frame-stalls.test.mjs'},
].map(item=>Object.freeze(item)));

export const BUDGET_METRICS=Object.freeze({
  'frame.interval.ms':{unit:'ms',technology:'scheduler'},
  'simulation.tick.ms':{unit:'ms',technology:'scene'},
  'physics.step.ms':{unit:'ms',technology:'rigid-ts'},
  'render.cpu.ms':{unit:'ms',technology:'webgpu'},
  'render.gpu.ms':{unit:'ms',technology:'webgpu'},
  'render.upload.bytes':{unit:'bytes',technology:'webgpu'},
  'memory.heap.bytes':{unit:'bytes',technology:'scene'},
  'network.rtt.ms':{unit:'ms',technology:'network'},
  'network.pending':{unit:'count',technology:'network'},
  'worker.queue':{unit:'count',technology:'execution'},
  'trace.dropped':{unit:'count',technology:'performance-trace'},
} as const);
for(const definition of Object.values(BUDGET_METRICS))Object.freeze(definition);
export type BudgetMetric=keyof typeof BUDGET_METRICS;
export interface EngineBudgetOptions {
  readonly fps?:number;readonly tickHz?:number;readonly physicsHz?:number;
  readonly renderCpuFraction?:number;readonly gpuFraction?:number;
  readonly simulationFraction?:number;readonly physicsFraction?:number;
  readonly width?:number;readonly height?:number;readonly device?:string;
  readonly minSamples?:number;readonly percentile?:number;
  readonly limits?:Partial<Record<BudgetMetric,number>>;
  /** Only these metrics are required; absent optional measurements stay missing. */
  readonly required?:readonly BudgetMetric[];
}
export interface EngineBudgets {
  readonly revision:typeof ENGINE_TECHNOLOGY_REVISION;
  readonly target:{readonly fps:number;readonly tickHz:number;readonly physicsHz:number;readonly width:number;readonly height:number;readonly device:string};
  readonly limits:Readonly<Record<BudgetMetric,number>>;
  readonly required:readonly BudgetMetric[];readonly minSamples:number;readonly percentile:number;
}
function positive(value:number,label:string,max:number):number{
  if(!Number.isFinite(value)||value<=0||value>max)throw new RangeError(`Invalid ${label}`);return value;
}
export function engineBudgets(options:EngineBudgetOptions={}):EngineBudgets{
  const fields=new Set(['fps','tickHz','physicsHz','renderCpuFraction','gpuFraction','simulationFraction','physicsFraction','width','height','device','minSamples','percentile','limits','required']);
  for(const key of Object.keys(options))if(!fields.has(key))throw new TypeError(`Unknown budget parameter ${key}`);
  const fps=positive(options.fps??60,'fps',1000),tickHz=positive(options.tickHz??60,'tickHz',2000),physicsHz=positive(options.physicsHz??120,'physicsHz',4000);
  const width=positive(options.width??1920,'width',32768),height=positive(options.height??1080,'height',32768);
  if(!Number.isInteger(width)||!Number.isInteger(height))throw new RangeError('Resolution must be integral');
  const minSamples=options.minSamples??60,percentile=positive(options.percentile??.95,'percentile',1);
  if(!Number.isSafeInteger(minSamples)||minSamples<1||minSamples>1_000_000)throw new RangeError('Invalid minSamples');
  const device=options.device??'unspecified';if(typeof device!=='string'||!device.length||device.length>180)throw new TypeError('Invalid device');
  const fraction=(value:number,label:string)=>positive(value,label,1);
  const limits:Record<BudgetMetric,number>={
    'frame.interval.ms':1000/fps,
    'simulation.tick.ms':1000/tickHz*fraction(options.simulationFraction??.6,'simulationFraction'),
    'physics.step.ms':1000/physicsHz*fraction(options.physicsFraction??.6,'physicsFraction'),
    'render.cpu.ms':1000/fps*fraction(options.renderCpuFraction??.5,'renderCpuFraction'),
    'render.gpu.ms':1000/fps*fraction(options.gpuFraction??.9,'gpuFraction'),
    'render.upload.bytes':16*1024*1024,'memory.heap.bytes':512*1024*1024,
    'network.rtt.ms':100,'network.pending':48,'worker.queue':8,'trace.dropped':0,
  };
  for(const [key,value] of Object.entries(options.limits??{})){
    if(!Object.hasOwn(BUDGET_METRICS,key)||typeof value!=='number'||!Number.isFinite(value)||value<0)throw new RangeError(`Invalid budget ${key}`);
    limits[key as BudgetMetric]=value;
  }
  const required=options.required??['frame.interval.ms','render.cpu.ms','render.gpu.ms'];
  if(required.some(key=>!Object.hasOwn(BUDGET_METRICS,key))||new Set(required).size!==required.length)throw new TypeError('Invalid required metrics');
  return Object.freeze({revision:ENGINE_TECHNOLOGY_REVISION,target:Object.freeze({fps,tickHz,physicsHz,width,height,device}),limits:Object.freeze(limits),required:Object.freeze([...required]),minSamples,percentile});
}

export function technologyAudit(){return {revision:ENGINE_TECHNOLOGY_REVISION,technologies:ENGINE_TECHNOLOGIES,metrics:BUDGET_METRICS,
  interpretation:'Inventory describes available implementations. Active backends, device support and measured budgets require capture evidence. CPU, GPU and simulation budgets overlap and must not be added.'};}
