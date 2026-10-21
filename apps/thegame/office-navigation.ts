import {inCorridor,toLocal,officeObstacles,type OfficeLayout} from './office-layout.js';
import type {OfficeState,Vec3} from './shared.js';
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
export class OfficeNavigation {
 readonly minZ:number;
 readonly step=.42;readonly width:number;readonly depth:number;private readonly startX:number;private readonly startZ:number;
 readonly blocked:Uint8Array;readonly costs:Float32Array;
 constructor(layout:OfficeLayout,state:OfficeState,ignored:ReadonlySet<string>=new Set()){
  const bound=state.placement;this.startX=bound?-bound.width/2+.35:-13.23;this.startZ=bound?-bound.depth/2+.35:-8.4;this.minZ=bound?this.startZ:-8.15;
  this.width=bound?Math.ceil((bound.width-.7)/this.step):64;this.depth=bound?Math.ceil((bound.depth-.7)/this.step):44;
  this.blocked=new Uint8Array(this.width*this.depth);this.costs=new Float32Array(this.blocked.length);
  const solid=officeObstacles(layout,state,ignored);
  for(let i=0;i<this.blocked.length;i++){
   const p=this.position(i),point={x:p[0],z:p[2]};this.costs[i]=layout.corridors.some(c=>inCorridor(c,point))?.8:1.15;
   if(p[0]<(bound?this.startX:-13.2)||p[0]>(bound?bound.width/2-.35:13.2)||p[2]<this.minZ||p[2]>(bound?bound.depth/2-.35:9.15)){this.blocked[i]=1;continue;}
   for(const b of solid){const q=toLocal(b,point),x=b.width/2+.32,z=b.depth/2+.32;if(b.kind==='island'?(q.x/x)**2+(q.z/z)**2<1:Math.abs(q.x)<x&&Math.abs(q.z)<z){this.blocked[i]=1;break;}}
  }
 }
 position(n:number):Vec3{return[this.startX+n%this.width*this.step,.055,this.startZ+Math.floor(n/this.width)*this.step];}
 isFree(p:Vec3){const x=Math.round((p[0]-this.startX)/this.step),z=Math.round((p[2]-this.startZ)/this.step);return x>=0&&x<this.width&&z>=0&&z<this.depth&&!this.blocked[x+z*this.width];}
 private nearest(p:Vec3){const x=clamp(Math.round((p[0]-this.startX)/this.step),0,this.width-1),z=clamp(Math.round((p[2]-this.startZ)/this.step),0,this.depth-1),node=x+z*this.width;if(!this.blocked[node])return node;let best=node,distance=Infinity;for(let i=0;i<this.blocked.length;i++)if(!this.blocked[i]){const q=this.position(i),d=Math.hypot(q[0]-p[0],q[2]-p[2]);if(d<distance){best=i;distance=d;}}return best;}
 route(from:Vec3,to:Vec3):Vec3[]{
  const start=this.nearest(from),goal=this.nearest(to);if(this.blocked[start]||this.blocked[goal])return[];if(start===goal)return[this.position(goal)];
  const costs=new Float32Array(this.blocked.length).fill(Infinity),parents=new Int32Array(this.blocked.length).fill(-1),open=new Set([start]),closed=new Uint8Array(this.blocked.length),g=this.position(goal);costs[start]=0;
  const heuristic=(n:number)=>{const p=this.position(n);return Math.hypot(p[0]-g[0],p[2]-g[2])*.8;};
  while(open.size){let node=start,score=Infinity;for(const n of open){const f=costs[n]!+heuristic(n);if(f<score){score=f;node=n;}}
   if(node===goal){const result:Vec3[]=[];let n=goal;while(n!==start&&n>=0){result.push(this.position(n));n=parents[n]!;}return result.reverse();}
   open.delete(node);closed[node]=1;const x=node%this.width,z=Math.floor(node/this.width);
   for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const){const xx=x+dx,zz=z+dz;if(xx<0||xx>=this.width||zz<0||zz>=this.depth)continue;const next=xx+zz*this.width;if(this.blocked[next]||closed[next]||(dx&&dz&&(this.blocked[x+dx+z*this.width]||this.blocked[x+(z+dz)*this.width])))continue;const cost=costs[node]!+this.step*(dx&&dz?Math.SQRT2:1)*this.costs[next]!;if(cost<costs[next]!){costs[next]=cost;parents[next]=node;open.add(next);}}
  }return[];
 }
}
