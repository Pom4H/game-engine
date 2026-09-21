import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,basename,join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encodePackedMesh} from '../../../dist/assets/packed-mesh.js';
import {readPng,writePng} from '../../photorealism/io.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const root=resolve(arg('--root',process.env.REALITY_DATA_ROOT??'reality-data/stanford-orb'));
const out=resolve(arg('--out','artifacts/reality/stanford-orb'));
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
const calibration=JSON.parse(await readFile(new URL('./calibration.json',import.meta.url),'utf8'));
await mkdir(out,{recursive:true});

async function walk(dir,result=[]){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const p=join(dir,entry.name);if(entry.isDirectory())await walk(p,result);else result.push(p);
  }
  return result;
}
let allFiles;
async function files(){return allFiles??=await walk(root);}
async function findSuffix(suffix){
  const normalized=suffix.replaceAll('\\','/').toLowerCase(),matches=(await files()).filter(p=>p.replaceAll('\\','/').toLowerCase().endsWith(normalized));
  if(matches.length!==1)throw new Error(`Expected one ${suffix} under ${root}, found ${matches.length}`);
  return matches[0];
}
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};

async function benchmarkPng(source,target,{mask=false}={}){
  const image=await readPng(source),size=manifest.resolution;
  if(image.width===size&&image.height===size){await writePng(target,size,size,image.rgb);return target;}
  if(image.width%size||image.height%size)throw new RangeError(`Stanford image ${source} is ${image.width}x${image.height}; expected an integer downscale to ${size}`);
  const fx=image.width/size,fy=image.height/size,out=new Uint8Array(size*size*3),area=fx*fy;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let r=0,g=0,b=0;
    for(let yy=0;yy<fy;yy++)for(let xx=0;xx<fx;xx++){
      const p=(((y*fy+yy)*image.width)+(x*fx+xx))*3;r+=image.rgb[p];g+=image.rgb[p+1];b+=image.rgb[p+2];
    }
    const q=(y*size+x)*3;
    if(mask){const on=(r/area)>=127.5?255:0;out[q]=on;out[q+1]=on;out[q+2]=on;}
    else{out[q]=Math.round(r/area);out[q+1]=Math.round(g/area);out[q+2]=Math.round(b/area);}
  }
  await writePng(target,size,size,out);return target;
}

