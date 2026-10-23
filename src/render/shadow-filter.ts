/** Each map has its own normalized PCF kernel. Keep sample counts shared with
 * the shader loops: combining unnormalized sums weights unequal kernels wrong. */
export const STATIC_SHADOW_SAMPLES=4;
export const DYNAMIC_SHADOW_SAMPLES=4;
export const SHADOW_FILTER_WGSL=`
const STATIC_SHADOW_SAMPLES=${STATIC_SHADOW_SAMPLES}u;
const DYNAMIC_SHADOW_SAMPLES=${DYNAMIC_SHADOW_SAMPLES}u;
// Centred, symmetric footprint: changing rotation at half-metre world-cell
// boundaries makes the same continuous shadow edge break into square patches.
const SHADOW_TAPS=array<vec2<f32>,4>(
 vec2<f32>(-.5,-.5),vec2<f32>(.5,-.5),
 vec2<f32>(-.5,.5),vec2<f32>(.5,.5)
);
fn combineShadowVisibility(staticSum:f32,dynamicSum:f32)->f32{
 return min(staticSum/f32(STATIC_SHADOW_SAMPLES),dynamicSum/f32(DYNAMIC_SHADOW_SAMPLES));
}
/** Solve dz = gradient.x*du + gradient.y*dv on the local receiver plane.
 * Degenerate light projections have no reliable inverse. */
fn shadowReceiverGradient(dx:vec3<f32>,dy:vec3<f32>)->vec2<f32>{
 let det=dx.x*dy.y-dx.y*dy.x;
 if(abs(det)<=1e-12){return vec2<f32>(0.0);}
 return vec2<f32>(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/det;
}
`;
