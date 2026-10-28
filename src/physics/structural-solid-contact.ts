import type {SolidBox,SolidPlane} from './compound.js';
import type {StructuralBody} from './structure.js';
import {castRoundedTrianglePrism,closestPrismPoint} from './triangle-prism.js';
import {StructuralUnilateralContact} from './structural-unilateral-contact.js';

type ContactRow={contact:StructuralUnilateralContact;seen:number};
type ContactFrame={step:number;serial:number;cursor:Uint32Array;maps:Map<object,Map<number,ContactRow>>[];pool:ContactRow[][];active:ContactRow[]};
/** Physical exterior margin shared with a dormant material body's facade. */
export const STRUCTURAL_CONTACT_SKIN=.006;

/** A node-centred convex volume. `radius` bounds it for broad phase; support
 * returns its extent along a unit world normal (for example an oriented tyre). */
export type StructuralContactSphere={node:number;radius:number;enabled?:()=>boolean;normalEnabled?:(normal:readonly number[])=>boolean;support?:(normal:readonly number[])=>number};
export type StructuralContactSection={a:number;b:number;radius:number;constraint:number};
/** A physical surface point embedded in a material chart. Signed affine
 * weights name one and the same point in geometry, mass and reaction space;
 * chart quadrature nodes themselves need not lie on physical material. */
export type StructuralMaterialContactSample={readonly nodes:readonly number[];readonly weights:readonly number[];readonly radius:number;readonly support?:(normal:readonly number[],body:StructuralBody)=>number;readonly enabled?:(body:StructuralBody)=>boolean};
type CompiledMaterialSample={nodes:Float64Array;weights:Float64Array};

/** Position constraints against the same oriented solids queried by rigid bodies.
 * Reusable scalar scratch, bounded samples, and swept face selection for thin walls.
 * Position projection reconstructs contact velocity once in StructuralBody.finishStep;
 * penetration correction is never added again as a rebound velocity. */
