import type {WorkBudget} from '../core/work-budget.js';
import type {EnvironmentMip} from './environment-bake.js';
/** Incremental copy into a private cubemap. The owner swaps the texture only after
 * all faces/mips have arrived. Each write is <=64 KiB, each call obeys its budget. */
export class EnvironmentUpload {
 private level=0;private face=0;private row=0;
 uploadedBytes=0;
 constructor(readonly mips:readonly EnvironmentMip[],private readonly write:(mip:number,face:number,row:number,size:number,rows:number,pixels:Uint16Array)=>void){
  if(mips.length!==9||mips.some((m,i)=>m.mip!==i||m.size!==Math.max(1,256>>i)||!(m.pixels instanceof Uint16Array)||m.pixels.length!==m.size*m.size*6*4))throw new RangeError('Invalid cubemap transfer');
 }
 advance(budget:WorkBudget):boolean{
  while(this.level<this.mips.length){
   const m=this.mips[this.level]!,rowBytes=m.size*8,rows=Math.min(m.size-this.row,Math.floor(Math.min(64*1024,budget.availableBytes)/rowBytes));
   if(!rows||!budget.claim(rows*rowBytes))return false;
   const offset=(this.face*m.size+this.row)*m.size*4;
   this.write(m.mip,this.face,this.row,m.size,rows,m.pixels.subarray(offset,offset+rows*m.size*4));
   this.uploadedBytes+=rows*rowBytes;this.row+=rows;
   if(this.row===m.size){this.row=0;this.face++;if(this.face===6){this.face=0;this.level++;}}
  }
  return true;
 }
}
