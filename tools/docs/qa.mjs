#!/usr/bin/env node
/** Native browser acceptance: DOM edits, actual engine, canvas captures, no generated imagery. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const output=resolve('artifacts/dsl-playground');await mkdir(output,{recursive:true});
const chrome=process.env.CHROME_PATH??['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if(!chrome)throw new Error('Set CHROME_PATH to a native Chrome with WebGPU');
const freePort=async()=>{const s=createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const p=s.address().port;await new Promise(ok=>s.close(ok));return p;};
const port=await freePort(),debug=await freePort(),profile=await mkdtemp(join(tmpdir(),'dsl-qa-'));
const server=spawn(process.execPath,['tools/docs/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let errors=[],stderr='';server.stderr.on('data',c=>stderr+=c);
const browser=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--disable-background-networking','--disable-extensions','--hide-scrollbars','--enable-unsafe-webgpu','--enable-gpu',`--user-data-dir=${profile}`,`--remote-debugging-port=${debug}`,'about:blank'],{stdio:['ignore','pipe','pipe']});browser.stderr.on('data',c=>stderr+=c);
let ws;const checks=[],renders=[];let info;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let page;for(let i=0;i<200;i++){try{const pages=await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json();page=pages.find(x=>x.type==='page');if(page)break;}catch{}await sleep(50);}
 if(!page)throw new Error('Chrome unavailable: '+stderr.slice(-1000));
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let serial=0;const pending=new Map();
 ws.addEventListener('message',({data})=>{const message=JSON.parse(String(data));if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.no(new Error(message.error.message)):p.ok(message.result);});
 const send=(method,params={})=>new Promise((ok,no)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);no(new Error('CDP timeout: '+method));},90000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
 const wait=async(expression,timeout=30000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await evaluate(expression))return;await sleep(60);}throw new Error('Timeout: '+expression+'; '+await evaluate('document.querySelector("#error")?.textContent'));};
 const capture=async name=>{await evaluate('__DSL_EDITOR__.runtime.flush()');await sleep(100);const data=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(data.data,'base64'));renders.push(name);};
 const canvasHash=async()=>createHash('sha256').update(await evaluate('document.querySelector("#render").toDataURL()')).digest('hex');
 const settled='__DSL_EDITOR__.runtime && __DSL_EDITOR__.appliedRevision === __DSL_EDITOR__.revision && document.querySelector("#error").hidden';
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:960,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`http://127.0.0.1:${port}/docs/`});await wait('!!globalThis.__DSL_EDITOR__');await wait(settled,60000);
 assert.equal(await evaluate('document.querySelector("#control-panel").hidden'),true);await evaluate('document.querySelector("#panel-toggle").focus();document.querySelector("#panel-toggle").click()');checks.push('one console drawer; closed by default');
 info=await evaluate('(async()=>({userAgent:navigator.userAgent,adapter:(await navigator.gpu.requestAdapter())?.info?.toJSON?.()??null,renderer:__DSL_EDITOR__.runtime.renderer.inspect()}))()');assert.equal(info.renderer.backend,'webgpu');assert.ok(info.renderer.triangles>0);checks.push('native WebGPU first frame');await capture('m3-before');
 // Console uses the same source-bound actions, and never writes derived state.
 const command=async line=>{await evaluate(`(()=>{const input=document.querySelector('#console-input');input.value=${JSON.stringify(line)};document.querySelector('#console-form').requestSubmit();})()`);await wait(`!document.querySelector('#console-input').hasAttribute('aria-busy')`);};
 await command('watch scene.tick');await command('watch profile.latestCpu.totalMs');
 assert.ok(await evaluate(`document.querySelector('#console-watches').textContent.includes('scene.tick')`));checks.push('live console watches share existing diagnostics');
 await evaluate(`globalThis.__consoleSource=__DSL_EDITOR__.source;globalThis.__consoleBody=__DSL_EDITOR__.runtime.scene.physics.bodies.get('car')`);
 await command('set exposure 0.72');await wait(settled);
 assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.spec.rendering.exposure'),.72);
 assert.ok(await evaluate(`__DSL_EDITOR__.runtime.scene.physics.bodies.get('car')===__consoleBody`));checks.push('console set → exact DSL binding → live renderer; body preserved');
 await command('undo');await wait(settled);assert.ok(await evaluate('__DSL_EDITOR__.source===__consoleSource'));checks.push('console shares source Undo');
 await command('inspect physics');await capture('engine-console');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.ok(await evaluate(`document.querySelector('#control-panel').hidden && document.querySelector('#control-panel').inert`));
 assert.ok(await evaluate(`document.activeElement===document.querySelector('#panel-toggle')`));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ё',code:'Backquote',windowsVirtualKeyCode:192});
 await wait(`!document.querySelector('#control-panel').hidden && document.activeElement===document.querySelector('#console-input')`);checks.push('Ё opens, Escape closes and restores focus');
 // Real recorded pixels, not seek/resimulation. These checks require native WebGPU.
 await command('record start');await evaluate('__DSL_EDITOR__.play()');
 await wait('__DSL_EDITOR__.recording.model.frames.length >= 8 && __DSL_EDITOR__.recording.model.images >= 2',60000);
 await evaluate('__DSL_EDITOR__.pause()');await command('record stop');
 await evaluate(`document.querySelector('#recording-tab').click();globalThis.__recordTick=__DSL_EDITOR__.runtime.scene.tick;const t=document.querySelector('[data-time]');t.value='0';t.dispatchEvent(new Event('input',{bubbles:true}));`);
 await wait(`!document.querySelector('[data-image]').hidden && document.querySelector('[data-caption]').textContent.includes('Выбран '+__DSL_EDITOR__.recording.model.frames[0].key)`);
 assert.ok(await evaluate(`(()=>{const m=__DSL_EDITOR__.recording.model;return !m.active && m.images>=2 && m.frames.every(f=>!f.gpu || f.gpu.frame===f.cpu.frame) && document.querySelector('[data-image]').src===m.imageAt(0).image;})()`));
 assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.tick'),await evaluate('__recordTick'));
 checks.push('recording: actual canvas filmstrip + frame-keyed CPU/GPU + scrub without physics seek');
 await capture('engine-profiler');
 await evaluate(`document.querySelector('[data-do=zoomIn]').click();document.querySelector('[data-do=next]').click()`);
 await wait(`document.querySelector('[data-caption]').textContent.includes('Выбран '+__DSL_EDITOR__.recording.model.frames[1].key)`);
 assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.tick'),await evaluate('__recordTick'));
 checks.push('recording zoom and frame stepping preserve live scene');
 await evaluate(`document.querySelector('#parameters-tab').click()`);
 const before=await canvasHash();
 await evaluate(`(()=>{globalThis.__qaBody=__DSL_EDITOR__.runtime.scene.physics.bodies.get('car');const field=document.querySelector('[data-key="exposure"] input[type="range"]');field.value='0.65';field.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(settled);
 assert.ok(await evaluate("__DSL_EDITOR__.source.includes('exposure: 0.65')"));assert.ok(await evaluate("__DSL_EDITOR__.runtime.scene.physics.bodies.get('car') === __qaBody"));assert.equal(await evaluate('__DSL_EDITOR__.lastPatch'),'live');assert.notEqual(await canvasHash(),before);checks.push('HUD → source → shader pixels; body preserved');await capture('m3-exposure-edit');
 await evaluate(`__DSL_EDITOR__.setSource(__DSL_EDITOR__.source.replace('exposure: 0.65','exposure: 1.3'))`);await wait(settled);assert.equal(await evaluate('Number(document.querySelector(\'[data-key="exposure"] input[type="number"]\').value)'),1.3);checks.push('source → HUD value');
 await evaluate(`(()=>{const row=document.querySelector('[data-key="roughness"]'),field=row.querySelector('input[type="range"]');field.value='.68';field.dispatchEvent(new Event('input',{bubbles:true}));row.querySelector('.source-link').click();})()`);await wait(settled);assert.equal(await evaluate("__DSL_EDITOR__.runtime.scene.entities.get('car/body').material.roughness"),.68);await capture('two-way-material');checks.push('paint roughness roundtrip and source focus');
 await evaluate(`(()=>{const f=document.querySelector('[data-key="exposure"] input[type="range"]');for(let i=0;i<25;i++){f.value=String(.7+i*.02);f.dispatchEvent(new Event('input',{bubbles:true}));}})()`);await wait(settled);assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.spec.rendering.exposure'),1.18);checks.push('25 rapid slider edits: latest result wins');
 await evaluate(`globalThis.__qaGood=__DSL_EDITOR__.source; __DSL_EDITOR__.setSource(__qaGood+'\\nexport default scene({')`);await wait('!document.querySelector("#error").hidden');assert.ok(await evaluate("__DSL_EDITOR__.runtime.scene.physics.bodies.get('car') === __qaBody"));assert.ok(await evaluate(`Array.from(document.querySelectorAll('.control-row input')).every(f=>f.disabled)`));checks.push('syntax error retains last valid world and disables stale controls');
 await evaluate('document.querySelector("#undo").click()');await wait(settled);assert.equal(await evaluate('__DSL_EDITOR__.source'),await evaluate('__qaGood'));checks.push('unified undo restores code and controls');
 await evaluate(`__DSL_EDITOR__.setSource('while (true) {}')`);await wait('document.querySelector("#error").textContent.includes("лимиту")',8000);assert.ok(await evaluate("__DSL_EDITOR__.runtime.scene.physics.bodies.get('car') === __qaBody"));checks.push('hung author code killed; old renderer stays alive');
 await evaluate('__DSL_EDITOR__.setSource(__qaGood)');await wait(settled);checks.push('compiler recovers after timeout');
 // Real pointer gestures must remain a single source-history transaction across worker replies.
 await evaluate(`globalThis.__qaGestureSource=__DSL_EDITOR__.source;globalThis.__qaSlider=document.querySelector('[data-key="exposure"] input[type="range"]');globalThis.__qaLabel=document.querySelector('[data-key="exposure"] .scrubbable');__qaLabel.scrollIntoView({block:'center'})`);
 const handle=await evaluate('(()=>{const r=__qaLabel.getBoundingClientRect();return {x:r.x+12,y:r.y+r.height/2};})()');
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...handle,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+40,y:handle.y,button:'left',buttons:1});await wait(settled);
 assert.ok(await evaluate('__DSL_EDITOR__.source !== __qaGestureSource'));
 assert.ok(await evaluate(`__qaSlider===document.querySelector('[data-key="exposure"] input[type="range"]') && __qaLabel.isConnected`));
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+80,y:handle.y,button:'left',buttons:1});await wait(settled);
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+80,y:handle.y,button:'left',buttons:0,clickCount:1});
 assert.ok(await evaluate("__DSL_EDITOR__.runtime.scene.physics.bodies.get('car') === __qaBody"));
 await evaluate(`document.querySelector('[data-key="exposure"] input[type="number"]').focus()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90});await wait(settled);
 assert.ok(await evaluate('__DSL_EDITOR__.source === __qaGestureSource'));checks.push('pointer scrub survives async compilation; one global undo from HUD');
 await evaluate(`document.querySelector('[data-key="exposure"] .value-reset').click()`);await wait(settled);assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.spec.rendering.exposure'),1);checks.push('individual reset patches source and live rendering');
 await evaluate(`(()=>{const f=document.querySelector('#parameter-search');f.value='Покрытие';f.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 assert.equal(await evaluate(`document.querySelectorAll('.control-group:not([hidden])').length`),1);checks.push('parameter search uses domain group and retains controls');
 await evaluate(`(()=>{const f=document.querySelector('[data-key="color"] input[type="color"]');f.value='#46829c';f.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(settled);
 assert.ok(await evaluate('__DSL_EDITOR__.source.includes("0.2745")'));await capture('hud-colour');checks.push('color picker roundtrip');
 await evaluate(`(()=>{const f=document.querySelector('#parameter-search');f.value='';f.dispatchEvent(new Event('input',{bubbles:true}));const v=document.querySelector('[data-key="sunDirection"] input[data-axis="2"]');v.value='-0.6';v.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(settled);
 assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.spec.rendering.sunDirection[2]'),-.6);checks.push('vector component edits exact DSL token');
 await evaluate(`(()=>{const search=document.querySelector('#parameter-search');search.value='Покрытие';search.dispatchEvent(new Event('input',{bubbles:true}));const row=document.querySelector('[data-key="roughness"]');row.querySelector('.source-link').click();})()`);await capture('hud-two-way');
 await evaluate(`__DSL_EDITOR__.setSource(__DSL_EDITOR__.source.replace('massKg: 1500','massKg: 1300'))`);await wait(settled);assert.equal(await evaluate('__DSL_EDITOR__.lastPatch'),'rebuild');assert.ok(await evaluate("__DSL_EDITOR__.runtime.scene.physics.bodies.get('car') !== __qaBody"));checks.push('construction edit is an explicit rebuild');
 await evaluate(`__DSL_EDITOR__.select('wear')`);await wait(settled);await evaluate('__DSL_EDITOR__.seek(.6)');
 const state=await evaluate(`(()=>{globalThis.__qaBody=__DSL_EDITOR__.runtime.scene.physics.bodies.get('car');return {tick:__DSL_EDITOR__.runtime.scene.tick,pos:[...__qaBody.position]};})()`);
 await evaluate(`(()=>{const b=__DSL_EDITOR__.bindings.find(b=>b.key==='steer');__DSL_EDITOR__.edit(b.id,-.3);})()`);await wait(settled);
 assert.ok(await evaluate("__DSL_EDITOR__.runtime.scene.physics.bodies.get('car') === __qaBody"));assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.tick'),state.tick);checks.push('input hot-edit retains evolved state');
 await evaluate('document.querySelector("#diagnostics-tab").click()');assert.equal(await evaluate('document.querySelectorAll("#diagnostics input").length'),0);await capture('wear-diagnostics');checks.push('derived outputs are read-only');
 await evaluate('document.querySelector("#parameters-tab").click()');
 for(const id of ['pickup','drive','wall','drop','collision','glass','materials','rendering','walker','snow','spatial','kernel','wings']){
  await evaluate(`__DSL_EDITOR__.select(${JSON.stringify(id)})`);await wait(settled);const r=await evaluate('__DSL_EDITOR__.runtime.renderer.inspect()');assert.ok(r.drawCalls>0&&r.triangles>0,id);checks.push('render '+id);
  if(['pickup','drop','glass','walker'].includes(id))await capture(id);
  if(id==='snow'){await evaluate(`(()=>{const f=document.querySelector('[data-key="snowfall"] select');f.value='light';f.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(settled);assert.equal(await evaluate('__DSL_EDITOR__.runtime.scene.spec.environment.snowfall'),'light');checks.push('enum choice edits source and rebuilds environmental initial state');}
  if(id==='wings'){await evaluate(`(()=>{const f=document.querySelector('[data-key="wingsEnabled"] input');f.checked=false;f.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(settled);assert.equal(await evaluate('__DSL_EDITOR__.program.vehicles[0].blueprint.parts.filter(p=>p.source.kind==="wing").length'),0);assert.equal(await evaluate('__DSL_EDITOR__.lastPatch'),'rebuild');await evaluate('__DSL_EDITOR__.undo()');await wait(settled);assert.equal(await evaluate('__DSL_EDITOR__.program.vehicles[0].blueprint.parts.filter(p=>p.source.kind==="wing").length'),2);checks.push('composition toggle updates code, removes wings and restores them with undo');}
 }
 await evaluate('__DSL_EDITOR__.seek(16.3)');const y=await evaluate('__DSL_EDITOR__.runtime.scene.physics.bodies.get("car").position[1]');assert.ok(y>.8,'real airborne position');await capture('wings-airborne');checks.push('wing demo runs live physics to takeoff');
 await evaluate(`__DSL_EDITOR__.select('m3')`);await wait(settled);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate('document.querySelector("#control-panel").hidden=true');await capture('mobile');
 await evaluate('document.querySelector("#panel-toggle").click()');await capture('mobile-controls');
 assert.ok(await evaluate(`(()=>{const r=document.querySelector('#control-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`));
 const mobileField=await evaluate(`(()=>{const row=document.querySelector('[data-key="exposure"] input[type="number"]');return {height:row.getBoundingClientRect().height}})()`);assert.ok(mobileField.height>=40);checks.push('mobile HUD fits viewport with touch-sized controls');
 await evaluate(`document.querySelector('[data-key="exposure"] .source-link').click()`);assert.equal(await evaluate('document.querySelector(".workspace").dataset.pane'),'code');checks.push('mobile source link opens the code pane');
 await evaluate('document.querySelector("button[data-pane=preview]").click()');
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:960,deviceScaleFactor:1,mobile:false});
 // A different query forces a new document; changing only the hash is same-document navigation.
 const imported=Buffer.from("while(true){}\n// Imported source must not autorun").toString('base64');
 await send('Page.navigate',{url:`http://127.0.0.1:${port}/docs/?qa=shared-document#scene=m3&source=${encodeURIComponent(imported)}`});await wait(`globalThis.__DSL_EDITOR__?.source.includes('Imported source must not autorun')`);await sleep(1500);assert.equal(await evaluate('__DSL_EDITOR__.appliedRevision'),-1);assert.equal(await evaluate('__DSL_EDITOR__.runtime'),null);checks.push('shared code requires explicit execution');
 await evaluate(`__DSL_EDITOR__.setSource(__DSL_EDITOR__.source+'\\n// editing does not grant trust')`);await sleep(2300);assert.equal(await evaluate('__DSL_EDITOR__.runtime'),null);assert.equal(await evaluate('__DSL_EDITOR__.appliedRevision'),-1);assert.equal(await evaluate('document.querySelector("#error").hidden'),true);checks.push('editing imported code does not bypass Apply confirmation');
 assert.equal(errors.length,0,errors.join('\n'));
 const report={checks,renders,info,errors,notes:['Screenshots are actual native WebGPU canvas within the editor UI.','Simulation/graphics are the existing engine, not a second demo renderer.','No FPS, migration parity or BeamNG fidelity claim.']};await writeFile(join(output,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,errors,stderr:stderr.slice(-4000)},null,2));throw error;}
finally{ws?.close();browser.kill();server.kill();await sleep(200);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});}
