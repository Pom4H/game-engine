import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dir,'..');
export async function buildPlayground(out=resolve(root,'site')){
 await mkdir(out,{recursive:true});
 const bundle=async(entry,define={})=>{
  const result=await Bun.build({entrypoints:[resolve(root,entry)],target:'browser',format:'iife',minify:true,define,
   external:['fs','path','os','crypto','buffer','perf_hooks','inspector','node:fs','node:path','node:os','node:crypto']});
  if(!result.success)throw new AggregateError(result.logs,'Playground build failed');return result.outputs[0].text();
 };
 const catalog=JSON.parse(await readFile(resolve(root,'playground/examples/catalog.json'),'utf8'));
 const examples=await Promise.all(catalog.map(async example=>({...example,source:await readFile(resolve(root,`playground/examples/${example.id}.ts`),'utf8')})));
 const [compiler,execution,style,template]=await Promise.all([bundle('playground/compiler-worker.ts'),bundle('playground/execution-worker.ts'),readFile(resolve(root,'playground/styles.css'),'utf8'),readFile(resolve(root,'playground/index.html'),'utf8')]);
 const [frame,app]=await Promise.all([bundle('playground/compiler-frame.ts',{'__COMPILER_SOURCE__':JSON.stringify(compiler),'__EXECUTION_SOURCE__':JSON.stringify(execution)}),bundle('playground/app.ts',{'__EXAMPLES__':JSON.stringify(examples)})]);
 const safe=s=>s.replace(/<\/script/gi,'<\\/script');
 const parentCSP="default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src 'self' data: blob:; worker-src blob:; frame-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'";
 const frameCSP="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
 const html=template.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+parentCSP+'">').replace('__STYLE__',style).replace('__APP__',safe(app));
 await writeFile(resolve(out,'index.html'),html);
 await writeFile(resolve(out,'compiler.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${frameCSP}"><title>DSL compiler isolation</title><script>${safe(frame)}</script>`);
 const manifest={schema:1,commit:process.env.GITHUB_SHA??'local',examples:catalog,bytes:{page:Buffer.byteLength(html),compiler:Buffer.byteLength(frame)},sha256:createHash('sha256').update(html).digest('hex')};
 await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));return out;
}
if(import.meta.main)await buildPlayground();
