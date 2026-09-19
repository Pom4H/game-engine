import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,symlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {serveScene} from '../dist/cli/server.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'engine-material-assets-')),directory=join(root,'scene');await mkdir(join(directory,'assets'),{recursive:true});
 const images={'base tile.PNG':'base-image','snow.jpg':'snow-image','contact.webp':'contact-image','hidden.txt':'private-unreferenced'};
 for(const [name,data] of Object.entries(images))await writeFile(join(directory,'assets',name),data);
 const scene={version:1,entities:[
  {id:'base',mesh:{kind:'box'},material:{texture:{url:'assets/base%20tile.PNG?revision=2#grain'}}},
  {id:'snow',mesh:{kind:'box',size:[3,.1,2]},environmental:{surfaceUse:'curb',snowDepthM:.05,snowMaterial:{texture:{url:'/assets/snow.jpg'}}}},
  {id:'contact',mesh:{kind:'box',size:[3,.1,2]},environmental:{surfaceUse:'generic',snowDepthM:.05}},
  {id:'remote',material:{texture:{url:'https://remote.invalid/external.png'}}},
  {id:'network',material:{texture:{url:'//remote.invalid/external2.png'}}},
 ],surfaceContacts:{snow:[{surfaceId:'contact',material:{texture:{url:'./assets/contact.webp'}}}]}};
 return{root,directory,scene};
}

test('local server serves exact material references, including generated snow, with browser URL semantics',async t=>{
 const f=await fixture();let host;t.after(async()=>{await host?.close();await rm(f.root,{recursive:true,force:true});});host=await serveScene(f.scene,{sceneDirectory:f.directory});
 const get=path=>fetch(new URL(path,host.url));
 for(const [url,body,mime] of [['/assets/base%20tile.PNG?cache=9','base-image','image/png'],['/assets/snow.jpg','snow-image','image/jpeg'],['/assets/contact.webp','contact-image','image/webp']]){
  const response=await get(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),mime);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(await response.text(),body);
 }
 assert.deepEqual(await (await get('/scene.json')).json(),f.scene);
 const engine=await get('/dist/browser-entry.js');assert.equal(engine.status,200);assert.match(engine.headers.get('content-type'),/javascript/);
 for(const path of ['/assets/hidden.txt','/external.png','/external2.png','/assets/','/assets/%2e%2e%2fhidden.txt','/dist/%2e%2e%2fcli.ts'])assert.equal((await get(path)).status,404,path);
 f.scene.entities.push({id:'injected',material:{texture:{url:'/assets/hidden.txt'}}});assert.equal((await get('/assets/hidden.txt')).status,404);
 const head=await fetch(new URL('/assets/snow.jpg',host.url),{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),String('snow-image'.length));
 assert.equal((await fetch(new URL('/assets/snow.jpg',host.url),{method:'POST'})).status,405);
 assert.equal((await get('/assets/%zz')).status,400);
});

test('local material whitelist rejects traversal, reserved routes, missing files and escaping symlinks before listening',async t=>{
 const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));await writeFile(join(f.root,'outside.png'),'outside-secret');await symlink(join(f.root,'outside.png'),join(f.directory,'assets','escape.png'));
 const spec=url=>({version:1,entities:[{id:'material',material:{texture:{url}}}]});
 for(const url of ['../outside.png','%2e%2e/outside.png','assets/escape.png','/scene.json','/dist/browser-entry.js','assets/bad%00.png','assets/bad%5c.png'])await assert.rejects(serveScene(spec(url),{sceneDirectory:f.directory}),undefined,url);
 await assert.rejects(serveScene(spec('assets/missing.png'),{sceneDirectory:f.directory}),/ENOENT/);
 await assert.rejects(serveScene({version:2,entities:[]},{sceneDirectory:f.directory}));
});

test('a whitelisted asset cannot be redirected outside its scene directory after startup',async t=>{
 const f=await fixture();let host;t.after(async()=>{await host?.close();await rm(f.root,{recursive:true,force:true});});host=await serveScene(f.scene,{sceneDirectory:f.directory});
 await mkdir(join(f.root,'outside'));await writeFile(join(f.root,'outside','snow.jpg'),'outside-secret');await rename(join(f.directory,'assets'),join(f.directory,'old-assets'));await symlink(join(f.root,'outside'),join(f.directory,'assets'));
 const response=await fetch(new URL('/assets/snow.jpg',host.url));assert.equal(response.status,404);assert.equal(await response.text(),'Not found');
});

test('CLI serve roots relative textures at the scene file instead of the process working directory',async t=>{
 const f=await fixture(),sceneFile=join(f.directory,'scene.json');await writeFile(sceneFile,JSON.stringify(f.scene));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../dist/cli.js',import.meta.url)),'serve',sceneFile,'--port','0'],{cwd:f.root,stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}await rm(f.root,{recursive:true,force:true});});
 const url=await new Promise((resolve,reject)=>{let out='',err='';const timeout=setTimeout(()=>{child.kill();reject(new Error(`CLI startup timeout: ${err}`));},5000);child.stdout.on('data',chunk=>{out+=chunk;const match=/Game Engine: (http:\/\/\S+)/.exec(out);if(match){clearTimeout(timeout);resolve(match[1]);}});child.stderr.on('data',chunk=>err+=chunk);child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`CLI exited ${code}: ${err}`));});});
 const image=await fetch(new URL('/assets/contact.webp',url));assert.equal(image.status,200);assert.equal(await image.text(),'contact-image');assert.equal((await fetch(new URL('/assets/hidden.txt',url))).status,404);
});
