#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, mkdtemp, rm, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, join, extname, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {distribution} from './metrics.mjs';
import {requireProfile} from './profiles.mjs';
import {motionModes,requireParameters} from './parameters.mjs';

const root = resolve(import.meta.dirname, '../..'), output = resolve(root, process.env.COMPARE_OUTPUT ?? 'artifacts/engine-compare');
const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!chrome) throw new Error('Set CHROME_PATH to a native WebGPU browser');
const frames = Number(process.env.COMPARE_FRAMES ?? 240), warmup = Number(process.env.COMPARE_WARMUP ?? 48), repetitions = Number(process.env.COMPARE_REPETITIONS ?? 3);
const width = Number(process.env.COMPARE_WIDTH ?? 1920), height = Number(process.env.COMPARE_HEIGHT ?? 1080);
const counts = (process.env.COMPARE_COUNTS ?? '5000,10000').split(',').map(Number), scenarios = (process.env.COMPARE_SCENARIOS ?? 'static,camera-motion').split(',');
const backends = (process.env.COMPARE_BACKENDS ?? 'engine,three,babylon').split(',');
const quality = process.env.COMPARE_QUALITY === '1';
const profile=requireProfile(process.env.COMPARE_PROFILE??'native');
const parameters=requireParameters({engineVisibility:process.env.COMPARE_ENGINE_VISIBILITY??'gpu',peerInstancing:(process.env.COMPARE_PEER_INSTANCING??'1')==='1',dirtyFraction:Number(process.env.COMPARE_DIRTY_FRACTION??'.01'),environmentMode:process.env.COMPARE_ENVIRONMENT??'fixed',motionApi:process.env.COMPARE_MOTION_API??'direct'});
const cpuApiTimings=process.env.COMPARE_CPU_API_TIMINGS==='1';
const cpuPhaseTimings=process.env.COMPARE_CPU_PHASE_TIMINGS==='1';
if(cpuPhaseTimings&&(backends.length!==1||backends[0]!=='engine'))throw new Error('CPU phase diagnostics require COMPARE_BACKENDS=engine');
if (![frames, warmup, repetitions, width, height].every(Number.isSafeInteger) || frames < 8 || frames > 2048 || warmup < 1 || warmup > 512 || repetitions < 1 || repetitions > 12 || width < 1 || width > 4096 || height < 1 || height > 4096 || !counts.length||!counts.every(count => Number.isSafeInteger(count) && count >= 4 && count <= 100000) || !scenarios.length||!scenarios.every(scenario => motionModes.includes(scenario)) || !backends.length||!backends.every(backend => ['engine', 'three', 'babylon'].includes(backend)) || new Set(backends).size !== backends.length||!['0','1'].includes(process.env.COMPARE_PEER_INSTANCING??'1')) throw new RangeError('Invalid benchmark controls');
for (const [library, version] of [['three', '0.186.1'], ['@babylonjs/core', '9.30.0']]) {
  const file = join(root, 'artifacts/engine-compare/vendor/node_modules', library, 'package.json');
  if (!existsSync(file) || JSON.parse(await readFile(file, 'utf8')).version !== version) throw new Error('Install pinned benchmark-only dependencies: npm install --prefix artifacts/engine-compare/vendor --no-save --no-package-lock --ignore-scripts three@0.186.1 @babylonjs/core@9.30.0');
}
await mkdir(output, {recursive: true});
async function treeHash(directory) {
  const files = [];
  async function visit(path) {for (const entry of await readdir(path, {withFileTypes: true})) {const file = join(path, entry.name);if (entry.isDirectory()) await visit(file);else if (entry.isFile()) files.push(file);}}
  await visit(resolve(root, directory));
  const digest = createHash('sha256');
  for (const file of files.sort()) {digest.update(relative(root, file).replaceAll('\\', '/') + '\0');digest.update(await readFile(file));}
  return digest.digest('hex');
}
const sourceState = {head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim(), dirty: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8', windowsHide: true}).trim() !== '', srcSha256: await treeHash('src'), distSha256: await treeHash('dist'), harnessSha256: await treeHash('tools/engine-compare')};
const runId = new Date().toISOString().replaceAll(':', '-'), images = join(output, 'images', runId);await mkdir(images, {recursive: true});
const within = (parent, file) => {const path = relative(parent, file);return path !== '' && !path.startsWith('..') && !isAbsolute(path);};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/') {res.setHeader('content-type', 'text/html');res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}canvas{display:block}</style><canvas></canvas><script type="importmap">{"imports":{"three/webgpu":"/vendor/three/build/three.webgpu.js","three/tsl":"/vendor/three/build/three.tsl.js"}}</script><script type="module" src="/tools/engine-compare/client.mjs"></script>');return;}
    const mounts = [['/vendor/three/', 'artifacts/engine-compare/vendor/node_modules/three'], ['/vendor/babylon/', 'artifacts/engine-compare/vendor/node_modules/@babylonjs/core'], ['/dist/', 'dist'], ['/tools/engine-compare/', 'tools/engine-compare'], ['/tools/gpu-visibility/', 'tools/gpu-visibility'], ['/quality-assets/', 'tools/promo/assets']];
    const mount = mounts.find(([prefix]) => path.startsWith(prefix));
    if (!mount) {res.writeHead(404);res.end();return;}
    const parent = resolve(root, mount[1]), file = resolve(parent, path.slice(mount[0].length));
    if (!within(parent, file)) {res.writeHead(404);res.end();return;}
    res.setHeader('content-type', ['.js', '.mjs'].includes(extname(file)) ? 'text/javascript' : extname(file) === '.wasm' ? 'application/wasm' : extname(file) === '.png' ? 'image/png' : 'application/octet-stream');res.end(await readFile(file));
  } catch (error) {res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profileDir = await mkdtemp(join(tmpdir(), 'engine-compare-'));
const flags = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--enable-unsafe-webgpu', '--enable-gpu', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profileDir, '--window-size=' + width + ',' + height, 'about:blank'];
const child = spawn(chrome, flags, {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
let stderr = '', ws, id = 0, failure;
const pending = new Map(), browserErrors = [], results = [], controls = {width, height, frames, warmup, repetitions, counts, scenarios, backends, quality,profile,parameters,cpuApiTimings,cpuPhaseTimings}, delay = ms => new Promise(resolve => setTimeout(resolve, ms));
child.stderr.on('data', chunk => stderr += chunk);child.on('error', error => failure = error);
const baseReport = {version: 1, runId, startedAt: new Date().toISOString(), controls, sourceState,
  methodology: {scene: 'shared engine Render IR geometry + Float32 transforms/colors; deterministic 60-tick physics snapshot', schedule: 'RAF, fresh document/device per case, rotated backend order per repetition', gpuTime: 'sum of render/compute pass timestamps; common asynchronous eight-slot ring; excludes queue gaps and copy-only commands', cpuTime: 'wall time of camera update and render call, including common hooks; timestamp resolve/readback overhead reported separately', uploads: 'GPUQueue.writeBuffer/writeTexture requested bytes; external-image estimates separate', fps: '1000 / mean RAF interval; native headless Chromium scheduling, not a presentation/VSync guarantee', quality: 'identical scene inputs, different native render pipelines; canonical screenshots and pixel differences are descriptive, not an equal-quality gate', correctness: 'source/replay/geometry/environment hashes, actual instance matrices/geometry, right-handed view and WebGPU projection audits, no software adapter, >=95% GPU timestamps'},
  libraries: {three: {version: '0.186.1', license: 'MIT'}, babylon: {version: '9.30.0', license: 'Apache-2.0'}, engine: {version: 'workspace'}}, results};
try {
  let port;
  for (let n = 0; n < 200; n++) {if (failure) throw failure;try {port = Number((await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);if (port) break;} catch {}await delay(50);}
  if (!port) throw new Error('Browser startup failed: ' + stderr.slice(-2000));
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(), page = pages.find(page => page.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) {pending.delete(message.id);message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);}
  });
  ws.addEventListener('close', () => {for (const request of pending.values()) request.reject(new Error('Browser connection closed'));pending.clear();});
  await new Promise((resolve, reject) => {ws.addEventListener('open', resolve, {once: true});ws.addEventListener('error', reject, {once: true});});
  const send = (method, params = {}) => new Promise((resolve, reject) => {const requestId = ++id;pending.set(requestId, {resolve, reject});ws.send(JSON.stringify({id: requestId, method, params}));});
  const evaluate = async expression => {const response = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);return response.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  const browserVersion = await send('Browser.getVersion');baseReport.browser = browserVersion;
  for (const count of counts) for (const scenario of scenarios) for (let repetition = 0; repetition < repetitions; repetition++) {
    const order = [...backends.slice(repetition % backends.length), ...backends.slice(0, repetition % backends.length)];
    for (const backend of order) {
      browserErrors.length = 0;
      console.log(JSON.stringify({event: 'begin', backend, count, scenario, repetition}));
      await send('Page.navigate', {url: 'http://127.0.0.1:' + server.address().port + '/?case=' + results.length+(cpuApiTimings?'&cpuApiTimings=1':'')});
      let ready = false;
      for (let n = 0; n < 600; n++) {if (await evaluate("document.documentElement?.dataset.ready==='1'")) {ready = true;break;}if (browserErrors.length) throw new Error(JSON.stringify(browserErrors));await delay(50);}
      if (!ready) throw new Error('Benchmark page did not initialize');
      const result = await evaluate('runEngineCompare(' + JSON.stringify({backend, count, scenario, width, height, frames, warmup, repetition,profile,parameters,cpuApiTimings,cpuPhaseTimings}) + ')');
      if (browserErrors.length) throw new Error(JSON.stringify(browserErrors));
      const image = await evaluate('engineCompareImage'), basename = `${count}-${scenario}-${backend}-r${repetition}.png`;
      await writeFile(join(images, basename), Buffer.from(image.split(',')[1], 'base64'));result.image = 'images/' + runId + '/' + basename;
      const actualImage=await evaluate('engineCompareActualImage'),actualBasename=basename.replace('.png','-measured.png');await writeFile(join(images,actualBasename),Buffer.from(actualImage.split(',')[1],'base64'));result.actualImage='images/'+runId+'/'+actualBasename;
      const reference = results.find(item => item.count === count);
      if (reference && ['sourceHash', 'replayHash', 'geometryHash', 'environmentHash'].some(key => result[key] !== reference[key])) throw new Error('Shared source hash mismatch');
      const motionReference=results.find(item=>item.count===count&&item.scenario===scenario);
      if(motionReference&&result.motionHash!==motionReference.motionHash)throw new Error('Deterministic motion mismatch');
      if (results.length && JSON.stringify(results[0].adapter) !== JSON.stringify(result.adapter)) throw new Error('GPU adapter changed between cases');
      results.push(result);await writeFile(join(output, 'report.json'), JSON.stringify({...baseReport, status: 'running'}, null, 2));
      console.log(JSON.stringify({event: 'result', backend, count, scenario, repetition, cpuP95: result.cpuMs.p95, gpuP95: result.gpuMs.p95, intervalP95: result.frameIntervalMs.p95, fps: result.fps, uploads: result.uploadBytes.mean, draws: result.drawCalls.mean}));
    }
  }
  const aggregates = [];
  for (const count of counts) for (const scenario of scenarios) for (const backend of backends) {
    const runs = results.filter(result => result.count === count && result.scenario === scenario && result.backend === backend);
    const by = key => distribution(runs.flatMap(run => run.raw[key]));
    const interval = by('frameIntervalMs');
    aggregates.push({count, scenario, backend, repetitions: runs.length, cpuMs: by('cpuMs'), gpuMs: by('gpuMs'), frameIntervalMs: interval, fps: 1000 / interval.mean, uploadBytes: by('uploadBytes'), drawCalls: by('drawCalls'),
      fpsByRepetition: runs.map(run => run.fps), timestampCoverage: Math.min(...runs.map(run => run.timestampCoverage)), frameBudgetPassed: by('cpuMs').p95 <= 1000 / 60 && by('gpuMs').p95 <= 1000 / 60 && interval.p95 <= 1000 / 60,
      images: runs.map(run => run.image),...(cpuApiTimings?{cpuApi:{totalMs:by('cpuGpuApiMs'),remainingMs:by('cpuRemainingMs')}}:{})});
  }
  const pixelComparisons = [];
  for (const count of counts) {
    const reference = results.find(result => result.count === count && result.backend === 'engine');
    if (!reference) continue;
    for (const backend of backends.filter(backend => backend !== 'engine')) {
      const other = results.find(result => result.count === count && result.backend === backend);
      let square = 0, maximum = 0;
      for (let n = 0; n < reference.pixelSamples.length; n++) {const error = Math.abs(reference.pixelSamples[n] - other.pixelSamples[n]);square += error * error;maximum = Math.max(maximum, error);}
      pixelComparisons.push({count, reference: 'engine', backend, samples: reference.pixelSamples.length, rgb8Rms: Math.sqrt(square / reference.pixelSamples.length), rgb8Max: maximum, interpretation: 'Different native lighting/postprocessing. No pixel-equality or equal-quality performance claim.'});
    }
  }
  let visualQuality;
  if (quality) {
    browserErrors.length = 0;
    await send('Page.navigate', {url: 'http://127.0.0.1:' + server.address().port + '/?quality=1'});
    let ready = false;
    for (let n = 0; n < 600; n++) {if (await evaluate("document.documentElement?.dataset.ready==='1'")) {ready = true;break;}if (browserErrors.length) throw new Error(JSON.stringify(browserErrors));await delay(50);}
    if (!ready) throw new Error('Quality page did not initialize');
    console.log(JSON.stringify({event: 'quality-begin'}));
    visualQuality = await evaluate('runEngineQuality(' + JSON.stringify({width, height}) + ')');
    if (browserErrors.length) throw new Error(JSON.stringify(browserErrors));
    if (JSON.stringify(visualQuality.adapter) !== JSON.stringify(results[0].adapter)) throw new Error('Quality GPU changed');
    for (let n = 0; n < visualQuality.captures.length; n++) {
      const artifact = await evaluate('engineQualityArtifacts[' + n + ']'), capture = visualQuality.captures[n];
      const basename = 'quality-' + artifact.name;
      for (const [key, extension] of [['png', '.png'], ['rgba8', '.rgba8'], ['reflectionPng', '-reflection.png'], ['reflectionRgba16f', '-reflection.rgba16f']]) {
        const file = basename + extension;
        await writeFile(join(images, file), Buffer.from(artifact[key].split(',').at(-1), 'base64'));capture[key + 'File'] = 'images/' + runId + '/' + file;
      }
    }
    console.log(JSON.stringify({event: 'quality-completed', views: visualQuality.captures.length}));
  }
  const report = {...baseReport, status: 'completed', completedAt: new Date().toISOString(), sceneInputsMatched: true, equalPixelQualityEstablished: false, aggregates, pixelComparisons, ...(visualQuality ? {visualQuality} : {})};
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({event: 'completed', report: join(output, 'report.json'), aggregates}));
} catch (error) {
  await writeFile(join(output, 'report.json'), JSON.stringify({...baseReport, status: 'failed', error: String(error), browserErrors}, null, 2));console.error(error);process.exitCode = 1;
} finally {
  ws?.close();server.close();child.kill();await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  const target = resolve(profileDir);
  if (within(resolve(tmpdir()), target)) for (let n = 0; n < 10; n++) {try {await rm(target, {recursive: true, force: true});break;} catch {await delay(100);}}
}
