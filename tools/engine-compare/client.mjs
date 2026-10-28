import {installGPUJournal} from './gpu-journal.mjs';
import {createFixture,createMotion, hash, versions, visibilityCamera} from './fixture.mjs';
import {requireParameters} from './parameters.mjs';
import {createBackend, seedEnvironment, describePipeline} from './backends.mjs';
import {requireProfile,auditProfile} from './profiles.mjs';
import {distribution} from './metrics.mjs';
import {captureEngineQuality} from './engine-quality.mjs';

const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
const cpuApiTimings=new URLSearchParams(location.search).get('cpuApiTimings')==='1';
const hooks = installGPUJournal({cpuApiTimings});
globalThis.runEngineQuality = async options => {
  const report = await captureEngineQuality(hooks, options);
  globalThis.engineQualityArtifacts = report.captures.map(({name, png, rgba8, reflectionPng, reflectionRgba16f}) => ({name, png, rgba8, reflectionPng, reflectionRgba16f}));
  report.captures = report.captures.map(({png, rgba8, reflectionPng, reflectionRgba16f, ...metadata}) => metadata);
  return report;
};

globalThis.runEngineCompare = async ({backend: name, count, scenario, width, height, frames, warmup, repetition,profile='native',parameters:requestedParameters={},cpuApiTimings:requestedCpuApiTimings=false,cpuPhaseTimings=false}) => {
  requireProfile(profile);
  if(requestedCpuApiTimings!==cpuApiTimings)throw new Error('CPU API timing control does not match browser hooks');
  const parameters=requireParameters(requestedParameters),fixture = await createFixture(count,parameters), canvas = document.querySelector('canvas');
  const motion=createMotion(fixture,scenario,parameters.dirtyFraction,parameters.motionApi);
  canvas.width = width;canvas.height = height;
  const environment = await seedEnvironment(canvas, fixture, width, height);
  // Destroy the setup device before creating the measured renderer.
  const seedJournal = hooks.journals.at(-1);
  await seedJournal.dispose();seedJournal.device.destroy();
  const environmentHash = await hash(environment.rgba16f);
  const backend = await createBackend(name, canvas, fixture, environment, width, height,profile,{cpuPhaseTimings,...parameters});
  const journal = hooks.journals.at(-1);
  if (journal === seedJournal) throw new Error('Missing renderer device journal');
  try {
    for (let n = 0; n < warmup; n++) {await raf();motion.update(n);backend.updateInstances?.(motion.selected);backend.render(visibilityCamera(n, scenario), n);}
    await backend.flush();await journal.flush();
    motion.syncModels();
    const audit = backend.audit(visibilityCamera(Math.max(0, warmup - 1), scenario));
    if (audit.objects !== count + 9 || Object.entries(audit).some(([key, value]) => key.endsWith('MaxError') && value > 1e-4)) throw new Error('Identical-scene gate failed: ' + JSON.stringify(audit));
    const actual=document.createElement('canvas');actual.width=width;actual.height=height;const actualContext=actual.getContext('2d',{willReadFrequently:true});
    const samples = [], intervals = [];let previous;
    for (let n = 0; n < frames; n++) {
      const now = await raf();
      if (previous !== undefined) intervals.push(now - previous);previous = now;
      const frame = n + warmup, instrumentationStart = performance.now();
      journal.beginFrame(n);
      backend.beginCpuFrame?.(n);
      const start = performance.now();motion.update(frame);backend.updateInstances?.(motion.selected);backend.render(visibilityCamera(frame, scenario), frame);const end = performance.now();
      const work = journal.endFrame();work.cpuMs = end - start;work.journalCpuMs = performance.now() - instrumentationStart - work.cpuMs;samples.push(work);
      if(cpuPhaseTimings)work.cpuPhases=backend.endCpuFrame(work.cpuMs);
      if(cpuApiTimings){if(!work.cpuApi||work.cpuApi.totalMs>work.cpuMs+1e-6)throw new Error('CPU API timings exceed measured render interval');work.cpuRemainingMs=Math.max(0,work.cpuMs-work.cpuApi.totalMs);}
      // Latch the last presented frame after both CPU timers stop. It cannot
      // change a subsequent measured RAF interval, because this is the final frame.
      if(n===frames-1)actualContext.drawImage(canvas,0,0);
    }
    await backend.flush();await journal.flush();
    const timed = samples.filter(sample => sample.gpuMs !== undefined);
    if (timed.length < frames * .95 || samples.some(sample => !sample.passes.length)) throw new Error('Insufficient GPU timestamp coverage: ' + timed.length + '/' + frames);
    const measured = backend.inspect();
    motion.syncModels();
    const finalAudit=backend.audit(visibilityCamera(frames+warmup-1,scenario));
    if(finalAudit.objects!==count+9||Object.entries(finalAudit).some(([key,value])=>key.endsWith('MaxError')&&value>1e-4))throw new Error('Final scene audit failed: '+JSON.stringify(finalAudit));
    const motionHash=await hash(fixture.groups.map(group=>[group.key,Array.from(group.models)]));
    globalThis.engineCompareActualImage=actual.toDataURL('image/png');
    const actualPixelHash=await hash(actualContext.getImageData(0,0,width,height).data);
    motion.restore();backend.updateInstances?.(motion.selected);
    if (measured.errors?.length) throw new Error('Renderer validation errors: ' + measured.errors.join('\n'));
    const afterHash = await hash(fixture.scene.snapshot());
    if (afterHash !== fixture.replayHash) throw new Error('Renderer mutated the authoritative physical state');
    const passGroups = new Map();
    for (const sample of timed) for (const pass of sample.passes) {
      const key = pass.kind + ':' + pass.label.replace(/^\[\d+\|\d+\] - /, '');
      if (!passGroups.has(key)) passGroups.set(key, []);
      passGroups.get(key).push(pass);
    }
    const gpuPasses=Object.fromEntries([...passGroups].map(([key,passes])=>[key,{
      gpuMs:distribution(passes.map(pass=>pass.gpuMs)),drawCalls:distribution(passes.map(pass=>pass.drawCalls)),indirectDrawCalls:distribution(passes.map(pass=>pass.indirectDrawCalls)),dispatches:distribution(passes.map(pass=>pass.dispatches)),
    }]));
    auditProfile(profile,name,measured,gpuPasses);
    // Canonical view is captured independently of measured camera motion.
    backend.reset();
    const copy = document.createElement('canvas');copy.width = width;copy.height = height;
    const ctx = copy.getContext('2d', {willReadFrequently: true});
    for (let n = 0; n < 32; n++) {
      backend.render(visibilityCamera(0), n);
      // WebGPU presentation textures expire at the next browser task. Latch the
      // final canvas synchronously, before awaiting a queue completion callback.
      if (n === 31) ctx.drawImage(canvas, 0, 0);
      await backend.flush();
    }
    await journal.flush();
    const pixels = ctx.getImageData(0, 0, width, height).data, pixelSamples = [];
    let sum = 0, sumSquares = 0;
    for (let n = 0; n < pixels.length; n += 4) {const luminance = (pixels[n] + pixels[n + 1] + pixels[n + 2]) / 3;sum += luminance;sumSquares += luminance * luminance;}
    const pixelMean = sum / (width * height), pixelStddev = Math.sqrt(sumSquares / (width * height) - pixelMean * pixelMean);
    if (pixelMean < 3 || pixelStddev < 3) throw new Error('Empty or flat screenshot: ' + JSON.stringify({pixelMean, pixelStddev}));
    const skyOffset = Math.floor(width / 2) * 4, skyRgb = [...pixels.subarray(skyOffset, skyOffset + 3)];
    if (Math.max(...skyRgb) < 10) throw new Error('Missing sky/environment in canonical capture');
    for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
      const offset = (Math.floor((y + .5) * height / 36) * width + Math.floor((x + .5) * width / 64)) * 4;
      pixelSamples.push(...pixels.subarray(offset, offset + 3));
    }
    globalThis.engineCompareImage = copy.toDataURL('image/png');
    if (await hash(fixture.scene.snapshot()) !== fixture.replayHash) throw new Error('Quality capture mutated the physical state');
    const by = field => distribution(samples.map(sample => sample[field]));
    const cpuApi=cpuApiTimings?{enabled:true,coveredMethods:[...journal.cpuApiMethods].sort(),totalMs:distribution(samples.map(sample=>sample.cpuApi.totalMs)),remainingMs:by('cpuRemainingMs'),methods:Object.fromEntries([...journal.cpuApiMethods].sort().map(method=>[method,{calls:distribution(samples.map(sample=>sample.cpuApi.methods[method]?.calls??0)),exclusiveMs:distribution(samples.map(sample=>sample.cpuApi.methods[method]?.exclusiveMs??0)),inclusiveMs:distribution(samples.map(sample=>sample.cpuApi.methods[method]?.inclusiveMs??0))}])),scope:'Synchronous host duration inside covered native WebGPU calls; exclusive totals avoid nested double counting. Remaining wall time includes JavaScript, hook/timer overhead and uninstrumented native APIs, including GPUCanvasContext.getCurrentTexture. Native call time is not GPU execution time or proof of a stall source.'}:null;
    return {backend: name, version: versions[name],profile,parameters,motion:motion.describe(),motionHash,finalAudit,actualPixelHash,actualCamera:visibilityCamera(frames+warmup-1,scenario),count, scenario, width, height, frames, warmup, repetition, adapter: journal.adapter,
      sourceHash: fixture.sourceHash, replayHash: fixture.replayHash, afterHash, geometryHash: fixture.geometryHash, environmentHash, audit,
      cpuMs: by('cpuMs'), gpuMs: distribution(timed.map(sample => sample.gpuMs)), frameIntervalMs: distribution(intervals), fps: 1000 / distribution(intervals).mean,
      uploadBytes: distribution(samples.map(sample => sample.bufferUploadBytes + sample.textureUploadBytes)), bufferUploadBytes: by('bufferUploadBytes'), textureUploadBytes: by('textureUploadBytes'), externalImageEstimatedBytes: by('externalImageEstimatedBytes'),
      drawCalls: by('drawCalls'), indirectDrawCalls: by('indirectDrawCalls'), trianglesDirect: by('trianglesDirect'), dispatches: by('dispatches'), submissions: by('submissions'), journalCpuMs: by('journalCpuMs'),writeBufferCalls:by('writeBufferCalls'),
      timestampCoverage: timed.length / frames, gpuPasses, measured,cpuApi,
      cpuPhases:cpuPhaseTimings?{enabled:true,scope:'Renderer phase host wall time, including native API calls. Exclusive totals avoid nested double counting; remaining time includes code outside phases and observer overhead. Renderer GPU profiling and occlusion queries remain disabled.',coveredMs:distribution(samples.map(sample=>sample.cpuPhases.coveredMs)),remainingMs:distribution(samples.map(sample=>sample.cpuPhases.remainingMs))}:null,
      pipeline: describePipeline(name,profile,parameters), pixelMean, pixelStddev, skyRgb, pixelSamples,
      raw: {cpuMs: samples.map(sample => sample.cpuMs), gpuMs: timed.map(sample => sample.gpuMs), frameIntervalMs: intervals, uploadBytes: samples.map(sample => sample.bufferUploadBytes + sample.textureUploadBytes), drawCalls: samples.map(sample => sample.drawCalls),...(cpuApiTimings?{cpuGpuApiMs:samples.map(sample=>sample.cpuApi.totalMs),cpuRemainingMs:samples.map(sample=>sample.cpuRemainingMs),cpuApiSamples:samples.map(sample=>sample.cpuApi)}:{}),...(cpuPhaseTimings?{cpuPhaseSamples:samples.map(sample=>sample.cpuPhases)}:{})}};
  } finally {motion.restore();try {await journal.dispose();} finally {try {backend.dispose();} finally {journal.device.destroy();}}}
};
document.documentElement.dataset.ready = '1';
