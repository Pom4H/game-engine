import type {Primitive} from '../scene/types.js';

export type DetailedThreeBoxParameters={
  sculpt:{rearFloorStart:number;rearArchFlare:number;cowlSweep:number;cowlCrown:number;cowlDip:number;roofFrontSweep:number;roofFrontCrown:number;windshieldBulge:number;windshieldColumnBias:number;rockerHeight:number;lowerWidth:number;sideTaper:number;rearEndRound:number;rearLampWidth:number;rearLampHeight:number;diffuserHeight:number;rearFloorRise:number;rearWaist:number;rearGlassInset:number;roofRailDrop:number;roofRailOutset:number;panelSpacing:number;faceting:number;hoodChannelWidth:number;lampDepth:number;bumperDepth:number;fenderCrown:number};
  dimensions:{width:number;length:number;height:number;wheelbase:number;track:number;wheelRadius:number;axleOffset:number;clearance:number;rideHeight:number};
  side:readonly (readonly [number,number,number,number])[];
  roof:readonly (readonly [number,number,number])[];
  cowl:number;rearGlassBase:number;quarterWindowEnd:number;quarterKick:number;frontDoorRear:number;rearDoorRear:number;
  endRound:number;archClearance:number;archFlare:number;shoulder:number;roofCrown:number;hoodCrown:number;hoodRidge:number;panelGap:number;
};

export type M3DetailedBodyParameters=DetailedThreeBoxParameters;
export const M3_DETAILED_BODY_PARAMETERS:DetailedThreeBoxParameters=Object.freeze({
  sculpt:Object.freeze({rearFloorStart:.33,rearArchFlare:.056,cowlSweep:.172,cowlCrown:.0084,cowlDip:.009,roofFrontSweep:.0525,roofFrontCrown:.0445,windshieldBulge:.019,windshieldColumnBias:.095,rockerHeight:.108,lowerWidth:.964,sideTaper:1.30,rearEndRound:.30,rearLampWidth:.58,rearLampHeight:.17,diffuserHeight:.14,rearFloorRise:.228,rearWaist:.105,rearGlassInset:.135,roofRailDrop:.045,roofRailOutset:.035,panelSpacing:.18,faceting:.42,hoodChannelWidth:.098,lampDepth:.088,bumperDepth:.095,fenderCrown:.048}),
  dimensions:Object.freeze({width:1.888,length:4.796,height:1.462,wheelbase:2.837,track:1.574,wheelRadius:.346,axleOffset:.118,clearance:.22,rideHeight:.475}),
  side:Object.freeze([[-.5,.894,.715,.92],[-.40,.922,.725,.84],[-.28,.998,.715,.84],[-.08,.976,.68,.86],[.06,.976,.658,.875],[.1633,.970,.675,.80],[.32,1.006,.608,.935],[.46,.957,.522,.975],[.5,.888,.492,1]] as const),
  roof:Object.freeze([[-.255,.60,.918],[-.19,.59,.947],[-.08,.58,.965],[0,.60,.945],[.0484,.628,.9034]] as const),
  cowl:.1633,rearGlassBase:-.402,quarterWindowEnd:-.277,quarterKick:.06,frontDoorRear:-.068,rearDoorRear:-.24,
  endRound:.50,archClearance:.034,archFlare:.034,shoulder:.20,roofCrown:.050,hoodCrown:.030,hoodRidge:.038,panelGap:.005,
});

type V3=[number,number,number];
type P2=[number,number];
type Door={id:string;side:1|-1;hingeZ:number;width:number;bottom:number;top:number};
type Panel={id:string;kind:string;vertices:V3[];faces:[number,number,number,number][];normal:V3;paint:boolean};
type Body={parts:Panel[];p:DetailedThreeBoxParameters;width:number;length:number;height:number;floor:number;roofFront:number;roofRear:number;belt:number;archRadius:number;wheelY:number;axles:[number,number];frontBase:number;rearBase:number;gap:number;doors:Door[]};

const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const divisions=(a:number,b:number,n:number)=>Array.from({length:n+1},(_,i)=>mix(a,b,i/n));

