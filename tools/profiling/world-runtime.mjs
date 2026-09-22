import {performance} from 'node:perf_hooks';
import {InterestPlanner,WorldMailbox} from '../../dist/index.js';

const subjects=Array.from({length:4096},(_,i)=>({id:`s${i}`,x:(i*53)%8192-4096,z:(i*97)%8192-4096,radius:i%7}));
const observers=Array.from({length:128},(_,i)=>({x:(i*379)%8192-4096,z:(i*997)%8192-4096}));
const owners=Array.from({length:512},(_,i)=>({locationId:`loc:v1:1:${i}:0`,ownerId:'world',epoch:1}));
const median=values=>{const sorted=values.slice().sort((a,b)=>a-b);return(sorted[3]+sorted[4])/2};

function interest(){
  const planner=new InterestPlanner({downgradeTicks:2});
  const start=performance.now();
  for(let tick=0;tick<8;tick++)planner.plan(tick,subjects,observers);
  return performance.now()-start;
}
function mailbox(){
  const box=new WorldMailbox(4096);
  for(let i=0;i<4096;i++){
    const target=owners[i%owners.length];
    box.enqueue({id:`m${i}`,source:owners[0],target,tick:i%4,sequence:i,type:'step',payload:i},owners[0],target);
  }
  const start=performance.now();
  for(const owner of owners)box.drain(owner,4);
  if(box.size!==0)throw new Error('Mailbox did not drain');
  return performance.now()-start;
}

interest();mailbox();
const interestMs=[],mailboxMs=[];
for(let i=0;i<8;i++){interestMs.push(interest());mailboxMs.push(mailbox())}
console.log(JSON.stringify({
  fixture:{subjects:subjects.length,observers:observers.length,interestTicks:8,locations:owners.length,messages:4096},
  interestMedianMs:median(interestMs),mailboxMedianMs:median(mailboxMs),interestMs,mailboxMs
},null,2));
