/** Browser/Node workload. Compare full conversion, retaining the frozen inputs. */
export async function benchmarkMeshPacking(before,after){
 const cases=[];let checksum=0;
 const equal=(a,b)=>{
  for(const key of ['vertices','colors','indices','uvs','variationSeeds']){
   if(!a[key]&&!b[key])continue;
   if(!a[key]||!b[key]||a[key].constructor!==b[key].constructor||a[key].byteLength!==b[key].byteLength)throw Error('Mesh stream mismatch: '+key);
   const x=new Uint8Array(a[key].buffer,a[key].byteOffset,a[key].byteLength),y=new Uint8Array(b[key].buffer,b[key].byteOffset,b[key].byteLength);
   for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error('Mesh byte mismatch: '+key+'/'+i);
  }
  if(a.indexFormat!==b.indexFormat)throw Error('Index format mismatch');
 };
 for(const count of [2048,24000,70000])for(const colors of ['absent','white','varied','late-white']){
  const positions=Array.from({length:count*3},(_,i)=>Math.sin(i*.13)*10),normals=Array.from({length:count*3},(_,i)=>i%3===1?1:0),indices=Array.from({length:Math.floor(count/3)*3},(_,i)=>i);
  const rgba=Array.from({length:count*4},(_,i)=>colors==='varied'?(i%4===3?1:(i%100)/100):1);if(colors==='late-white')rgba[rgba.length-1]=0;
  const input=before.freezePrimitive({kind:'triangle-mesh',positions,normals,indices,...(colors==='absent'?{}:{colors:rgba})},true);
  equal(before.primitiveMesh(input),after.primitiveMesh(input));
  const samples={before:[],after:[]},pairs=[],repeats=count<3000?100:15;
  for(let round=0;round<13;round++){
   const times={};
   for(const variant of round%2?['after','before']:['before','after']){
    const fn=variant==='before'?before.primitiveMesh:after.primitiveMesh,start=performance.now();
    for(let i=0;i<repeats;i++){const result=fn(input);checksum^=result.colors[(i*4)%result.colors.length];}
    const ms=(performance.now()-start)/repeats;if(round>=3){samples[variant].push(ms);times[variant]=ms;}
   }
   if(round>=3)pairs.push({beforeMs:times.before,afterMs:times.after,deltaMs:times.after-times.before});
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],beforeMs=median(samples.before),afterMs=median(samples.after);
  cases.push({vertices:count,colors,frozen:true,byteIdentical:true,beforeMs,afterMs,speedup:beforeMs/afterMs,medianPairedDeltaMs:median(pairs.map(p=>p.deltaMs)),samples,pairs});
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 return {schema:'engine.mesh-packing-benchmark.v1',byteIdentical:true,cases,checksum,method:'Whole primitiveMesh conversion, frozen authored arrays, 3 warmup rounds then 10 alternating AB/BA rounds. No FPS inference.'};
}