function cameraFromFrame(metadata,frame){
  const m=frame.transform_matrix;if(!Array.isArray(m)||m.length!==4)throw new TypeError('Stanford frame transform_matrix missing');
  const position=[m[0][3],m[1][3],m[2][3]],forward=norm([-m[0][2],-m[1][2],-m[2][2]]),up=norm([m[0][1],m[1][1],m[2][1]]),target=add(position,forward);
  const angle=Number(frame.camera_angle_x??metadata.camera_angle_x);if(!Number.isFinite(angle))throw new TypeError('Stanford camera_angle_x missing');
  const width=manifest.resolution,height=manifest.resolution,focal=.5*width/Math.tan(.5*angle);
  const worldToEnvironment=[
    m[0][0],m[1][0],m[2][0],
    m[0][1],m[1][1],m[2][1],
    m[0][2],m[1][2],m[2][2],
  ];
  return{camera:{position,target,up,intrinsics:{fx:focal,fy:focal,cx:width*.5,cy:height*.5,width,height}},worldToEnvironment};
}
function floatToHalf(value){
  if(!Number.isFinite(value))return value<0?0xfc00:0x7c00;
  const f=new Float32Array([value]),x=new Uint32Array(f.buffer)[0],sign=(x>>>16)&0x8000,exp=((x>>>23)&255)-127+15,mantissa=x&0x7fffff;
  if(exp<=0){if(exp<-10)return sign;return sign|((mantissa|0x800000)>>(14-exp));}
  if(exp>=31)return sign|0x7c00;return sign|(exp<<10)|(mantissa>>13);
}
function measuredEnvironment(exr,width=256,height=128){
  const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',exr,'-vf',`scale=${width}:${height}:flags=lanczos`,'-f','rawvideo','-pix_fmt','gbrpf32le','pipe:1'],{encoding:null,maxBuffer:32*1024*1024});
  if(ff.status!==0)throw new Error(`ffmpeg EXR decode failed: ${ff.stderr?.toString()??''}`);
  const floats=new Float32Array(ff.stdout.buffer,ff.stdout.byteOffset,ff.stdout.byteLength/4),plane=width*height;
  if(floats.length!==plane*3)throw new RangeError(`Unexpected ffmpeg radiance size ${floats.length}`);
  const half=Buffer.allocUnsafe(plane*3*2);
  for(let i=0;i<plane;i++){
    // gbrpf32le is planar G, B, R.
    half.writeUInt16LE(floatToHalf(Math.max(0,floats[plane*2+i])),(i*3)*2);
    half.writeUInt16LE(floatToHalf(Math.max(0,floats[i])),(i*3+1)*2);
    half.writeUInt16LE(floatToHalf(Math.max(0,floats[plane+i])),(i*3+2)*2);
  }
  return{width,height,rgb16fBase64:half.toString('base64')};
}
function parseObj(text){
  const sourcePositions=[],sourceNormals=[],positions=[],normals=[],indices=[],map=new Map();
  const index=(raw,count)=>{const n=Number(raw);return n<0?count+n:n-1;};
  for(const line of text.split(/\r?\n/)){
    if(line.startsWith('v ')){const p=line.trim().split(/\s+/).slice(1,4).map(Number);sourcePositions.push(p);continue;}
    if(line.startsWith('vn ')){const n=line.trim().split(/\s+/).slice(1,4).map(Number);sourceNormals.push(n);continue;}
    if(!line.startsWith('f '))continue;
    const tokens=line.trim().split(/\s+/).slice(1);
    for(let tri=1;tri+1<tokens.length;tri++){
      const face=[tokens[0],tokens[tri],tokens[tri+1]],faceIndices=[];
      let generatedNormal=null;
      if(face.some(token=>!(token.split('/')[2]))){
        const ps=face.map(token=>sourcePositions[index(token.split('/')[0],sourcePositions.length)]);
        const a=ps[0],b=ps[1],d=ps[2],u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[d[0]-a[0],d[1]-a[1],d[2]-a[2]];
        generatedNormal=norm([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]);
      }
      for(const token of face){
        const parts=token.split('/'),vi=index(parts[0],sourcePositions.length),ni=parts[2]?index(parts[2],sourceNormals.length):-1,key=generatedNormal?`${token}@${indices.length}`:`${vi}/${ni}`;
        let dst=map.get(key);if(dst===undefined){dst=positions.length/3;map.set(key,dst);positions.push(...sourcePositions[vi]);normals.push(...(generatedNormal??sourceNormals[ni]));}
        faceIndices.push(dst);
      }
      indices.push(...faceIndices);
    }
  }
  if(!positions.length||positions.some(v=>!Number.isFinite(v))||normals.some(v=>!Number.isFinite(v)))throw new TypeError('OBJ did not produce finite triangle geometry');
  return{kind:'triangle-mesh',positions,normals,indices};
}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const linearToSrgb=x=>{x=Math.max(0,Math.min(1,x));return x<=.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-.055;};

