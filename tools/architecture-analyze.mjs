import {readdir,readFile} from 'node:fs/promises';
import {dirname,relative,resolve} from 'node:path';
import process from 'node:process';

const root=resolve(process.argv[2]??'src');
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(?:ts|tsx|mts|cts)$/.test(entry.name)&&!entry.name.endsWith('.d.ts'))files.push(path);}}
await walk(root);
const ids=new Map(files.map(file=>[file,relative(root,file).replaceAll('\\','/')]));
const byStem=new Map();
for(const file of files){const stem=file.replace(/\.(?:ts|tsx|mts|cts)$/,'');byStem.set(stem,file);byStem.set(resolve(stem,'index'),file);}
const resolveLocal=(from,spec)=>{if(!spec.startsWith('.'))return null;const base=resolve(dirname(from),spec).replace(/\.js$/,'');return byStem.get(base)??byStem.get(resolve(base,'index'))??null;};
const count=(s,re)=>[...s.matchAll(re)].length;
const nodes=[];const edges=[];
for(const file of files){const source=await readFile(file,'utf8');const specs=[...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m=>m[1]);const local=[];for(const spec of specs){const target=resolveLocal(file,spec);if(target){local.push(target);edges.push([ids.get(file),ids.get(target)]);}}
 const lines=source.split('\n').length;
 nodes.push({id:ids.get(file),domain:ids.get(file).split('/')[0],bytes:Buffer.byteLength(source),lines,imports:local.length,exports:count(source,/\bexport\s+(?:(?:default|type)\s+)?/g),functions:count(source,/\b(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g),classes:count(source,/\bclass\s+\w+/g),branches:count(source,/\b(?:if|else\s+if|switch|case|catch)\b/g),loops:count(source,/\b(?:for|while|do)\b/g),async:count(source,/\b(?:async|await)\b/g),writes:count(source,/(?:\+\+|--|\+=|-=|\*=|\/=|\b(?:let|var)\s+\w+)/g)});
}
const fanIn=new Map(nodes.map(n=>[n.id,0]));for(const [,to] of edges)fanIn.set(to,(fanIn.get(to)??0)+1);for(const n of nodes)n.fanIn=fanIn.get(n.id)??0;
const graph=new Map(nodes.map(n=>[n.id,[]]));for(const [a,b] of edges)graph.get(a).push(b);
const cycles=[];const visiting=new Set(),done=new Set(),stack=[];function dfs(id){if(visiting.has(id)){const i=stack.indexOf(id);cycles.push([...stack.slice(i),id]);return;}if(done.has(id))return;visiting.add(id);stack.push(id);for(const to of graph.get(id)??[])dfs(to);stack.pop();visiting.delete(id);done.add(id);}for(const n of nodes)dfs(n.id);
const domains={};for(const n of nodes){const d=domains[n.domain]??={files:0,bytes:0,lines:0,imports:0,exports:0,functions:0,classes:0,branches:0,loops:0,async:0,writes:0};d.files++;for(const k of ['bytes','lines','imports','exports','functions','classes','branches','loops','async','writes'])d[k]+=n[k];}
const result={summary:{files:nodes.length,edges:edges.length,cycles:cycles.length,bytes:nodes.reduce((s,n)=>s+n.bytes,0),lines:nodes.reduce((s,n)=>s+n.lines,0)},domains,nodes:nodes.sort((a,b)=>(b.fanIn+b.imports)-(a.fanIn+a.imports)),edges,cycles};
console.log(JSON.stringify(result,null,2));