import {deflateSync} from 'node:zlib';
import {compose,lookAt,multiply4,V3,type Mat4, type Vec3} from '../math.js';
import {primitiveMesh,type MeshData} from '../procedural/mesh.js';
import type {CameraSpec,Color} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Renderer,RenderStats,LinearPixelSample} from './types.js';

type ProjectedVertex={x:number;y:number;z:number;invW:number;world:Vec3;normal:Vec3;color:Color};
type Light={position:Vec3;color:Vec3;intensity:number;range:number};

const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const rgb=(v:number)=>Math.round(clamp(v)*255);
const mul3=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
const add3=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const transformPoint=(m:Mat4,p:Vec3):[number,number,number,number]=>[
 m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
 m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
 m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
 m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!,
];
const transformNormal=(m:Mat4,n:Vec3,s:Vec3):Vec3=>V3.normalize([
 m[0]!*(n[0]/Math.max(s[0],1e-6))+m[4]!*(n[1]/Math.max(s[1],1e-6))+m[8]!*(n[2]/Math.max(s[2],1e-6)),
 m[1]!*(n[0]/Math.max(s[0],1e-6))+m[5]!*(n[1]/Math.max(s[1],1e-6))+m[9]!*(n[2]/Math.max(s[2],1e-6)),
 m[2]!*(n[0]/Math.max(s[0],1e-6))+m[6]!*(n[1]/Math.max(s[1],1e-6))+m[10]!*(n[2]/Math.max(s[2],1e-6)),
]);

