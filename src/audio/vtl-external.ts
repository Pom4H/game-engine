/**
 * External VocalTractLab speech backend contract.
 *
 * game-engine remains MIT and owns the utterance/motor plan.
 * VocalTractLab is GPL-3.0 and is intentionally executed as a separate
 * process/library by a server-side worker. No VTL code or binary is linked
 * into this package.
 */

export type VtlSeedSyllable='la'|'ma'|'na'|'pa';

export interface VtlExternalSegment{
  /** VTL segment symbol; empty string means silence. */
  readonly phone:string;
  readonly durationS:number;
}

export interface VtlExternalPlan{
  readonly text:string;
  readonly backend:'vocaltractlab-external';
  readonly speaker:'JD3';
  readonly sampleRate:number;
  readonly segments:readonly VtlExternalSegment[];
}

export const VTL_EXTERNAL_BACKEND=Object.freeze({
  kind:'external-process' as const,
  upstream:'TUD-STKS/VocalTractLabBackend-dev',
  license:'GPL-3.0',
  api:'vtlSegmentSequenceToGesturalScore -> vtlGesturalScoreToAudio',
  sampleRate:44_100,
});

const SYLLABLES:Readonly<Record<VtlSeedSyllable,readonly VtlExternalSegment[]>>=Object.freeze({
  la:Object.freeze([
    Object.freeze({phone:'l',durationS:.18}),
    Object.freeze({phone:'a',durationS:.30}),
  ]),
  ma:Object.freeze([
    Object.freeze({phone:'m',durationS:.18}),
    Object.freeze({phone:'a',durationS:.30}),
  ]),
  na:Object.freeze([
    Object.freeze({phone:'n',durationS:.18}),
    Object.freeze({phone:'a',durationS:.30}),
  ]),
  pa:Object.freeze([
    Object.freeze({phone:'p',durationS:.18}),
    Object.freeze({phone:'a',durationS:.30}),
  ]),
});

export function planVtlNpcSpeech(text:string):VtlExternalPlan{
  const normalized=text.toLowerCase().trim().replace(/\s+/g,' ');
  if(!normalized)throw new RangeError('VTL NPC text must not be empty');
  const words=normalized.split(' ') as VtlSeedSyllable[];
  const segments:VtlExternalSegment[]=[Object.freeze({phone:'',durationS:.12})];
  for(const word of words){
    const sequence=SYLLABLES[word];
    if(!sequence)throw new RangeError('VTL seed lexicon does not contain: '+word);
    segments.push(...sequence);
  }
  segments.push(Object.freeze({phone:'',durationS:.18}));
  return Object.freeze({
    text:normalized,
    backend:'vocaltractlab-external',
    speaker:'JD3',
    sampleRate:VTL_EXTERNAL_BACKEND.sampleRate,
    segments:Object.freeze(segments),
  });
}

export function serializeVtlSegmentSequence(plan:VtlExternalPlan):string{
  if(plan.backend!=='vocaltractlab-external')throw new TypeError('Not a VocalTractLab external plan');
  return plan.segments.map(segment=>{
    if(!Number.isFinite(segment.durationS)||segment.durationS<=0)throw new RangeError('VTL segment duration must be positive');
    if(/[;\r\n]/.test(segment.phone))throw new RangeError('Unsafe VTL segment symbol');
    return `name = ${segment.phone}; duration_s = ${segment.durationS.toFixed(6)};`;
  }).join('\n')+'\n';
}