function sectionAt<T extends readonly number[]>(sections:readonly T[],z:number):number[]{
  const hi=sections.findIndex(s=>s[0]!>=z);if(hi<=0)return [...sections[hi<0?sections.length-1:0]!];
  const a=sections[hi-1]!,b=sections[hi]!,t=(z-a[0]!)/(b[0]!-a[0]!),h=b[0]!-a[0]!;
  return a.map((v,i)=>{
    if(i===0)return z;
    const delta=(b[i]!-v)/h,slope=(j:number)=>{
      if(j===0)return (sections[1]![i]!-sections[0]![i]!)/(sections[1]![0]!-sections[0]![0]!);
      if(j===sections.length-1)return (sections[j]![i]!-sections[j-1]![i]!)/(sections[j]![0]!-sections[j-1]![0]!);
      const x=sections[j-1]!,y=sections[j]!,w=sections[j+1]!,d0=(y[i]!-x[i]!)/(y[0]!-x[0]!),d1=(w[i]!-y[i]!)/(w[0]!-y[0]!);
      return d0*d1<=0?0:2*d0*d1/(d0+d1);
    },m0=delta===0?0:slope(hi-1),m1=delta===0?0:slope(hi);
    return (2*t**3-3*t*t+1)*v+(t**3-2*t*t+t)*h*m0+(-2*t**3+3*t*t)*b[i]!+(t**3-t*t)*h*m1;
  });
}

function makeBody(p:DetailedThreeBoxParameters):Body{
  const d=p.dimensions,floor=d.clearance-d.rideHeight,roofFront=p.roof.at(-1)![0]*d.length,roofRear=p.roof[0]![0]*d.length,belt=sectionAt(p.side,0)[2]!*d.height-d.rideHeight;
  const frontEdge=d.length*p.cowl,frontSpan=frontEdge-d.length*p.frontDoorRear,frontWidth=frontSpan/.97,hi=frontEdge-frontSpan-d.length*.010,rearEdge=d.length*p.rearDoorRear,rearWidth=(hi-rearEdge)/.97;
  const doors:Door[]=[];
  for(const side of [1,-1] as const){doors.push({id:`front-${side>0?'left':'right'}`,side,hingeZ:frontEdge,width:frontWidth,bottom:floor+.05,top:d.height-d.rideHeight-.07});doors.push({id:`rear-${side>0?'left':'right'}`,side,hingeZ:hi,width:rearWidth,bottom:floor+.05,top:d.height-d.rideHeight-.07});}
  const parkedHub=.24-.44+.11,wheelY=parkedHub*(d.rideHeight/(.34*1.3970588235)),archRadius=d.wheelRadius+p.archClearance;
  return {parts:[],p,width:d.width,length:d.length,height:d.height,floor,roofFront,roofRear,belt,archRadius,wheelY,axles:[-d.wheelbase/2+d.axleOffset,d.wheelbase/2+d.axleOffset],frontBase:d.length*p.cowl,rearBase:d.length*p.rearGlassBase,gap:p.panelGap,doors};
}
function panel(body:Body,id:string,kind:string,normal:V3,paint=true):Panel{const q={id,kind,vertices:[],faces:[],normal,paint};body.parts.push(q);return q;}

