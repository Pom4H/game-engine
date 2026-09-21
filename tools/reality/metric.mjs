import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {readPng} from '../photorealism/io.mjs';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const srgbToLinear=x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);
const luma=(r,g,b)=>.2126*r+.7152*g+.0722*b;
const value=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const args={production:value('--production'),reference:value('--reference'),mask:value('--mask'),lpips:value('--lpips'),capture:value('--capture','capture'),out:value('--out','artifacts/reality/report.json'),baseline:value('--baseline'),assert:process.argv.includes('--assert')};
if(!args.production||!args.reference||!args.mask)throw new TypeError('--production, --reference and --mask are required');

const production=await readPng(args.production),reference=await readPng(args.reference),maskImage=await readPng(args.mask);
if(production.width!==reference.width||production.height!==reference.height||production.width!==maskImage.width||production.height!==maskImage.height)throw new RangeError('Reality image/mask dimensions differ');
const n=production.width*production.height,active=new Uint8Array(n),pl=new Float32Array(n),rl=new Float32Array(n);
let count=0,mse=0,logLuminance=0,chroma=0;
for(let i=0;i<n;i++){
  const m=maskImage.rgb[i*3]/255;if(m<.5)continue;active[i]=1;count++;
  const p=i*3,pr=production.rgb[p]/255,pg=production.rgb[p+1]/255,pb=production.rgb[p+2]/255,rr=reference.rgb[p]/255,rg=reference.rgb[p+1]/255,rb=reference.rgb[p+2]/255;
  mse+=((pr-rr)**2+(pg-rg)**2+(pb-rb)**2)/3;
  pl[i]=luma(srgbToLinear(pr),srgbToLinear(pg),srgbToLinear(pb));rl[i]=luma(srgbToLinear(rr),srgbToLinear(rg),srgbToLinear(rb));
  logLuminance+=Math.abs(Math.log1p(12*pl[i])-Math.log1p(12*rl[i]))/Math.log(13);
  chroma+=(Math.abs((pr-pg)-(rr-rg))+Math.abs((pb-pg)-(rb-rg)))*.5;
}
if(count<64)throw new RangeError('Reality mask contains too few active pixels');
mse/=count;

function maskedSsim(a,b){
  let ma=0,mb=0;for(let i=0;i<n;i++)if(active[i]){ma+=a[i];mb+=b[i];}ma/=count;mb/=count;
  let va=0,vb=0,cov=0;for(let i=0;i<n;i++)if(active[i]){const da=a[i]-ma,db=b[i]-mb;va+=da*da;vb+=db*db;cov+=da*db;}
  const d=Math.max(1,count-1);va/=d;vb/=d;cov/=d;const c1=.01*.01,c2=.03*.03;
  return clamp(((2*ma*mb+c1)*(2*cov+c2))/((ma*ma+mb*mb+c1)*(va+vb+c2)),0,1);
}
function grad(values,x,y){
  const w=production.width,h=production.height,at=(xx,yy)=>values[Math.max(0,Math.min(h-1,yy))*w+Math.max(0,Math.min(w-1,xx))];
  const gx=-at(x-1,y-1)+at(x+1,y-1)-2*at(x-1,y)+2*at(x+1,y)-at(x-1,y+1)+at(x+1,y+1);
  const gy=-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1)+at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1);
  return[gx,gy];
}
let edgeNumerator=0,edgeDenominator=0;
for(let y=0;y<production.height;y++)for(let x=0;x<production.width;x++){
  const i=y*production.width+x;if(!active[i])continue;
  const [px,py]=grad(pl,x,y),[rx,ry]=grad(rl,x,y),pm=Math.hypot(px,py),rm=Math.hypot(rx,ry);
  const magnitude=Math.abs(pm-rm),orientation=pm>.005&&rm>.005?1-clamp((px*rx+py*ry)/(pm*rm),-1,1)*.5-.5:0;
  edgeNumerator+=magnitude+orientation*rm*.35;edgeDenominator+=rm+.025;
}
const ssim=maskedSsim(pl,rl),psnr=mse<=1e-12?120:10*Math.log10(1/mse);
let lpips=null;
if(args.lpips){
  const parsed=JSON.parse(await readFile(args.lpips,'utf8'));lpips=Number(parsed.lpips);
  if(!Number.isFinite(lpips)||lpips<0)throw new TypeError('Invalid LPIPS sidecar');
}
const components={
  lpips:lpips===null?null:clamp(lpips),
  structural:1-ssim,
  logLuminance:clamp(logLuminance/count),
  edge:clamp(edgeNumerator/Math.max(1e-9,edgeDenominator)),
  chroma:clamp(chroma/count),
};
const rawWeights={lpips:.30,structural:.20,logLuminance:.20,edge:.15,chroma:.15};
const usable=Object.entries(rawWeights).filter(([key])=>components[key]!==null),weight=usable.reduce((s,[,w])=>s+w,0);
const gap=usable.reduce((s,[key,w])=>s+components[key]*w,0)/weight;
const report={version:1,metric:'RealityGap',lowerIsBetter:true,capture:args.capture,resolution:[production.width,production.height],maskPixels:count,gap,psnr,ssim,components,weights:Object.fromEntries(usable.map(([k,w])=>[k,w/weight]))};
if(args.baseline){
  const baseline=JSON.parse(await readFile(args.baseline,'utf8')),entry=baseline[args.capture]??baseline;
  report.baseline={gap:entry.gap,tolerance:entry.tolerance??.003,delta:gap-entry.gap};
  report.regressions=gap>entry.gap+(entry.tolerance??.003)?[{id:args.capture,baseline:entry.gap,actual:gap}]:[];
}
await mkdir(dirname(args.out),{recursive:true});await writeFile(args.out,JSON.stringify(report,null,2));
console.log(JSON.stringify({metric:report.metric,capture:report.capture,gap:report.gap,psnr:report.psnr,ssim:report.ssim,components:report.components,report:args.out}));
if(args.assert&&report.regressions?.length){console.error('Reality regression: '+JSON.stringify(report.regressions));process.exitCode=1;}
