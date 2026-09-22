import {execFileSync} from 'node:child_process';
import {causalFingerprint,parseCausalCommit,validateCausalCommit} from './protocol.mjs';

const arg=(name,fallback=null)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const ref=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'HEAD';
const noteRef=arg('--against-notes');
const message=git(['show','-s','--format=%B',ref]);
const commit=parseCausalCommit(message),errors=validateCausalCommit(commit);
const sha=git(['rev-parse',ref]).trim();
if(noteRef)errors.push(...findDuplicateErrors(commit,sha,noteRef));
console.log(JSON.stringify({ref,sha,commit,valid:errors.length===0,errors},null,2));
if(errors.length)process.exitCode=1;

function findDuplicateErrors(current,currentSha,notesRef){
  let listing;
  try{listing=git(['notes',`--ref=${notesRef}`,'list']);}catch{return [];}
  const fingerprint=causalFingerprint(current),errors=[];
  for(const line of listing.trim().split('\n').filter(Boolean)){
    const [,subject]=line.trim().split(/\s+/);
    if(!subject||subject===currentSha)continue;
    try{
      const evidence=JSON.parse(git(['notes',`--ref=${notesRef}`,'show',subject]));
      if(!evidence?.declaration||causalFingerprint(evidence.declaration)!==fingerprint)continue;
      if(current.supersedes.some(value=>subject.startsWith(value)||value.startsWith(subject)))continue;
      errors.push(`Duplicate causal experiment already evaluated at ${subject.slice(0,12)} (${evidence.verdict??'unknown'}). Change the hypothesis/intervention or add Causal-Supersedes: ${subject}`);
    }catch{}
  }
  return errors;
}
function git(args){return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
