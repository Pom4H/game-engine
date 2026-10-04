/**
 * Brad H. Story's four-tier parametric vocal-tract area-function model.
 *
 * Structural data and equations are transcribed from:
 * Story, B.H. (2005), JASA 117(5), 3231-3254, DOI 10.1121/1.1869752.
 * Tier-I vectors are the MRI-derived male-speaker neutral diameter and the
 * first two PCA modes reported in Appendix A (44 sections).
 *
 * The model is intentionally independent from our procedural face scale.
 * Soft tissue constrains/animates visible anatomy; this model is the
 * speaker-calibrated acoustic tract representation.
 */

export const STORY_SECTIONS=44;
export const STORY_TUBELET_LENGTH_CM=.396825;
export const STORY_NOMINAL_TRACT_LENGTH_CM=STORY_SECTIONS*STORY_TUBELET_LENGTH_CM;

export const STORY_NEUTRAL_DIAMETER=Object.freeze([
  .636,.561,.561,.550,.598,.895,1.187,1.417,1.380,1.273,1.340,
  1.399,1.433,1.506,1.493,1.473,1.499,1.529,1.567,1.601,1.591,
  1.547,1.570,1.546,1.532,1.496,1.429,1.425,1.496,1.608,1.668,
  1.757,1.842,1.983,2.073,2.123,2.194,2.175,2.009,1.785,1.675,
  1.539,1.405,1.312,
] as const);

export const STORY_MODE_1=Object.freeze([
  .018,.001,-.013,-.025,-.036,-.048,-.062,-.076,-.093,-.111,-.130,
  -.149,-.167,-.183,-.196,-.204,-.207,-.203,-.193,-.175,-.151,
  -.119,-.082,-.041,.004,.051,.097,.141,.181,.214,.240,.257,.264,
  .260,.246,.224,.194,.159,.122,.087,.057,.038,.034,.048,
] as const);

export const STORY_MODE_2=Object.freeze([
  -.013,-.007,-.029,-.059,-.088,-.108,-.120,-.123,-.118,-.107,-.092,
  -.075,-.056,-.035,-.014,.008,.032,.057,.084,.111,.138,.164,.188,
  .206,.218,.221,.214,.195,.164,.121,.070,.013,-.046,-.100,-.143,
  -.167,-.165,-.132,-.066,.031,.148,.264,.346,.338,
] as const);

export type StoryVowel='i'|'ih'|'eh'|'ae'|'uh'|'aa'|'aw'|'uu'|'o'|'u'|'schwa';
export interface StoryVowelCoefficients{readonly q1:number;readonly q2:number}

/** Table IV coefficients. Names use readable ASCII approximations of IPA. */
export const STORY_VOWELS:Readonly<Record<StoryVowel,StoryVowelCoefficients>>=Object.freeze({
  i:Object.freeze({q1:-5.176,q2:-2.556}),
  ih:Object.freeze({q1:-1.092,q2:.677}),
  eh:Object.freeze({q1:2.561,q2:3.849}),
  ae:Object.freeze({q1:3.471,q2:1.729}),
  uh:Object.freeze({q1:.102,q2:-3.565}),
  aa:Object.freeze({q1:.981,q2:1.043}),
  aw:Object.freeze({q1:.331,q2:2.315}),
  uu:Object.freeze({q1:.128,q2:1.356}),
  o:Object.freeze({q1:-.493,q2:-1.910}),
  u:Object.freeze({q1:-2.685,q2:-2.065}),
  schwa:Object.freeze({q1:0,q2:0}),
});

export interface StoryConstriction{
  /** 1-based section index, glottis=1, lips=44. */
  readonly location:number;
  /** Desired minimum cross-sectional area at full activation. */
  readonly areaCm2:number;
  /** Full spatial range in section units. */
  readonly range:number;
  /** Downstream/upstream skew quotient. */
  readonly skew:number;
  /** Activation magnitude; values >1 spread a complete occlusion. */
  readonly magnitude:number;
}

export type StoryConsonant='p'|'t'|'k'|'m'|'n'|'ng'|'f'|'th'|'s'|'sh'|'l';

