#!/usr/bin/env node
/** Recover only the known document-readiness navigation race. The failed report
 * is retained. Rendering, fixture, journal and measured loop remain unchanged. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const root=resolve(import.meta.dirname,'../..'),[fromArg,outputArg]=process.argv.slice(2);
if(!fromArg||!outputArg)throw new Error('Usage: recover-engine-compare.mjs <failed-directory> <new-directory>');
const from=resolve(root,fromArg),output=resolve(root,outputArg);assert.notEqual(output,from,'Keep the failed report');
const previous=JSON.parse(await readFile(resolve(from,'report.json'),'utf8'));
assert.equal(previous.status,'failed');assert.match(previous.error,/Cannot read properties of null \(reading 'dataset'\)/);assert.equal(previous.browserErrors.length,0);
const benchmark=resolve(root,'tools/engine-compare/benchmark.mjs'),original=await readFile(benchmark,'utf8');let code=original;
function replace(before,after){assert.equal(code.split(before).length,2,'Unique known runner boundary: '+before);code=code.replace(before,after);}
replace("from './metrics.mjs'","from '../../tools/engine-compare/metrics.mjs'");
replace("from './profiles.mjs'","from '../../tools/engine-compare/profiles.mjs'");
// The generated file is saved in the output directory. Give it absolute imports
// and the real workspace root, independently of the output directory's depth.
code=code.replace("from '../../tools/engine-compare/metrics.mjs'",`from ${JSON.stringify(new URL('../../tools/engine-compare/metrics.mjs',import.meta.url).href)}`);
code=code.replace("from '../../tools/engine-compare/profiles.mjs'",`from ${JSON.stringify(new URL('../../tools/engine-compare/profiles.mjs',import.meta.url).href)}`);
replace("const root = resolve(import.meta.dirname, '../..'), output",`const root = ${JSON.stringify(root)}, output`);
assert.equal(code.split("document.documentElement.dataset.ready==='1'").length,3,'Two known readiness polls');
code=code.replaceAll("document.documentElement.dataset.ready==='1'","document.documentElement?.dataset.ready==='1'");
replace("browserErrors = [], results = [], controls",`browserErrors = [], results = JSON.parse(await readFile(${JSON.stringify(resolve(output,'recovered-cases.json'))}, 'utf8')), controls`);
replace("    for (const backend of order) {",`    for (const backend of order) {
      if (results.some(run => run.count === count && run.scenario === scenario && run.repetition === repetition && run.backend === backend)) continue;`);
replace("  const browserVersion = await send('Browser.getVersion');baseReport.browser = browserVersion;",`  const browserVersion = await send('Browser.getVersion');baseReport.browser = browserVersion;
  const recovery = JSON.parse(await readFile(${JSON.stringify(resolve(output,'recovery.json'))}, 'utf8'));
  for (const key of ['srcSha256', 'distSha256', 'harnessSha256']) if (sourceState[key] !== recovery.originalSourceState[key]) throw new Error('Recovery program changed: ' + key);
  if (browserVersion.product !== recovery.browserProduct) throw new Error('Recovery browser changed');
  if (JSON.stringify(controls) !== JSON.stringify(recovery.controls)) throw new Error('Recovery controls changed');
  baseReport.recovery = recovery;`);
const digest=s=>createHash('sha256').update(s).digest('hex');
const recovery={failedReport:relative(root,resolve(from,'report.json')).replaceAll('\\','/'),failedRunId:previous.runId,failedError:previous.error,originalSourceState:previous.sourceState,browserProduct:previous.browser.product,controls:previous.controls,
 preservedCases:previous.results.length,resumedCases:previous.controls.counts.length*previous.controls.scenarios.length*previous.controls.backends.length*previous.controls.repetitions-previous.results.length,
 baseRunnerSha256:digest(original),recoveryRunnerSha256:digest(code),interpretation:'The failed execution remains failed and is not overwritten. Only completed, validated cases before the navigation readiness error are reused. Remaining cases execute in a fresh browser on the same source/dist/measured harness. The recovery runner differs solely in import/root resolution, document null guard, restored cases, skipping already completed cases and provenance checks outside the timed loop.'};
const results=previous.results.map(run=>({...run,capturedRunId:previous.runId,image:relative(output,resolve(from,run.image)).replaceAll('\\','/')}));
await mkdir(output,{recursive:true});await writeFile(resolve(output,'recovery.json'),JSON.stringify(recovery,null,2)+'\n');await writeFile(resolve(output,'recovered-cases.json'),JSON.stringify(results)+'\n');
const file=resolve(output,'recovery-runner.mjs');await writeFile(file,code);
const c=previous.controls,env={...process.env,COMPARE_OUTPUT:output,COMPARE_COUNTS:c.counts.join(','),COMPARE_SCENARIOS:c.scenarios.join(','),COMPARE_BACKENDS:c.backends.join(','),COMPARE_FRAMES:String(c.frames),COMPARE_WARMUP:String(c.warmup),COMPARE_REPETITIONS:String(c.repetitions),COMPARE_WIDTH:String(c.width),COMPARE_HEIGHT:String(c.height),COMPARE_QUALITY:c.quality?'1':'0',COMPARE_PROFILE:c.profile??'native'};
const child=spawn(process.execPath,[file],{cwd:root,env,windowsHide:true,stdio:'inherit'});child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
