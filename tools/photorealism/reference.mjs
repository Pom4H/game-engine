import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import scene,{northStar} from './scene.mjs';
import {writeExr,writePng} from './io.mjs';
import {material as physicalMaterial} from '../../dist/materials/catalog.js';

const PI=Math.PI,EPS=1e-4;
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,b)=>[a[0]*b[0],a[1]*b[1],a[2]*b[2]];
const scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=length(a)||1;return[a[0]/l,a[1]/l,a[2]/l];};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const max3=a=>Math.max(a[0],a[1],a[2]);
const reflect=(d,n)=>sub(d,scale(n,2*dot(d,n)));
const mix3=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const srgbToLinear=x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);
const linearToSrgb=x=>x<=.0031308?12.92*x:1.055*Math.pow(Math.max(0,x),1/2.4)-.055;
const schlick=(f0,cosine)=>f0+(1-f0)*Math.pow(1-clamp(cosine),5);
const schlick3=(f0,cosine)=>f0.map(v=>schlick(v,cosine));
const hashSeed=(a,b,c)=>{let x=(a*73856093)^(b*19349663)^(c*83492791)^0x9e3779b9;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return(x^(x>>>16))>>>0;};
const random=seed=>{let x=seed||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};};

function basis(n){
  const t=norm(Math.abs(n[1])<.999?cross([0,1,0],n):cross([1,0,0],n)),b=cross(n,t);
  return{t,b};
}
function cosineHemisphere(n,rng){
  const u1=rng(),u2=rng(),r=Math.sqrt(u1),phi=2*PI*u2,x=r*Math.cos(phi),y=r*Math.sin(phi),z=Math.sqrt(Math.max(0,1-u1)),{t,b}=basis(n);
  return norm(add(add(scale(t,x),scale(b,y)),scale(n,z)));
}
function powerHemisphere(axis,exponent,rng){
  const u1=rng(),u2=rng(),cosTheta=Math.pow(u1,1/(exponent+1)),sinTheta=Math.sqrt(Math.max(0,1-cosTheta*cosTheta)),phi=2*PI*u2,{t,b}=basis(axis);
  return norm(add(add(scale(t,Math.cos(phi)*sinTheta),scale(b,Math.sin(phi)*sinTheta)),scale(axis,cosTheta)));
}
function refractRay(d,n,eta){
  const cosI=-dot(n,d),sinT2=eta*eta*Math.max(0,1-cosI*cosI);
  if(sinT2>1)return null;
  return norm(add(scale(d,eta),scale(n,eta*cosI-Math.sqrt(1-sinT2))));
}
function resolveMaterial(spec={}){
  const profile=physicalMaterial(spec.kind??'default'),color=spec.color??profile.color;
  return{
    kind:spec.kind??profile.kind,
    base:color.slice(0,3).map(srgbToLinear),
    alpha:color[3]??1,
    roughness:clamp(spec.roughness??profile.optical.roughness,.02,1),
    metalness:clamp(spec.metalness??profile.optical.metalness),
    ior:profile.optical.ior,
    transmission:profile.optical.transmission,
    clearcoat:clamp(spec.clearcoat??(spec.treatment==='painted'?.82:0)),
    clearcoatRoughness:clamp(spec.clearcoatRoughness??.075,.02,1),
    emissive:[...(spec.emissive??[0,0,0])],
  };
}
function buildObjects(){
  const objects=[],lights=[];
  for(const entity of scene.entities){
    if(entity.light){lights.push({position:entity.position??[0,0,0],...entity.light});continue;}
    if(!entity.mesh)continue;
    const position=entity.position??[0,0,0],scaleV=entity.scale??[1,1,1],mesh=entity.mesh,material=resolveMaterial(entity.material);
    if(mesh.kind==='sphere'){
      const radius=(mesh.radius??1)*Math.max(scaleV[0],scaleV[1],scaleV[2]);
      objects.push({id:entity.id,kind:'sphere',center:position,radius,material});
    }else if(mesh.kind==='box'){
      const size=mesh.size??[1,1,1],half=[size[0]*scaleV[0]/2,size[1]*scaleV[1]/2,size[2]*scaleV[2]/2];
      objects.push({id:entity.id,kind:'box',min:[position[0]-half[0],position[1]-half[1],position[2]-half[2]],max:[position[0]+half[0],position[1]+half[1],position[2]+half[2]],material});
    }
  }
  return{objects,lights};
}
const world=buildObjects();

