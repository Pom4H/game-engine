import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodePackedMesh} from '../../../dist/assets/packed-mesh.js';
import {readPng} from '../../photorealism/io.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const dir=resolve(arg('--dir','artifacts/reality/stanford-orb'));
const manifest=JSON.parse(await readFile(join(dir,'captures.json'),'utf8'));
if(manifest.calibrationMode!=='inverse-render')process.exit(0);

const mesh=(await import(pathToFileURL(join(dir,'mesh-white.mjs')).href)).default;
const vertices=mesh.positions.length/3;
const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l];};
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const clamp01=x=>Math.max(0,Math.min(1,x));

function srgbToLinear(x){
  x=clamp01(x);
  return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);
}
function inverseAces(y){
  y=clamp01(y);
  if(y<=0)return 0;
  if(y>=.999999)return 16;
  const a=2.51,b=.03,c=2.43,d=.59,e=.14,A=y*c-a,B=y*d-b,C=y*e,disc=Math.max(0,B*B-4*A*C),s=Math.sqrt(disc),den=2*A;
  if(Math.abs(den)<1e-9)return Math.max(0,-C/B);
  const r0=(-B-s)/den,r1=(-B+s)/den,candidates=[r0,r1].filter(v=>Number.isFinite(v)&&v>=0);
  return candidates.length?Math.min(...candidates):0;
}
const displayToPreExposure=x=>inverseAces(srgbToLinear(x));

function sampleRgb(image,x,y,out){
  const x0=Math.max(0,Math.min(image.width-1,Math.floor(x))),y0=Math.max(0,Math.min(image.height-1,Math.floor(y))),x1=Math.min(image.width-1,x0+1),y1=Math.min(image.height-1,y0+1),tx=x-x0,ty=y-y0;
  for(let ch=0;ch<3;ch++){
    const a=image.rgb[(y0*image.width+x0)*3+ch]*(1-tx)+image.rgb[(y0*image.width+x1)*3+ch]*tx;
    const b=image.rgb[(y1*image.width+x0)*3+ch]*(1-tx)+image.rgb[(y1*image.width+x1)*3+ch]*tx;
    out[ch]=(a*(1-ty)+b*ty)/255;
  }
  return out;
}
function maskInside(mask,x,y){
  const xi=Math.round(x),yi=Math.round(y);
  if(xi<3||yi<3||xi>=mask.width-3||yi>=mask.height-3)return false;
  for(const [dx,dy] of [[0,0],[-2,0],[2,0],[0,-2],[0,2]])if(mask.rgb[((yi+dy)*mask.width+(xi+dx))*3]<128)return false;
  return true;
}
function projectedMesh(camera,width,height){
  const position=camera.position,forward=norm(sub(camera.target,position)),up=norm(camera.up??[0,1,0]),right=norm(cross(forward,up)),fx=camera.intrinsics.fx,fy=camera.intrinsics.fy,cx=camera.intrinsics.cx,cy=camera.intrinsics.cy,x=new Float32Array(vertices),y=new Float32Array(vertices),z=new Float32Array(vertices);
  for(let i=0;i<vertices;i++){
    const rel=[mesh.positions[i*3]-position[0],mesh.positions[i*3+1]-position[1],mesh.positions[i*3+2]-position[2]],depth=dot(rel,forward);
    z[i]=depth;x[i]=fx*dot(rel,right)/Math.max(depth,1e-9)+cx;y[i]=cy-fy*dot(rel,up)/Math.max(depth,1e-9);
  }
  return{position,forward,up,right,x,y,z};
}
function rasterDepth(projected,width,height){
  const depth=new Float32Array(width*height);depth.fill(Infinity);
  const edge=(ax,ay,bx,by,px,py)=>(px-ax)*(by-ay)-(py-ay)*(bx-ax);
  for(let t=0;t<mesh.indices.length;t+=3){
    const ia=mesh.indices[t],ib=mesh.indices[t+1],ic=mesh.indices[t+2],za=projected.z[ia],zb=projected.z[ib],zc=projected.z[ic];
    if(!(za>1e-6&&zb>1e-6&&zc>1e-6))continue;
    const ax=projected.x[ia],ay=projected.y[ia],bx=projected.x[ib],by=projected.y[ib],cx=projected.x[ic],cy=projected.y[ic],area=edge(ax,ay,bx,by,cx,cy);
    if(Math.abs(area)<1e-8)continue;
    const minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx))),minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)));
    if(minX>maxX||minY>maxY)continue;
    const positive=area>0,epsilon=Math.abs(area)*1e-6;
    for(let py=minY;py<=maxY;py++)for(let px=minX;px<=maxX;px++){
      const sx=px+.5,sy=py+.5,w0=edge(bx,by,cx,cy,sx,sy),w1=edge(cx,cy,ax,ay,sx,sy),w2=edge(ax,ay,bx,by,sx,sy);
      if(positive?(w0 < -epsilon||w1 < -epsilon||w2 < -epsilon):(w0 > epsilon||w1 > epsilon||w2 > epsilon))continue;
      const inv=1/area,d=(w0*za+w1*zb+w2*zc)*inv,index=py*width+px;
      if(d>0&&d<depth[index])depth[index]=d;
    }
  }
  return depth;
}
function visibleAt(projected,depth,width,height,index){
  const x=projected.x[index],y=projected.y[index],z=projected.z[index],xi=Math.floor(x),yi=Math.floor(y);let closest=Infinity;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const px=xi+dx,py=yi+dy;if(px<0||py<0||px>=width||py>=height)continue;const d=depth[py*width+px];if(Number.isFinite(d))closest=Math.min(closest,Math.abs(d-z));}
  return closest<=Math.max(.003,.012*Math.abs(z));
}