function panelEndOffset(body:Body,z:number,u=1){const p=body.p,start=.32,span=.5-start;return (z<0?p.sculpt.rearEndRound:p.endRound)*clamp((Math.abs(z)/body.length-start)/span)**2*Math.abs(u)**4;}
function panelFloor(body:Body,z:number){const p=body.p,start=p.sculpt.rearFloorStart,t=clamp((-z/body.length-start)/(.5-start));return body.floor+p.sculpt.rearFloorRise*t*t*(3-2*t);}
function panelPaintBottom(body:Body,z:number){const h=body.p.sculpt.rockerHeight,span=body.length/2,fade=clamp((span-Math.abs(z))/.55);return panelFloor(body,z)+h*fade*(1-.13*z/span);}
function panelBelt(body:Body,z:number){const p=body.p;return sectionAt(p.side,z/body.length)[2]!*body.height-p.dimensions.rideHeight;}
function panelRearInset(body:Body,z:number,y:number){if(z>=0)return 0;const floor=panelFloor(body,z),t=clamp((y-floor)/(panelBelt(body,z)-floor)),amount=body.p.sculpt.rearWaist,profile=t<.34?mix(.45,0,t/.34):t<.72?mix(0,1,(t-.34)/.38):mix(1,0,(t-.72)/.28),blend=clamp((-z/body.length-.34)/.16);return amount*profile*blend*blend;}
function panelSidePoint(body:Body,side:number,y:number,z:number):V3{
  const p=body.p,s=sectionAt(p.side,z/body.length),belt=panelBelt(body,z),floor=panelPaintBottom(body,z),t=clamp((y-floor)/(belt-floor)),shoulder=p.shoulder;
  const width=s[1]!*body.width/2*(t<shoulder?mix(p.sculpt.lowerWidth,1,Math.sin(t/shoulder*Math.PI/2)):mix(1,s[3]!,((t-shoulder)/(1-shoulder))**p.sculpt.sideTaper));
  const flare=Math.max(...body.axles.map(a=>(a<0?p.sculpt.rearArchFlare:p.archFlare)*Math.exp(-(((z-a)/(body.archRadius*1.1))**2))))*Math.sin(Math.PI*t);
  return [side*(width+flare),y,z-Math.sign(z)*panelEndOffset(body,z)+panelRearInset(body,z,y)];
}
function panelEndPoint(body:Body,end:number,u:number,y:number):V3{const z=end*body.length/2,edge=panelSidePoint(body,1,y,z);return[u*edge[0],y,z-end*panelEndOffset(body,z,u)+panelRearInset(body,z,y)];}
function archBottom(body:Body,z:number){let y=panelPaintBottom(body,z);for(const axle of body.axles){const dz=z-axle;if(Math.abs(dz)<=body.archRadius*(1+1e-9))y=Math.max(y,body.wheelY+Math.sqrt(Math.max(0,body.archRadius**2-dz**2)));}return y;}
function roofPoint(body:Body,side:number,z:number):V3{const s=sectionAt(body.p.roof,z/body.length);return[side*s[1]!*body.width/2,s[2]!*body.height-body.p.dimensions.rideHeight,z];}
function sideRoofPoint(body:Body,side:number,z:number):V3{const q=roofPoint(body,side,z),s=body.p.sculpt;return[q[0]+side*s.roofRailOutset,q[1]-s.roofRailDrop,q[2]];}
function roofSurfacePoint(body:Body,u:number,z:number):V3{const edge=roofPoint(body,1,z),p=body.p,s=p.sculpt,blend=clamp((z-(body.roofFront-.4))/.4),crown=mix(p.roofCrown,s.roofFrontCrown,blend);return[u*edge[0],edge[1]+crown*(1-u*u),z+s.roofFrontSweep*(1-Math.abs(u)**1.75)*blend*blend];}
function panelDeckPoint(body:Body,front:boolean,u:number,z:number):V3{
  const p=body.p,start=front?body.frontBase:-body.length/2,end=front?body.length/2:body.rearBase,distance=front?(z-start)/(end-start):(end-z)/(end-start),width=panelSidePoint(body,1,panelBelt(body,z),z)[0],crown=front?mix(p.sculpt.cowlCrown,p.hoodCrown,clamp(distance/.24)):.012,channel=p.sculpt.hoodChannelWidth,inner=.46-channel/2,outer=.46+channel/2;
  const ridge=front?p.hoodRidge*clamp((Math.abs(u)-inner)/.025)*clamp((outer-Math.abs(u))/.025)*clamp((distance-.10)/.12)*clamp((.88-distance)/.1):0;
  const fender=front?p.sculpt.fenderCrown*clamp((Math.abs(u)-.75)/.15)*clamp((1-Math.abs(u))/.10)*Math.exp(-(((z-body.axles[1])/.7)**2)):0;
  return[u*width,panelBelt(body,z)+crown*(1-u*u)*(1-.6*distance*distance)+ridge+fender-(front?p.sculpt.cowlDip*Math.sin(Math.PI*Math.abs(u))**2*(1-clamp(distance/.24)):0),z-Math.sign(z)*panelEndOffset(body,z,u)+(front?p.sculpt.cowlSweep*(1-Math.abs(u)**3.4)*(1-clamp(distance/.35))**2:0)];
}
function rearGlassBottom(body:Body,u:number):V3{const width=panelSidePoint(body,1,panelBelt(body,body.rearBase),body.rearBase)[0],inset=body.p.sculpt.rearGlassInset;return panelDeckPoint(body,false,u*(1-inset/width),body.rearBase);}
function frontPillarPoint(body:Body,side:number,v:number):V3{const a=panelDeckPoint(body,true,side,body.frontBase),b=roofPoint(body,side,body.roofFront);return[mix(a[0],b[0],v),mix(a[1],b[1],v)+body.p.sculpt.windshieldBulge*Math.sin(Math.PI*v),mix(a[2],b[2],v)];}

