export const profiles=Object.freeze(['native','common-post','common-bloom']);
export const commonPostFeatures=Object.freeze({screenSpace:false,bloom:false,temporalAA:false,planarReflections:false});
export const commonBloomFeatures=Object.freeze({...commonPostFeatures,bloom:true});
export function requireProfile(profile){if(!profiles.includes(profile))throw new RangeError('Invalid comparison profile: '+profile);return profile;}
export function engineFeatures(profile){requireProfile(profile);return profile==='common-post'?commonPostFeatures:profile==='common-bloom'?commonBloomFeatures:undefined;}
export function sharedEffects(profile){requireProfile(profile);return profile==='native'?null:{ao:false,ssr:false,dof:false,planarReflections:false,bloom:profile==='common-bloom',antiAliasing:'none',samples:1,toneMapping:true};}

/** Verify executed GPU work, rather than relying on a declarative feature label. */
export function auditProfile(profile,backend,measured,gpuPasses){
  requireProfile(profile);
  if(profile==='native')return;
  if(backend!=='engine'){
    if(measured.comparisonEffects){
      for(const [key,value] of Object.entries(sharedEffects(profile)))if(measured.comparisonEffects[key]!==value)throw new Error('Peer effect mismatch: '+key);
      if(profile==='common-bloom'&&!(measured.bloomExecutions>0))throw new Error('Peer bloom never executed');
    }else if(profile==='common-bloom')throw new Error('Missing peer bloom execution audit');
    return;
  }
  if(!Object.entries(engineFeatures(profile)).every(([key,value])=>measured.pipeline?.features?.[key]===value)||measured.pipeline.presentSource!==(profile==='common-bloom'?'effects':'hdr'))throw new Error('Common postprocessing profile was not applied');
  for(const pass of Object.keys(gpuPasses))if((profile==='common-post'?/render\.(reflection|effects|taa|bloom)(\.|$)/:/render\.(reflection|taa)(\.|$)/).test(pass))throw new Error('Disabled render pass executed: '+pass);
  if(profile==='common-bloom'&&!Object.keys(gpuPasses).some(pass=>/render\.bloom\./.test(pass)))throw new Error('Engine bloom never executed');
  if((measured.visibility?.reflection?.batches??0)!==0)throw new Error('Disabled reflection retained visibility buffers');
  if((measured.preparation?.visibilityPlan?.passes.reflection.tests??0)!==0)throw new Error('Disabled reflection performed CPU clip tests');
}
