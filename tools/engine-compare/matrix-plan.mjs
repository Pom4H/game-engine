import {requireParameters,motionModes} from './parameters.mjs';
import {requireProfile,sharedEffects} from './profiles.mjs';
const all=['engine','three','babylon'];
export function createMatrixPlan(tier='standard'){
  if(!['standard','smoke'].includes(tier))throw new RangeError('Unknown matrix tier');
  const settings={frames:240,warmup:48,repetitions:3,quality:false};
  const base={width:1920,height:1080,profile:'common-post',backends:all,counts:[10000],scenarios:['static','camera-motion'],parameters:requireParameters()};
  const batches=[
    {...base,id:'reference',axis:'object-count',counts:[1000,5000,10000]},
    {...base,id:'resolution-720p',axis:'resolution',width:1280,height:720},
    {...base,id:'bloom',axis:'effects',profile:'common-bloom'},
    {...base,id:'motion-1pct',axis:'dirty-fraction',scenarios:['object-motion','camera-object-motion']},
    {...base,id:'motion-100pct',axis:'dirty-fraction',scenarios:['object-motion'],parameters:requireParameters({dirtyFraction:1})},
    {...base,id:'motion-api-1pct',axis:'motion-api',scenarios:['object-motion','camera-object-motion'],parameters:requireParameters({motionApi:'visual-transform'})},
    {...base,id:'motion-api-100pct',axis:'motion-api',scenarios:['object-motion'],parameters:requireParameters({dirtyFraction:1,motionApi:'visual-transform'})},
    {...base,id:'cpu-batched',axis:'engine-culling',backends:['engine'],parameters:requireParameters({engineVisibility:'cpu-batched'})},
    {...base,id:'unbatched',axis:'instancing',counts:[1000],scenarios:['static'],parameters:requireParameters({engineVisibility:'cpu',peerInstancing:false})},
  ].map(batch=>({...settings,...batch}));
  if(tier==='smoke')for(const batch of batches){batch.width=640;batch.height=360;batch.counts=[16];batch.frames=12;batch.warmup=8;batch.repetitions=1;}
  return validateMatrixPlan({version:1,tier,design:'Controlled parameter sweeps anchored at 10k / 1080p / common-post. Counts and camera movement are crossed; other axes change separately. This is not a full Cartesian matrix.',batches});
}
export function validateMatrixPlan(plan){
  if(plan.version!==1||!Array.isArray(plan.batches)||!plan.batches.length)throw new RangeError('Invalid matrix plan');
  for(const key of Object.keys(plan))if(!['version','tier','design','batches','expectedCases'].includes(key))throw new RangeError('Unknown matrix control: '+key);
  const ids=new Set();
  for(const batch of plan.batches){
    for(const key of Object.keys(batch))if(!['frames','warmup','repetitions','quality','width','height','profile','backends','counts','scenarios','parameters','id','axis'].includes(key))throw new RangeError('Unknown batch control: '+key);
    if(!/^[a-z0-9][a-z0-9-]*$/.test(batch.id)||ids.has(batch.id))throw new RangeError('Invalid/duplicate batch id');ids.add(batch.id);
    requireProfile(batch.profile);if(!sharedEffects(batch.profile))throw new Error('Competitive matrix requires a shared effect set');
    batch.parameters=requireParameters(batch.parameters);
    if(batch.backends?.some(backend=>backend!=='engine')&&batch.parameters.environmentMode!=='fixed')throw new Error('Shared matrix requires fixed environment radiance');
    if(![batch.width,batch.height,batch.frames,batch.warmup,batch.repetitions].every(Number.isSafeInteger)||batch.width<1||batch.width>4096||batch.height<1||batch.height>4096||batch.frames<8||batch.frames>2048||batch.warmup<1||batch.warmup>512||batch.repetitions<1||batch.repetitions>12)throw new RangeError('Invalid dimensions/sample controls');
    if(!batch.counts?.length||new Set(batch.counts).size!==batch.counts.length||!batch.counts.every(n=>Number.isSafeInteger(n)&&n>=4&&n<=100000)||!batch.scenarios?.length||new Set(batch.scenarios).size!==batch.scenarios.length||!batch.scenarios.every(s=>motionModes.includes(s))||!batch.backends?.length||new Set(batch.backends).size!==batch.backends.length||!batch.backends.every(b=>all.includes(b)))throw new RangeError('Invalid matrix axes');
    if(typeof batch.quality!=='boolean')throw new RangeError('Invalid quality control');
  }
  return {...plan,expectedCases:plan.batches.reduce((sum,b)=>sum+b.counts.length*b.scenarios.length*b.backends.length*b.repetitions,0)};
}
export const capabilities={
  commonEffects:{'common-post':sharedEffects('common-post'),'common-bloom':sharedEffects('common-bloom')},
  engine:{visibility:['gpu','cpu-batched','cpu'],instancing:'gpu/cpu-batched use instancing; cpu uses individual main-view draws',nativeOnly:['AO','SSR','TAA','planar reflections','procedural atmosphere/material detail']},
  three:{visibility:'native bounds per InstancedMesh or per Mesh',instancing:[true,false],bloom:'native TSL BloomNode'},
  babylon:{visibility:'native bounds per thin-instance batch or per Mesh',instancing:[true,false],bloom:'native DefaultRenderingPipeline'},
  limitation:'Common effects share enablement, not identical implementations or image quality. Bloom threshold 1, weight .46 and initial scale .25 are recorded; soft knees, blur kernels and mip chains differ. No cross-engine quality winner is inferred.'
};