function patch(part:Panel,us:number[],vs:number[],point:(u:number,v:number)=>V3){
  const start=part.vertices.length;
  for(const v of vs)for(const u of us)part.vertices.push(point(u,v));
  for(let j=0;j<vs.length-1;j++)for(let i=0;i<us.length-1;i++){
    const a=start+j*us.length+i,b=a+1,d=a+us.length,c=d+1,A=part.vertices[a]!,B=part.vertices[b]!,C=part.vertices[c]!,D=part.vertices[d]!,ab:V3=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],ac:V3=[C[0]-A[0],C[1]-A[1],C[2]-A[2]],ad:V3=[D[0]-A[0],D[1]-A[1],D[2]-A[2]],n:V3=[ab[1]*ac[2]-ab[2]*ac[1]+ac[1]*ad[2]-ac[2]*ad[1],ab[2]*ac[0]-ab[0]*ac[2]+ac[2]*ad[0]-ac[0]*ad[2],ab[0]*ac[1]-ab[1]*ac[0]+ac[0]*ad[1]-ac[1]*ad[0]];
    if(Math.hypot(...n)<1e-12)continue;
    part.faces.push(n[0]*part.normal[0]+n[1]*part.normal[1]+n[2]*part.normal[2]<0?[a,d,c,b]:[a,b,c,d]);
  }
}
const cross2=(a:P2,b:P2,c:P2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const dist2=(a:P2,b:P2)=>(b[0]-a[0])**2+(b[1]-a[1])**2;
const inside=(p:P2,a:P2,b:P2,c:P2,e=1e-10)=>cross2(a,b,p)>=-e&&cross2(b,c,p)>=-e&&cross2(c,a,p)>=-e;
function triangulate(contour:P2[],spacing:number,surface:(p:P2)=>V3){
  const points:P2[]=[];for(const p of contour)if(!points.length||dist2(points.at(-1)!,p)>1e-16)points.push(p);if(points.length>1&&dist2(points[0]!,points.at(-1)!)<1e-16)points.pop();
  let area=0;for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!;area+=a[0]*b[1]-b[0]*a[1];}if(area<0)points.reverse();
  const remaining=points.map((_,i)=>i),faces:[number,number,number][]=[];
  while(remaining.length>3){let best=-1,bq=-1;for(let i=0;i<remaining.length;i++){const a=remaining[(i+remaining.length-1)%remaining.length]!,b=remaining[i]!,c=remaining[(i+1)%remaining.length]!;if(cross2(points[a]!,points[b]!,points[c]!)<=1e-12)continue;if(remaining.some(j=>j!==a&&j!==b&&j!==c&&inside(points[j]!,points[a]!,points[b]!,points[c]!)))continue;const q=Math.abs(cross2(points[a]!,points[b]!,points[c]!))/(dist2(points[a]!,points[b]!)+dist2(points[b]!,points[c]!)+dist2(points[c]!,points[a]!));if(q>bq){bq=q;best=i;}}if(best<0)break;faces.push([remaining[(best+remaining.length-1)%remaining.length]!,remaining[best]!,remaining[(best+1)%remaining.length]!]);remaining.splice(best,1);}if(remaining.length===3)faces.push(remaining as [number,number,number]);
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1])),rows=Math.ceil((maxY-minY)/(spacing*.866)),cols=Math.ceil((maxX-minX)/spacing);
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const p:P2=[minX+(i+.33+(j%2)*.5)*spacing,minY+(j+.43)*spacing*.866];if(points.some(v=>dist2(v,p)<(spacing*.48)**2))continue;const f=faces.findIndex(([a,b,c])=>inside(p,points[a]!,points[b]!,points[c]!,-1e-9));if(f<0)continue;const [a,b,c]=faces[f]!,n=points.length;points.push(p);faces.splice(f,1,[a,b,n],[b,c,n],[c,a,n]);}
  void surface;return{points,faces};
}
function appendContour(part:Panel,contour:P2[],point:(p:P2)=>V3,spacing:number){const t=triangulate(contour,spacing,point),known=new Map(part.vertices.map((p,i)=>[p.map(x=>x.toFixed(8)).join(':'),i])),ids=t.points.map(p=>{const v=point(p),key=v.map(x=>x.toFixed(8)).join(':'),old=known.get(key);if(old!==undefined)return old;const i=part.vertices.length;part.vertices.push(v);known.set(key,i);return i;});for(const f of t.faces){const[a,b,c]=f.map(i=>ids[i]!) as[number,number,number],A=part.vertices[a]!,B=part.vertices[b]!,C=part.vertices[c]!,ab:V3=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],ac:V3=[C[0]-A[0],C[1]-A[1],C[2]-A[2]],n:V3=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];part.faces.push(n[0]*part.normal[0]+n[1]*part.normal[1]+n[2]*part.normal[2]<0?[a,c,b,b]:[a,b,c,c]);}}