function intersectSphere(ray,o){
  const oc=sub(ray.origin,o.center),b=dot(oc,ray.direction),c=dot(oc,oc)-o.radius*o.radius,h=b*b-c;if(h<0)return null;
  const root=Math.sqrt(h),t0=-b-root,t1=-b+root,t=t0>EPS?t0:t1>EPS?t1:Infinity;if(!Number.isFinite(t))return null;
  const position=add(ray.origin,scale(ray.direction,t)),outward=norm(sub(position,o.center)),front=dot(ray.direction,outward)<0,normal=front?outward:scale(outward,-1);
  return{t,position,normal,outward,front,object:o};
}
function intersectBox(ray,o){
  let near=-Infinity,far=Infinity,nearAxis=0,nearSign=0,farAxis=0,farSign=0;
  for(let axis=0;axis<3;axis++){
    const d=ray.direction[axis],origin=ray.origin[axis],lo=o.min[axis],hi=o.max[axis];
    if(Math.abs(d)<1e-10){if(origin<lo||origin>hi)return null;continue;}
    let a=(lo-origin)/d,b=(hi-origin)/d,sa=-1,sb=1;
    if(a>b){[a,b]=[b,a];[sa,sb]=[sb,sa];}
    if(a>near){near=a;nearAxis=axis;nearSign=sa;}
    if(b<far){far=b;farAxis=axis;farSign=sb;}
    if(near>far||far<EPS)return null;
  }
  const useNear=near>EPS,t=useNear?near:far;if(t<=EPS)return null;
  const normal=[0,0,0];normal[useNear?nearAxis:farAxis]=useNear?nearSign:farSign;
  const position=add(ray.origin,scale(ray.direction,t)),outward=normal,front=dot(ray.direction,outward)<0;
  return{t,position,normal:front?outward:scale(outward,-1),outward,front,object:o};
}
function nearest(ray,maxDistance=Infinity){
  let best=null,bestT=maxDistance;
  for(const object of world.objects){
    const hit=object.kind==='sphere'?intersectSphere(ray,object):intersectBox(ray,object);
    if(hit&&hit.t<bestT){best=hit;bestT=hit.t;}
  }
  return best;
}
const visible=(origin,direction,maxDistance=Infinity)=>!nearest({origin:add(origin,scale(direction,EPS*4)),direction},maxDistance-EPS*8);

const settings=scene.rendering??{},sunDirection=norm(settings.sunDirection??[-.55,.48,-.35]),sunColor=settings.sunColor??[1,.87,.72],sunIntensity=settings.sunIntensity??3,skyColor=settings.skyColor??[.26,.34,.47],exposure=settings.exposure??1;
function environment(direction){
  const up=clamp(direction[1]*.5+.5),horizon=.28+.72*Math.sqrt(up),sky=scale(skyColor,horizon);
  const disk=dot(direction,sunDirection)>Math.cos(.00465)?sunIntensity*22:0;
  return add(sky,scale(sunColor,disk));
}
function ggx(mat,n,v,l){
  const nl=Math.max(0,dot(n,l)),nv=Math.max(.001,dot(n,v));if(nl<=0)return[0,0,0];
  const h=norm(add(v,l)),nh=Math.max(.001,dot(n,h)),vh=Math.max(.001,dot(v,h)),rough=mat.roughness,a2=Math.pow(rough,4),den=nh*nh*(a2-1)+1,d=a2/(PI*den*den),k=Math.pow(rough+1,2)/8,g=(nv/(nv*(1-k)+k))*(nl/(nl*(1-k)+k)),f0=mix3([.04,.04,.04],mat.base,mat.metalness),f=schlick3(f0,vh),spec=scale(f,d*g/Math.max(4*nv*nl,.001)),diff=mul(scale(mat.base,(1-mat.metalness)/PI),f.map(x=>1-x));
  let result=add(diff,spec);
  if(mat.clearcoat>0){
    const r=mat.clearcoatRoughness,ca2=Math.pow(r,4),cden=nh*nh*(ca2-1)+1,cd=ca2/(PI*cden*cden),ck=Math.pow(r+1,2)/8,cg=(nv/(nv*(1-ck)+ck))*(nl/(nl*(1-ck)+ck)),cf=schlick(.04,vh),coat=cd*cg*cf/Math.max(4*nv*nl,.001)*mat.clearcoat;
    result=add(scale(result,1-mat.clearcoat*cf*.2),[coat,coat,coat]);
  }
  return result;
}
function direct(hit,view){
  const n=hit.normal,mat=hit.object.material;let sum=[0,0,0],nl=Math.max(0,dot(n,sunDirection));
  if(nl>0&&visible(hit.position,sunDirection)){
    const brdf=ggx(mat,n,view,sunDirection);sum=add(sum,scale(mul(brdf,scale(sunColor,sunIntensity)),nl));
  }
  for(const light of world.lights){
    const delta=sub(light.position,hit.position),distance=length(delta),range=light.range??12;if(distance>=range||distance<EPS)continue;
    const l=scale(delta,1/distance),cos=Math.max(0,dot(n,l));if(cos<=0||!visible(hit.position,l,distance))continue;
    const falloff=Math.pow(1-distance/range,2),radiance=scale(light.color??[1,.78,.5],(light.intensity??1)*falloff/(4*PI*Math.max(.04,distance*distance))),brdf=ggx(mat,n,view,l);
    sum=add(sum,scale(mul(brdf,radiance),cos));
  }
  return sum;
}
function trace(primary,rng,maxBounces=5){
  let ray=primary,throughput=[1,1,1],radiance=[0,0,0];
  for(let bounce=0;bounce<maxBounces;bounce++){
    const hit=nearest(ray);
    if(!hit){radiance=add(radiance,mul(throughput,environment(ray.direction)));break;}
    const mat=hit.object.material,view=scale(ray.direction,-1);
    radiance=add(radiance,mul(throughput,mat.emissive));
    if(mat.transmission<.5)radiance=add(radiance,mul(throughput,direct(hit,view)));
    let next,weight=[1,1,1];
    if(mat.transmission>.5){
      const etaI=hit.front?1:mat.ior,etaT=hit.front?mat.ior:1,eta=etaI/etaT,cos=Math.max(0,dot(hit.normal,view)),f0=Math.pow((etaI-etaT)/(etaI+etaT),2),f=schlick(f0,cos),refracted=refractRay(ray.direction,hit.normal,eta);
      if(!refracted||rng()<f)next=reflect(ray.direction,hit.normal);
      else{next=refracted;weight=scale([.97,.985,1],mat.transmission);}
    }else{
      const specProbability=clamp(.12+.58*mat.metalness+.16*mat.clearcoat,.12,.9);
      if(rng()<specProbability){
        const perfect=norm(reflect(ray.direction,hit.normal)),exponent=Math.max(1,2/(mat.roughness*mat.roughness)-2);next=powerHemisphere(perfect,exponent,rng);
        if(dot(next,hit.normal)<=0)next=perfect;
        const f0=mix3([.04,.04,.04],mat.base,mat.metalness);weight=scale(f0,1/specProbability);
      }else{
        next=cosineHemisphere(hit.normal,rng);weight=scale(mat.base,(1-mat.metalness)/(1-specProbability));
      }
    }
    throughput=mul(throughput,weight);
    if(bounce>=2){const survive=clamp(max3(throughput),.12,.92);if(rng()>survive)break;throughput=scale(throughput,1/survive);}
    const side=dot(next,hit.normal)>=0?1:-1;ray={origin:add(hit.position,scale(hit.normal,EPS*4*side)),direction:norm(next)};
  }
  return radiance;
}

