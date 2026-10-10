export function imageFeatures(rgb,width,height){
  if(width<1||height<1||rgb.length!==width*height*3)throw new RangeError('Invalid RGB frame');
  const lum=new Float32Array(width*height);let mean=0,sumsq=0,black=0,white=0,edges=0,n=0;
  for(let i=0;i<lum.length;i++){
    const p=3*i,v=(.2126*rgb[p]+.7152*rgb[p+1]+.0722*rgb[p+2])/255;
    lum[i]=v;mean+=v;sumsq+=v*v;if(v<.01)black++;if(v>.99)white++;
  }
  mean/=lum.length;
  for(let y=1;y<height;y++)for(let x=1;x<width;x++){const p=y*width+x;edges+=Math.abs(lum[p]-lum[p-1])+Math.abs(lum[p]-lum[p-width]);n+=2;}
  return {width,height,lumaMean:mean,lumaStdDev:Math.sqrt(Math.max(0,sumsq/lum.length-mean*mean)),
    meanEdge:edges/Math.max(1,n),blackFraction:black/lum.length,whiteFraction:white/lum.length};
}

export function compareImages(a,b,width,height){
  if(a.length!==b.length||a.length!==width*height*3)throw new RangeError('Mismatched reference dimensions');
  const gray=rgb=>{const out=new Float32Array(width*height);for(let i=0;i<out.length;i++)out[i]=(.2126*rgb[i*3]+.7152*rgb[i*3+1]+.0722*rgb[i*3+2])/255;return out;};
  const x=gray(a),y=gray(b);let similarity=0,blocks=0,mae=0;
  for(let i=0;i<x.length;i++)mae+=Math.abs(x[i]-y[i]);
  for(let by=0;by<height;by+=8)for(let bx=0;bx<width;bx+=8){
    let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
    for(let j=by;j<Math.min(height,by+8);j++)for(let i=bx;i<Math.min(width,bx+8);i++){
      const k=j*width+i,a=x[k],b=y[k];n++;sx+=a;sy+=b;sxx+=a*a;syy+=b*b;sxy+=a*b;
    }
    const ax=sx/n,ay=sy/n,vx=Math.max(0,sxx/n-ax*ax),vy=Math.max(0,syy/n-ay*ay),cov=sxy/n-ax*ay;
    similarity+=((2*ax*ay+0.0001)*(2*cov+0.0009))/((ax*ax+ay*ay+0.0001)*(vx+vy+0.0009));
    blocks++;
  }
  return {ssim:similarity/blocks,meanAbsoluteLumaError:mae/x.length};
}

export function decodeWav(bytes){
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('Invalid WAVE');
  let f=null,data=null;
  for(let i=12;i+8<=bytes.length;){
    const name=bytes.toString('ascii',i,i+4),size=bytes.readUInt32LE(i+4),at=i+8;
    if(at+size>bytes.length)throw new Error('Truncated WAVE chunk');
    if(name==='fmt ')f={tag:bytes.readUInt16LE(at),channels:bytes.readUInt16LE(at+2),rate:bytes.readUInt32LE(at+4),bits:bytes.readUInt16LE(at+14)};
    if(name==='data')data=bytes.subarray(at,at+size);
    i=at+size+(size&1);
  }
  if(!f||!data||!f.channels||!f.rate||!([16,24,32].includes(f.bits))||!(f.tag===1||f.tag===3&&f.bits===32))throw new Error('Unsupported WAVE format');
  const bps=f.bits/8,stride=bps*f.channels;
  if(data.length===0||data.length%stride)throw new Error('Misaligned or empty WAVE');
  const frames=data.length/stride,channels=Array.from({length:f.channels},()=>new Float32Array(frames));
  for(let i=0;i<frames;i++)for(let c=0;c<f.channels;c++){
    const at=i*stride+c*bps;
    let v=f.tag===3?data.readFloatLE(at):f.bits===16?data.readInt16LE(at)/32768:
      f.bits===24?((data.readUIntLE(at,3)^0x800000)-0x800000)/8388608:data.readInt32LE(at)/2147483648;
    if(!Number.isFinite(v))throw new Error('Nonfinite PCM');channels[c][i]=v;
  }
  return {channels,sampleRate:f.rate,durationSeconds:frames/f.rate};
}

export function audioFeatures(wav){
  let peak=0,clipped=0,total=0;
  const channels=wav.channels.map(data=>{
    let e=0,dc=0,derivative=0,crossings=0,previous=0;
    for(let i=0;i<data.length;i++){
      const v=data[i];e+=v*v;dc+=v;peak=Math.max(peak,Math.abs(v));
      if(Math.abs(v)>=.999)clipped++;total++;
      if(i){derivative+=(v-previous)**2;if(v*previous<0)crossings++;}previous=v;
    }
    return {rms:Math.sqrt(e/data.length),dc:dc/data.length,
      differentialRms:Math.sqrt(derivative/Math.max(1,data.length-1)),
      zeroCrossings:crossings/Math.max(1,data.length-1)};
  });
  return {channels,sampleRate:wav.sampleRate,durationSeconds:wav.durationSeconds,peak,clippedFraction:clipped/total};
}

export function checkRange(name,value,limit,direction='max'){
  return {name,passed:Number.isFinite(value)&&(direction==='min'?value>=limit:value<=limit),actual:value,limit};
}

export function verifyGpuProfile(report,profile){
  const checks=[],add=(n,v,l,d)=>checks.push(checkRange(n,v,l,d));
  checks.push({name:'resolution unchanged',passed:JSON.stringify(report.resolution)===JSON.stringify(profile.resolution),actual:report.resolution,limit:profile.resolution});
  add('sample frames',report.requestedFrames,profile.minFrames,'min');
  add('real GPU samples',report.gpu?.samples,profile.minGpuFrames,'min');
  add('frame interval p95',report.frameInterval?.p95Ms,profile.maxFrameIntervalP95Ms);
  add('CPU frame p95',report.frameCpu?.p95Ms,profile.maxCpuFrameP95Ms);
  add('GPU frame p95',report.gpu?.p95Ms,profile.maxGpuP95Ms);
  checks.push({name:'hardware GPU timestamps',passed:report.timestampQueries===true,actual:report.timestampQueries,limit:true});
  const adapter=JSON.stringify(report.adapter??{}).toLowerCase();
  checks.push({name:'hardware adapter',passed:adapter.length>2&&!/swiftshader|lavapipe|llvmpipe|software adapter/.test(adapter),actual:report.adapter});
  if(profile.adapterVendor)checks.push({name:'named GPU vendor',passed:report.adapter?.vendor?.toLowerCase()===profile.adapterVendor.toLowerCase(),actual:report.adapter?.vendor,limit:profile.adapterVendor});
  if(profile.adapterArchitecture)checks.push({name:'named GPU architecture',passed:report.adapter?.architecture?.toLowerCase()===profile.adapterArchitecture.toLowerCase(),actual:report.adapter?.architecture,limit:profile.adapterArchitecture});
  return {passed:checks.every(x=>x.passed),checks,
    gpuHotspots:Object.entries(report.gpuPasses??{}).map(([name,value])=>({name,p95Ms:value?.p95Ms??null})).filter(x=>x.p95Ms!==null).sort((a,b)=>b.p95Ms-a.p95Ms).slice(0,12),
    simulationHotspots:(report.simulationHotspots??[]).slice(0,12)};
}