const samples=Array.from({length:vertices},()=>[]);
const tmpT=[0,0,0],tmpW=[0,0,0],tmpB=[0,0,0];
for(const capture of manifest.captures.filter(c=>c.split==='calibration')){
  if(!capture.inverseBasis)throw new Error(`Calibration capture ${capture.id} has no inverse basis`);
  const captureDir=join(dir,capture.id),target=await readPng(capture.reference),mask=await readPng(capture.mask),white=await readPng(join(captureDir,'basis-white.png')),black=await readPng(join(captureDir,'basis-black.png'));
  const camera=capture.camera,projected=projectedMesh(camera,target.width,target.height),position=projected.position,depthBuffer=rasterDepth(projected,target.width,target.height);
  let accepted=0,occluded=0;
  for(let i=0;i<vertices;i++){
    const z=projected.z[i];if(z<=1e-5)continue;
    const x=projected.x[i],y=projected.y[i];if(!maskInside(mask,x,y))continue;
    if(!visibleAt(projected,depthBuffer,target.width,target.height,i)){occluded++;continue;}
    const p=[mesh.positions[i*3],mesh.positions[i*3+1],mesh.positions[i*3+2]],n=norm([mesh.normals[i*3],mesh.normals[i*3+1],mesh.normals[i*3+2]]);
    const facing=Math.max(0,dot(n,norm(sub(position,p))));if(facing<.08)continue;
    sampleRgb(target,x,y,tmpT);sampleRgb(white,x,y,tmpW);sampleRgb(black,x,y,tmpB);
    const solved=[0,0,0];let valid=0,span=0;
    for(let ch=0;ch<3;ch++){
      const t=displayToPreExposure(tmpT[ch]),w=displayToPreExposure(tmpW[ch]),b=displayToPreExposure(tmpB[ch]),den=w-b;
      if(!(den>.012)||!Number.isFinite(t)||!Number.isFinite(w)||!Number.isFinite(b)){solved[ch]=.5;continue;}
      solved[ch]=Math.pow(clamp01((t-b)/den),1/2.2);span+=den;valid++;
    }
    if(valid<2)continue;
    const weight=facing*facing*Math.max(.01,span/valid);
    samples[i].push({rgb:solved,weight});accepted++;
  }
  console.log(JSON.stringify({phase:'inverse-albedo-view',capture:capture.id,accepted,occluded}));
}

const colors=new Array(vertices*4),known=new Uint8Array(vertices);let observed=0;
for(let i=0;i<vertices;i++){
  const list=samples[i];
  if(list.length){
    list.sort((a,b)=>b.weight-a.weight);const best=list[0];known[i]=1;observed++;
    colors[i*4]=best.rgb[0];colors[i*4+1]=best.rgb[1];colors[i*4+2]=best.rgb[2];
  }else{colors[i*4]=0;colors[i*4+1]=0;colors[i*4+2]=0;}
  colors[i*4+3]=1;
}
const neighbors=Array.from({length:vertices},()=>[]);
for(let i=0;i<mesh.indices.length;i+=3){const a=mesh.indices[i],b=mesh.indices[i+1],c=mesh.indices[i+2];neighbors[a].push(b,c);neighbors[b].push(a,c);neighbors[c].push(a,b);}
let filled=observed;
for(let pass=0;pass<24&&filled<vertices;pass++){
  const pending=[];
  for(let i=0;i<vertices;i++)if(!known[i]){
    let r=0,g=0,b=0,n=0;
    for(const j of neighbors[i])if(known[j]){r+=colors[j*4];g+=colors[j*4+1];b+=colors[j*4+2];n++;}
    if(n)pending.push([i,r/n,g/n,b/n]);
  }
  if(!pending.length)break;
  for(const [i,r,g,b] of pending){colors[i*4]=r;colors[i*4+1]=g;colors[i*4+2]=b;known[i]=1;filled++;}
}
let mr=0,mg=0,mb=0,mc=0;
for(let i=0;i<vertices;i++)if(known[i]){mr+=colors[i*4];mg+=colors[i*4+1];mb+=colors[i*4+2];mc++;}
const fallback=[mr/Math.max(1,mc),mg/Math.max(1,mc),mb/Math.max(1,mc)];
for(let i=0;i<vertices;i++)if(!known[i]){colors[i*4]=fallback[0];colors[i*4+1]=fallback[1];colors[i*4+2]=fallback[2];}

const packed=encodePackedMesh({...mesh,colors});
await writeFile(join(dir,'mesh.mjs'),`import {decodePackedMesh} from '../../../dist/assets/packed-mesh.js';\nexport default decodePackedMesh(${JSON.stringify(packed)});\n`);
console.log(JSON.stringify({phase:'inverse-albedo-complete',observed,filled,vertices,coverage:observed/vertices,meanSrgb:fallback}));
