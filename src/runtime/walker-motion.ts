import type {Vec3} from '../math.js';
export interface WalkBox {readonly min:Vec3;readonly max:Vec3}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
/** Swept point against an expanded box. Returns entry time and separating axis. */
function hit(origin:Vec3,delta:Vec3,box:WalkBox,pad:Vec3):{time:number;axis:number}|undefined{
 let enter=-Infinity,leave=Infinity,axis=0;
 for(let k=0;k<3;k++){
  const lo=box.min[k]!-pad[k]!,hi=box.max[k]!+pad[k]!,o=origin[k]!,d=delta[k]!;
  if(Math.abs(d)<1e-12){if(o<=lo||o>=hi)return;continue;}
  const a=(lo-o)/d,b=(hi-o)/d,near=Math.min(a,b),far=Math.max(a,b);
  if(near>enter){enter=near;axis=k;}leave=Math.min(leave,far);
 }
 if(enter< -1e-8||enter>1||leave<=Math.max(0,enter))return;
 return{time:Math.max(0,enter),axis};
}
/** Static kinematic walking queries. Obstacles come from scene geometry before
 * render batching, not material/triangle batches whose bounds span the street. */
export class WalkWorld {
 private readonly cells=new Map<string,WalkBox[]>();
 constructor(readonly boxes:readonly WalkBox[],readonly bounds:WalkBox){
  for(const b of [...boxes,bounds])if(![...b.min,...b.max].every(Number.isFinite)||b.min.some((v,k)=>v>=b.max[k]!))throw new RangeError('Invalid walking bounds');
  for(const b of boxes)for(let x=Math.floor(b.min[0]/4);x<=Math.floor(b.max[0]/4);x++)for(let z=Math.floor(b.min[2]/4);z<=Math.floor(b.max[2]/4);z++){
   const key=x+':'+z,list=this.cells.get(key)??[];list.push(b);this.cells.set(key,list);
  }
 }
 private candidates(a:Vec3,b:Vec3,pad:number):WalkBox[]{
  const found=new Set<WalkBox>();
  for(let x=Math.floor((Math.min(a[0],b[0])-pad)/4);x<=Math.floor((Math.max(a[0],b[0])+pad)/4);x++)for(let z=Math.floor((Math.min(a[2],b[2])-pad)/4);z<=Math.floor((Math.max(a[2],b[2])+pad)/4);z++)for(const box of this.cells.get(x+':'+z)??[])found.add(box);
  return [...found];
 }
 move(position:Vec3,dx:number,dz:number,radius=.28,height=1.75):Vec3{
  if(![...position,dx,dz,radius,height].every(Number.isFinite)||radius<=0||height<=.35||Math.hypot(dx,dz)>100)throw new RangeError('Invalid walking movement');
  // A 35 cm step allowance permits kerbs; chest/legs still collide with walls.
  const half=(height-.35)/2,offset=.35+half,p:[number,number,number]=[position[0],position[1]+offset,position[2]];
  const delta:[number,number,number]=[dx,0,dz],pad:Vec3=[radius,half,radius];
  for(let iteration=0;iteration<3&&Math.hypot(delta[0],delta[2])>1e-8;iteration++){
   let nearest:{time:number;axis:number}|undefined;
   for(const b of this.candidates(p,[p[0]+delta[0],p[1],p[2]+delta[2]],radius)){const h=hit(p,delta,b,pad);if(h&&(!nearest||h.time<nearest.time))nearest=h;}
   if(!nearest){p[0]+=delta[0];p[2]+=delta[2];break;}
   const t=Math.max(0,nearest.time-1e-5);p[0]+=delta[0]*t;p[2]+=delta[2]*t;
   delta[0]*=1-t;delta[2]*=1-t;delta[nearest.axis]=0;
  }
  return[clamp(p[0],this.bounds.min[0]+radius,this.bounds.max[0]-radius),position[1],clamp(p[2],this.bounds.min[2]+radius,this.bounds.max[2]-radius)];
 }
 camera(target:Vec3,desired:Vec3):Vec3{
  const d:Vec3=[desired[0]-target[0],desired[1]-target[1],desired[2]-target[2]];let t=1;
  for(const b of this.candidates(target,desired,.15)){const h=hit(target,d,b,[.15,.15,.15]);if(h)t=Math.min(t,Math.max(0,h.time-.015));}
  return[target[0]+d[0]*t,target[1]+d[1]*t,target[2]+d[2]*t];
 }
}
export function walkerInput(forward:number,right:number,yaw:number,sprint:boolean):{speed:number;heading:number}{
 const length=Math.hypot(forward,right);return{speed:length<.08?0:(sprint?4.2:1.6)*Math.min(1,length),heading:length?yaw-Math.atan2(right,forward):yaw};
}