function contourSide(body:Body,part:Panel,side:number,start:number,end:number,low:number){
  const g=body.gap,spacing=body.p.sculpt.panelSpacing,begin=start+g/2,finish=end-g/2,belt=(z:number)=>panelBelt(body,z)-g/2,shoulder=(z:number)=>mix(panelPaintBottom(body,z),belt(z),body.p.shoulder),bottom=(z:number)=>Math.max(low,archBottom(body,z))+g/2;
  const regular=divisions(begin,finish,Math.max(1,Math.ceil((finish-begin)/spacing))),arc=body.axles.flatMap(axle=>divisions(0,Math.PI,16).map(a=>axle+Math.cos(a)*body.archRadius)).filter(z=>z>begin&&z<finish),support=body.axles.filter(z=>z>begin&&z<finish),shared=[...new Set([...regular,...support])].sort((a,b)=>a-b);
  for(const upper of [false,true]){const lo=(z:number)=>upper?Math.max(shoulder(z),bottom(z)):bottom(z),hi=upper?belt:shoulder,cuts=[begin,...support,finish].sort((a,b)=>a-b);for(let k=0;k<cuts.length-1;k++){const a=cuts[k]!,b=cuts[k+1]!;if(b-a<1e-7||hi((a+b)/2)-lo((a+b)/2)<1e-6)continue;const base=[a,...shared.filter(z=>z>a&&z<b),b],lower=[...new Set([...base,...arc.filter(z=>z>a&&z<b&&bottom(z)>=lo(z)-1e-7)])].sort((x,y)=>x-y),contour:P2[]=[...lower.map(z=>[z,Math.min(hi(z),lo(z))] as P2),...base.slice().reverse().map(z=>[z,hi(z)] as P2)];appendContour(part,contour,([z,y])=>panelSidePoint(body,side,y,z),spacing);}}
}
function contourHood(part:Panel,body:Body,start:number,end:number,inner:number,outer:number){
  const half=body.width/2,spacing=body.p.sculpt.panelSpacing,z0=mix(start,end,.10),z1=mix(start,end,.88),cuts=[-.8,-outer,-outer+.025,-inner-.025,-inner,inner,inner+.025,outer-.025,outer,.8].map(u=>u*half),across=(lo:number,hi:number)=>divisions(lo,hi,Math.max(1,Math.ceil((hi-lo)/spacing))),zs=across(z0,z1),point=([x,z]:P2)=>panelDeckPoint(body,true,x/half,z);
  for(let i=0;i<cuts.length-1;i++){const x0=cuts[i]!,x1=cuts[i+1]!,us=across(x0,x1),contour:P2[]=[...us.map(x=>[x,z0] as P2),...zs.slice(1).map(z=>[x1,z] as P2),...us.slice(0,-1).reverse().map(x=>[x,z1] as P2),...zs.slice(1,-1).reverse().map(z=>[x0,z] as P2)];appendContour(part,contour,point,spacing);}
}
function sidePanel(body:Body,id:string,kind:string,side:1|-1,start:number,end:number,low:number){const part=panel(body,id,kind,[side,0,0]),g=body.gap;contourSide(body,part,side,start,end,low);}

