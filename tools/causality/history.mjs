import {execFileSync} from 'node:child_process';
import {parseCausalCommit} from './protocol.mjs';

const arg=(name,fallback=null)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const experiment=arg('--experiment');
const ref=arg('--ref','causality');
let listing='';
try{listing=git(['notes',`--ref=${ref}`,'list']);}catch{
  console.error(`No git notes found at refs/notes/${ref}. Fetch them with: git fetch origin refs/notes/${ref}:refs/notes/${ref}`);
  process.exit(1);
}
const rows=[];
for(const line of listing.trim().split('\n').filter(Boolean)){
  const [,subject]=line.trim().split(/\s+/);if(!subject)continue;
  try{
    const note=JSON.parse(git(['notes',`--ref=${ref}`,'show',subject]));
    if(experiment&&note.experiment!==experiment)continue;
    const message=git(['show','-s','--format=%B',subject]);
    const declaration=parseCausalCommit(message);
    const perf=note.observations?.performance1080??note.observations?.visualFast;
    const reality=note.observations?.reality;
    rows.push({sha:subject.slice(0,10),date:git(['show','-s','--format=%cs',subject]).trim(),verdict:note.verdict,gap:reality?.gap,delta:reality?.baseline?.delta,fps:perf?.completedFps,gpu:perf?.gpuP95Ms,hypothesis:declaration.hypothesis??''});
  }catch{}
}
rows.sort((a,b)=>a.date.localeCompare(b.date));
if(!rows.length){console.log('No causal evidence'+(experiment?` for ${experiment}`:'')+'.');process.exit(0);}
console.log('| date | commit | verdict | RealityGap | Δ | FPS | GPU p95 ms | hypothesis |');
console.log('|---|---|---|---:|---:|---:|---:|---|');
for(const row of rows)console.log(`| ${row.date} | ${row.sha} | ${row.verdict} | ${fmt(row.gap,6)} | ${fmt(row.delta,6)} | ${fmt(row.fps,2)} | ${fmt(row.gpu,2)} | ${escapeCell(row.hypothesis)} |`);

function git(args){return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
function fmt(value,digits){return Number.isFinite(value)?value.toFixed(digits):'';}
function escapeCell(value){return String(value).replace(/\|/g,'\\|').replace(/\s+/g,' ').trim();}
