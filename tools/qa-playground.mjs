import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as tcp} from 'node:net';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const out=resolve('artifacts/playground'),site=resolve('site');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname,name=path==='/'?'index.html':path.slice(1);if(!['index.html','compiler.html','manifest.json'].includes(name)){res.writeHead(404);res.end();return;}try{res.writeHead(200,{'content-type':name.endsWith('.html')?'text/html; charset=utf-8':'application/json','cache-control':'no-store'});res.end(await readFile(join(site,name)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,debug=tcp();await new Promise(r=>debug.listen(0,'127.0.0.1',r));const debugPort=debug.address().port;await new Promise(r=>debug.close(r));
const chrome=process.env.CHROME_PATH??['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);if(!chrome)throw new Error('Chrome required');
const profile=await mkdtemp(join(tmpdir(),'dsl-playground-'));
const child=spawn(chrome,['--headless=new','--no-sandbox','--no-first-run','--disable-extensions','--disable-background-networking','--enable-unsafe-webgpu','--enable-gpu',`--user-data-dir=${profile}`,`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1','--window-size=1600,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let stderr='',ws,sequence=0;child.stderr.on('data',b=>stderr+=b);const pending=new Map(),logs=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let target;for(let i=0;i<200;i++){try{target=(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t=>t.type==='page'&&t.webSocketDebuggerUrl);if(target)break;}catch{}await delay(50);}
 if(!target)throw new Error('CDP unavailable: '+stderr.slice(-2000));ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown'||m.method==='Log.entryAdded')logs.push(m);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??JSON.stringify(result.exceptionDetails));return result.result.value;};
 const until=async(expression,ms=30000)=>{const end=Date.now()+ms;let value;while(Date.now()<end){value=await evaluate(expression);if(value)return value;await delay(60);}throw new Error('Browser condition timeout: '+expression+'\n'+JSON.stringify(await evaluate('({error:document.getElementById("error")?.textContent,notice:document.getElementById("notice")?.textContent,text:document.body?.innerText?.slice(0,3000)})')));};
 const stable=()=>until('window.__PLAYGROUND__ && (()=>{const s=__PLAYGROUND__.inspect();return !s.pending&&s.lastGood===s.version&&s.renderer?.backend==="webgpu"&&s.renderer.drawCalls>0&&s})()');
 const screenshot=async name=>{const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,`${name}.png`),Buffer.from(image.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');await send('Log.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await send('Page.navigate',{url:`http://127.0.0.1:${port}/`});
 await stable();await evaluate('__PLAYGROUND__.pause()');const first=await evaluate('__PLAYGROUND__.inspect()');assert.equal(first.renderer.errors.length,0);await screenshot('01-vehicle-code-hud');
 await evaluate('document.getElementById("example").value="material";document.getElementById("example").dispatchEvent(new Event("change"))');await stable();await evaluate('__PLAYGROUND__.pause()');
 const before=await evaluate('__PLAYGROUND__.inspect()');assert.equal(before.bindings.find(b=>b.owner==='сфера'&&b.path==='material.roughness').value,.24);
 const position=await evaluate(`(()=>{const s=__PLAYGROUND__.inspect(),b=s.bindings.find(b=>b.owner==='сфера'&&b.path==='material.roughness');const input=[...document.querySelectorAll('input[type=range]')].find(i=>i.dataset.key===b.key);input.scrollIntoView({block:'center'});input.focus();const r=input.getBoundingClientRect();return {x:r.left+r.width*.25,y:r.top+r.height/2,width:r.width}})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:position.x,y:position.y,button:'left',clickCount:1});
 for(let i=1;i<=6;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:position.x+position.width*i/12,y:position.y,button:'left',buttons:1});await delay(120);}
 assert.ok((await evaluate('__PLAYGROUND__.inspect()')).hotEdits>before.hotEdits,'render must update during drag, before pointerup');
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:position.x+position.width/2,y:position.y,button:'left',clickCount:1});
 await stable();const after=await evaluate('__PLAYGROUND__.inspect()');assert.notEqual(after.source,before.source);assert.equal(after.coldBuilds,before.coldBuilds);assert.ok(after.hotEdits>before.hotEdits);assert.notEqual(after.program.items[1].material.roughness,.24);assert.equal(after.scene.time,before.scene.time);
 await screenshot('02-live-material-edit');
 // Actual global keyboard undo, same stack as text edits.
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await stable();assert.equal(await evaluate('__PLAYGROUND__.inspect().source'),before.source);
 const setSource=async text=>evaluate(`(()=>{const t=document.getElementById('source');t.value=${JSON.stringify(text)};t.dispatchEvent(new InputEvent('input',{inputType:'insertText',bubbles:true}));})()`);
 const typed=before.source.replace('exposure: 1','exposure: 1.7').replace('roughness: 0.24','roughness: 0.4');await setSource(typed);await stable();const fromCode=await evaluate('__PLAYGROUND__.inspect()');assert.equal(fromCode.bindings.find(b=>b.path==='rendering.exposure').value,1.7);assert.equal(fromCode.program.stage.rendering.exposure,1.7);assert.equal(fromCode.coldBuilds,before.coldBuilds);
 // Preview resolution is an authored DSL parameter too, not a parallel form state.
 const width=fromCode.renderer.width;await setSource(typed.replace('resolutionScale: 1','resolutionScale: 0.5'));await stable();const scaled=await evaluate('__PLAYGROUND__.inspect()');assert.ok(scaled.renderer.width<width*.6);assert.equal(scaled.coldBuilds,before.coldBuilds);
 await setSource(typed);await stable();const valid=await evaluate('__PLAYGROUND__.inspect()');await setSource(typed+'\n const broken = ;');await until('document.getElementById("error").textContent.length>0');const invalid=await evaluate('__PLAYGROUND__.inspect()');assert.equal(invalid.coldBuilds,valid.coldBuilds);assert.equal(invalid.lastGood,valid.lastGood);assert.equal(invalid.renderer.backend,'webgpu');await screenshot('03-error-keeps-render');
 // Killing a disposable executor must not kill the renderer or the persistent compiler.
 await setSource('while (true) {}');await until('document.getElementById("error").textContent.includes("2 секунды")',10000);assert.equal((await evaluate('__PLAYGROUND__.inspect()')).lastGood,valid.lastGood);
 await setSource(typed);await stable();
 const manifest=JSON.parse(await readFile(join(site,'manifest.json'),'utf8')),scenes=[];
 for(const example of manifest.examples){await evaluate(`document.getElementById('example').value=${JSON.stringify(example.id)};document.getElementById('example').dispatchEvent(new Event('change'))`);await stable();await evaluate('for(let i=0;i<30;i++)document.getElementById("step").click();');await evaluate('__PLAYGROUND__.flush()');const s=await evaluate('__PLAYGROUND__.inspect()');assert.equal(s.renderer.errors.length,0,example.id);scenes.push({id:example.id,renderer:s.renderer,entities:s.scene.entities.length});if(['wings','ik','soft-body'].includes(example.id))await screenshot(`scene-${example.id}`);}
 await evaluate('document.getElementById("example").value="vehicle";document.getElementById("example").dispatchEvent(new Event("change"))');await stable();await evaluate('__PLAYGROUND__.pause()');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(500);await screenshot('04-mobile');
 const report={schema:1,commit:process.env.GITHUB_SHA??'local',browser:await evaluate('navigator.userAgent'),before:{coldBuilds:before.coldBuilds,hotEdits:before.hotEdits},after:{coldBuilds:after.coldBuilds,hotEdits:after.hotEdits,roughness:after.program.items[1].material.roughness},checks:['native continuous drag -> source -> material before pointerup','keyboard undo shares source history','source -> inspector','hot material/camera preserve scene time','resolution scale updates GPU target without scene reset','syntax error retains last good renderer','2s executor timeout recovers compiler','all example scenes use WebGPU'],scenes,logs};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,scenes:scenes.map(s=>s.id)},null,2));
}catch(error){await writeFile(join(out,'failure.log'),String(error.stack??error)+'\n'+JSON.stringify(logs)+'\n'+stderr.slice(-5000));throw error;}
finally{try{ws?.close();child.kill();server.close();await rm(profile,{recursive:true,force:true});}catch{}}
