import {mulberry32} from '../core/random.js';
import type {AudioChannels} from './synth.js';

export interface RotorAcousticState {
 readonly rpm:number;
 readonly blades:number;
 readonly radiusM:number;
 readonly loadN:number;
 readonly vortexRing?:number;
 readonly retreatingStall?:number;
 readonly gain?:number;
 readonly seed?:number;
}

/** Deterministic rotor acoustics driven by the physical rotor state.
 * Tonal blade-pass harmonics come from RPM/blade count; broadband energy rises with
 * blade loading, VRS and retreating-blade stall. It has no private simulation clock. */
export function renderRotorSound(state:RotorAcousticState,duration:number,sampleRate=48000):AudioChannels{
 const {rpm,blades,radiusM,loadN}=state;
 if(!Number.isFinite(duration)||duration<=0||duration>60||!Number.isSafeInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Invalid rotor audio render');
 if(!Number.isFinite(rpm)||rpm<0||rpm>20000||!Number.isSafeInteger(blades)||blades<1||blades>16||!Number.isFinite(radiusM)||radiusM<=0||radiusM>100||!Number.isFinite(loadN)||loadN<0)throw new RangeError('Invalid rotor acoustic state');
 const vrs=Math.max(0,Math.min(1,state.vortexRing??0)),stall=Math.max(0,Math.min(1,state.retreatingStall??0)),gain=Math.max(0,Math.min(4,state.gain??1));
 const count=Math.ceil(duration*sampleRate),left=new Float32Array(count),right=new Float32Array(count),rng=mulberry32(state.seed??911);
 const rotorHz=rpm/60,bladePass=rotorHz*blades,tip=Math.min(1.3,rotorHz*Math.PI*2*radiusM/343),load=Math.min(1,loadN/12000);
 let low=0,phase=0;
 for(let i=0;i<count;i++){
  const noise=rng()*2-1;low+=(noise-low)*(1-Math.exp(-2*Math.PI*(180+260*stall)/sampleRate));
  phase+=2*Math.PI*bladePass/sampleRate;
  const pulse=Math.sin(phase)*.55+Math.sin(phase*2+.25)*.24+Math.sin(phase*3+.8)*.10;
  const modulation=1+vrs*(.22*Math.sin(i/sampleRate*2*Math.PI*7)+.10*Math.sin(i/sampleRate*2*Math.PI*13));
  const broadband=low*(.06+.15*tip+.18*stall+.22*vrs);
  const sample=Math.tanh((pulse*(.035+.11*load)*modulation+broadband)*gain);
  left[i]=sample;right[i]=sample;
 }
 return{left,right,sampleRate};
}
