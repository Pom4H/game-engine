import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,basename,join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encodePackedMesh} from '../../../dist/assets/packed-mesh.js';

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
function sceneModule({meshImport,camera,environment,material,exposure}){
  return `import {defineScene} from '@rom4/game-engine';\nimport mesh from '${meshImport}';\nexport default defineScene(${JSON.stringify({
    version:1,seed:1,gravity:[0,0,0],ground:-100,
    environment:{humidity:.45,temperatureC:20,precipitation:'rare',sunlight:0,wind:[0,0,0],groundMoisture:0,clock:{startHour:12,hoursPerSecond:0}},
    camera,rendering:{sunIntensity:0,skyColor:[0,0,0],fogDensity:0,exposure,environmentRadiance:environment},
    entities:[{id:'stanford-orb-car',mesh:null,material}],
  },null,2).replace('"mesh": null','"mesh": mesh')});\n`;
}

const meshPath=await findSuffix(`ground_truth/${manifest.calibration[0].scene}/mesh_blender/mesh.obj`);
console.log(JSON.stringify({phase:'mesh',path:meshPath}));
const mesh=parseObj(await readFile(meshPath,'utf8')),packed=encodePackedMesh(mesh);
await writeFile(join(out,'mesh.mjs'),`import {decodePackedMesh} from '../../../dist/assets/packed-mesh.js';\nexport default decodePackedMesh(${JSON.stringify(packed)});\n`);

const captures=[];
for(const [split,list] of [['calibration',manifest.calibration],['heldOut',manifest.heldOut]]){
  for(const item of list){
    const transforms=await findSuffix(`blender_LDR/${item.scene}/transforms_test.json`),sceneDir=dirname(transforms),metadata=JSON.parse(await readFile(transforms,'utf8')),frame=metadata.frames[item.testIndex];
    if(!frame)throw new RangeError(`${item.scene} has no test frame ${item.testIndex}`);
    const frameRel=frame.file_path.replace(/^\.\//,''),stem=basename(frameRel),reference=join(sceneDir,frameRel+'.png'),mask=join(sceneDir,dirname(frameRel)+'_mask',stem+'.png');
    await stat(reference);await stat(mask);
    const envPath=await findSuffix(`ground_truth/${item.scene}/env_map/${stem}.exr`),{camera,worldToEnvironment}=cameraFromFrame(metadata,frame),radiance=measuredEnvironment(envPath);
    const environment={...radiance,worldToEnvironment,convention:'stanford-orb',intensity:1},id=`${item.scene}-test${item.testIndex}`,scenePath=join(out,id+'.mjs');
    await writeFile(scenePath,sceneModule({meshImport:'./mesh.mjs',camera,environment,material:calibration.material,exposure:calibration.exposure}));
    captures.push({id,split,scene:item.scene,testIndex:item.testIndex,scenePath,reference,mask,environment:envPath});
  }
}
await writeFile(join(out,'captures.json'),JSON.stringify({version:1,dataset:manifest.dataset,object:manifest.object,calibration:calibration.frozenFrom,captures},null,2));
console.log(JSON.stringify({phase:'prepared',root,out,captures:captures.map(c=>({id:c.id,split:c.split,reference:relative(root,c.reference)}))}));
