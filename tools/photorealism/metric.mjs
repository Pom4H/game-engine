import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {readPng} from './io.mjs';
import {northStar} from './scene.mjs';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const srgbToLinear=x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);
const luma=(r,g,b)=>.2126*r+.7152*g+.0722*b;

function rectPixels(image,rect){
  const [x0n,y0n,x1n,y1n]=rect,x0=Math.max(0,Math.floor(x0n*image.width)),y0=Math.max(0,Math.floor(y0n*image.height)),x1=Math.min(image.width,Math.ceil(x1n*image.width)),y1=Math.min(image.height,Math.ceil(y1n*image.height)),width=Math.max(1,x1-x0),height=Math.max(1,y1-y0),rgb=new Float32Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const src=((y0+y)*image.width+x0+x)*3,dst=(y*width+x)*3;rgb[dst]=image.rgb[src]/255;rgb[dst+1]=image.rgb[src+1]/255;rgb[dst+2]=image.rgb[src+2]/255;}
  return{width,height,rgb};
}
function linearLuma(image){
  const result=new Float32Array(image.width*image.height);
  for(let i=0,j=0;i<image.rgb.length;i+=3,j++)result[j]=luma(srgbToLinear(image.rgb[i]),srgbToLinear(image.rgb[i+1]),srgbToLinear(image.rgb[i+2]));
  return result;
}
function downsample(values,width,height){
  const w=Math.max(1,Math.floor(width/2)),h=Math.max(1,Math.floor(height/2)),out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let sum=0,count=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const sx=Math.min(width-1,x*2+dx),sy=Math.min(height-1,y*2+dy);sum+=values[sy*width+sx];count++;}out[y*w+x]=sum/count;}
  return{values:out,width:w,height:h};
}
function ssim(a,b){
  const n=a.length;if(!n)return 1;let ma=0,mb=0;for(let i=0;i<n;i++){ma+=a[i];mb+=b[i];}ma/=n;mb/=n;
  let va=0,vb=0,cov=0;for(let i=0;i<n;i++){const da=a[i]-ma,db=b[i]-mb;va+=da*da;vb+=db*db;cov+=da*db;}const d=Math.max(1,n-1);va/=d;vb/=d;cov/=d;
  const c1=.01*.01,c2=.03*.03;return clamp(((2*ma*mb+c1)*(2*cov+c2))/((ma*ma+mb*mb+c1)*(va+vb+c2)),-1,1);
}
function gradient(values,width,height,x,y){
  const at=(xx,yy)=>values[Math.max(0,Math.min(height-1,yy))*width+Math.max(0,Math.min(width-1,xx))];
  const gx=-at(x-1,y-1)+at(x+1,y-1)-2*at(x-1,y)+2*at(x+1,y)-at(x-1,y+1)+at(x+1,y+1);
  const gy=-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1)+at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1);
  return Math.hypot(gx,gy);
}
function laplacian(values,width,height,x,y){
  const at=(xx,yy)=>values[Math.max(0,Math.min(height-1,yy))*width+Math.max(0,Math.min(width-1,xx))];
  return Math.abs(at(x-1,y)+at(x+1,y)+at(x,y-1)+at(x,y+1)-4*at(x,y));
}
function evaluateRegion(prod,ref){
  if(prod.width!==ref.width||prod.height!==ref.height)throw new RangeError('Region dimensions differ');
  const lp=linearLuma(prod),lr=linearLuma(ref),n=lp.length,logNorm=Math.log1p(8);let logLuminance=0,chroma=0,edgeNumerator=0,edgeDenominator=0,detailNumerator=0,detailDenominator=0;
  for(let i=0;i<n;i++){
    logLuminance+=Math.abs(Math.log1p(8*lp[i])-Math.log1p(8*lr[i]))/logNorm;
    const p=i*3,rp=prod.rgb[p],gp=prod.rgb[p+1],bp=prod.rgb[p+2],rr=ref.rgb[p],gr=ref.rgb[p+1],br=ref.rgb[p+2];
    chroma+=(Math.abs((rp-gp)-(rr-gr))+Math.abs((bp-gp)-(br-gr)))*.5;
  }
  for(let y=0;y<prod.height;y++)for(let x=0;x<prod.width;x++){
    const gp=gradient(lp,prod.width,prod.height,x,y),gr=gradient(lr,ref.width,ref.height,x,y),dp=laplacian(lp,prod.width,prod.height,x,y),dr=laplacian(lr,ref.width,ref.height,x,y);
    edgeNumerator+=Math.abs(gp-gr);edgeDenominator+=gr+.025;detailNumerator+=Math.abs(dp-dr);detailDenominator+=dr+.02;
  }
  let a=lp,b=lr,w=prod.width,h=prod.height,ssimError=0,scales=0;
  for(let level=0;level<3;level++){ssimError+=1-clamp(ssim(a,b),0,1);scales++;if(w<=4||h<=4)break;const da=downsample(a,w,h),db=downsample(b,w,h);a=da.values;b=db.values;w=da.width;h=da.height;}
  const components={
    logLuminance:clamp(logLuminance/n),
    structural:clamp(ssimError/scales),
    detail:clamp(detailNumerator/Math.max(1e-9,detailDenominator)),
    edge:clamp(edgeNumerator/Math.max(1e-9,edgeDenominator)),
    chroma:clamp(chroma/n),
  };
  const gap=.35*components.logLuminance+.25*components.structural+.20*components.detail+.10*components.edge+.10*components.chroma;
  return{gap,components};
}
function parseArgs(){
  const value=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
  return{production:value('--production'),reference:value('--reference'),out:value('--out','artifacts/photorealism/report.json'),mode:value('--mode','fast'),baseline:value('--baseline'),assert:process.argv.includes('--assert')};
}
const args=parseArgs();if(!args.production||!args.reference)throw new TypeError('--production and --reference are required');
const production=await readPng(args.production),reference=await readPng(args.reference);if(production.width!==reference.width||production.height!==reference.height)throw new RangeError('Production/reference image sizes differ');
const full=evaluateRegion(production,reference),crops=[];
for(const crop of northStar.crops){const p=rectPixels(production,crop.rect),r=rectPixels(reference,crop.rect),result=evaluateRegion(p,r);crops.push({id:crop.id,weight:crop.weight??1,rect:crop.rect,...result});}
const weight=crops.reduce((sum,c)=>sum+c.weight,0)||1,cropGap=crops.reduce((sum,c)=>sum+c.gap*c.weight,0)/weight,gap=.55*full.gap+.45*cropGap;
const report={version:1,metric:'RendererConsistencyGap',lowerIsBetter:true,mode:args.mode,resolution:[production.width,production.height],gap,full,cropGap,crops,weights:{full:.55,crops:.45,components:{logLuminance:.35,structural:.25,detail:.20,edge:.10,chroma:.10}}};
if(args.baseline){
  const baseline=JSON.parse(await readFile(args.baseline,'utf8')),entry=baseline[args.mode]??baseline;
  report.baseline={gap:entry.gap,tolerance:entry.tolerance??.005,delta:gap-entry.gap};
  const cropById=new Map((entry.crops??[]).map(c=>[c.id,c]));
  report.regressions=[];
  if(gap>entry.gap+(entry.tolerance??.005))report.regressions.push({id:'overall',baseline:entry.gap,actual:gap});
  for(const crop of crops){const previous=cropById.get(crop.id);if(previous&&crop.gap>previous.gap+(previous.tolerance??.015))report.regressions.push({id:crop.id,baseline:previous.gap,actual:crop.gap});}
}
await mkdir(dirname(args.out),{recursive:true});await writeFile(args.out,JSON.stringify(report,null,2));
console.log(JSON.stringify({metric:report.metric,mode:report.mode,gap:report.gap,baseline:report.baseline??null,crops:Object.fromEntries(crops.map(c=>[c.id,c.gap])),report:args.out}));
if(args.assert&&report.regressions?.length){console.error('Renderer consistency regression: '+JSON.stringify(report.regressions));process.exitCode=1;}