export interface StoryConsonantPreset{
  readonly q1:number;
  readonly q2:number;
  readonly constrictions:readonly StoryConstriction[];
  readonly nasalPortAreaCm2:number;
}

/** Story 2005 Tables I/II. The /l/ entry uses the acoustically improved "b" fit. */
export const STORY_CONSONANTS:Readonly<Record<StoryConsonant,StoryConsonantPreset>>=Object.freeze({
  p:Object.freeze({q1:-1.5,q2:.5,nasalPortAreaCm2:0,constrictions:Object.freeze([{location:44,areaCm2:0,range:4,skew:1,magnitude:1.1}])}),
  t:Object.freeze({q1:-1.5,q2:2,nasalPortAreaCm2:0,constrictions:Object.freeze([{location:39,areaCm2:0,range:6,skew:1.1,magnitude:1.3}])}),
  k:Object.freeze({q1:0,q2:0,nasalPortAreaCm2:0,constrictions:Object.freeze([{location:30,areaCm2:0,range:10,skew:1.5,magnitude:1.2}])}),
  m:Object.freeze({q1:0,q2:-3,nasalPortAreaCm2:1.04,constrictions:Object.freeze([{location:44,areaCm2:0,range:4,skew:1,magnitude:1.1}])}),
  n:Object.freeze({q1:-.5,q2:.4,nasalPortAreaCm2:1.09,constrictions:Object.freeze([{location:38,areaCm2:0,range:11,skew:3,magnitude:1.3}])}),
  ng:Object.freeze({q1:3,q2:-1,nasalPortAreaCm2:1.26,constrictions:Object.freeze([{location:31,areaCm2:0,range:8,skew:1.5,magnitude:2}])}),
  f:Object.freeze({q1:-3,q2:-2,nasalPortAreaCm2:0,constrictions:Object.freeze([{location:43,areaCm2:.1,range:4,skew:1,magnitude:1}])}),
  th:Object.freeze({q1:1,q2:2,nasalPortAreaCm2:0,constrictions:Object.freeze([{location:42,areaCm2:.05,range:9,skew:.3,magnitude:1}])}),
  s:Object.freeze({q1:.5,q2:3.5,nasalPortAreaCm2:0,constrictions:Object.freeze([{location:41,areaCm2:.05,range:9,skew:.6,magnitude:1}])}),
  sh:Object.freeze({q1:-4,q2:3.5,nasalPortAreaCm2:0,constrictions:Object.freeze([{location:36,areaCm2:.05,range:11,skew:.4,magnitude:1}])}),
  l:Object.freeze({q1:2,q2:-2,nasalPortAreaCm2:0,constrictions:Object.freeze([
    {location:12,areaCm2:3,range:4,skew:1,magnitude:1},
    {location:40,areaCm2:.1,range:4,skew:1,magnitude:1},
  ])}),
});

export interface StoryAreaControl{
  readonly q1:number;
  readonly q2:number;
  readonly constrictions?:readonly StoryConstriction[];
  /** 0..1 multiplier applied to all consonant magnitudes for coarticulation. */
  readonly consonantActivation?:number;
  /** Tier IV nasal port area from the published model. */
  readonly nasalPortAreaCm2?:number;
}

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

export function storyVowelArea(q1:number,q2:number):Float64Array{
  if(!Number.isFinite(q1)||!Number.isFinite(q2))throw new RangeError('Story vowel coefficients must be finite');
  const out=new Float64Array(STORY_SECTIONS);
  for(let i=0;i<STORY_SECTIONS;i++){
    const diameter=STORY_NEUTRAL_DIAMETER[i]!+q1*STORY_MODE_1[i]!+q2*STORY_MODE_2[i]!;
    out[i]=Math.max(.0001,Math.PI/4*diameter*diameter);
  }
  return out;
}

export function storyVowel(name:StoryVowel):Float64Array{
  const c=STORY_VOWELS[name];
  return storyVowelArea(c.q1,c.q2);
}

/**
 * Eq. 5-9: multiply a vowel substrate by an asymmetric Gaussian
 * superposition function whose minimum equals the requested area at m=1.
 */
