import {generatePassengerVehicle,type ParametricPassengerGeometry,type PassengerVehicleProfile} from './passenger.js';
import {M3_SHELL_FIDELITY,m3HighFidelityBody} from './m3-shell.js';

/**
 * Compact authored approximation of the user-supplied BMW M3 reference.
 *
 * Macro dimensions and structure stay parametric. The production visual body can
 * optionally overlay the tiny quantized exterior shell in m3-shell.ts, which is
 * deduplicated from the user's own reference and retains sub-0.04 mm vertex error.
 */
export const M3_REFERENCE_PROVENANCE=Object.freeze({
  source:'BMW M3.fbx',
  sha256:'9c03464b3407ff1ab45cf4b3b913ee108ed454e4d7e5a82da438667af8cc2d67',
  sourceBytes:241628,
  representation:'parametric macro profile + deduplicated uint16 exterior shell',
  origin:'TheGame procedural profile plus quantized exterior CarPaint shell derived from the user-supplied reference',
  parametricFallbackEnvelopeMeanErrorMm:Object.freeze({width:6.4,top:6.0,bottom:6.8}),
  highFidelity:Object.freeze({...M3_SHELL_FIDELITY}),
});

export const M3_PARAMETRIC_PROFILE:PassengerVehicleProfile=Object.freeze({
  id:'m3-procedural',
  dimensions:Object.freeze({
    width:1.888,
    length:4.796,
    height:1.462,
    wheelbase:2.837,
    track:1.574,
    wheelRadius:.346,
    axleOffset:.118,
    clearance:.16,
  }),
  side:Object.freeze([
    [-.5,.894,.715,.92],
    [-.40,.922,.725,.84],
    [-.28,.998,.715,.84],
    [-.08,.976,.68,.86],
    [.06,.976,.658,.875],
    [.1633,.970,.675,.80],
    [.32,1.006,.608,.935],
    [.46,.957,.522,.975],
    [.5,.888,.492,1],
  ] as const),
  roof:Object.freeze([
    [-.255,.60,.918],
    [-.19,.59,.947],
    [-.08,.58,.965],
    [0,.60,.945],
    [.0484,.628,.9034],
  ] as const),
  cowl:.1633,
  rearGlassBase:-.402,
  roofCrown:.050,
  hoodCrown:.030,
  shoulder:.20,
  lowerWidth:.964,
  wheel:Object.freeze({width:.30,rimRatio:.80,spokes:10,dish:.032}),
});


export function generateM3Vehicle():ParametricPassengerGeometry{
  const procedural=generatePassengerVehicle(M3_PARAMETRIC_PROFILE),body=m3HighFidelityBody();
  const parts=procedural.parts.map(part=>part.id==='body'?Object.freeze({...part,mesh:body}):part);
  return Object.freeze({
    profile:procedural.profile,
    parts:Object.freeze(parts),
    body,
    bodyTriangles:body.indices.length/3,
    generatedTriangles:procedural.generatedTriangles-procedural.bodyTriangles+body.indices.length/3,
  });
}
