import {LiveSnowWorld} from './live-world.mjs';
import {makeAuthority} from './authority.mjs';
export const quality={output:[1920,1080],internal:[1920,1080],warmupFrames:2,maxWarmupFrames:2};
const spec = {
 version:1,seed:20261003,ground:0,
 environment:{temperatureC:-5,snowfall:'heavy',humidity:.8,wind:[2.2,0,.8],sunlight:.12,clock:{startHour:16.8,hoursPerSecond:0}},
 rendering:{sunDirection:[-.6,.48,-.5],sunColor:[1,.90,.78],sunIntensity:.55,skyColor:[.78,.84,.93],exposure:1.65,shadowExtent:125,environmentProbeGridM:32,fogDensity:.0045,fogColor:[.57,.66,.76],fogHeightFalloff:.055,fogStartDistance:45,fogRampDistance:125},
 camera:{position:[-25,29,22],target:[-12,1,-1],fov:58},entities:[],
};
export default spec;
export const liveAuthority=true;
export async function createAuthority(options={}){const archive=options.storageDirectory?await(await import('./snow-archive.mjs')).openSnowArchive(options.storageDirectory):undefined;return makeAuthority(spec,{...options,archive});}
const simulations=new WeakMap();
// Older, already-open worker pages predate the version handshake. Their next
// trusted scene load installs the updater without asking for a manual refresh.
async function upgradeOpenWorker(){
 if(globalThis.meshworkWorkerAutoUpdate||typeof document==='undefined'||!document.querySelector?.('#start')||!document.querySelector?.('#log'))return;
 try{const {upgradeLegacyWorker}=await import('/worker-upgrade.js');await upgradeLegacyWorker();}catch{}
}
export async function initializeRuntime(runtime){await upgradeOpenWorker();const previous=simulations.get(runtime);previous?.dispose();const sim=new LiveSnowWorld(runtime.scene);simulations.set(runtime,sim);runtime.snowCity=sim;}
export async function prepareFrame(runtime){const sim=simulations.get(runtime);if(!sim)throw Error('Snow city runtime is not initialized');sim.viewAspect=runtime.canvas?runtime.canvas.width/Math.max(1,runtime.canvas.height):16/9;sim.viewHeight=runtime.canvas?.height??1080;await sim.prepareFrame();runtime.presentationStages=sim.viewStages;}


/** Presentation-only restore from the single live authority. The original URL
 * remains stable; content hashes fence code and state across deployments. */
function applySnowRange(snow,frames,from,to){
 // Presentation needs the final state of each cell, not a replay of intermediate
 // material mutations. A tombstone followed by an edit restores that cell.
 const edits=new Map(),removed=new Set();for(let n=from;n<=to;n++){const frame=frames[n];for(const key of frame.snowRemoved??[]){edits.delete(key);removed.add(key);}for(const row of frame.snowEdits){removed.delete(row[0]);edits.set(row[0],row);}}
 snow.removeCells([...removed]);snow.apply([...edits.values()]);
}
export async function seekRuntime(runtime,targetTick,{streamId,sceneHash,epoch=0,signal}={}){
 if(!Number.isSafeInteger(targetTick)||targetTick<0||runtime.tickRate!==60)throw RangeError('Invalid 60 Hz state tick');
 if(!streamId||!sceneHash)throw Error('Live scene requires its stream and scene identity');
 const sim=simulations.get(runtime),start=Math.floor(targetTick/120)*120;
 const timings=runtime.authorityStages={'state.network':0,'state.decode':0,'state.snow':0,'state.pose':0};
 sim.chunks??=new Map();if(sim.stateEpoch!==epoch){sim.chunks.clear();sim.chunkStart=undefined;sim.restoredTick=-1;sim.stateEpoch=epoch;}let chunk=sim.chunks.get(start);
 const adjacent=sim.chunkStart===start-120&&sim.restoredTick<start;
 // Finish the previous delta range, including physics ticks between the last
 // displayed frame and the next chunk. Never lose edits at a quality boundary.
 if(adjacent){const applyAt=performance.now();const previous=sim.chunks.get(sim.chunkStart);applySnowRange(sim.snow,previous.frames,sim.restoredTick+1-sim.chunkStart,119);sim.restoredTick=start-1;timings['state.snow']+=performance.now()-applyAt;}
 const needsBase=!adjacent&&(sim.chunkStart!==start||sim.restoredTick>targetTick);
 if(!chunk||(needsBase&&!chunk.base)){const requestAt=performance.now();const response=await fetch('/streams/'+encodeURIComponent(streamId)+'/state?scene='+sceneHash+'&tick='+start+(needsBase?'':'&checkpoint=0'),{signal,cache:'no-store'});if(!response.ok)throw Error((await response.json()).error??'Live state unavailable');const text=await response.text();timings['state.network']+=performance.now()-requestAt;const decodeAt=performance.now();chunk=JSON.parse(text);timings['state.decode']+=performance.now()-decodeAt;if(chunk.startTick!==start||chunk.frames.length!==120||needsBase&&!chunk.base)throw Error('Invalid live state range');sim.chunks.set(start,chunk);while(sim.chunks.size>3)sim.chunks.delete(sim.chunks.keys().next().value);}
 const snowAt=performance.now();if(needsBase){sim.snow.restore(chunk.base.snow);sim.restoredTick=start-1;}sim.chunkStart=start;
 applySnowRange(sim.snow,chunk.frames,sim.restoredTick+1-start,targetTick-start);
 timings['state.snow']+=performance.now()-snowAt;sim.restoredTick=targetTick;const poseAt=performance.now();sim.restore(structuredClone(chunk.frames[targetTick-start]));timings['state.pose']+=performance.now()-poseAt;runtime.authorityProfile=chunk.profile;
}
