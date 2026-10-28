export const motionModes=Object.freeze(['static','camera-motion','object-motion','camera-object-motion']);
export const visibilityModes=Object.freeze(['gpu','cpu-batched','cpu']);
export const motionApis=Object.freeze(['direct','visual-transform']);
export function requireParameters(options={}){
  for(const key of Object.keys(options))if(!['engineVisibility','peerInstancing','dirtyFraction','environmentMode','motionApi'].includes(key))throw new RangeError('Unknown renderer parameter: '+key);
  const {engineVisibility='gpu',peerInstancing=true,dirtyFraction=.01,environmentMode='fixed',motionApi='direct'}=options;
  if(!visibilityModes.includes(engineVisibility)||typeof peerInstancing!=='boolean'||!Number.isFinite(dirtyFraction)||dirtyFraction<0||dirtyFraction>1||!['fixed','scene-derived'].includes(environmentMode)||!motionApis.includes(motionApi))throw new RangeError('Invalid renderer parameters');
  return {engineVisibility,peerInstancing,dirtyFraction,environmentMode,motionApi};
}
export function movingScenario(scenario){if(!motionModes.includes(scenario))throw new RangeError('Invalid motion mode');return scenario.includes('object-motion');}
