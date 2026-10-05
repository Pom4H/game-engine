import {MeshStream} from '../procedural/mesh-stream.js';
import {decodePackedMesh} from '../assets/packed-mesh.js';
import {FACE_REFERENCE} from '../assets/face-reference.js';
import type {FaceIdentity} from './expressive-face.js';

/** Authored flex targets, not a soft-tissue physics simulation. */
export interface FaceSurfaceControls {
  width:number;gap:number;protrusion:number;jaw:number;
  smileLeft:number;smileRight:number;browLeft:number;browRight:number;browTiltLeft:number;browTiltRight:number;
  cheekLeft:number;cheekRight:number;squint:number;squintLeft:number;squintRight:number;sneerLeft:number;sneerRight:number;blink:number;gazeY:number;
}
export const neutralFaceSurface=():FaceSurfaceControls=>({width:.047,gap:.003,protrusion:0,jaw:0,smileLeft:0,smileRight:0,browLeft:0,browRight:0,browTiltLeft:.5,browTiltRight:.5,cheekLeft:0,cheekRight:0,squint:0,squintLeft:0,squintRight:0,sneerLeft:0,sneerRight:0,blink:0,gazeY:0});
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(x:number)=>{x=clamp(x);return x*x*(3-2*x);};
const gauss=(x:number,m:number,s:number)=>Math.exp(-(((x-m)/s)**2));
const fields=Object.keys(neutralFaceSurface()) as (keyof FaceSurfaceControls)[];
function bytes(base64:string):Uint8Array{return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}
function u16(base64:string):Uint16Array{const b=bytes(base64),d=new DataView(b.buffer),a=new Uint16Array(b.length/2);for(let i=0;i<a.length;i++)a[i]=d.getUint16(i*2,true);return a;}
function f32(base64:string):Float32Array{const b=bytes(base64),d=new DataView(b.buffer),a=new Float32Array(b.length/4);for(let i=0;i<a.length;i++)a[i]=d.getFloat32(i*4,true);return a;}
function normalsFor(p:Float64Array,indices:readonly number[],out:Float64Array):void{
  out.fill(0);
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3,ux=p[b]!-p[a]!,uy=p[b+1]!-p[a+1]!,uz=p[b+2]!-p[a+2]!,vx=p[c]!-p[a]!,vy=p[c+1]!-p[a+1]!,vz=p[c+2]!-p[a+2]!;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const v of [a,b,c]){out[v]=out[v]!+nx;out[v+1]=out[v+1]!+ny;out[v+2]=out[v+2]!+nz;}
  }
  for(let i=0;i<out.length;i+=3){const n=Math.hypot(out[i]!,out[i+1]!,out[i+2]!)||1;out[i]=out[i]!/n;out[i+1]=out[i+1]!/n;out[i+2]=out[i+2]!/n;}
}
export function validateFaceIdentity(identity:FaceIdentity):void{
  for(const key of ['skin','iris'] as const)if(identity[key].length!==4||identity[key].some(v=>!Number.isFinite(v)||v<0||v>1))throw new RangeError('Invalid face '+key);
  for(const [key,lo,hi] of [['jawWidth',.8,1.2],['cheekbone',0,.02],['noseLength',.015,.055]] as const)if(!Number.isFinite(identity[key])||identity[key]<lo||identity[key]>hi)throw new RangeError('Invalid face '+key);
}

/** One anatomically authored CC0 skin surface, procedurally varied and flexed.
 * A sparse geodesic binding moves neighboring skin with the lips and eyelids.
 * No per-pose mesh cache; one fixed-topology stream survives for the rig's life.
 * Mouth vertices themselves preserve the acoustic aperture, not just a dummy
 * ellipse hidden behind a second animation. Source/data provenance is explicit. */
