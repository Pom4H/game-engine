import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';

const root=resolve(import.meta.dirname,'..'),site=resolve(root,'_site');
await mkdir(site,{recursive:true});
await cp(resolve(root,'pages/index.html'),resolve(site,'index.html'));
await cp(resolve(root,'dist'),resolve(site,'dist'),{recursive:true});

const scene=await loadScene(resolve(root,'examples/window-gauntlet.ts'));
await writeFile(resolve(site,'scene.json'),JSON.stringify(scene));
await writeFile(resolve(site,'.nojekyll'),'');
console.log(`Pages site: ${site}`);

async function loadScene(path:string){
  const script=`const m=await import(${JSON.stringify(new URL('file://'+path.replaceAll('\\\\','/')).href)});process.stdout.write(JSON.stringify(m.default??m.scene));`;
  const stdout=await capture(process.execPath,['--experimental-strip-types','--no-warnings','--input-type=module','-e',script]);
  return JSON.parse(stdout);
}
async function capture(binary:string,args:string[]):Promise<string>{
  return await new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd:root,stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
    child.once('error',reject);child.once('exit',code=>code===0?resolve(out):reject(new Error(err||`exit ${code}`)));
  });
}
