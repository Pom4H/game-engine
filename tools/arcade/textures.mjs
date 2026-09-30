// Deterministic authored PBR maps. No generated photographs, downloads, npm
// graphics dependencies or reference-image projection enter the renderer.
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const N=1024;
const clamp=(v)=>Math.min(1,Math.max(0,v));
const hash=(x,y,seed=0)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(seed,1442695041);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;};
const wrap=(x,p)=>((x%p)+p)%p;
function noise(x,y,period=256,seed=0){
 const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
 const sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty);
 const h=(a,b)=>hash(wrap(a,period),wrap(b,period),seed);
 const a=h(ix,iy)*(1-sx)+h(ix+1,iy)*sx,b=h(ix,iy+1)*(1-sx)+h(ix+1,iy+1)*sx;
 return a*(1-sy)+b*sy;
}
const fractal=(u,v,seed)=>noise(u*4,v*4,4,seed)*.42+noise(u*16,v*16,16,seed+1)*.26+noise(u*64,v*64,64,seed+2)*.18+noise(u*256,v*256,256,seed+3)*.14;
function sample(kind,u,v,x,y){
 const f=fractal(u,v,11),g=hash(x,y,22),broad=noise(u*8,v*8,8,30);
 if(kind==='wood'){
  const warp=fractal(u,v,41)*3+noise(u*16,v*16,16,5)*.6;
  const grain=.5+.5*Math.sin(u*Math.PI*128+warp*5);
  const crack=Math.pow(Math.max(0,grain-.82)*5.55,3)*.10;
  const value=.40+.28*f+.12*grain-.20*Math.max(0,.45-broad)-crack;
  return[value*1.05,value*.89,value*.73,.25*f+.05*grain-crack,.70+.22*g,0];
 }
 if(kind==='snow'){
  const grain=(g-.5)*.07,crust=noise(u*40,v*40,40,73),value=.78+.17*f+.03*g;
  return[value*.97,value*.99,value,.15*f+.038*crust+grain,.86+.12*g,0];
 }
 if(kind==='stone'){
  const pits=Math.max(0,.20-g)*.65,value=.50+.28*f-pits;
  return[value*1.01,value,value*.94,.4*f+.045*g-pits,.76+.20*g,0];
 }
 if(kind==='lace'){
  const a=Math.cos(u*Math.PI*32),b=Math.cos(v*Math.PI*32),flower=Math.pow(Math.abs(a*b),3);
  const threads=Math.max(Math.cos(u*Math.PI*256),Math.cos(v*Math.PI*256)),value=.50+.29*flower+.08*threads+.025*g;
  return[value,value*.97,value*.9,flower*.05+threads*.008,.92,0];
 }
 const hairline=Math.exp(-Math.abs(Math.sin(u*Math.PI*22+noise(u*8,v*8,8,81)*5+v*Math.PI*14))*70)*.07;
 const pits=Math.max(0,.12-g)*1.5,stain=Math.max(0,.40-broad)*.55,value=.55+.30*f-stain-hairline-pits;
 return[value*1.01,value*.97,value*.91,.40*f+.035*g-hairline-pits,.87+.11*g,0];
}
async function png(path,rgb){
 const ppm=path+'.ppm';await writeFile(ppm,Buffer.concat([Buffer.from(`P6\n${N} ${N}\n255\n`),rgb]));
 const r=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',ppm,'-frames:v','1',path],{encoding:'utf8',windowsHide:true});
 if(r.error||r.status!==0)throw r.error??new Error(r.stderr);
 await rm(ppm);
}
export async function prepareArcadeTextures(){
 const root='tools/arcade/assets';await mkdir(root,{recursive:true});
 for(const kind of ['plaster','wood','stone','snow','lace']){
  const albedo=Buffer.alloc(N*N*3),normal=Buffer.alloc(N*N*3),orm=Buffer.alloc(N*N*3),height=new Float32Array(N*N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   const i=y*N+x,j=i*3,s=sample(kind,x/N,y/N,x,y);
   for(let c=0;c<3;c++)albedo[j+c]=Math.round(clamp(s[c])*255);
   height[i]=s[3];orm[j]=Math.round((.89+.11*clamp(s[3]))*255);orm[j+1]=Math.round(clamp(s[4])*255);orm[j+2]=Math.round(clamp(s[5])*255);
  }
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   const j=(y*N+x)*3,h=(xx,yy)=>height[wrap(yy,N)*N+wrap(xx,N)];
   const nx=(h(x-1,y)-h(x+1,y))*4,ny=(h(x,y-1)-h(x,y+1))*4,l=Math.hypot(nx,ny,1);
   normal[j]=Math.round((nx/l*.5+.5)*255);normal[j+1]=Math.round((ny/l*.5+.5)*255);normal[j+2]=Math.round((.5/l+.5)*255);
  }
  await png(`${root}/${kind}.png`,albedo);await png(`${root}/${kind}-normal.png`,normal);await png(`${root}/${kind}-orm.png`,orm);
 }
}