function cameraRay(x,y,width,height,rng){
  const camera=scene.camera??northStar.camera,forward=norm(sub(camera.target,camera.position)),right=norm(cross(forward,[0,1,0])),up=norm(cross(right,forward)),aspect=width/height,tan=Math.tan((camera.fov??55)*PI/360),jx=rng(),jy=rng(),sx=((x+jx)/width*2-1)*aspect*tan,sy=(1-(y+jy)/height*2)*tan;
  return{origin:camera.position,direction:norm(add(forward,add(scale(right,sx),scale(up,sy))))};
}
export function renderReference(width,height,spp){
  const linear=new Float32Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let sum=[0,0,0];
    for(let sample=0;sample<spp;sample++){const rng=random(hashSeed(x,y,sample+1)),value=trace(cameraRay(x,y,width,height,rng),rng);sum=add(sum,value);}
    const p=(y*width+x)*3;linear[p]=sum[0]/spp;linear[p+1]=sum[1]/spp;linear[p+2]=sum[2]/spp;
  }
  return linear;
}
const aces=x=>clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14));
export function displayTransform(linear,width,height){
  const out=new Uint8Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=(y*width+x)*3,center=[linear[index],linear[index+1],linear[index+2]],neighbour=[0,0,0];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=Math.max(0,Math.min(width-1,x+dx)),yy=Math.max(0,Math.min(height-1,y+dy)),p=(yy*width+xx)*3;neighbour[0]+=linear[p]*.25;neighbour[1]+=linear[p+1]*.25;neighbour[2]+=linear[p+2]*.25;}
    let mapped=center.map((v,c)=>aces(Math.max(0,v+(v-neighbour[c])*.15)*exposure)),luma=mapped[0]*.2126+mapped[1]*.7152+mapped[2]*.0722;mapped=mapped.map(v=>luma+(v-luma)*1.015);
    out[index]=Math.round(clamp(linearToSrgb(mapped[0]))*255);out[index+1]=Math.round(clamp(linearToSrgb(mapped[1]))*255);out[index+2]=Math.round(clamp(linearToSrgb(mapped[2]))*255);
  }
  return out;
}
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
if(import.meta.url===new URL(process.argv[1],'file:').href){
  const width=Number(option('--width','320')),height=Number(option('--height','180')),spp=Number(option('--spp','64')),png=option('--png','artifacts/photorealism/reference.png'),exr=option('--exr','artifacts/photorealism/reference.exr');
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||!Number.isSafeInteger(spp)||width<16||height<9||spp<1)throw new RangeError('Invalid reference render dimensions or spp');
  await mkdir(dirname(png),{recursive:true});await mkdir(dirname(exr),{recursive:true});
  const started=performance.now(),linear=renderReference(width,height,spp);await writeExr(exr,width,height,linear);await writePng(png,width,height,displayTransform(linear,width,height));
  console.log(JSON.stringify({width,height,spp,seconds:(performance.now()-started)/1000,png,exr}));
}
