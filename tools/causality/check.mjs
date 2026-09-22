import {execFileSync} from 'node:child_process';
import {parseCausalCommit,validateCausalCommit} from './protocol.mjs';

const ref=process.argv[2]??'HEAD';
const message=execFileSync('git',['show','-s','--format=%B',ref],{encoding:'utf8'});
const commit=parseCausalCommit(message),errors=validateCausalCommit(commit);
console.log(JSON.stringify({ref,commit,valid:errors.length===0,errors},null,2));
if(errors.length)process.exitCode=1;