function sculptedFrontPoint(body:Body,x:number,y:number):V3{const p=body.p,w=body.width*.445,L=body.length/2,ground=p.dimensions.clearance,top=sectionAt(p.side,.5)[2]!*body.height,t=clamp((y-ground)/(top-ground)),projection=t<.48?t/.48*.045:(1-t)/.52*.045;return[x,y-p.dimensions.rideHeight,L+projection-panelEndOffset(body,L,x/w)];}
function sculptedFrontPanels(body:Body):Panel[]{
  const p=body.p,W=body.width*.445,ground=p.dimensions.clearance,top=sectionAt(p.side,.5)[2]!*body.height,split=ground+.048,browY=top-.23,A=.69/2+.045,bumper=panel(body,'front-bumper','bumper',[0,0,1]),brow=panel(body,'front-fascia','fender',[0,0,1]);
  const openings:{kind:string;side:number;outer:V3[];inner:V3[]}[]=[];
  const pts=(side:number,xy:number[][])=>xy.map(([x,y])=>sculptedFrontPoint(body,side*x!,y!));
  for(const side of [-1,1]){const inner=.040/2,outer=.69/2,grilleTop=top-.025,bottom=Math.max(split+.03,grilleTop-.44),lampBottom=top-.138-.045,lampTop=top-.02,lampEdge=Math.min(W-.025,A+.025+.41),intakeEdge=Math.min(W-.055,A+.03+.40);openings.push({kind:'grille',side,outer:pts(side,[[0,split],[A,split],[A,browY],[A,top],[0,top],[0,top-.04]]),inner:pts(side,[[inner,bottom],[outer*.84,bottom],[outer,bottom+.44*.35],[outer*.96,grilleTop-.025],[inner+.01,grilleTop],[inner,grilleTop-.02]])});openings.push({kind:'lamp',side,outer:pts(side,[[A,browY],[A+.10,browY],[W,browY],[W,top],[A,top]]),inner:pts(side,[[A+.025,lampBottom+.020],[A+.085,lampBottom],[lampEdge-.015,lampBottom+.058],[lampEdge,lampTop],[A+.04,lampTop-.045]])});openings.push({kind:'intake',side,outer:pts(side,[[A,split],[W,split],[W,browY-.08],[W,browY],[A,browY]]),inner:pts(side,[[A+.03,split+.045],[intakeEdge-.045,split+.045],[intakeEdge,split+.12],[intakeEdge-.075,browY-.065],[A+.08,browY-.07]])});}
  for(const o of openings){const part=o.kind==='lamp'?brow:bumper;for(let i=0;i<o.outer.length;i++){const j=(i+1)%o.outer.length,k=part.vertices.length,points=[o.outer[i]!,o.outer[j]!,o.inner[j]!,o.inner[i]!];part.vertices.push(...points);part.faces.push([k,k+1,k+2,k+3]);}}
  return[bumper,brow];
}
function buildPanels(p:DetailedThreeBoxParameters){
  const body=makeBody(p),l=body.length/2;
  for(const side of [1,-1] as const){const name=side>0?'left':'right',doors=body.doors.filter(d=>d.side===side).sort((a,b)=>a.hingeZ-b.hingeZ);let cursor=-l;for(const door of doors){const lo=door.hingeZ-door.width*.97,hi=door.hingeZ;if(lo>cursor+body.gap)sidePanel(body,`${cursor===-l?'rear-fender':'b-pillar-base'}-${name}`,'fender',side,cursor,lo,body.floor);sidePanel(body,`door-${door.id}`,'door',side,lo,hi,door.bottom);cursor=hi;}sidePanel(body,`front-fender-${name}`,'fender',side,cursor,l,body.floor);
    const rear=body.axles[0]+body.archRadius,front=body.axles[1]-body.archRadius,sill=panel(body,`sill-${name}`,'sill',[side,0,0]);patch(sill,divisions(rear,front,8),[0,1],(z,t)=>panelSidePoint(body,side,panelPaintBottom(body,z)+t*p.dimensions.wheelRadius*.12,z));
    for(const axle of body.axles){const lip=panel(body,`${axle>0?'front':'rear'}-arch-lip-${name}`,'fender',[side,0,0]),outer=body.archRadius+p.dimensions.wheelRadius*.05;for(let i=0;i<24;i++){const a=i*Math.PI/24,b=(i+1)*Math.PI/24,za=axle+Math.cos(a)*outer,zb=axle+Math.cos(b)*outer,doorBay=doors.some(d=>Math.max(za,zb)>d.hingeZ-d.width*.97+body.gap&&Math.min(za,zb)<d.hingeZ-body.gap);if(doorBay)continue;patch(lip,[a,b],[0,1],(angle,t)=>{const r=body.archRadius+t*p.dimensions.wheelRadius*.05,y=body.wheelY+Math.sin(angle)*r,z=axle+Math.cos(angle)*r,q=panelSidePoint(body,side,y,z);return[q[0]+side*p.dimensions.wheelRadius*.006,y,q[2]];});}}
  }
  for(const front of [true,false]){const start=front?body.frontBase:-l,end=front?l:body.rearBase,part=panel(body,front?'hood':'trunk-lid',front?'hood':'trunk',[0,1,0]),channel=p.sculpt.hoodChannelWidth,inner=.46-channel/2,outer=.46+channel/2,limit=front?.80:.84;if(front)contourHood(part,body,start,end,inner,outer);else{const spacing=p.sculpt.panelSpacing,xs=divisions(-limit*body.width/2,limit*body.width/2,Math.ceil(limit*body.width/spacing)),zz=divisions(start+body.gap,end-body.gap,Math.max(1,Math.ceil((end-start)/spacing))),lo=xs[0]!,hi=xs.at(-1)!,contour:P2[]=[...xs.map(x=>[x,start+body.gap] as P2),...zz.slice(1).map(z=>[hi,z] as P2),...xs.slice(0,-1).reverse().map(x=>[x,end-body.gap] as P2),...zz.slice(1,-1).reverse().map(z=>[lo,z] as P2)];appendContour(part,contour,([x,z])=>panelDeckPoint(body,false,x/(body.width/2),z),spacing);}for(const side of [-1,1]){const strip=panel(body,`${front?'front-fender':'rear-quarter'}-crown-${side>0?'left':'right'}`,'fender',[0,1,0]);patch(strip,divisions(side>0?limit+body.gap/(body.width/2):-1,side>0?1:-limit-body.gap/(body.width/2),3),divisions(start,end,8),(u,z)=>panelDeckPoint(body,front,u,z));}}
  for(const side of [1,-1] as const){const name=side>0?'left':'right',at=(z:number)=>panelSidePoint(body,side,panelBelt(body,z),z),a=panel(body,`a-pillar-${name}`,'pillar',[side,.2,.4]);a.vertices=[at(body.frontBase),frontPillarPoint(body,side,.5),roofPoint(body,side,body.roofFront),sideRoofPoint(body,side,body.roofFront)];a.faces=side>0?[[0,3,1,1],[1,3,2,2]]:[[0,1,3,3],[1,2,3,3]];const cp=panel(body,`c-pillar-${name}`,'pillar',[side,.3,-.4]),aa=at(body.rearBase),bb=rearGlassBottom(body,side),cc=roofPoint(body,side,body.roofRear),dd=sideRoofPoint(body,side,body.roofRear);cp.vertices=[aa,bb,cc,dd];cp.faces=[side>0?[0,1,2,3]:[0,3,2,1]];const sail=panel(body,`c-pillar-sail-${name}`,'pillar',[side,0,0]),top=sideRoofPoint(body,side,body.roofRear),base=at(body.rearBase),innerLow=at(p.quarterWindowEnd*body.length+p.quarterKick),u=.57,innerHigh:V3=[mix(top[0],base[0],u),mix(top[1],base[1],u),p.quarterWindowEnd*body.length];sail.vertices=[base,innerLow,innerHigh,top];sail.faces=[side>0?[0,3,2,1]:[0,1,2,3]];}
  const roof=panel(body,'roof','roof',[0,1,0]);patch(roof,divisions(-1,1,4),p.roof.map(s=>s[0]*body.length),(u,z)=>roofSurfacePoint(body,u,z));
  sculptedFrontPanels(body);
  const bumper=panel(body,'rear-bumper','bumper',[0,0,-1]);patch(bumper,divisions(-1,1,10),[0,.18,.36,.58,.80,1],(u,t)=>{const y=mix(panelFloor(body,-l),panelBelt(body,-l)-p.dimensions.wheelRadius*.38,t);return panelEndPoint(body,-1,u,y);});
  const fascia=panel(body,'rear-fascia','fender',[0,0,-1]);patch(fascia,divisions(-1,1,16),[0,1],(u,t)=>{const y=mix(panelBelt(body,-l)-p.dimensions.wheelRadius*.38,panelBelt(body,-l)+.012*(1-u*u),t);return panelEndPoint(body,-1,u,y);});
  return body;
}
function toMesh(body:Body):Extract<Primitive,{kind:'triangle-mesh'}>{
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  for(const part of body.parts.filter(p=>p.paint)){
    for(const face of part.faces){const ids=face[2]===face[3]?[face[0],face[1],face[2]]:[face[0],face[1],face[2],face[0],face[2],face[3]];for(let i=0;i<ids.length;i+=3){const tri=ids.slice(i,i+3),base=positions.length/3,pts=tri.map(id=>part.vertices[id]!),world=pts.map(([x,y,z])=>[z,y+body.p.dimensions.rideHeight,x] as V3),a=world[0]!,b=world[1]!,c=world[2]!,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,L=Math.hypot(nx,ny,nz)||1;for(const q of world){positions.push(...q);normals.push(nx/L,ny/L,nz/L);}indices.push(base,base+1,base+2);}}
    }
  return{kind:'triangle-mesh',positions,normals,indices};
}

