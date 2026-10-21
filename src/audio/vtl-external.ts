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
  upstreamCommit:'df30392f18dc5e175b577c3ba734caaa65a3927f',
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

/** Hz and Pa are physical targets, in utterance-local seconds. */
export interface VtlPitchPoint{readonly timeS:number;readonly hz:number;}
export interface VtlPressurePoint{readonly timeS:number;readonly pa:number;}
export interface VtlDialogueSpeaker{
  readonly id:string;
  readonly name:string;
  /** Null preserves the calibrated JD3 tract; a profile morphs the tract anatomy. */
  readonly anatomy:{readonly ageMonths:number;readonly isMale:boolean}|null;
  /** Equal-power stereo placement, from -1 to 1. */
  readonly pan:number;
}
export interface VtlDialogueTurn{
  readonly id:string;
  readonly speakerId:string;
  readonly text:string;
  /** Absolute start in the dialogue; segment and contour times stay local. */
  readonly startS:number;
  readonly segments:readonly VtlExternalSegment[];
  readonly pitch:readonly VtlPitchPoint[];
  /** Multiplies the converter's articulation-aligned 800 Pa pressure windows. */
  readonly pressure:readonly VtlPressurePoint[];
}
export interface VtlDialoguePlan{
  readonly schemaVersion:1;
  readonly sampleRate:44100;
  readonly speakers:readonly VtlDialogueSpeaker[];
  readonly turns:readonly VtlDialogueTurn[];
}

// SAMPA inventory accepted by the pinned backend; an unknown symbol must not
// silently produce a different articulatory gesture.
const VTL_PHONES=new Set(('a: e: i: o: u: E: 2: y: a e i o u E 2 y I O U 9 Y @ 6 '+
  'aI aU OY i:6 i6 I6 y:6 y6 Y6 e:6 e6 E6 E:6 2:6 26 96 a:6 a6 u:6 u6 U6 o:6 o6 O6 '+
  '? p b t d k g f v T D s z S Z C j x r R h pf ts tS dZ m n N l').split(' '));
const VTL_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function finiteRange(value:number,min:number,max:number,name:string):void{
  if(!Number.isFinite(value)||value<min||value>max)throw new RangeError(name+' is out of range');
}
function contourTimes(points:readonly {readonly timeS:number}[],durationS:number):void{
  if(!points.length||points[0]!.timeS!==0)throw new RangeError('VTL contour must start at zero');
  let previous=-1;
  for(const point of points){
    finiteRange(point.timeS,0,durationS,'VTL contour time');
    if(previous>=0&&point.timeS-previous<.001-1e-9)throw new RangeError('VTL contour times must increase by at least 1 ms');
    previous=point.timeS;
  }
}

/**
 * A deterministic motor/prosody score, not a text-to-phoneme model. The caller
 * supplies pronunciations and intonation. No waveform, TTS or voice samples are
 * accepted; the external worker synthesizes each turn from the physical score.
 */
export function planVtlDialogue(
  speakers:readonly VtlDialogueSpeaker[],turns:readonly VtlDialogueTurn[],
):VtlDialoguePlan{
  if(!speakers.length||speakers.length>32||!turns.length||turns.length>256)throw new RangeError('VTL dialogue must have 1–32 speakers and 1–256 turns');
  const ids=new Set<string>();
  const frozenSpeakers=speakers.map(speaker=>{
    if(!VTL_ID.test(speaker.id)||ids.has(speaker.id))throw new RangeError('Invalid or duplicate VTL speaker ID');
    ids.add(speaker.id);
    if(!speaker.name.trim())throw new RangeError('VTL speaker name must not be empty');
    finiteRange(speaker.pan,-1,1,'VTL speaker pan');
    if(speaker.anatomy){
      finiteRange(speaker.anatomy.ageMonths,12,1200,'VTL anatomy age');
      if(!Number.isInteger(speaker.anatomy.ageMonths)||typeof speaker.anatomy.isMale!=='boolean')throw new TypeError('Invalid VTL anatomy');
    }
    return Object.freeze({...speaker,anatomy:speaker.anatomy?Object.freeze({...speaker.anatomy}):null});
  });
  const turnIds=new Set<string>();
  const frozenTurns=turns.map(turn=>{
    if(!VTL_ID.test(turn.id)||turnIds.has(turn.id))throw new RangeError('Invalid or duplicate VTL turn ID');
    turnIds.add(turn.id);
    if(!ids.has(turn.speakerId))throw new RangeError('Unknown VTL speaker: '+turn.speakerId);
    if(!turn.text.trim()||!turn.segments.length)throw new RangeError('Empty VTL turn');
    finiteRange(turn.startS,0,600,'VTL turn start');
    let durationS=0;
    const segments=turn.segments.map(segment=>{
      if(segment.phone!==''&&!VTL_PHONES.has(segment.phone))throw new RangeError('Unsupported VTL phone: '+segment.phone);
      finiteRange(segment.durationS,.001,55,'VTL segment duration');
      durationS+=segment.durationS;
      return Object.freeze({...segment});
    });
    if(!segments.some(segment=>segment.phone)||durationS>55||turn.startS+durationS>600)throw new RangeError('VTL speech must fit within 55 s per turn and 600 s total');
    contourTimes(turn.pitch,durationS);contourTimes(turn.pressure,durationS);
    for(const point of turn.pitch)finiteRange(point.hz,16,512,'VTL pitch');
    for(const point of turn.pressure)finiteRange(point.pa,0,1600,'VTL pressure');
    for(let i=1;i<turn.pitch.length;i++){
      const a=turn.pitch[i-1]!,b=turn.pitch[i]!;
      if(Math.abs(12*Math.log2(b.hz/a.hz)/(b.timeS-a.timeS))>80+1e-9)throw new RangeError('VTL pitch slope exceeds 80 semitones/s');
    }
    return Object.freeze({...turn,segments:Object.freeze(segments),
      pitch:Object.freeze(turn.pitch.map(point=>Object.freeze({...point}))),
      pressure:Object.freeze(turn.pressure.map(point=>Object.freeze({...point}))),
    });
  });
  return Object.freeze({schemaVersion:1,sampleRate:44100,speakers:Object.freeze(frozenSpeakers),turns:Object.freeze(frozenTurns)});
}
