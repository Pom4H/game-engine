import {decodePackedMesh} from '../assets/packed-mesh.js';
import {FACE_REFERENCE} from '../assets/face-reference.js';
import type {Color,Primitive} from '../scene/types.js';
export interface FaceIdentity {
  readonly skin:Color;readonly iris:Color;readonly jawWidth:number;readonly cheekbone:number;
  readonly cheekHollow:number;readonly noseLength:number;readonly noseHook:number;
  readonly foreheadHeight:number;readonly templeWidth:number;readonly chinLength:number;
  readonly chinForward:number;readonly mouthForward:number;readonly stubble?:boolean;readonly freckles?:boolean;
}
type TrianglePrimitive=Extract<Primitive,{kind:'triangle-mesh'}>;

/** Authored flex targets, not a soft-tissue physics simulation. */
export interface FaceSurfaceControls {
  width:number;gap:number;protrusion:number;jaw:number;
  smileLeft:number;smileRight:number;browLeft:number;browRight:number;browTiltLeft:number;browTiltRight:number;
  cheekLeft:number;cheekRight:number;squint:number;squintLeft:number;squintRight:number;sneerLeft:number;sneerRight:number;frownLeft:number;frownRight:number;chinBunch:number;blink:number;gazeY:number;
}
export const neutralFaceSurface=():FaceSurfaceControls=>({width:.047,gap:.003,protrusion:0,jaw:0,smileLeft:0,smileRight:0,browLeft:0,browRight:0,browTiltLeft:.5,browTiltRight:.5,cheekLeft:0,cheekRight:0,squint:0,squintLeft:0,squintRight:0,sneerLeft:0,sneerRight:0,frownLeft:0,frownRight:0,chinBunch:0,blink:0,gazeY:0});
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(x:number)=>{x=clamp(x);return x*x*(3-2*x);};
const gauss=(x:number,m:number,s:number)=>Math.exp(-(((x-m)/s)**2));

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
  for(const [key,lo,hi] of [['jawWidth',.62,1.2],['cheekbone',0,.02],['cheekHollow',0,.03],['noseLength',.015,.08],['noseHook',0,.03],['foreheadHeight',.9,1.5],['templeWidth',.7,1.2],['chinLength',0,.05],['chinForward',-.005,.03],['mouthForward',0,.02]] as const)if(!Number.isFinite(identity[key])||identity[key]<lo||identity[key]>hi)throw new RangeError('Invalid face '+key);
}

/** Static adaptation of the approved continuous face at 4703baa9. Skin and
 * facial boundaries share the same flex evaluation; edits author a new immutable
 * scene mesh. No per-frame mesh generation, speech backend, or pose cache. */
