#!/usr/bin/env node
/** Build a portable character editor with its engine, styles and image inline.
 * Use Bun, an existing esbuild installation, or --bundler=/path/to/esbuild.
 */
import {execFile,execFileSync,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const run=promisify(execFile),directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../..');
function revision(){
  if(process.env.GITHUB_SHA)return process.env.GITHUB_SHA;
  try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return 'local';}
}
function replaceOnce(html,pattern,replacement,label){
  const matches=html.match(pattern);
  if(matches?.length!==1)throw new Error(`Expected one ${label} in character editor HTML; found ${matches?.length??0}`);
  return html.replace(pattern,()=>replacement);
}
async function compile(output,requested){
  const entry=join(directory,'app.mjs');
  let executable=requested;
  if(!executable&&spawnSync('bun',['--version'],{encoding:'utf8',windowsHide:true}).status===0)executable='bun';
  if(executable){
    const isBun=/^bun(?:\.exe)?$/i.test(basename(executable));
    const args=isBun?['build',entry,'--target','browser','--format','iife','--minify','--outfile',output]:[entry,'--bundle','--platform=browser','--format=iife','--target=es2022','--minify','--log-level=warning',`--outfile=${output}`];
    await run(executable,args,{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});
    return isBun?'bun':'esbuild';
  }
  let esbuild;
  try{esbuild=await import('esbuild');}catch(error){
    if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
    throw new Error('Bun or esbuild is required to bundle the editor. Use --bundler=/absolute/path/to/esbuild or CHARACTER_BUNDLER. No dependencies were installed.');
  }
  await esbuild.build({entryPoints:[entry],bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,outfile:output,logLevel:'warning'});
  return 'esbuild';
}

export async function buildCharacterCreator({bundler=process.env.CHARACTER_BUNDLER,output=join(root,'artifacts/character-creator.html')}={}){
  if(!existsSync(join(root,'dist/characters/character.js')))throw new Error('Build the engine first: bun run build');
  const temporary=await mkdtemp(join(tmpdir(),'character-creator-bundle-'));
  try{
    const bundledPath=join(temporary,'app.js'),compiler=await compile(bundledPath,bundler);
    const [template,css,javascript,reference,license,faceLicense,faceProvenance]=await Promise.all([
      readFile(join(directory,'index.html'),'utf8'),readFile(join(directory,'style.css'),'utf8'),readFile(bundledPath,'utf8'),readFile(join(directory,'reference.jpeg')),
      readFile(join(root,'LICENSE'),'utf8'),readFile(join(root,'licenses/face-reference-CC0.txt'),'utf8'),readFile(join(root,'licenses/face-reference.md'),'utf8'),
    ]);
    const metadata={sourceRevision:revision(),standalone:true};
    const metadataJSON=JSON.stringify(metadata).replaceAll('<','\\u003c');
    const script=`<script>globalThis.__CHARACTER_BUILD_META__=${metadataJSON};\n${javascript.replace(/<\/script/gi,'<\\/script')}\n</script>`;
    let html=replaceOnce(template,/<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']\/tools\/character-creator\/style\.css["'])[^>]*>/g,`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`,'editor stylesheet');
    html=replaceOnce(html,/<script\b[^>]*\bsrc=(["'])\/tools\/character-creator\/app\.mjs\1[^>]*>\s*<\/script>/g,script,'application module');
    html=replaceOnce(html,/src=(["'])\/tools\/character-creator\/reference\.jpeg\1/g,`src="data:image/jpeg;base64,${reference.toString('base64')}"`,'reference image');
    html=html.replace(/href=(["'])\/\1/g,'href="#"');
    const notices=`ROM4 Game Engine — standalone character editor\nSource revision: ${metadata.sourceRevision}\n\nENGINE LICENSE (LICENSE)\n${license}\nANATOMICAL FACE ASSET LICENSE (licenses/face-reference-CC0.txt)\n${faceLicense}\nANATOMICAL FACE PROVENANCE (licenses/face-reference.md)\n${faceProvenance}`;
    if(notices.includes('-->'))throw new Error('License notice contains an HTML comment terminator');
    html=replaceOnce(html,/<\/head>/g,`<!--\n${notices}\n-->\n</head>`,'document head');
    const destination=resolve(output);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,html);
    const result={file:destination,bytes:Buffer.byteLength(html),compiler,...metadata};
    console.log(JSON.stringify(result));return result;
  }finally{await rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const options={};
  for(const arg of process.argv.slice(2)){
    if(arg.startsWith('--bundler='))options.bundler=arg.slice('--bundler='.length);
    else if(arg.startsWith('--output='))options.output=arg.slice('--output='.length);
    else throw new Error('Usage: node tools/character-creator/bundle.mjs [--bundler=/path/to/esbuild] [--output=editor.html]');
  }
  await buildCharacterCreator(options);
}
