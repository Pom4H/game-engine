import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {startBrowser} from './browser.mjs';

const engine=resolve(process.env.ENGINE_ROOT??join(import.meta.dirname,'../../..')),game=resolve(process.env.GAME_ROOT??join(engine,'../thegame'));
const out=resolve(process.env.COMPARE_EXPORT_DIR??join(engine,'artifacts/native-game-compare'));await mkdir(out,{recursive:true});
const entry=join(out,'capture-entry.ts'),rel=p=>{let r=relative(out,p).replaceAll('\\','/');return r.startsWith('.')?r:'./'+r;};
await writeFile(entry,`import {WebGPURenderer} from ${JSON.stringify(rel(join(engine,'src/render/webgpu.ts')))};\nimport {installCapture} from ${JSON.stringify(rel(join(import.meta.dirname,'export-hook.mjs')))};\ninstallCapture(WebGPURenderer);\nawait import(${JSON.stringify(rel(join(game,'src/game/client.ts')))});\n`);
const build=await Bun.build({entrypoints:[entry],target:'browser',format:'esm',minify:true});if(!build.success)throw new Error(build.logs.join('\n'));
const bundle=await build.outputs[0].text();await writeFile(join(out,'capture-game.js'),bundle);
const server=createServer(async(req,res)=>{
 res.setHeader('access-control-allow-origin','*');res.setHeader('access-control-allow-headers','content-type');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.method==='POST'&&req.url==='/scene'){const chunks=[];for await(const c of req)chunks.push(c);await writeFile(join(out,'game-scene.json.gz'),Buffer.concat(chunks));res.end('ok');return;}
 res.writeHead(404);res.end();
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await startBrowser();
const diagnostics=[];browser.onEvent(m=>{
 if(m.method==='Runtime.exceptionThrown')diagnostics.push(m.params.exceptionDetails);
 if(m.method==='Fetch.requestPaused'){
  const r=m.params;if(new URL(r.request.url).pathname==='/build/game.js')void browser.send('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(bundle).toString('base64')});
  else void browser.send('Fetch.continueRequest',{requestId:r.requestId});
 }
});
try{
 await browser.send('Fetch.enable',{patterns:[{urlPattern:'*/build/game.js*',requestStage:'Request'}]});
 await browser.send('Page.navigate',{url:'http://127.0.0.1:3007/?agent=1&debug=1&renderer=engine'});
 console.log('Waiting for canonical game entry');
 await browser.waitFor('Boolean(window.__THEGAME_READY__&&window.__engineCapture)',300);
 const fixture=JSON.parse(await readFile(join(game,'artifacts/performance-scene.json'),'utf8'));
 console.log('Staging saved game fixture');
 await browser.evaluate(`window.__THEGAME_AGENT__.rendering.configure({adaptive:false,renderScale:1,drawDistance:420,taa:true,bloom:false,motionBlur:0,dof:0})`);
 await browser.evaluate(`window.__THEGAME_AGENT__.applyShot({time:2,position:[-345,.17,-66],yaw:1.12,scene:${JSON.stringify(fixture)}})`);
 await new Promise(r=>setTimeout(r,1500));
 await browser.evaluate(`window.__THEGAME_AGENT__.applyShot({time:2,position:[-345,.17,-66],yaw:1.12,scene:${JSON.stringify(fixture)}})`);
 await writeFile(join(out,'game-original.png'),await browser.screenshot());
 const summary=await browser.evaluate(`window.__exportGameScene('http://127.0.0.1:${server.address().port}/scene')`);
 await writeFile(join(out,'capture.json'),JSON.stringify({summary,diagnostics},null,2));
 console.log(JSON.stringify({entities:summary.entities,primitives:summary.primitives,assets:summary.assets,labels:summary.labels,jsonBytes:summary.jsonBytes,stats:{draws:summary.stats.drawCalls,triangles:summary.stats.triangles},diagnostics}));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