export class StructuralSolidContactSolver {
 readonly samples:readonly (readonly [number,number])[];
 private readonly local=new Float64Array(6);
 private bounds=new Float64Array(0);
 private readonly radii:readonly number[];
 private readonly maxRadius:number;
 private readonly weights:readonly number[];private readonly constraints:readonly number[];
 private readonly volumes:readonly (StructuralContactSphere|undefined)[];
 private readonly materialSamples:readonly(StructuralMaterialContactSample|undefined)[];
 readonly #materialMath:readonly(CompiledMaterialSample|undefined)[];
 private readonly materialPoint=new Float64Array(3);
 private readonly contactFrames=new WeakMap<StructuralBody,ContactFrame>();
 private readonly direction:[number,number,number]=[0,0,0];
 constructor(bodyNodes:number,edges:readonly {a:number;b:number}[]=[],spheres:readonly StructuralContactSphere[]=[],sections:readonly StructuralContactSection[]=[],materialSamples:readonly StructuralMaterialContactSample[]=[]){
  const samples:Array<readonly [number,number]>=[];
  for(let i=0;i<bodyNodes;i++)samples.push([i,i]);
  for(const edge of edges)if(edge.a<bodyNodes&&edge.b<bodyNodes)samples.push([edge.a,edge.b]);
  const radii=Array<number>(samples.length).fill(0),volumes:Array<StructuralContactSphere|undefined>=Array(samples.length).fill(undefined);
  for(const sphere of spheres){
   if(!Number.isInteger(sphere.node)||sphere.node<0||!Number.isFinite(sphere.radius)||sphere.radius<=0)throw new RangeError('Invalid structural contact sphere');
   samples.push([sphere.node,sphere.node]);radii.push(sphere.radius);volumes.push(sphere);
  }
  const weights:number[]=samples.map(([a,b])=>a===b?0:.5),constraints=Array<number>(samples.length).fill(-1);
  // Three bounded interior samples retain the visible pipe section. Fractured
  // members stop projecting immediately; disconnected endpoints are not a pipe.
  for(const section of sections){
   if(![section.a,section.b,section.constraint].every(n=>Number.isInteger(n)&&n>=0)||!(section.radius>0&&Number.isFinite(section.radius)))throw new RangeError('Invalid structural contact section');
   for(const t of [.25,.5,.75]){samples.push([section.a,section.b]);radii.push(section.radius);weights.push(t);constraints.push(section.constraint);volumes.push(undefined);}
  }
  const material:Array<StructuralMaterialContactSample|undefined>=samples.map(()=>undefined),materialMath:Array<CompiledMaterialSample|undefined>=samples.map(()=>undefined);
  for(const point of materialSamples){
   if(!point.nodes.length||point.nodes.length!==point.weights.length||point.nodes.some(i=>!Number.isSafeInteger(i)||i<0)||new Set(point.nodes).size!==point.nodes.length||point.weights.some(w=>!Number.isFinite(w))||Math.abs(point.weights.reduce((s,w)=>s+w,0)-1)>1e-8||!(point.radius>=0&&Number.isFinite(point.radius)))throw new RangeError('Invalid structural material surface sample');
   const owned:StructuralMaterialContactSample=Object.freeze({...point,nodes:Object.freeze([...point.nodes]),weights:Object.freeze([...point.weights])});samples.push([owned.nodes[0]!,owned.nodes[0]!]);radii.push(owned.radius);volumes.push(undefined);weights.push(0);constraints.push(-1);material.push(owned);
   // Keep the immutable callback descriptor public-facing. Numerical loops
   // own exact Float64 copies, including signed zero and every zero-weight term.
   // Float64 indices preserve the existing safe-integer/range error contract.
   materialMath.push({nodes:Float64Array.from(owned.nodes),weights:Float64Array.from(owned.weights)});
  }
  this.weights=weights;this.constraints=constraints;this.volumes=volumes;this.materialSamples=material;this.#materialMath=materialMath;
  this.samples=samples;this.radii=radii;this.maxRadius=Math.max(0,...radii);
 }
 private samplePoint(body:StructuralBody,sample:CompiledMaterialSample,previous=false){const out=this.materialPoint,p=previous?body.previous:body.position;let x=0,y=0,z=0;for(let i=0;i<sample.nodes.length;i++){const j=sample.nodes[i]!*3,w=sample.weights[i]!;x+=p[j]!*w;y+=p[j+1]!*w;z+=p[j+2]!*w;}out[0]=x;out[1]=y;out[2]=z;return out;}
 private support(sample:number,normal:readonly number[],body:StructuralBody){return this.materialSamples[sample]?.support?.(normal,body)??this.volumes[sample]?.support?.(normal)??this.radii[sample]!;}
 project(body:StructuralBody,boxes:readonly SolidBox[],planes:readonly SolidPlane[]):void{
  const pos=body.position,prev=body.previous,local=this.local;
  let frame=this.contactFrames.get(body);if(!frame){frame={step:-1,serial:0,cursor:new Uint32Array(this.samples.length),maps:this.samples.map(()=>new Map()),pool:this.samples.map(()=>[]),active:[]};this.contactFrames.set(body,frame);}
  if(frame.step!==body.steps){frame.step=body.steps;frame.cursor.fill(0);for(const map of frame.maps)map.clear();frame.active.length=0;}frame.serial++;
  if(this.bounds.length<boxes.length*6)this.bounds=new Float64Array(2**Math.ceil(Math.log2(boxes.length*6)));
  const bounds=this.bounds;
  for(let i=0;i<boxes.length;i++){
   const box=boxes[i]!;
   for(let k=0;k<3;k++){
    if(box.triangle){bounds[i*6+k]=box.triangle.bounds[k]!-STRUCTURAL_CONTACT_SKIN-this.maxRadius;bounds[i*6+3+k]=box.triangle.bounds[k+3]!+STRUCTURAL_CONTACT_SKIN+this.maxRadius;continue;}
    const padding=STRUCTURAL_CONTACT_SKIN+this.maxRadius,extent=Math.abs(box.axes[0]![k]!)*(box.half[0]!+padding)+Math.abs(box.axes[1]![k]!)*(box.half[1]!+padding)+Math.abs(box.axes[2]![k]!)*(box.half[2]!+padding)+1e-9;
    bounds[i*6+k]=box.p[k]!-extent;bounds[i*6+3+k]=box.p[k]!+extent;
   }
  }
  for(let sample=0;sample<this.samples.length;sample++){
   const volume=this.volumes[sample],material=this.materialSamples[sample],math=this.#materialMath[sample];if(volume?.enabled&&!volume.enabled())continue;
   const constraint=this.constraints[sample]!;if(constraint>=0&&body.broken[constraint])continue;
   const [a,b]=this.samples[sample]!,padding=STRUCTURAL_CONTACT_SKIN+this.radii[sample]!;
   const A=a*3,B=b*3,wb=this.weights[sample]!,wa=1-wb;let inv=body.inverseMass[a]!*wa*wa+body.inverseMass[b]!*wb*wb;
   if(material){let live=true;inv=0;for(let i=0;i<math!.nodes.length;i++){const node=math!.nodes[i]!,w=math!.weights[i]!;if(node>=body.nodeCount)throw new RangeError('Material surface sample exceeds its structural owner');if(w!==0&&body.mass[node]!<=0)live=false;inv+=body.inverseMass[node]!*w*w;}if(!live)continue;}
   else if(wa>0&&body.mass[a]!<=0||wb>0&&body.mass[b]!<=0)continue;
   if(inv<=0)continue;
   let x=pos[A]!*wa+pos[B]!*wb,y=pos[A+1]!*wa+pos[B+1]!*wb,z=pos[A+2]!*wa+pos[B+2]!*wb;
   let px=prev[A]!*wa+prev[B]!*wb,py=prev[A+1]!*wa+prev[B+1]!*wb,pz=prev[A+2]!*wa+prev[B+2]!*wb;
   if(material){let p=this.samplePoint(body,math!);x=p[0]!;y=p[1]!;z=p[2]!;p=this.samplePoint(body,math!,true);px=p[0]!;py=p[1]!;pz=p[2]!;}
   for(let boxIndex=0;boxIndex<boxes.length;boxIndex++){
    const box=boxes[boxIndex]!,offset=boxIndex*6;
    // Conservative swept world AABB. Distant barriers from a broad spatial cell
    // cannot touch this sample; retain the exact oriented test and ordering nearby.
    if(Math.max(x,px)<bounds[offset]!||Math.min(x,px)>bounds[offset+3]!||Math.max(y,py)<bounds[offset+1]!||Math.min(y,py)>bounds[offset+4]!||Math.max(z,pz)<bounds[offset+2]!||Math.min(z,pz)>bounds[offset+5]!)continue;
    if(box.triangle!==undefined){
     if(!box.triangle)continue;
     const now=[x,y,z],old=[px,py,pz],delta=[x-px,y-py,z-pz],closest=closestPrismPoint(now,box.triangle);
     let hit=castRoundedTrianglePrism(old,delta,1,padding,box.triangle);
     // Node/section spheres are exact. An oriented convex wheel uses its
     // finite directional extent at the selected prism feature, as on OBBs.
     if(hit&&(volume?.support||material?.support))for(let refine=0;refine<3;refine++){const extent=this.support(sample,hit.n,body)+STRUCTURAL_CONTACT_SKIN,next=castRoundedTrianglePrism(old,delta,1,extent,box.triangle);if(!next){hit=null;break;}const same=Math.abs(next.t-hit.t)<1e-10;hit=next;if(same)break;}
     const n=hit?.n??closest.normal,surface=hit?.p??closest.point,extent=this.support(sample,n,body)+STRUCTURAL_CONTACT_SKIN;
     if(!hit&&closest.distance>extent&&!frame.maps[sample]!.has(box))continue;
     const depth=extent-((x-surface[0]!)*n[0]!+(y-surface[1]!)*n[1]!+(z-surface[2]!)*n[2]!);
     this.moveSample(body,frame,sample,box,0,a,b,wa,wb,n[0]!,n[1]!,n[2]!,depth,inv);
     if(material){const p=this.samplePoint(body,math!);x=p[0]!;y=p[1]!;z=p[2]!;}else{x=pos[A]!*wa+pos[B]!*wb;y=pos[A+1]!*wa+pos[B+1]!*wb;z=pos[A+2]!*wa+pos[B+2]!*wb;}continue;
    }
    for(let k=0;k<3;k++){
     const axis=box.axes[k]!,dx=x-box.p[0]!,dy=y-box.p[1]!,dz=z-box.p[2]!;
     const oldX=px-box.p[0]!,oldY=py-box.p[1]!,oldZ=pz-box.p[2]!;
     local[k]=dx*axis[0]!+dy*axis[1]!+dz*axis[2]!;local[k+3]=oldX*axis[0]!+oldY*axis[1]!+oldZ*axis[2]!;
    }
    let enter=0,exit=1,face=-1,sign=0,inside=true,nearest=Infinity,nearAxis=0,nearSign=1;
    for(let k=0;k<3;k++){
     const half=box.half[k]!+this.support(sample,box.axes[k]!,body)+STRUCTURAL_CONTACT_SKIN,now=local[k]!,old=local[k+3]!,delta=now-old,gap=half-Math.abs(now);
     if(gap<0)inside=false;if(gap<nearest){nearest=gap;nearAxis=k;nearSign=now>=0?1:-1;}
     if(Math.abs(delta)<1e-12){if(Math.abs(old)>half){exit=-1;break;}continue;}
     let t0=(-half-old)/delta,t1=(half-old)/delta,s=-1;if(t0>t1){[t0,t1]=[t1,t0];s=1;}
     if(t0>=enter){enter=t0;face=k;sign=s;}exit=Math.min(exit,t1);
     if(enter>exit)break;
    }
    if(!(enter<=exit&&enter<=1&&exit>=0))continue;
    if(face<0){if(!inside)continue;face=nearAxis;sign=nearSign;}
    const depth=box.half[face]!+this.support(sample,box.axes[face]!,body)+STRUCTURAL_CONTACT_SKIN-sign*local[face]!;
    const n=box.axes[face]!;
    this.moveSample(body,frame,sample,box,face*2+(sign>0?1:0),a,b,wa,wb,n[0]!*sign,n[1]!*sign,n[2]!*sign,depth,inv);
    if(material){const p=this.samplePoint(body,math!);x=p[0]!;y=p[1]!;z=p[2]!;}else{x=pos[A]!*wa+pos[B]!*wb;y=pos[A+1]!*wa+pos[B+1]!*wb;z=pos[A+2]!*wa+pos[B+2]!*wb;}
   }
   for(const plane of planes){
    const n=plane.n;
    const dx=x-plane.p[0]!,dy=y-plane.p[1]!,dz=z-plane.p[2]!;
    // A material sample's declared radius bounds every directional extent.
    // No incident-face normal is needed in empty space, while existing rows
    // still receive their positive gap so an old reaction can unload.
    if(material&&(dx*n[0]!+dy*n[1]!+dz*n[2]!)>STRUCTURAL_CONTACT_SKIN+this.radii[sample]!&&!frame.maps[sample]!.has(plane))continue;
    const depth=this.support(sample,n,body)+STRUCTURAL_CONTACT_SKIN-(dx*n[0]!+dy*n[1]!+dz*n[2]!);
    if(depth>.5+this.radii[sample]!*2)continue;
    const u=dx*plane.u[0]!+dy*plane.u[1]!+dz*plane.u[2]!,v=dx*plane.v[0]!+dy*plane.v[1]!+dz*plane.v[2]!;
    if(Math.abs(u)>plane.hu||Math.abs(v)>plane.hv||plane.filter&&!plane.filter([x,y,z]))continue;
    this.moveSample(body,frame,sample,plane,0,a,b,wa,wb,n[0]!,n[1]!,n[2]!,depth,inv);
    if(material){const p=this.samplePoint(body,math!);x=p[0]!;y=p[1]!;z=p[2]!;}else{x=pos[A]!*wa+pos[B]!*wb;y=pos[A+1]!*wa+pos[B+1]!*wb;z=pos[A+2]!*wa+pos[B+2]!*wb;}
   }
  }
  // A previous finite face/filter/retired sample can disappear entirely from
  // this iteration's candidates. Its old generalized force must disappear too.
  for(const row of frame.active)if(row.seen!==frame.serial)row.contact.release();
 }
 private moveSample(body:StructuralBody,frame:ContactFrame,sample:number,source:object,feature:number,a:number,b:number,wa:number,wb:number,x:number,y:number,z:number,depth:number,inverse:number){
  const material=this.materialSamples[sample];if(material?.enabled&&!material.enabled(body))return;
  const enabled=this.volumes[sample]?.normalEnabled;if(enabled){const n=this.direction;n[0]=x;n[1]=y;n[2]=z;if(!enabled(n))return;}
  if(body.linearSolverBackend!==undefined){let byFeature=frame.maps[sample]!.get(source),row=byFeature?.get(feature);if(!row){if(depth<=0)return;const index=frame.cursor[sample]!,pool=frame.pool[sample]!;row=pool[index];if(!row){row={contact:new StructuralUnilateralContact(body,material?.nodes??(a===b?[a]:[a,b])),seen:0};pool.push(row);}frame.cursor[sample]=index+1;if(!byFeature){byFeature=new Map();frame.maps[sample]!.set(source,byFeature);}byFeature.set(feature,row);frame.active.push(row);}row.seen=frame.serial;const g=row.contact.gradient;if(material){const math=this.#materialMath[sample]!;for(let i=0;i<math.nodes.length;i++){const w=math.weights[i]!;g[i*3]=x*w;g[i*3+1]=y*w;g[i*3+2]=z*w;}}else{g[0]=x*wa;g[1]=y*wa;g[2]=z*wa;if(a!==b){g[3]=x*wb;g[4]=y*wb;g[5]=z*wb;}}row.contact.project(-depth);return;}
  if(depth<=0)return;
  const scale=depth/inverse;if(material){const math=this.#materialMath[sample]!;for(let i=0;i<math.nodes.length;i++){const node=math.nodes[i]!;this.move(body,node,x,y,z,scale*body.inverseMass[node]!*math.weights[i]!);}}else{this.move(body,a,x,y,z,scale*body.inverseMass[a]!*wa);if(wb)this.move(body,b,x,y,z,scale*body.inverseMass[b]!*wb);}
 }
 private move(body:StructuralBody,node:number,x:number,y:number,z:number,scale:number){const j=node*3;body.position[j]=body.position[j]!+x*scale;body.position[j+1]=body.position[j+1]!+y*scale;body.position[j+2]=body.position[j+2]!+z*scale;}
}
