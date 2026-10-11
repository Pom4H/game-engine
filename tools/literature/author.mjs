#!/usr/bin/env node
/**
 * Plain Russian .txt -> model or deterministic offline author -> checked
 * SceneSpec -> WebGPU render-harness input. No hand-authored JSON needed.
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {compileGeneratedLiterature} from '../../dist/literature/generative.js';
import {decodeWorldBinary} from '../../dist/scene/world-binary.js';
import {interpretOffline} from './offline.mjs';
import {requestLiteraryDraft} from './provider.mjs';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
function options(args){
  const first=args.shift();
  if(!first||first.startsWith('--'))throw new Error(
    'usage: node tools/literature/author.mjs <russian.txt> [--provider model|offline] [--world physical.world] [--out artifacts/literature]');
  const options={input:resolve(first),provider:'model',world:null,out:resolve('artifacts/literature')};
  while(args.length){
    const key=args.shift(),value=args.shift();
    if(!value)throw new Error('missing argument for '+key);
    if(key==='--world')options.world=resolve(value);
    else if(key==='--provider'&&['model','offline'].includes(value))options.provider=value;
    else if(key==='--out')options.out=resolve(value);
    else throw new Error('unknown option '+key+' '+value);
  }
  if(!options.input.endsWith('.txt'))throw new Error('input must be an original UTF-8 .txt');
  return options;
}
function baselineFromWorld(path){
  if(!path)return undefined;
  const scratch=mkdtempSync(join(tmpdir(),'prose-worldc-'));
  try{
    const out=join(scratch,'scene.wscn');
    const compiled=spawnSync('cargo',['run','--quiet','--manifest-path',
      join(root,'compiler','Cargo.toml'),'--','compile',path,'-o',out],{
      cwd:root,encoding:'utf8',
    });
    if(compiled.error||compiled.status!==0)
      throw new Error('Rust worldc failed: '+(compiled.error?.message??compiled.stderr));
    return decodeWorldBinary(readFileSync(out));
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
function save(path,obj){
  writeFileSync(path,JSON.stringify(obj,null,2)+'\n');
}
async function main(){
  const args=options(process.argv.slice(2));
  const source=readFileSync(args.input,'utf8');
  const world=baselineFromWorld(args.world);
  let proposal,compiled;
  if(args.provider==='offline'){
    proposal=interpretOffline(source,world);
    compiled=compileGeneratedLiterature(source,proposal,world);
  }else{
    for(let attempt=0;attempt<2;attempt++){
      proposal=await requestLiteraryDraft({
        source,world:world??{entities:[]},
        ...(attempt?{feedback:'The previous proposed JSON was rejected: '+String(lastError)}:{}),
      });
      try{
        compiled=compileGeneratedLiterature(source,proposal,world);
        break;
      }catch(error){
        if(attempt===1)throw error;
        var lastError=error instanceof Error?error.message:String(error);
      }
    }
  }
  if(!compiled)throw new Error('No checked literary scene');
  const {scene,shots,provenance}=compiled;
  mkdirSync(args.out,{recursive:true});
  save(join(args.out,'scene.json'),scene);
  save(join(args.out,'draft.json'),proposal);
  save(join(args.out,'provenance.json'),{
    provider:args.provider,sourceFile:basename(args.input),
    sourceSha256:createHash('sha256').update(source).digest('hex'),
    claims:provenance.claims,facts:provenance.facts,
    visualEntities:provenance.visualEntities,ungrounded:provenance.ungrounded,
  });
  // Harness serves /tools/*.mjs, so these modules are generated under tools.
  const generated=join(root,'tools','literature');
  writeFileSync(join(generated,'generated.scene.mjs'),
    '// Generated from '+JSON.stringify(basename(args.input))+'; do not edit.\n'+
    'export default '+JSON.stringify(scene)+';\n');
  const views=shots.map(shot=>({
    name:'literature-'+shot.id,
    output:join(args.out,shot.id+'.png').replaceAll('\\','/'),
    time:0,camera:shot.camera,
  }));
  writeFileSync(join(generated,'generated.views.mjs'),
    '// Views of a single authoritative Scene.\nexport default '+JSON.stringify(views)+';\n');
  console.log(JSON.stringify({
    provider:args.provider,source:args.input,physicalBodies:scene.entities.filter(e=>e.body).length,
    visualHypotheses:provenance.visualEntities.length,claimCount:provenance.claims.length,
    views:views.map(v=>v.output),
    render:'node tools/render-harness.mjs tools/literature/generated.scene.mjs tools/literature/generated.views.mjs 1280 720',
  },null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
