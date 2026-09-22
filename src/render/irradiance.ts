import type {Vec3} from '../math.js';

export type RadianceSampler=(direction:Vec3)=>readonly [number,number,number];

const BAND_SCALE=[Math.PI,2*Math.PI/3,2*Math.PI/3,2*Math.PI/3,Math.PI/4,Math.PI/4,Math.PI/4,Math.PI/4,Math.PI/4] as const;

export function shBasis(direction:Vec3):readonly [number,number,number,number,number,number,number,number,number]{
  const [x,y,z]=direction;
  return[
    .28209479177387814,
    .4886025119029199*y,
    .4886025119029199*z,
    .4886025119029199*x,
    1.0925484305920792*x*y,
    1.0925484305920792*y*z,
    .31539156525252005*(3*z*z-1),
    1.0925484305920792*x*z,
    .5462742152960396*(x*x-y*y),
  ];
}

/**
 * Projects world-space incident radiance into 3-band real SH and applies the
 * clamped-cosine convolution once. The resulting coefficients evaluate
 * Lambertian irradiance directly, so the frame shader pays only 9 RGB MADs.
 */
export function buildDiffuseIrradianceSH(sample:RadianceSampler,sampleCount=4096):Float32Array{
  if(!Number.isInteger(sampleCount)||sampleCount<256)throw new RangeError('Irradiance SH sampleCount must be an integer >= 256');
  const coefficients=new Float64Array(27),solidAngle=4*Math.PI/sampleCount,goldenAngle=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<sampleCount;i++){
    const y=1-2*(i+.5)/sampleCount,r=Math.sqrt(Math.max(0,1-y*y)),phi=i*goldenAngle,direction:Vec3=[Math.cos(phi)*r,y,Math.sin(phi)*r],radiance=sample(direction),basis=shBasis(direction);
    for(let band=0;band<9;band++){
      const weight=basis[band]!*solidAngle*BAND_SCALE[band]!,offset=band*3;
      coefficients[offset]=coefficients[offset]!+radiance[0]*weight;coefficients[offset+1]=coefficients[offset+1]!+radiance[1]*weight;coefficients[offset+2]=coefficients[offset+2]!+radiance[2]*weight;
    }
  }
  const packed=new Float32Array(36);
  for(let band=0;band<9;band++){packed[band*4]=coefficients[band*3]!;packed[band*4+1]=coefficients[band*3+1]!;packed[band*4+2]=coefficients[band*3+2]!;}
  packed[3]=1;
  return packed;
}

export function evaluateDiffuseIrradianceSH(packed:ArrayLike<number>,direction:Vec3):readonly [number,number,number]{
  if(packed.length<36)throw new RangeError('Diffuse irradiance SH requires 9 vec4 coefficients');
  const basis=shBasis(direction),rgb=[0,0,0] as [number,number,number];
  for(let band=0;band<9;band++)for(let channel=0;channel<3;channel++)rgb[channel]=rgb[channel]!+packed[band*4+channel]!*basis[band]!;
  return rgb;
}
