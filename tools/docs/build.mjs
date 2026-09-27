import {cp,mkdir,readFile,writeFile,access,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const here=fileURLToPath(new URL('.',import.meta.url)),root=resolve(here,'../..');
const out=resolve(root,process.env.DOCS_OUT??'.site');
await rm(out,{recursive:true,force:true});await mkdir(join(out,'vendor'),{recursive:true});
await cp(join(root,'dist'),join(out,'engine'),{recursive:true});
for(const file of ['index.html','style.css','controls.css','app.mjs','controls.mjs','compiler-worker.js','compile.cjs','bindings.cjs','document.mjs','compiler-client.mjs','examples.mjs','network-ui.mjs','network-worker.js','network.css','console.mjs','console.css','recording.mjs','recording-ui.mjs','recording.css'])await cp(join(here,file),join(out,file));
const require=createRequire(import.meta.url);let compiler;
try{compiler=require.resolve('typescript/lib/typescript.js');}catch{throw new Error('Install editor tooling: bun install --cwd tools/docs (or npm install --prefix tools/docs)');}
await cp(compiler,join(out,'vendor/typescript.js'));
let commit='working-tree';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
await writeFile(join(out,'build.json'),JSON.stringify({commit,builtAt:new Date().toISOString(),examplesModule:'examples.mjs'}));
await writeFile(join(out,'.nojekyll'),'');
await writeFile(join(out,'serve.mjs'),`import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.cjs':'text/javascript','.css':'text/css','.json':'application/json'};
createServer(async(req,res)=>{try{let name=decodeURIComponent(new URL(req.url,'http://local').pathname);const path=resolve(root,'.'+(name==='/'?'/index.html':name));if(!path.startsWith(root))throw Error();const body=await readFile(path);res.writeHead(200,{'content-type':types[extname(path)]??'application/octet-stream','x-content-type-options':'nosniff'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('http://127.0.0.1:4173/'));
`);
await writeFile(join(out,'START.txt'),'node serve.mjs\nOpen http://127.0.0.1:4173/ in a WebGPU browser.\nSource from shared links and files requires Apply.\n');
console.log('Docs built:',out);