function readNpy(buffer){
  if(buffer.subarray(0,6).toString('latin1')!=='\x93NUMPY')throw new TypeError('Invalid NPY magic');
  const major=buffer[6],headerBytes=major===1?2:4,headerOffset=8,headerLength=headerBytes===2?buffer.readUInt16LE(headerOffset):buffer.readUInt32LE(headerOffset),dataOffset=headerOffset+headerBytes+headerLength,header=buffer.subarray(headerOffset+headerBytes,dataOffset).toString('latin1');
  const descr=/['"]descr['"]\s*:\s*['"]([^'"]+)['"]/.exec(header)?.[1],fortran=/['"]fortran_order['"]\s*:\s*(True|False)/.exec(header)?.[1],shapeText=/['"]shape['"]\s*:\s*\(([^)]*)\)/.exec(header)?.[1];
  if(!descr||fortran!=='False'||shapeText===undefined)throw new TypeError('Unsupported NPY header');
  const shape=shapeText.split(',').map(v=>v.trim()).filter(Boolean).map(Number),count=shape.reduce((a,b)=>a*b,1),view=new DataView(buffer.buffer,buffer.byteOffset+dataOffset,buffer.byteLength-dataOffset),data=new Float32Array(count);
  if(descr==='<f4'||descr==='|f4')for(let i=0;i<count;i++)data[i]=view.getFloat32(i*4,true);
  else if(descr==='<f8'||descr==='|f8')for(let i=0;i<count;i++)data[i]=view.getFloat64(i*8,true);
  else if(descr==='|u1'||descr==='<u1')for(let i=0;i<count;i++)data[i]=view.getUint8(i);
  else throw new TypeError(`Unsupported NPY dtype ${descr}`);
  return{shape,data};
}
async function gtNpy(scene,kind,stem){const path=await findSuffix(`ground_truth/${scene}/${kind}/${stem}.npy`);return{path,...readNpy(await readFile(path))};}
function sampleBilinear(data,width,height,channels,x,y,out){
  const x0=Math.max(0,Math.min(width-1,Math.floor(x))),y0=Math.max(0,Math.min(height-1,Math.floor(y))),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),tx=x-x0,ty=y-y0;
  for(let ch=0;ch<channels;ch++){const a=data[(y0*width+x0)*channels+ch]*(1-tx)+data[(y0*width+x1)*channels+ch]*tx,b=data[(y1*width+x0)*channels+ch]*(1-tx)+data[(y1*width+x1)*channels+ch]*tx;out[ch]=a*(1-ty)+b*ty;}
  return out;
}
async function calibrateVertexColors(mesh,_sceneDir,metadata,items){
  const scene=items[0]?.scene;if(!scene)throw new Error('No calibration scene');
  const vertices=mesh.positions.length/3,sums=new Float64Array(vertices*3),weights=new Float64Array(vertices),sample=[0,0,0,0],stats={projected:0,depthAccepted:0,facingAccepted:0};
  for(const item of items){
    const frame=metadata.frames[item.testIndex];if(!frame)throw new RangeError(`Calibration frame ${item.testIndex} is missing`);
    const stem=basename(frame.file_path.replace(/^\.\//,'')),albedo=await gtNpy(scene,'pseudo_gt_albedo',stem),depth=await gtNpy(scene,'z_depth',stem),ah=albedo.shape[0],aw=albedo.shape[1],ac=albedo.shape[2]??1,dh=depth.shape[0],dw=depth.shape[1];
    if(ac<3||ah!==dh||aw!==dw)throw new RangeError(`GT albedo/depth mismatch for ${scene}/${stem}: ${albedo.shape} vs ${depth.shape}`);
    const m=frame.transform_matrix,position=[m[0][3],m[1][3],m[2][3]],right=norm([m[0][0],m[1][0],m[2][0]]),up=norm([m[0][1],m[1][1],m[2][1]]),forward=norm([-m[0][2],-m[1][2],-m[2][2]]),angle=Number(frame.camera_angle_x??metadata.camera_angle_x),fx=.5*aw/Math.tan(.5*angle),fy=fx;
    for(let i=0;i<vertices;i++){
      const p=[mesh.positions[i*3],mesh.positions[i*3+1],mesh.positions[i*3+2]],n=norm([mesh.normals[i*3],mesh.normals[i*3+1],mesh.normals[i*3+2]]),rel=sub(p,position),z=dot(rel,forward);
      if(z<=1e-5)continue;
      const x=fx*dot(rel,right)/z+aw*.5,y=ah*.5-fy*dot(rel,up)/z;if(x<1||y<1||x>=aw-2||y>=ah-2)continue;stats.projected++;
      const gtDepth=sampleBilinear(depth.data,dw,dh,1,x,y,sample)[0];if(!Number.isFinite(gtDepth)||gtDepth<=0||Math.abs(gtDepth-z)>Math.max(.003,.0125*Math.abs(gtDepth)))continue;stats.depthAccepted++;
      const facing=Math.max(0,dot(n,norm(sub(position,p))));if(facing<.08)continue;stats.facingAccepted++;
      sampleBilinear(albedo.data,aw,ah,ac,x,y,sample);const w=facing*facing;
      for(let ch=0;ch<3;ch++)sums[i*3+ch]+=linearToSrgb(sample[ch])*w;weights[i]+=w;
    }
  }
  const colors=new Array(vertices*4),known=new Uint8Array(vertices);let observed=0;
  for(let i=0;i<vertices;i++){if(weights[i]>0){known[i]=1;observed++;for(let ch=0;ch<3;ch++)colors[i*4+ch]=Math.max(0,Math.min(1,sums[i*3+ch]/weights[i]));}colors[i*4+3]=1;}
  const neighbors=Array.from({length:vertices},()=>[]);
  for(let i=0;i<mesh.indices.length;i+=3){const a=mesh.indices[i],b=mesh.indices[i+1],d=mesh.indices[i+2];neighbors[a].push(b,d);neighbors[b].push(a,d);neighbors[d].push(a,b);}
  let filled=observed;
  for(let pass=0;pass<16&&filled<vertices;pass++){const pending=[];for(let i=0;i<vertices;i++)if(!known[i]){let r=0,g=0,b=0,n=0;for(const j of neighbors[i])if(known[j]){r+=colors[j*4];g+=colors[j*4+1];b+=colors[j*4+2];n++;}if(n)pending.push([i,r/n,g/n,b/n]);}if(!pending.length)break;for(const [i,r,g,b] of pending){colors[i*4]=r;colors[i*4+1]=g;colors[i*4+2]=b;known[i]=1;filled++;}}
  let mr=0,mg=0,mb=0,mc=0;for(let i=0;i<vertices;i++)if(known[i]){mr+=colors[i*4];mg+=colors[i*4+1];mb+=colors[i*4+2];mc++;}const fallback=[mr/Math.max(1,mc),mg/Math.max(1,mc),mb/Math.max(1,mc)];
  for(let i=0;i<vertices;i++)if(!known[i]){colors[i*4]=fallback[0];colors[i*4+1]=fallback[1];colors[i*4+2]=fallback[2];}
  console.log(JSON.stringify({phase:'albedo-calibration',source:'pseudo_gt_albedo+z_depth',views:items.map(v=>v.testIndex),coverage:observed/vertices,observed,filled,vertices,meanSrgb:fallback,...stats}));
  return{colors,coverage:observed/vertices,positions:vertices,observed};
}

function sceneModule({meshImport,camera,environment,material,exposure}){
  return `import {defineScene} from '@rom4/game-engine';\nimport mesh from '${meshImport}';\nexport default defineScene(${JSON.stringify({
    version:1,seed:1,gravity:[0,0,0],ground:-100,
    environment:{humidity:.45,temperatureC:20,precipitation:'rare',sunlight:0,wind:[0,0,0],groundMoisture:0,clock:{startHour:12,hoursPerSecond:0}},
    camera,rendering:{sunIntensity:0,skyColor:[0,0,0],fogDensity:0,exposure,environmentRadiance:environment},
    entities:[{id:'stanford-orb-car',mesh:null,material}],
  },null,2).replace('"mesh": null','"mesh": mesh')});\n`;
}

const calibrationScene=manifest.calibration[0]?.scene;
if(!calibrationScene)throw new Error('Stanford-ORB manifest has no calibration scene');

const calibrationTransforms=await findSuffix(`blender_LDR/${calibrationScene}/transforms_test.json`),calibrationSceneDir=dirname(calibrationTransforms),calibrationMetadata=JSON.parse(await readFile(calibrationTransforms,'utf8'));
const meshPath=await findSuffix(`ground_truth/${manifest.calibration[0].scene}/mesh_blender/mesh.obj`);
console.log(JSON.stringify({phase:'mesh',path:meshPath}));
const mesh=parseObj(await readFile(meshPath,'utf8')),albedo=await calibrateVertexColors(mesh,calibrationSceneDir,calibrationMetadata,manifest.calibration);
mesh.colors=albedo.colors;
console.log(JSON.stringify({phase:'albedo-calibration',views:manifest.calibration.map(v=>v.testIndex),coverage:albedo.coverage,positions:albedo.positions,observed:albedo.observed}));
const packed=encodePackedMesh(mesh);
await writeFile(join(out,'mesh.mjs'),`import {decodePackedMesh} from '../../../dist/assets/packed-mesh.js';\nexport default decodePackedMesh(${JSON.stringify(packed)});\n`);

const captures=[];
for(const [split,list] of [['calibration',manifest.calibration],['heldOut',manifest.heldOut]]){
  for(const item of list){
    const targetTransforms=await findSuffix(`blender_LDR/${item.scene}/transforms_test.json`),sceneDir=dirname(targetTransforms),metadata=JSON.parse(await readFile(targetTransforms,'utf8')),frame=metadata.frames[item.testIndex],poseSource='test';
    if(!frame)throw new RangeError(`${item.scene} has no test frame ${item.testIndex}`);
    const frameRel=frame.file_path.replace(/^\.\//,''),stem=basename(frameRel),sourceReference=join(sceneDir,frameRel+'.png'),sourceMask=join(sceneDir,dirname(frameRel)+'_mask',stem+'.png');
    await stat(sourceReference);await stat(sourceMask);
    const id=`${item.scene}-test${item.testIndex}`,reference=join(out,id+'-reference.png'),mask=join(out,id+'-mask.png');
    await benchmarkPng(sourceReference,reference);await benchmarkPng(sourceMask,mask,{mask:true});
    const envPath=await findSuffix(`ground_truth/${item.scene}/env_map/${stem}.exr`),{camera,worldToEnvironment}=cameraFromFrame(metadata,frame),radiance=measuredEnvironment(envPath);
    const environment={...radiance,worldToEnvironment,convention:'stanford-orb',intensity:1},scenePath=join(out,id+'.mjs');
    await writeFile(scenePath,sceneModule({meshImport:'./mesh.mjs',camera,environment,material:calibration.material,exposure:calibration.exposure}));
    captures.push({id,split,scene:item.scene,testIndex:item.testIndex,poseSource,scenePath,reference,mask,environment:envPath,sourceReference,sourceMask});
  }
}
await writeFile(join(out,'captures.json'),JSON.stringify({version:1,dataset:manifest.dataset,object:manifest.object,calibration:calibration.frozenFrom,captures},null,2));
console.log(JSON.stringify({phase:'prepared',root,out,captures:captures.map(c=>({id:c.id,split:c.split,reference:relative(root,c.reference)}))}));
