import {spawn} from 'node:child_process';
import {oracle} from './render-oracle.scene.mjs';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const luma=rgba=>rgba[0]*.2126+rgba[1]*.7152+rgba[2]*.0722;

function project(world){
  const {position,target,fov}=oracle.camera,forward=norm(sub(target,position)),right=norm(cross(forward,[0,1,0])),up=norm(cross(right,forward)),delta=sub(world,position);
  const z=dot(delta,forward),half=Math.tan(fov*Math.PI/360),aspect=oracle.width/oracle.height;
  if(z<=0)throw new Error('Oracle point is behind the camera');
  const nx=dot(delta,right)/(z*half*aspect),ny=dot(delta,up)/(z*half);
  const x=Math.max(0,Math.min(oracle.width-1,Math.floor((nx*.5+.5)*oracle.width)));
  const y=Math.max(0,Math.min(oracle.height-1,Math.floor((.5-ny*.5)*oracle.height)));
  return[x,y];
}

function run(binary,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{stdio:['ignore','pipe','pipe']});let out='',err='';
    child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
    child.once('error',reject);child.once('exit',code=>code===0?resolve(out):reject(new Error(err||binary+' exited '+code)));
  });
}

const pixels=oracle.points.map(point=>project(point.world));
const raw=await run(process.execPath,[
  'dist/cli.js','probe','tools/render-oracle.scene.mjs',
  '--width',String(oracle.width),'--height',String(oracle.height),
  '--stage','all','--pixels',JSON.stringify(pixels),
]);
const report=JSON.parse(raw),pointById=new Map(oracle.points.map(point=>[point.id,point]));
const stageMaps=new Map();
for(const stage of ['hdr','effects','taa']){
  const map=new Map();
  oracle.points.forEach((point,index)=>map.set(point.id,report.samplesByStage[stage][index].rgba));
  stageMaps.set(stage,map);
}
const sample=id=>{
  const point=pointById.get(id);if(!point)throw new Error('Unknown oracle point '+id);
  return stageMaps.get(point.stage??'hdr').get(id);
};

const results=[];
for(const contract of oracle.contracts){
  if(contract.kind==='delta'){
    const a=sample(contract.a),b=sample(contract.b),actual=b.slice(0,3).map((v,i)=>v-a[i]),errors=actual.map((v,i)=>Math.abs(v-contract.expected[i]));
    results.push({id:contract.id,expected:contract.expected,actual,error:Math.max(...errors),pass:errors.every(e=>e<=contract.tolerance)});
  }else if(contract.kind==='ratio'){
    const black=luma(sample(contract.black)),mid=luma(sample(contract.mid)),white=luma(sample(contract.white)),actual=(mid-black)/Math.max(1e-9,white-black),error=Math.abs(actual-contract.expected);
    results.push({id:contract.id,expected:contract.expected,actual,error,pass:error<=contract.tolerance});
  }else if(contract.kind==='gain'){
    const low=luma(sample(contract.low)),high=luma(sample(contract.high)),actual=high/Math.max(low,1e-9);
    results.push({id:contract.id,minimum:contract.minimum,actual,pass:actual>=contract.minimum});
  }else if(contract.kind==='difference'){
    const low=luma(sample(contract.low)),high=luma(sample(contract.high)),actual=high-low;
    results.push({id:contract.id,minimum:contract.minimum,actual,pass:actual>=contract.minimum});
  }else if(contract.kind==='rangeRatio'){
    const low=luma(sample(contract.low)),high=luma(sample(contract.high)),actual=low/Math.max(high,1e-9);
    results.push({id:contract.id,minimum:contract.minimum,maximum:contract.maximum,actual,pass:actual>=contract.minimum&&actual<=contract.maximum});
  }else if(contract.kind==='channelDominance'){
    const value=sample(contract.sample),channel=value[contract.channel],others=value.slice(0,3).filter((_,index)=>index!==contract.channel),actual=channel/Math.max(1e-9,...others);
    results.push({id:contract.id,channel:contract.channel,minimum:contract.minimum,actual,pass:actual>=contract.minimum});
  }else if(contract.kind==='channelGain'){
    const low=sample(contract.low)[contract.channel],high=sample(contract.high)[contract.channel],actual=high/Math.max(low,1e-9);
    results.push({id:contract.id,channel:contract.channel,minimum:contract.minimum,actual,pass:actual>=contract.minimum});
  }else if(contract.kind==='channelDifference'){
    const low=sample(contract.low)[contract.channel],high=sample(contract.high)[contract.channel],actual=high-low;
    results.push({id:contract.id,channel:contract.channel,minimum:contract.minimum,actual,pass:actual>=contract.minimum});
  }else{
    throw new Error('Unknown oracle contract '+contract.kind);
  }
}

const failed=results.filter(result=>!result.pass);
console.log(JSON.stringify({
  version:2,
  resolution:[oracle.width,oracle.height],
  pixels:oracle.points.map((point,index)=>({
    id:point.id,stage:point.stage??'hdr',world:point.world,pixel:pixels[index],rgba:sample(point.id),
  })),
  contracts:results,
  failed:failed.map(result=>result.id),
},null,2));
if(failed.length)process.exitCode=1;