function srgb(v:number):number{const x=clamp(v);return x<=.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-.055;}
function hash(x:number,y:number):number{let n=Math.imul(x^Math.imul(y,374761393),668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}

export interface CpuRendererOptions{width?:number;height?:number;near?:number;far?:number;supersample?:number}
export class CpuRenderer implements Renderer{
 private width:number;private height:number;private readonly near:number;private readonly far:number;
 private rgba:Uint8Array;private depth:Float32Array;private errors:string[]=[];private drawCalls=0;private triangles=0;private meshes=0;private pointLights=0;
 constructor(options:CpuRendererOptions={}){this.width=options.width??640;this.height=options.height??360;this.near=options.near??.05;this.far=options.far??10000;this.rgba=new Uint8Array(this.width*this.height*4);this.depth=new Float32Array(this.width*this.height);this.resize();}
 setResolution(width:number,height:number):void{if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw new RangeError('Render dimensions must be integers in [1,4096]');this.width=width;this.height=height;this.rgba=new Uint8Array(width*height*4);this.depth=new Float32Array(width*height);}
 resize():void{this.depth.fill(1);for(let i=0;i<this.rgba.length;i+=4){this.rgba[i]=0;this.rgba[i+1]=0;this.rgba[i+2]=0;this.rgba[i+3]=255;}}
 render(scene:Scene,camera:CameraSpec=scene.camera):void{
  this.errors=[];this.drawCalls=0;this.triangles=0;this.meshes=0;
  const clear=scene.spec.clearColor??[0,0,0,1],env=scene.spec.rendering??{};
  const sky=env.skyColor??[.12,.16,.22];this.depth.fill(1);
  for(let y=0;y<this.height;y++){const t=y/Math.max(1,this.height-1),c=add3(mul3(sky,.72+.28*(1-t)),mul3([.04,.05,.07],t));for(let x=0;x<this.width;x++){const i=(y*this.width+x)*4;this.rgba[i]=rgb(c[0]);this.rgba[i+1]=rgb(c[1]);this.rgba[i+2]=rgb(c[2]);this.rgba[i+3]=rgb(clear[3]);}}
  const view=lookAt(camera.position,camera.target,camera.up??[0,1,0]);
  const aspect=this.width/this.height;
  const fov=(camera.fov??55)*Math.PI/180;
  const f=1/Math.tan(fov/2),nf=1/(this.near-this.far);
  const proj=new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,this.far*nf,-1,0,0,this.near*this.far*nf,0]);
  const vp=multiply4(proj,view);
  const lights:Light[]=[];
  for(const e of scene.entities.values())if(e.light)lights.push({position:[...e.position],color:[...(e.light.color??[1,1,1])],intensity:e.light.intensity??1,range:e.light.range??10});
  this.pointLights=lights.length;
  const sunDir=V3.normalize(env.sunDirection??[-.45,-1,-.3]),sun=V3.normalize([-sunDir[0],-sunDir[1],-sunDir[2]]),sunColor=env.sunColor??[1,.93,.82],sunIntensity=env.sunIntensity??1,exposure=env.exposure??1,fog=env.fogDensity??0;
  for(const entity of scene.entities.values()){
   const primitive=entity.renderMesh??entity.mesh;if(!primitive)continue;
   try{const mesh=primitiveMesh(primitive);this.meshes++;this.drawCalls++;this.triangles+=mesh.indices.length/3;this.rasterMesh(mesh,entity,vp,camera,lights,sun,sunColor,sunIntensity,exposure,fog);}catch(error){this.errors.push(error instanceof Error?error.message:String(error));}
  }
 }
 private rasterMesh(mesh:MeshData,entity:RuntimeEntity,vp:Mat4,camera:CameraSpec,lights:Light[],sun:Vec3,sunColor:Vec3,sunIntensity:number,exposure:number,fog:number):void{
  const model=compose(entity.position,entity.rotation,entity.scale),mv=multiply4(vp,model),v=mesh.vertices,c=mesh.colors;
  const projected=new Array<ProjectedVertex>(v.length/6);
  for(let i=0;i<projected.length;i++){const p=transformPoint(mv,[v[i*6]!,v[i*6+1]!,v[i*6+2]!]);const world=transformPoint(model,[v[i*6]!,v[i*6+1]!,v[i*6+2]!]);const normal=transformNormal(model,[v[i*6+3]!,v[i*6+4]!,v[i*6+5]!],entity.scale);projected[i]={x:((p[0]/p[3])*.5+.5)*(this.width-1),y:(1-(p[1]/p[3])*.5-.5)*(this.height-1),z:p[2]/p[3],invW:1/p[3],world:[world[0],world[1],world[2]],normal,color:[c[i*4]!/255,c[i*4+1]!/255,c[i*4+2]!/255,c[i*4+3]!/255]};}
  const idx=mesh.indices;
  for(let t=0;t<idx.length;t+=3){const a=projected[idx[t]!]!,b=projected[idx[t+1]!]!,d=projected[idx[t+2]!]!;if(a.invW<=0||b.invW<=0||d.invW<=0)continue;this.rasterTriangle(a,b,d,entity,camera,lights,sun,sunColor,sunIntensity,exposure,fog);}
 }
 private rasterTriangle(a:ProjectedVertex,b:ProjectedVertex,c:ProjectedVertex,entity:RuntimeEntity,camera:CameraSpec,lights:Light[],sun:Vec3,sunColor:Vec3,sunIntensity:number,exposure:number,fog:number):void{
  const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(area)<1e-7)return;
  const minX=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),maxX=Math.min(this.width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
  const minY=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),maxY=Math.min(this.height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
  const base=entity.material.color,metal=entity.material.metalness??0,rough=Math.max(.08,entity.material.roughness??.5),coat=clamp(entity.material.clearcoat??0),emissive=entity.material.emissive??[0,0,0];
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const px=x+.5,py=y+.5;const w0=((b.x-px)*(c.y-py)-(b.y-py)*(c.x-px))/area,w1=((c.x-px)*(a.y-py)-(c.y-py)*(a.x-px))/area,w2=1-w0-w1;if(w0<0||w1<0||w2<0)continue;
   const invW=w0*a.invW+w1*b.invW+w2*c.invW,wa=w0*a.invW/invW,wb=w1*b.invW/invW,wc=w2*c.invW/invW;
   const depth=wa*a.z+wb*b.z+wc*c.z;if(depth<0||depth>1)continue;const di=y*this.width+x;if(depth>=this.depth[di]!)continue;this.depth[di]=depth;
   const world:Vec3=[a.world[0]*wa+b.world[0]*wb+c.world[0]*wc,a.world[1]*wa+b.world[1]*wb+c.world[1]*wc,a.world[2]*wa+b.world[2]*wb+c.world[2]*wc];
   const n=V3.normalize([a.normal[0]*wa+b.normal[0]*wb+c.normal[0]*wc,a.normal[1]*wa+b.normal[1]*wb+c.normal[1]*wc,a.normal[2]*wa+b.normal[2]*wb+c.normal[2]*wc]);
   const vertex:[number,number,number]=[a.color[0]*wa+b.color[0]*wb+c.color[0]*wc,a.color[1]*wa+b.color[1]*wb+c.color[1]*wc,a.color[2]*wa+b.color[2]*wb+c.color[2]*wc];
   const albedo:Vec3=[base[0]*vertex[0],base[1]*vertex[1],base[2]*vertex[2]],viewDir=V3.normalize(V3.sub(camera.position,world));
   let color:Vec3=mul3(albedo,.035*(1-metal));
   const ndl=Math.max(0,V3.dot(n,sun));const h=V3.normalize(V3.add(sun,viewDir));const spec=Math.pow(Math.max(0,V3.dot(n,h)),Math.max(2,2+(1-rough)*120));
   color=add3(color,add3(mul3(albedo,ndl*sunIntensity*(1-metal)),mul3(sunColor,spec*(.04+metal*.96)*sunIntensity)));
   for(const light of lights){const delta=V3.sub(light.position,world),dist=V3.length(delta);if(dist>=light.range)continue;const l=mul3(delta,1/Math.max(dist,1e-6)),ln=Math.max(0,V3.dot(n,l)),atten=Math.pow(Math.max(0,1-dist/light.range),2)/(1+dist*dist*.18),lh=V3.normalize(V3.add(l,viewDir)),ls=Math.pow(Math.max(0,V3.dot(n,lh)),Math.max(2,2+(1-rough)*100));color=add3(color,mul3([albedo[0]*light.color[0],albedo[1]*light.color[1],albedo[2]*light.color[2]],ln*light.intensity*atten*(1-metal)));color=add3(color,mul3(light.color,ls*light.intensity*atten*(.03+metal*.9)));}
   color=add3(color,emissive);const distance=V3.length(V3.sub(camera.position,world));if(fog>0){const f=Math.exp(-fog*distance);const fogColor:Vec3=[.12,.15,.19];color=add3(mul3(color,f),mul3(fogColor,1-f));}
   color=mul3(color,exposure);const i=di*4;this.rgba[i]=rgb(srgb(color[0]/(1+Math.max(0,color[0]))));this.rgba[i+1]=rgb(srgb(color[1]/(1+Math.max(0,color[1]))));this.rgba[i+2]=rgb(srgb(color[2]/(1+Math.max(0,color[2]))));this.rgba[i+3]=255;
  }
 }
 async sampleLinearPixels(points:readonly (readonly [number,number])[]):Promise<readonly LinearPixelSample[]>{return points.map(([x,y])=>{const px=clamp(Math.round(x),0,this.width-1),py=clamp(Math.round(y),0,this.height-1),i=(py*this.width+px)*4;return{x:px,y:py,rgba:[this.rgba[i]!/255,this.rgba[i+1]!/255,this.rgba[i+2]!/255,this.rgba[i+3]!/255] as const};});}
 inspect():RenderStats{return{backend:'cpu',width:this.width,height:this.height,drawCalls:this.drawCalls,triangles:this.triangles,meshes:this.meshes,objects:this.drawCalls,errors:this.errors,pointLights:this.pointLights};}
 profile(){return undefined;}resetProfile():void{}async prepareMaterials():Promise<void>{}async flush():Promise<void>{}dispose():void{}
 framebuffer():Uint8Array{return this.rgba.slice();}
}

function chunk(type:string,data:Uint8Array):Buffer{const t=Buffer.from(type),payload=Buffer.concat([t,Buffer.from(data)]),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);payload.copy(out,4);out.writeUInt32BE(crc32(payload),8+data.length);return out;}
function crc32(data:Uint8Array):number{let crc=0xffffffff;for(const byte of data){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
export function encodePng(rgba:Uint8Array,width:number,height:number):Uint8Array{const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++){scan[y*(width*4+1)]=0;Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(scan,y*(width*4+1)+1);}const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan,{level:6})),chunk('IEND',new Uint8Array())]);}
