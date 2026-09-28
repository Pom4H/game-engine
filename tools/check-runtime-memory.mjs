import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';

async function files(dir){
  const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);if(entry.isDirectory())out.push(...await files(path));else if(entry.isFile()&&path.endsWith('.ts'))out.push(path);
  }return out;
}
const offenders=[];
for(const file of await files('src')){
  if(file.endsWith('core/runtime-memory.ts'))continue;
  const source=await readFile(file,'utf8'),lines=source.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    for(const statement of lines[i].split(';')){
      if(/^\s*(?:(?:private|protected|public|readonly|static)\s+)+[$A-Z_a-z][$\w]*(?:\s*:[^=]+)?\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b/.test(statement))
        offenders.push(`${relative('.',file)}:${i+1}: ${statement.trim()}`);
    }
  }
}
if(offenders.length){
  console.error('Persistent runtime collections must be registered with trackRuntimeMemory():\n'+offenders.map(x=>'  '+x).join('\n'));
  process.exitCode=1;
}