export class FaceSurface {
  readonly stream:MeshStream;
  readonly mouthBoundary:readonly number[]=FACE_REFERENCE.mouth;
  readonly eyeBoundaries:readonly (readonly number[])[]=FACE_REFERENCE.eyes;
  private readonly base:Float64Array;
  private readonly positions:Float64Array;
  private readonly normals:Float64Array;
  private readonly indices:readonly number[];
  private readonly mask:Float64Array;
  private readonly anchors:readonly number[]=[...FACE_REFERENCE.mouth,...FACE_REFERENCE.eyes.flat()];
  private readonly deltas=new Float64Array(this.anchors.length*3);
  private readonly bound=u16(FACE_REFERENCE.binding.verticesU16);
  private readonly influence=u16(FACE_REFERENCE.binding.controlsU16);
  private readonly weight=f32(FACE_REFERENCE.binding.weightsF32);
  private readonly mouthU=Float64Array.from(FACE_REFERENCE.mouthU);
  private readonly mouthV=new Float64Array(FACE_REFERENCE.mouth.length);
  private last:number[]=[];
  constructor(identity:FaceIdentity){
    validateFaceIdentity(identity);
    const mesh=decodePackedMesh(FACE_REFERENCE),p=Float64Array.from(mesh.positions),n=p.length/3;
    this.base=p;this.positions=new Float64Array(p);this.normals=new Float64Array(p.length);this.indices=mesh.indices;this.mask=new Float64Array(n*5);
    const colors:number[]=[];
    for(let v=0;v<n;v++){
      const k=v*3,x=p[k]!,y=p[k+1]!,z=p[k+2]!,front=smooth((x+.02)/.08);
      const cheek=gauss(y,-.012,.026)*gauss(Math.abs(z),.050,.025)*front,jaw=smooth((-.035-y)/.06)*front,brow=gauss(y,.056,.015)*gauss(Math.abs(z),.035,.020)*front;
      p[k]=x+(identity.cheekbone-.007)*cheek+(identity.noseLength-.031)*gauss(y,-.004,.016)*gauss(z,0,.016)*front;
      p[k+2]=z*(1+(identity.jawWidth-1)*jaw*.55);
      this.mask.set([cheek,jaw,brow,z<0?-1:1,front],v*5);
      const arch=.052+.008*gauss(Math.abs(z),.033,.016),hair=front*gauss(y,arch,.0022)*smooth((Math.abs(z)-.013)/.007)*smooth((.060-Math.abs(z))/.010);
      const beard=identity.stubble?.18*front*smooth((-.025-y)/.022):0;
      const lip=front*gauss(y,-.045,.006)*smooth((.030-Math.abs(z))/.009),freckle=identity.freckles&&Math.sin(v*12.9898)*43758.5453%1>.92&&Math.abs(z)>.028&&y<.02&&y>-.025?.07:0;
      colors.push(clamp(1-.77*hair-beard-freckle),clamp(1-.84*hair-beard-.10*cheek-.30*lip-freckle),clamp(1-.86*hair-beard-.07*cheek-.22*lip-freckle),1);
    }
    // Upper/lower edge share U samples. Any common smile curve is an
    // area-preserving shear; the polygon integral sets the gap scale exactly.
    const u=this.mouthU,lo=u.indexOf(Math.min(...u)),hi=u.indexOf(Math.max(...u));
    for(let i=0;i<u.length;i++)this.mouthV[i]=(i<lo||i>hi?1:-1)*Math.sqrt(Math.max(0,1-u[i]!**2));
    let cross=0;for(let i=0;i<u.length;i++){const j=(i+1)%u.length;cross+=u[i]!*this.mouthV[j]!-this.mouthV[i]!*u[j]!;}
    const correction=Math.PI/Math.abs(cross*.5);for(let i=0;i<u.length;i++)this.mouthV[i]=this.mouthV[i]!*correction;
    this.evaluate(neutralFaceSurface());normalsFor(this.positions,this.indices,this.normals);
    this.stream=new MeshStream({...mesh,positions:[...this.positions],normals:[...this.normals],colors});
  }
  private evaluate(c:FaceSurfaceControls):void{
    const p=this.positions,b=this.base,m=this.mask,d=this.deltas;
    for(let v=0;v<p.length/3;v++){
      const k=v*3,o=v*5,left=m[o+3]!<0,smile=left?c.smileLeft:c.smileRight,cheek=left?c.cheekLeft:c.cheekRight,brow=left?c.browLeft:c.browRight,tilt=(left?c.browTiltLeft:c.browTiltRight)-.5,sneer=left?c.sneerLeft:c.sneerRight;
      const upperLip=gauss(b[k+1]!,-.036,.011)*gauss(Math.abs(b[k+2]!),.024,.027)*m[o+4]!,noseWrinkle=gauss(b[k+1]!,-.010,.015)*gauss(Math.abs(b[k+2]!),.022,.020)*m[o+4]!;
      p[k]=b[k]!+.003*(smile+cheek)*m[o]!-.002*Math.sin(c.jaw)*m[o+1]!+.0028*sneer*(upperLip+noseWrinkle*.45);
      p[k+1]=b[k+1]!+.005*(smile+cheek)*m[o]!+(.007*brow+.12*tilt*(Math.abs(b[k+2]!)-.035))*m[o+2]!-.060*Math.sin(c.jaw)*m[o+1]!+.0048*sneer*upperLip+.0024*sneer*noseWrinkle;
      p[k+2]=b[k+2]!+m[o+3]!*(.002*smile+.0014*sneer)*(m[o]!+upperLip*.8);
    }
    const mouthCount=this.mouthBoundary.length,cy=-.043-c.gap*.30-.011*Math.sin(c.jaw);
    for(let i=0;i<this.anchors.length;i++){
      const k=this.anchors[i]!*3;let x:number,y:number,z:number;
      if(i<mouthCount){
        const u=this.mouthU[i]!,v=this.mouthV[i]!,smile=u<0?c.smileLeft:c.smileRight,sneer=u<0?c.sneerLeft:c.sneerRight;
        x=b[k]!-.002+c.protrusion+.0012*sneer*(1-Math.abs(u));z=c.width*.5*u;y=cy+c.gap*.5*v+(.0045*smile+.0058*sneer)*u*u;
      }else{
        z=b[k+2]!;const center=z<0?-.03385:.03385,left=z<0,blink=clamp(c.blink+c.squint*.32+(left?c.squintLeft:c.squintRight)*.62);
        const line=.0282+.035*(Math.abs(z)-.03385);
        y=b[k+1]!+(line-b[k+1]!)*blink+c.gazeY*.25;
        x=.07456+Math.sqrt(Math.max(0,.0140**2-(z-center)**2-(y-.029)**2))+.00055;
      }
      d[i*3]=x-p[k]!;d[i*3+1]=y-p[k+1]!;d[i*3+2]=z-p[k+2]!;
    }
    for(let r=0;r<this.bound.length;r++){
      const k=this.bound[r]!*3;
      for(let j=0;j<8;j++){const at=r*8+j,w=this.weight[at]!,a=this.influence[at]!*3;p[k]=p[k]!+w*d[a]!;p[k+1]=p[k+1]!+w*d[a+1]!;p[k+2]=p[k+2]!+w*d[a+2]!;}
    }
    for(let i=0;i<this.anchors.length;i++){const k=this.anchors[i]!*3;for(let j=0;j<3;j++)p[k+j]=p[k+j]!+d[i*3+j]!;}
  }
  update(c:FaceSurfaceControls):void{
    const values=fields.map(k=>c[k]);
    if(values.some(v=>!Number.isFinite(v))||c.width<=0||c.width>.12||c.gap<0||c.gap>.08||c.protrusion<0||c.protrusion>.03||c.jaw<0||c.jaw>1||Math.abs(c.gazeY)>.03)throw new RangeError('Invalid facial surface controls');
    for(const key of ['smileLeft','smileRight','browLeft','browRight','browTiltLeft','browTiltRight','cheekLeft','cheekRight','squint','squintLeft','squintRight','sneerLeft','sneerRight','blink'] as const)if(c[key]<0||c[key]>1)throw new RangeError('Invalid facial action '+key);
    if(values.length===this.last.length&&values.every((v,i)=>v===this.last[i]))return;
    this.evaluate(c);normalsFor(this.positions,this.indices,this.normals);this.stream.publish(this.positions,this.normals);this.last=values;
  }
  /** Actual central lower-lip vertex: a contact attachment, not an estimated
   * head-local ellipse. Both acting and debug views can observe this geometry. */
  lowerLipCenter():readonly [number,number,number]{
    const i=this.mouthU.findIndex((u,i)=>Math.abs(u)<1e-7&&this.mouthV[i]!<0),at=this.mouthBoundary[i]!*3;
    return[this.positions[at]!,this.positions[at+1]!,this.positions[at+2]!];
  }
  openingArea(boundary:readonly number[]=this.mouthBoundary):number{
    const p=this.positions;let area=0;for(let i=0;i<boundary.length;i++){const a=boundary[i]!*3,b=boundary[(i+1)%boundary.length]!*3;area+=p[a+2]!*p[b+1]!-p[a+1]!*p[b+2]!;}return Math.abs(area)*.5;
  }
  inspect(){return{...this.stream.inspect(),mouthAreaM2:this.openingArea(),eyeAreasM2:this.eyeBoundaries.map(b=>this.openingArea(b)),typedArrayBytes:this.mouthU.byteLength+this.mouthV.byteLength+this.base.byteLength+this.positions.byteLength+this.normals.byteLength+this.mask.byteLength+this.deltas.byteLength+this.weight.byteLength+this.influence.byteLength+this.bound.byteLength+this.stream.vertices.byteLength,reference:'MakeHuman-CC0' as const};}
}
