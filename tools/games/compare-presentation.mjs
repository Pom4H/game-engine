import assert from 'node:assert/strict';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
// Build the pinned base in a separate worktree and pass its dist directory.
if(!process.argv[2])throw Error('Usage: node tools/games/compare-presentation.mjs <baseline-dist>');
const base=pathToFileURL(resolve(process.argv[2])+sep),head=new URL('../../dist/',import.meta.url);
const {CarBallView:Before}=await import(new URL('examples/car-ball-view.js',base));
const {CarBallView:After,arenaOffset:o}=await import(new URL('examples/car-ball-view.js',head));
const {CarBallArena,arenaDatagram}=await import(new URL('examples/car-ball.js',head));
const {quaternionFromEuler}=await import(new URL('physics/rotation.js',head));
const world=new CarBallArena(),before=new Before(),after=new After(),states=()=>[...before.scene.entities.values()];
const clock={epoch:1,tick:0,sequence:1,time:0,paused:false},first=world.capture(clock);
let oldLookups=0,newLookups=0,oldRegex=0,newRegex=0,numericValues=0;
const count=(view,sample,which)=>{
 const get=view.scene.entities.get,exec=RegExp.prototype.exec;let lookups=0,patterns=0;
 view.scene.entities.get=function(k){lookups++;return get.call(this,k);};RegExp.prototype.exec=function(s){patterns++;return exec.call(this,s);};
 try{view.apply(sample);}finally{view.scene.entities.get=get;RegExp.prototype.exec=exec;}
 if(which){newLookups+=lookups;newRegex+=patterns;}else{oldLookups+=lookups;oldRegex+=patterns;}
};
for(let i=0;i<400;i++){
 const frame=structuredClone(first);frame.time=(i%43)/30;frame.tick=Math.round(frame.time*120);frame.epoch=1+Math.floor(i/137);frame.rows[0].generation=Math.floor(i/53);frame.sequence=i+1;const v=frame.rows[0].values;
 for(let c=0;c<2;c++){
  const pose=o['car'+c],q=o['rotation'+c];for(let k=0;k<3;k++)v[pose+k]=(Math.sin(i*1.13+k+c))*12;
  const angle=[Math.sin(i)*3,i%7===0?Math.PI/2:Math.cos(i)*3,Math.sin(i*.4)*3];quaternionFromEuler(angle).forEach((n,k)=>v[q+k]=n);
  for(let k=0;k<4;k++){v[o.spin+c*4+k]=i*.34+k;v[o.compression+c*4+k]=Math.sin(i+k)*.1;}
  v[o.steer+c]=Math.sin(i*.2+c);
 }
 for(let k=0;k<201;k++)v[o.nodes+k]+=Math.sin(i*.3+k)*.02;
 for(let k=0;k<34;k++)v[o.pads+k]=i%3?0:4;
 const decoded=arenaDatagram.decode(arenaDatagram.encode(frame));
 const sample={...decoded,alpha:0,fromTick:frame.tick,toTick:frame.tick,rows:decoded.rows.map(r=>({...r,values:Float64Array.from(r.values)}))};
 count(before,sample,false);count(after,sample,true);
 const a=[...before.scene.entities.values()].map(e=>[e.id,...e.position,...e.rotation,...e.scale]),b=[...after.scene.entities.values()].map(e=>[e.id,...e.position,...e.rotation,...e.scale]);
 assert.deepEqual(b,a);assert.deepEqual(after.ballMesh.vertices,before.ballMesh.vertices);assert.deepEqual(after.ballMesh.positions,before.ballMesh.positions);
 numericValues+=a.length*9+after.ballMesh.vertices.length+after.ballMesh.positions.length;
}
const report={base:'6bfb8c51228c99dad1cc91c647194a0643c5bb8a',runtime:process.version,samples:400,entities:states().length,carParts:after.geometry.parts.length,numericValues,poseAndBallBuffers:'exactly equal',oldLookups,newLookups,oldRegex,newRegex,simulationModified:false};
console.log(JSON.stringify(report,null,2));world.dispose();before.dispose();after.dispose();