class FaceSurface {
  readonly mesh:TrianglePrimitive;
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
  constructor(identity:FaceIdentity,controls:FaceSurfaceControls){
    validateFaceIdentity(identity);
    const mesh=decodePackedMesh(FACE_REFERENCE),p=Float64Array.from(mesh.positions),n=p.length/3;
    this.base=p;this.positions=new Float64Array(p);this.normals=new Float64Array(p.length);this.indices=mesh.indices;this.mask=new Float64Array(n*5);
    const colors:number[]=[];
    for(let v=0;v<n;v++){
      const k=v*3,x=p[k]!,y=p[k+1]!,z=p[k+2]!,front=smooth((x+.02)/.08);
      const cheek=gauss(y,-.012,.026)*gauss(Math.abs(z),.050,.025)*front,jaw=smooth((-.028-y)/.075)*front,brow=gauss(y,.056,.015)*gauss(Math.abs(z),.035,.020)*front;
      const forehead=smooth((y-.018)/.080)*front,temple=gauss(y,.055,.052)*front;
      const nose=gauss(y,-.004,.023)*gauss(z,0,.021)*front,noseTip=gauss(y,-.020,.016)*gauss(z,0,.017)*front;
      const chin=gauss(y,-.078,.024)*gauss(z,0,.040)*front,mouth=gauss(y,-.046,.015)*gauss(z,0,.043)*front;
      const hollow=gauss(y,-.020,.030)*gauss(Math.abs(z),.047,.022)*front;
      p[k]=x+(identity.cheekbone-.007)*cheek+(identity.noseLength-.031)*1.75*nose+identity.chinForward*chin+identity.mouthForward*mouth-identity.cheekHollow*hollow;
      p[k+1]=y+(identity.foreheadHeight-1)*Math.max(0,y-.018)*forehead-identity.noseHook*noseTip-identity.chinLength*chin;
      p[k+2]=z*(1+(identity.templeWidth-1)*temple)*(1+(identity.jawWidth-1)*jaw*.96);
      // The reference has a pointed projecting nose, with a narrow descending
      // tip. Shape the same continuous surface instead of adding a bulb mesh.
      const tip=smooth((p[k]!-.118)/.046);
      p[k]=p[k]!-.014*tip;p[k+1]=-.030+(p[k+1]!+.030)*(1-.48*tip)-.006*tip;p[k+2]=p[k+2]!*(1-.70*tip);
      this.mask.set([cheek,jaw,brow,z<0?-1:1,front],v*5);
      const beard=identity.stubble?.11*front*smooth((-.025-y)/.022):0;
      const lip=front*gauss(y,-.045,.006)*smooth((.030-Math.abs(z))/.009),freckle=identity.freckles&&Math.sin(v*12.9898)*43758.5453%1>.92&&Math.abs(z)>.028&&y<.02&&y>-.025?.07:0;
      const blush=.065*nose+.07*front*gauss(y,.012,.017)*gauss(Math.abs(z),.038,.022);
      colors.push(clamp(1-beard-freckle),clamp(1-beard-.10*cheek-.30*lip-blush-freckle),clamp(1-beard-.07*cheek-.22*lip-blush*.8-freckle),1);
    }
    // Upper/lower edge share U samples. Any common smile curve is an
    // area-preserving shear; the polygon integral sets the gap scale exactly.
    const u=this.mouthU,lo=u.indexOf(Math.min(...u)),hi=u.indexOf(Math.max(...u));
    for(let i=0;i<u.length;i++)this.mouthV[i]=(i<lo||i>hi?1:-1)*Math.sqrt(Math.max(0,1-u[i]!**2));
    let cross=0;for(let i=0;i<u.length;i++){const j=(i+1)%u.length;cross+=u[i]!*this.mouthV[j]!-this.mouthV[i]!*u[j]!;}
    const correction=Math.PI/Math.abs(cross*.5);for(let i=0;i<u.length;i++)this.mouthV[i]=this.mouthV[i]!*correction;
    validateControls(controls);this.evaluate(controls);normalsFor(this.positions,this.indices,this.normals);
    this.mesh={...mesh,positions:[...this.positions],normals:[...this.normals],colors};
  }
  private evaluate(c:FaceSurfaceControls):void{
    const p=this.positions,b=this.base,m=this.mask,d=this.deltas;
    for(let v=0;v<p.length/3;v++){
      const k=v*3,o=v*5,left=m[o+3]!<0,smile=left?c.smileLeft:c.smileRight,cheek=left?c.cheekLeft:c.cheekRight,brow=left?c.browLeft:c.browRight,tilt=(left?c.browTiltLeft:c.browTiltRight)-.5,sneer=left?c.sneerLeft:c.sneerRight,frown=left?c.frownLeft:c.frownRight;
      const upperLip=gauss(b[k+1]!,-.036,.011)*gauss(Math.abs(b[k+2]!),.024,.027)*m[o+4]!,noseWrinkle=gauss(b[k+1]!,-.010,.015)*gauss(Math.abs(b[k+2]!),.022,.020)*m[o+4]!,chin=gauss(b[k+1]!,-.071,.018)*gauss(Math.abs(b[k+2]!),.018,.030)*m[o+4]!;
      p[k]=b[k]!+.003*(smile+cheek)*m[o]!-.002*Math.sin(c.jaw)*m[o+1]!+.0028*sneer*(upperLip+noseWrinkle*.45)+.0035*c.chinBunch*chin;
      p[k+1]=b[k+1]!+.005*(smile+cheek)*m[o]!+(.007*brow+.12*tilt*(Math.abs(b[k+2]!)-.035))*m[o+2]!-.060*Math.sin(c.jaw)*m[o+1]!+.0048*sneer*upperLip+.0024*sneer*noseWrinkle+.0038*c.chinBunch*chin-.0032*frown*upperLip;
      p[k+2]=b[k+2]!+m[o+3]!*(.002*smile+.0014*sneer-.0018*frown)*(m[o]!+upperLip*.8);
    }
    const mouthCount=this.mouthBoundary.length,cy=-.043-c.gap*.30-.011*Math.sin(c.jaw);
    for(let i=0;i<this.anchors.length;i++){
      const k=this.anchors[i]!*3;let x:number,y:number,z:number;
      if(i<mouthCount){
        const u=this.mouthU[i]!,v=this.mouthV[i]!,smile=u<0?c.smileLeft:c.smileRight,sneer=u<0?c.sneerLeft:c.sneerRight,frown=u<0?c.frownLeft:c.frownRight,corner=Math.abs(u);
        x=b[k]!-.002+c.protrusion+.0012*sneer*(1-corner)+.0016*c.chinBunch*(1-corner);
        z=c.width*.5*u;
        y=cy+c.gap*.5*v+(.0045*smile+.0058*sneer-.0068*frown)*corner*corner+.0028*c.chinBunch*(1-corner);
      }else{
        const center=b[k+2]!<0?-.03385:.03385;z=center+(b[k+2]!-center)*1.22;const left=z<0,blink=clamp(c.blink+c.squint*.32+(left?c.squintLeft:c.squintRight)*.62);
        const line=.0282+.035*(Math.abs(z)-.03385);
        y=b[k+1]!+(line-b[k+1]!)*blink+c.gazeY*.25;
        x=.07456+.014*Math.sqrt(Math.max(0,1-((z-center)/.0175)**2-((y-.029)/.014)**2))+.00055;
      }
      d[i*3]=x-p[k]!;d[i*3+1]=y-p[k+1]!;d[i*3+2]=z-p[k+2]!;
    }
    for(let r=0;r<this.bound.length;r++){
      const k=this.bound[r]!*3;
      for(let j=0;j<8;j++){const at=r*8+j,w=this.weight[at]!,a=this.influence[at]!*3;p[k]=p[k]!+w*d[a]!;p[k+1]=p[k+1]!+w*d[a+1]!;p[k+2]=p[k+2]!+w*d[a+2]!;}
    }
    for(let i=0;i<this.anchors.length;i++){const k=this.anchors[i]!*3;for(let j=0;j<3;j++)p[k+j]=p[k+j]!+d[i*3+j]!;}
  }
}

function validateControls(c:FaceSurfaceControls):void {
  const values=Object.values(c);
  if(values.some(v=>!Number.isFinite(v))||c.width<=0||c.width>.12||c.gap<0||c.gap>.08||c.protrusion<0||c.protrusion>.03||c.jaw<0||c.jaw>1||Math.abs(c.gazeY)>.03)throw new RangeError('Invalid facial surface controls');
  for(const key of ['smileLeft','smileRight','browLeft','browRight','browTiltLeft','browTiltRight','cheekLeft','cheekRight','squint','squintLeft','squintRight','sneerLeft','sneerRight','frownLeft','frownRight','chinBunch','blink'] as const)if(c[key]<0||c[key]>1)throw new RangeError('Invalid facial action '+key);
}
export function characterFaceSurface(identity:FaceIdentity,controls:FaceSurfaceControls):TrianglePrimitive {
  return new FaceSurface(identity,controls).mesh;
}
