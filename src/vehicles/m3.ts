import type {PassengerVehicleProfile} from './passenger.js';

/**
 * Compact authored approximation of the user-supplied BMW M3 reference.
 *
 * This intentionally stores control sections and dimensions, not imported FBX
 * vertices/topology. Values come from the independently authored TheGame profile
 * whose local FBX comparison was tightened to ~6 mm mean sampled envelope error.
 */
export const M3_REFERENCE_PROVENANCE=Object.freeze({
  source:'BMW M3.fbx',
  sha256:'9c03464b3407ff1ab45cf4b3b913ee108ed454e4d7e5a82da438667af8cc2d67',
  sourceBytes:241628,
  representation:'authored parametric control sections',
  origin:'TheGame procedural M3 profile, no imported FBX vertices/topology at runtime',
  sampledEnvelopeMeanErrorMm:Object.freeze({width:6.4,top:6.0,bottom:6.8}),
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
