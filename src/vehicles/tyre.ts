import type {TyreComplianceSpec} from './components.js';

export interface LoadedTyreState {
  readonly radialStiffnessNPerM:number;
  readonly deflectionM:number;
  readonly loadedRadiusM:number;
  readonly contactPatchLengthM:number;
}
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value));

/** Pressure is the cause: lower inflation pressure reduces radial stiffness. */
export function tyreRadialStiffness(spec:TyreComplianceSpec):number{
  const reference=spec.referencePressurePa??spec.pressurePa;
  return spec.radialStiffnessNPerM*clamp(spec.pressurePa/reference,.15,2);
}
export function tyreContactPatchLength(radiusM:number,deflectionM:number):number{
  if(!Number.isFinite(radiusM)||radiusM<=0||!Number.isFinite(deflectionM)||deflectionM<0)throw new RangeError('Invalid tyre geometry');
  const d=Math.min(radiusM*.95,deflectionM);
  return Math.max(.04,2*Math.sqrt(Math.max(0,2*radiusM*d-d*d)));
}
export function loadedTyreState(spec:TyreComplianceSpec,radiusM:number,normalLoadN:number):LoadedTyreState{
  if(!Number.isFinite(normalLoadN)||normalLoadN<0)throw new RangeError('Invalid tyre load');
  const stiffness=tyreRadialStiffness(spec),max=spec.maxDeflectionM??Math.min(radiusM*.18,.10),deflection=Math.min(max,normalLoadN/stiffness);
  return Object.freeze({radialStiffnessNPerM:stiffness,deflectionM:deflection,loadedRadiusM:Math.max(.01,radiusM-deflection),contactPatchLengthM:tyreContactPatchLength(radiusM,deflection)});
}
