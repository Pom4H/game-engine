import type {Vec3} from '../math.js';

export interface ProbeCaptureSpec {key:string;position:Vec3;boxHalfExtents:Vec3;radius:number;facesPerFrame:number}
export interface ProbeCaptureBatch {position:Vec3;boxHalfExtents:Vec3;faces:readonly number[];complete:boolean}

/** A capture sweep has one origin. Its image and parallax bounds become visible
 * together only after every face is ready; partial sweeps never replace it. */
export class ProbeCapture {
 private key='';private nextFace=0;private origin:Vec3|null=null;
 private current:ProbeCaptureBatch|null=null;
 get published():ProbeCaptureBatch|null{return this.current;}
 get face():number{return this.nextFace;}
 plan(spec:ProbeCaptureSpec):ProbeCaptureBatch{
  const dx=spec.position[0]-(this.origin?.[0]??spec.position[0]),dy=spec.position[1]-(this.origin?.[1]??spec.position[1]),dz=spec.position[2]-(this.origin?.[2]??spec.position[2]);
  if(this.key!==spec.key||dx*dx+dy*dy+dz*dz>Math.max(2,spec.radius*.16)**2){this.reset();this.key=spec.key;}
  if(this.nextFace===0||!this.origin)this.origin=[...spec.position];
  // Do not wrap into another sweep: facesPerFrame need not divide six.
  const end=Math.min(6,this.nextFace+spec.facesPerFrame);
  return{position:this.origin,boxHalfExtents:[...spec.boxHalfExtents],faces:Array.from({length:end-this.nextFace},(_,i)=>this.nextFace+i),complete:end===6};
 }
 commit(batch:ProbeCaptureBatch):void{
  this.nextFace=batch.complete?0:batch.faces.at(-1)!+1;
  if(batch.complete)this.current=batch;
 }
 reset():void{this.key='';this.nextFace=0;this.origin=null;this.current=null;}
}