export function storyApplyConstriction(
  substrate:Float64Array,
  spec:StoryConstriction,
  activation=1,
):Float64Array{
  if(substrate.length!==STORY_SECTIONS)throw new RangeError('Story substrate must contain 44 sections');
  if(!Number.isFinite(spec.location)||spec.location<1||spec.location>STORY_SECTIONS)throw new RangeError('Story constriction location must be 1..44');
  if(!Number.isFinite(spec.range)||spec.range<=0||!Number.isFinite(spec.skew)||spec.skew<=0)throw new RangeError('Story constriction range/skew must be positive');
  const lc=spec.location,base=substrate[Math.max(0,Math.min(STORY_SECTIONS-1,Math.round(lc)-1))]!;
  const degree=1-clamp(spec.areaCm2/Math.max(.0001,base),0,1);
  const rForward=spec.skew*spec.range/(1+spec.skew);
  const rBackward=spec.range/(1+spec.skew);
  const magnitude=Math.max(0,spec.magnitude*clamp(activation,0,1));
  const out=new Float64Array(STORY_SECTIONS);
  for(let zero=0;zero<STORY_SECTIONS;zero++){
    const i=zero+1,range=i<lc?rBackward:rForward;
    const gaussian=Math.exp(-Math.log(16)*((i-lc)/Math.max(1e-6,range))**2);
    const overlay=Math.max(0,1-magnitude*degree*gaussian);
    out[zero]=Math.max(.0001,substrate[zero]!*overlay);
  }
  return out;
}

export function storyArea(control:StoryAreaControl):Float64Array{
  let area=storyVowelArea(control.q1,control.q2);
  for(const spec of control.constrictions??[])area=storyApplyConstriction(area,spec,control.consonantActivation??1);
  return area;
}

export function storyControlForVowel(name:StoryVowel):StoryAreaControl{
  const q=STORY_VOWELS[name];
  return Object.freeze({q1:q.q1,q2:q.q2,nasalPortAreaCm2:0});
}

export function storyControlForConsonant(name:StoryConsonant,activation=1):StoryAreaControl{
  const p=STORY_CONSONANTS[name];
  return Object.freeze({
    q1:p.q1,q2:p.q2,
    constrictions:p.constrictions,
    consonantActivation:clamp(activation,0,1),
    nasalPortAreaCm2:p.nasalPortAreaCm2,
  });
}

/** Linear spatial resampling for the engine's current waveguide section count. */
export function resampleStoryArea(area:readonly number[],sections:number):Float64Array{
  if(area.length<2||!Number.isInteger(sections)||sections<2)throw new RangeError('Invalid Story area resample dimensions');
  if(sections===area.length)return new Float64Array(area);
  const out=new Float64Array(sections);
  for(let j=0;j<sections;j++){
    const x=(j+.5)/sections*area.length-.5;
    const i=Math.max(0,Math.min(area.length-2,Math.floor(x))),u=clamp(x-i,0,1);
    out[j]=area[i]!+(area[i+1]!-area[i]!)*u;
  }
  return out;
}

/**
 * Tier III nominal length vector. Local length perturbation functions are kept
 * explicit even though the current real-time waveguide still consumes one
 * effective global tract length; this preserves the Story ownership boundary.
 */
export function storyLengthVector(
  glottalDeltaCm=0,
  lipDeltaCm=0,
  range=8,
):Float64Array{
  const D=STORY_TUBELET_LENGTH_CM,K=2*Math.log(10_000);
  const gaussian=(i:number,center:number)=>Math.exp(-K*((i-center)/(2*range))**2);
  const sumG=Array.from({length:STORY_SECTIONS},(_,z)=>gaussian(z+1,1)).reduce((a,b)=>a+b,0);
  const sumL=Array.from({length:STORY_SECTIONS},(_,z)=>gaussian(z+1,STORY_SECTIONS)).reduce((a,b)=>a+b,0);
  const out=new Float64Array(STORY_SECTIONS);
  for(let z=0;z<STORY_SECTIONS;z++){
    const i=z+1;
    const alpha=1+(glottalDeltaCm*gaussian(i,1))/(D*sumG);
    const beta=1+(lipDeltaCm*gaussian(i,STORY_SECTIONS))/(D*sumL);
    out[z]=D*alpha*beta;
  }
  return out;
}
