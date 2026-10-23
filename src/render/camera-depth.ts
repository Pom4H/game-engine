/** The camera's depth encoding is independent of shadow and local-probe maps.
 * The Game's original renderer writes logarithmic depth in the fragment stage;
 * its perspective clip position (and therefore clipping and motion) stays intact.
 */
export interface CameraDepthConfiguration {
 readonly encoding:'perspective'|'logarithmic';
 readonly near:number;
 readonly far:number;
 readonly logarithmicDenominator:number;
}
export function cameraDepthConfiguration(logarithmicFar?:number):CameraDepthConfiguration {
 if(logarithmicFar!==undefined&&(!Number.isFinite(logarithmicFar)||logarithmicFar<=.05))throw new RangeError('logarithmicDepthFar must be finite and greater than the camera near plane (.05 m)');
 return Object.freeze({encoding:logarithmicFar===undefined?'perspective':'logarithmic',near:.05,far:logarithmicFar??10000,logarithmicDenominator:logarithmicFar===undefined?0:Math.log2(1+logarithmicFar)});
}
export const CAMERA_DEPTH_WGSL=`
fn logarithmicCameraDepth(viewDepth:f32,denominator:f32)->f32{return clamp(log2(1.0+max(0.0,viewDepth))/denominator,0.0,1.0);}
fn logarithmicCameraDistance(depth:f32,denominator:f32)->f32{return exp2(depth*denominator)-1.0;}
`;
