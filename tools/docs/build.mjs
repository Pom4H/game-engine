import {buildProduct} from '../product/build.mjs';
import {cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const here=fileURLToPath(new URL('.',import.meta.url)),root=resolve(here,'../..');
const out=resolve(root,process.env.DOCS_OUT??'.site'),docs=join(out,'docs');
await rm(out,{recursive:true,force:true});await mkdir(docs,{recursive:true});await mkdir(join(out,'shared/vendor'),{recursive:true});
// Every consumer imports the same engine and shared UI/network module URLs.
await cp(join(root,'dist'),join(out,'engine'),{recursive:true});
await cp(join(root,'tools/shared'),join(out,'shared'),{recursive:true});
for(const file of ['index.html','style.css','controls.css','app.mjs','controls.mjs','compiler-worker.js','compiler-client.mjs','examples.mjs','network-ui.mjs','network.css','console.css'])await cp(join(here,file),join(docs,file));
await mkdir(join(out,'games/car-ball'),{recursive:true});
for(const file of ['index.html','style.css'])await cp(join(root,'tools/games',file),join(out,'games',file));
for(const file of ['index.html','style.css','app.mjs'])await cp(join(root,'tools/games/car-ball',file),join(out,'games/car-ball',file));
const require=createRequire(import.meta.url);let compiler;
try{compiler=require.resolve('typescript/lib/typescript.js');}catch{throw new Error('Install editor tooling: bun install --cwd tools/docs (or npm install --prefix tools/docs)');}
await cp(compiler,join(out,'shared/vendor/typescript.js'));
let commit='working-tree';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
await writeFile(join(out,'build.json'),JSON.stringify({commit,builtAt:new Date().toISOString(),examplesModule:'docs/examples.mjs'}));
await writeFile(join(out,'.nojekyll'),'');
await cp(join(root,'tools/site.mjs'),join(out,'site.mjs'));
await writeFile(join(out,'serve.mjs'),`import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {staticSite} from './site.mjs';
const server=createServer(staticSite(fileURLToPath(new URL('.',import.meta.url))));
server.listen(Number(process.env.PORT??4173),'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/'));
`);
await writeFile(join(out,'START.txt'),'node serve.mjs\nDocs: http://127.0.0.1:4173/docs/\nGames: http://127.0.0.1:4173/games/\nLocal Car / Ball: /games/car-ball/?mode=local. Remote rooms: bun run arena from source.\nSource from shared links and files requires Apply.\n');
await mkdir(join(out,'games/chess'),{recursive:true});
for(const file of ['index.html','style.css','app.mjs'])await cp(join(root,'tools/games/chess',file),join(out,'games/chess',file));
await cp(join(root,'examples/chess/project.ts'),join(out,'games/chess/project.ts'));
await cp(join(root,'examples/car-ball/project.ts'),join(out,'games/car-ball/project.ts'));
await buildProduct(root,out);
console.log('Site built:',out);
