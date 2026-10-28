import {mkdir} from 'node:fs/promises';
import {SolidBody,Qeuler} from '../dist/physics/compound.js';
import {oldMaterialBoxes} from '../test/fixtures/world-triangle-before-local-cache.mjs';

// Component-only paired benchmark of the frozen predecessor and current path.
// Same body/shape count, mutable coordinates, poses and complete query geometry.
const points=[];for(let layer=0;layer<2;layer++)for(let j=0;j<4;j++)for(let i=0;i<3;i++)points.push([layer*.04+.018*Math.sin(j*.6)+.006*i*i,j*.35,i*.55]);
const triangles=[];for(let layer=0;layer<2;layer++)for(let j=0;j<3;j++)for(let i=0;i<2;i++){const a=layer*12+j*3+i,b=a+1,c=a+3,d=a+4;triangles.push([a,b,c],[b,d,c]);}
const shapes=triangles.map(ids=>({half:[.1,.2,.3],triangle:ids.map(i=>[...points[i]]),structureNodes:ids,thickness:.0008})),body=new SolidBody({mass:26,shapes}),iterations=1000;
function measure(builder,mode,count=iterations){let checksum=0;const start=performance.now();for(let i=0;i<count;i++){
 const t=i*.013;body.p=[Math.sin(t)*3,.5+Math.cos(t*.7)*.03,i*.001];body.q=mode==='translation'?[0,0,0,1]:Qeuler(t*.7,Math.sin(t)*.2,t*.3);
 if(mode==='deforming')for(let face=0;face<shapes.length;face++)for(let j=0;j<3;j++){const source=points[triangles[face][j]],target=shapes[face].triangle[j];target[0]=source[0]+Math.sin(t*.3+source[1])*source[2]*.003;target[1]=source[1];target[2]=source[2];}
 for(const box of builder(body)){checksum+=box.triangle.bounds[0]+box.triangle.planes[0].offset+box.triangle.normals[0][2];}
}return{ms:performance.now()-start,checksum};}
const current=b=>b.boxes(),rows=[];for(const mode of ['rotation','translation','deforming']){
 measure(oldMaterialBoxes,mode,250);measure(current,mode,250);const trials=[];
 for(let pair=0;pair<7;pair++){const first=pair%2?current:oldMaterialBoxes,second=pair%2?oldMaterialBoxes:current,a=measure(first,mode),b=measure(second,mode),before=pair%2?b:a,after=pair%2?a:b;if(Math.abs(before.checksum-after.checksum)>1e-6)throw Error('Component benchmark geometry differs');trials.push({beforeMs:before.ms,afterMs:after.ms,ratio:after.ms/before.ms,checksumDifference:after.checksum-before.checksum});}
 const median=key=>trials.map(t=>t[key]).sort((a,b)=>a-b)[Math.floor(trials.length/2)],row={mode,faces:shapes.length,poseQueries:iterations,medianBeforeMs:median('beforeMs'),medianAfterMs:median('afterMs'),medianPairedRatio:median('ratio'),trials};rows.push(row);console.log(JSON.stringify(row));
}
await mkdir('artifacts',{recursive:true});await Bun.write('artifacts/world-triangle-local-cache.json',JSON.stringify({scope:'Paired component CPU benchmark only. Identical24-face material chart and1000bodyposes; seven alternating before/after pairs. Does not measure whole physics steps, native GPU or browser FPS.',rows},null,2));
