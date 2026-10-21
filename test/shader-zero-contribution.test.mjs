import test from 'node:test';
import assert from 'node:assert/strict';

// The WGSL main asphalt shader has three independent procedural noise terms.
// Each term is multiplied by a bounded physical response coefficient. The
// early-exit path is legal only where that coefficient is exactly zero.
function smoothstep(low,high,value){
  const t=Math.max(0,Math.min(1,(value-low)/(high-low)));
  return t*t*(3-2*t);
}
function tracks(z){
  const fract=x=>x-Math.floor(x);
  const repeated=Math.abs(fract((z+.34)/1.55)-.5);
  return 1-smoothstep(.065,.13,repeated);
}
function evaluateOld(slush,waterDepth,track,z,noise){
  const phaseWet=Math.max(0,Math.min(1,slush*.95+waterDepth/.0035*.42));
  const laneWarp=(noise[0]-.5)*.10;
  const historicalRut=tracks(z+laneWarp)*smoothstep(.035,.22,phaseWet);
  const roadTrack=Math.max(track,historicalRut*.72);
  const shoulder=smoothstep(.10,.48,historicalRut)*(1-smoothstep(.58,.94,historicalRut));
  const ridge=shoulder*slush*(.72+.55*noise[1]);
  const ridgeBump=(noise[2]-.5)*ridge;
  return {phaseWet,historicalRut,roadTrack,ridge,ridgeBump};
}
function evaluateFast(slush,waterDepth,track,z,readNoise){
  const phaseWet=Math.max(0,Math.min(1,slush*.95+waterDepth/.0035*.42));
  const gain=smoothstep(.035,.22,phaseWet);
  let historicalRut=0;
  if(gain>0)historicalRut=tracks(z+(readNoise(0)-.5)*.10)*gain;
  const roadTrack=Math.max(track,historicalRut*.72);
  const shoulder=smoothstep(.10,.48,historicalRut)*(1-smoothstep(.58,.94,historicalRut));
  let ridge=0;
  if(shoulder>0&&slush>0)ridge=shoulder*slush*(.72+.55*readNoise(1));
  const ridgeBump=ridge>0?(readNoise(2)-.5)*ridge:0;
  return {phaseWet,historicalRut,roadTrack,ridge,ridgeBump};
}

test('dry asphalt contributes no rut/noise and all results match the old shader algebra',()=>{
  for(const track of [0,.05,.5,1])for(const z of [-200,-2,0,1,50]){
    const noise=[.14,.73,.37];let calls=0;
    const old=evaluateOld(0,0,track,z,noise);
    const next=evaluateFast(0,0,track,z,i=>{calls++;return noise[i]});
    // IEEE-754 +0 and -0 carry equal physical work/energy. Compare numerically.
    for(const key of Object.keys(old))
      assert.ok(Number.isFinite(next[key])&&Math.abs(next[key]-old[key])<=1e-12,
        key+': '+next[key]+' vs '+old[key]);
    assert.equal(calls,0,'wet-rut shader read noise on provably dry material');
  }
});

test('wet but zero slush retains only physically nonzero procedural terms',()=>{
  const noise=[.52,.71,.38],waterDepth=.003;
  for(const z of [-20,-1,0,1,20]){
    const old=evaluateOld(0,waterDepth,.4,z,noise);
    const next=evaluateFast(0,waterDepth,.4,z,i=>noise[i]);
    // IEEE-754 +0 and -0 carry equal physical work/energy. Compare numerically.
    for(const key of Object.keys(old))
      assert.ok(Number.isFinite(next[key])&&Math.abs(next[key]-old[key])<=1e-12,
        key+': '+next[key]+' vs '+old[key]);
    assert.equal(next.ridge,0);
  }
});

test('nonzero wet and slush cases match every material quantity to numerical precision',()=>{
  const noise=[.18,.58,.83];
  for(const slush of [0,.005,.15,.5,1])
    for(const waterDepth of [0,.00005,.0005,.003,.01])
      for(const track of [0,.3,.9])
        for(const z of [-15,-.4,.13,2.4]){
          const a=evaluateOld(slush,waterDepth,track,z,noise);
          const b=evaluateFast(slush,waterDepth,track,z,i=>noise[i]);
          for(const key of Object.keys(a)){
            assert.ok(Math.abs(a[key]-b[key])<=1e-12,key+': '+a[key]+' vs '+b[key]);
          }
        }
});