/** Shared three-box panel compiler, stripped of gameplay/damage state. */
export function generateDetailedThreeBoxBody(parameters:DetailedThreeBoxParameters):Extract<Primitive,{kind:'triangle-mesh'}>{return toMesh(buildPanels(parameters));}
/** Backwards-compatible M3 preset. */
export function generateM3DetailedProceduralBody():Extract<Primitive,{kind:'triangle-mesh'}>{return generateDetailedThreeBoxBody(M3_DETAILED_BODY_PARAMETERS);}


function surfaceMesh(quads:readonly (readonly [V3,V3,V3,V3])[],body:Body):Extract<Primitive,{kind:'triangle-mesh'}>{
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],world=([x,y,z]:V3):V3=>[z,y+body.p.dimensions.rideHeight,x];
  for(const quad of quads){const q=quad.map(world) as [V3,V3,V3,V3],base=positions.length/3,a=q[0],b=q[1],d=q[3],ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,L=Math.hypot(nx,ny,nz)||1;for(const p of q){positions.push(...p);normals.push(nx/L,ny/L,nz/L);}indices.push(base,base+1,base+2,base,base+2,base+3);}
  return{kind:'triangle-mesh',positions,normals,indices};
}
function windshieldPoint(body:Body,u:number,v:number):V3{
  const s=body.p.sculpt,raw=u*2-1,across=raw+Math.sign(raw)*s.windshieldColumnBias*(1-v)*Math.sin(Math.PI*Math.abs(raw)),bottom=panelDeckPoint(body,true,across,body.frontBase),top=roofSurfacePoint(body,across,body.roofFront),bulge=s.windshieldBulge*Math.sin(Math.PI*v);
  return[bottom[0]+(top[0]-bottom[0])*v,bottom[1]+(top[1]-bottom[1])*v+bulge*(.72+.28*across*across),bottom[2]+(top[2]-bottom[2])*v+bulge*.395*(1-across*across)];
}
/** Glass is compiled from the exact same cowl, roof, door and quarter-window causes as the metal shell. */
export function generateDetailedThreeBoxGlass(parameters:DetailedThreeBoxParameters):Extract<Primitive,{kind:'triangle-mesh'}>{
  const body=makeBody(parameters),quads:[V3,V3,V3,V3][]=[];
  // Front windshield: the original TheGame authored topology is exactly 4 x 2 quads.
  const front=Array.from({length:3},(_,j)=>Array.from({length:5},(_,i)=>windshieldPoint(body,i/4,j/2)));
  for(let j=0;j<2;j++)for(let i=0;i<4;i++)quads.push([front[j]![i]!,front[j]![i+1]!,front[j+1]![i+1]!,front[j+1]![i]!]);
  // Rear glass: 12 longitudinal strips with the same roof crown and rear deck boundary.
  const rearTop=(t:number):V3=>{const a=roofPoint(body,1,body.roofRear),b=roofPoint(body,-1,body.roofRear),q:V3=[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];q[1]+=body.p.roofCrown*(1-(t*2-1)**2);return q;};
  for(let i=0;i<12;i++){const a=i/12,b=(i+1)/12;quads.push([rearGlassBottom(body,1-2*a),rearGlassBottom(body,1-2*b),rearTop(b),rearTop(a)]);}
  const base=(side:number,z:number)=>panelSidePoint(body,side,panelBelt(body,z),z);
  for(const side of [1,-1] as const){
    const windowTop=(z:number):V3=>{if(z>body.roofFront){const a=sideRoofPoint(body,side,body.roofFront),b=base(side,body.frontBase),t=(z-body.roofFront)/(body.frontBase-body.roofFront),q:V3=[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];q[1]+=body.p.sculpt.windshieldBulge*Math.sin(Math.PI*t);return q;}if(z<body.roofRear){const a=sideRoofPoint(body,side,body.roofRear),b=base(side,body.rearBase),t=(body.roofRear-z)/(body.roofRear-body.rearBase);return[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];}return sideRoofPoint(body,side,z);};
    const doors=body.doors.filter(d=>d.side===side).sort((a,b)=>b.hingeZ-a.hingeZ);
    for(const door of doors){const g=body.gap*1.2,lo=door.hingeZ-door.width*.97+g,hi=door.hingeZ-g,zs=[...new Set([lo,hi,...Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4),...body.p.roof.map(s=>s[0]*body.length).filter(z=>z>lo&&z<hi)])].sort((a,b)=>a-b);for(let i=0;i<zs.length-1;i++){const a=zs[i]!,b=zs[i+1]!;quads.push([base(side,a),windowTop(a),windowTop(b),base(side,b)]);}}
    const rearDoor=doors.at(-1)!,end=rearDoor.hingeZ-rearDoor.width*.97,outer=base(side,body.rearBase),top=sideRoofPoint(body,side,body.roofRear),innerLow=base(side,body.p.quarterWindowEnd*body.length+body.p.quarterKick),u=.57,innerHigh:V3=[mix(top[0],outer[0],u),mix(top[1],outer[1],u),body.p.quarterWindowEnd*body.length],q:[V3,V3,V3,V3]=[base(side,end),windowTop(end),innerHigh,innerLow];quads.push(q);
  }
  return surfaceMesh(quads,body);
}
/** Backwards-compatible M3 preset. */
export function generateM3DetailedProceduralGlass():Extract<Primitive,{kind:'triangle-mesh'}>{return generateDetailedThreeBoxGlass(M3_DETAILED_BODY_PARAMETERS);}
