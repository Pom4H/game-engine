import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';

async function files(dir){
  const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);if(entry.isDirectory())out.push(...await files(path));else if(entry.isFile()&&path.endsWith('.ts'))out.push(path);
  }return out;
}
function masked(source){
  const out=[...source];let state='code',escape=false;
  const blank=i=>{if(source[i]!=='\n'&&source[i]!=='\r')out[i]=' ';};
  for(let i=0;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(state==='line'){blank(i);if(ch==='\n')state='code';continue;}
    if(state==='block'){blank(i);if(ch==='*'&&next==='/'){blank(i+1);i++;state='code';}continue;}
    if(state!=='code'){blank(i);if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch===state)state='code';continue;}
    if(ch==='/'&&next==='/'){blank(i);blank(i+1);i++;state='line';continue;}
    if(ch==='/'&&next==='*'){blank(i);blank(i+1);i++;state='block';continue;}
    if(ch===String.fromCharCode(39)||ch===String.fromCharCode(34)||ch===String.fromCharCode(96)){blank(i);state=ch;}
  }return out.join('');
}
const kinds=/\bnew\s+(Map|Set|WeakMap|WeakSet)\b/g,offenders=[];
for(const file of await files('src')){
  if(file.endsWith('core/runtime-memory.ts'))continue;
  const source=await readFile(file,'utf8'),code=masked(source),stack=[];let pendingClass=false,match=kinds.exec(code);
  for(let i=0;i<code.length&&match;){
    const ch=code[i];
    if(/[A-Za-z_$]/.test(ch)){let j=i+1;while(j<code.length&&/[\w$]/.test(code[j]))j++;if(code.slice(i,j)==='class')pendingClass=true;i=j;continue;}
    if(ch==='{'){stack.push(pendingClass?'class':'block');pendingClass=false;}else if(ch==='}')stack.pop();
    if(i>=match.index){
      if(stack.length===0||stack.at(-1)==='class'){
        const start=Math.max(code.lastIndexOf(';',match.index),code.lastIndexOf('{',match.index),code.lastIndexOf('}',match.index))+1;
        const prefix=code.slice(start,match.index);
        if(!/trackRuntimeMemory\s*\([^;{}]*$/.test(prefix)){
          const line=source.slice(0,match.index).split('\n').length;
          offenders.push(relative('.',file)+':'+line+': untracked persistent new '+match[1]+'()');
        }
      }
      match=kinds.exec(code);
    }
    i++;
  }
}
if(offenders.length){
  console.error('Persistent runtime collections must be registered with trackRuntimeMemory():\n'+offenders.map(x=>'  '+x).join('\n'));
  process.exitCode=1;
}
