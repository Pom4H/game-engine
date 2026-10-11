#!/usr/bin/env node
// Offline experiment: authored World -> Rust WSCN -> model-draft validation ->
// engine-native SceneSpec + interchangeable camera projections.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileLiteraryDraft,literaryView} from '../../dist/literature/index.js';
import {decodeWorldBinary} from '../../dist/scene/world-binary.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const [draftArg='examples/literature/pereprava.draft.json',
  worldArg='examples/literature/pereprava.world',
  destination='artifacts/literature']=process.argv.slice(2);
const output=resolve(destination);
const scratch=mkdtempSync(join(tmpdir(),'literary-world-'));
try{
  const binary=join(scratch,'scene.wscn');
  const result=spawnSync('cargo',['run','--quiet','--manifest-path','compiler/Cargo.toml','--',
    'compile',resolve(worldArg),'-o',binary],{cwd:root,encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||'worldc compile failed');
  const draft=JSON.parse(readFileSync(resolve(draftArg),'utf8'));
  const compiled=compileLiteraryDraft(draft,decodeWorldBinary(readFileSync(binary)));
  mkdirSync(output,{recursive:true});
  const save=(name,data)=>writeFileSync(join(output,name),JSON.stringify(data,null,2)+'\n');
  save('scene.json',compiled.scene);
  save('provenance.json',compiled.provenance);
  for(const shot of compiled.shots)save(shot.id+'.scene.json',literaryView(compiled.scene,shot));
  console.log('Literary scene:',join(output,'scene.json'));
  console.log('Physical claims:',compiled.provenance.facts.length);
  console.log('Visual projections:',compiled.provenance.visualEntities.length);
  console.log('Unresolved/figurative:',compiled.provenance.ungrounded.join(', ')||'none');
}finally{rmSync(scratch,{recursive:true,force:true});}
