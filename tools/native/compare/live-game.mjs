import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startBrowser} from './browser.mjs';

// Existing canonical game client/server, isolated persistence; no staged replay.
const engine=resolve(process.env.ENGINE_ROOT??join(import.meta.dirname,'../../..')),game=resolve(process.env.GAME_ROOT??join(engine,'../thegame'));
const root=join(engine,'artifacts/native-game-compare'),port=Number(process.env.COMPARE_LIVE_PORT??3189);await mkdir(root,{recursive:true});
const save=await mkdtemp(join(root,'live-save-')),fixturePath=join(game,'artifacts/performance-scene.json'),fixtureBefore=await readFile(fixturePath);
const child=spawn(process.execPath,['src/server/index.ts'],{cwd:game,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',WEBTRANSPORT_PORT:String(port+2),THEGAME_SAVE_DIR:save,NODE_ENV:'development'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='',browser;for(const stream of [child.stdout,child.stderr])stream.on('data',b=>serverLog=(serverLog+b).slice(-50000));
try{
 for(let i=0;;i++){if(child.exitCode!==null)throw new Error('Isolated server exited: '+serverLog);try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(250)});if(r.ok)break;}catch{}if(i>=600)throw new Error('Isolated server readiness timeout: '+serverLog);await Bun.sleep(100);}
 browser=await startBrowser({headful:true});const bundle=await readFile(join(root,'capture-game.js')),diagnostics=[];
 browser.onEvent(m=>{if(m.method==='Runtime.exceptionThrown')diagnostics.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused'){const r=m.params;void browser.send(new URL(r.request.url).pathname==='/build/game.js'?'Fetch.fulfillRequest':'Fetch.continueRequest',new URL(r.request.url).pathname==='/build/game.js'?{requestId:r.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:bundle.toString('base64')}:{requestId:r.requestId});}});
 await browser.send('Fetch.enable',{patterns:[{urlPattern:'*/build/game.js*',requestStage:'Request'}]});
 await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}/?agent=1&debug=1&renderer=engine`});await browser.send('Page.bringToFront');
 await browser.waitFor('Boolean(window.__THEGAME_READY__&&window.__THEGAME_AGENT__)',300);
 await browser.evaluate("document.querySelector('#connect-network')?.click()");await browser.waitFor('window.__THEGAME_AGENT__.snapshot().network.tick>2',300);
 const settings={adaptive:false,renderScale:1,drawDistance:420,taa:true,bloom:false,motionBlur:0,dof:0};await browser.evaluate(`window.__THEGAME_AGENT__.rendering.configure(${JSON.stringify(settings)})`);
 console.log('Live game connected, warming 180 frames');await browser.evaluate('window.__THEGAME_AGENT__.benchmarkLive(180)');
 const report=await browser.evaluate('window.__THEGAME_AGENT__.benchmarkLive(300,true)');
 report.renderer=await browser.evaluate('window.__THEGAME_AGENT__.rendering.inspect()');report.browser={executable:browser.executable,args:browser.args};report.scope='Canonical live networked browser game on an isolated save, fixed standing player, normal background environment worker. Not directly comparable to recorded render replay.';report.requestedSettings=settings;report.warmupFrames=180;report.diagnostics=diagnostics;report.date=new Date().toISOString();
 await writeFile(join(root,'live-browser.json'),JSON.stringify(report,null,2));await writeFile(join(root,'live-browser.png'),await browser.screenshot());
 if(diagnostics.length)throw new Error('Browser exceptions during live game');
 console.log('Live game complete: '+JSON.stringify({frames:report.frames,keys:Object.keys(report),network:report.snapshot?.network,settings:report.renderer.settings}));
}finally{await browser?.close();child.kill();await writeFile(join(root,'live-server.log'),serverLog);if(!(await readFile(fixturePath)).equals(fixtureBefore))throw new Error('Canonical performance fixture changed during live QA');}
