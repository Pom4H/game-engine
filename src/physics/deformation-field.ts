import type {MutableVec3,Vec3} from '../math.js';
import {finiteVec3} from '../math.js';

/** Body-local material coordinates -> current body-local shape. One physical owner
 * increments revision only when the field changes. Reads NEVER advance simulation. */
export interface DeformationField {
  readonly revision:number;
  sample(rest:Vec3,out:MutableVec3):void;
}

/** A small rigid mount following a deforming patch. Seven field samples derive a
 * frame once per revision. The frame deliberately strips stretch/shear: an intact
 * attached wing is not made larger by denting its mounting panel. Not a joint solver. */
const IDENTITY=Object.freeze([1,0,0,0,1,0,0,0,1]);
export class DeformationAttachment {
  readonly position:MutableVec3=[0,0,0];
  readonly basis=new Float64Array([1,0,0,0,1,0,0,0,1]);
  valid=true;
  builds=0;
  samples=0;
  private field:DeformationField|undefined;
  private revision=-1;
  private readonly query:MutableVec3=[0,0,0];
  private readonly plus:MutableVec3=[0,0,0];
  private readonly minus:MutableVec3=[0,0,0];
  private readonly jacobian=new Float64Array(9);
  private readonly nextBasis=new Float64Array(9);
  private readonly nextPosition:MutableVec3=[0,0,0];
  readonly rest:Vec3;
  constructor(rest:Vec3,readonly radiusM=.05){
    finiteVec3(rest,'Attachment');
    if(!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Attachment radius must be positive');
    this.rest=Object.freeze([...rest]) as Vec3;
    this.position.splice(0,3,...rest);
  }
  update(field:DeformationField|undefined,reuse=true):boolean {
    const revision=field?.revision??0;
    if(!Number.isSafeInteger(revision)||revision<0)throw new RangeError('Deformation revision must be a nonnegative safe integer');
    if(reuse&&field===this.field&&revision===this.revision)return false;
    const b=this.nextBasis,j=this.jacobian;
    if(!field){this.nextPosition.splice(0,3,...this.rest);b.set(IDENTITY);return this.commit(field,revision,true);}
    field.sample(this.rest,this.nextPosition);this.samples++;finiteVec3(this.nextPosition,'Deformed mount');
    for(let axis=0;axis<3;axis++){
      for(let k=0;k<3;k++)this.query[k]=this.rest[k]!;
      this.query[axis]=this.rest[axis]!+this.radiusM;field.sample(this.query,this.plus);
      this.query[axis]=this.rest[axis]!-this.radiusM;field.sample(this.query,this.minus);this.samples+=2;
      finiteVec3(this.plus,'Deformed tangent');finiteVec3(this.minus,'Deformed tangent');
      for(let k=0;k<3;k++)j[axis*3+k]=(this.plus[k]!-this.minus[k]!)/(2*this.radiusM);
    }
    // Deterministic Gram-Schmidt. Inverted/collapsed patches cannot carry a mount.
    const x=Math.hypot(j[0]!,j[1]!,j[2]!);
    if(x<1e-8)return this.commit(field,revision,false);
    for(let k=0;k<3;k++)b[k]=j[k]!/x;
    const xy=b[0]!*j[3]!+b[1]!*j[4]!+b[2]!*j[5]!;
    for(let k=0;k<3;k++)b[3+k]=j[3+k]!-b[k]!*xy;
    const y=Math.hypot(b[3]!,b[4]!,b[5]!);
    if(y<1e-8)return this.commit(field,revision,false);
    for(let k=0;k<3;k++)b[3+k]=b[3+k]!/y;
    b[6]=b[1]!*b[5]!-b[2]!*b[4]!;b[7]=b[2]!*b[3]!-b[0]!*b[5]!;b[8]=b[0]!*b[4]!-b[1]!*b[3]!;
    return this.commit(field,revision,b[6]!*j[6]!+b[7]!*j[7]!+b[8]!*j[8]!>1e-8);
  }
  private commit(field:DeformationField|undefined,revision:number,valid:boolean):true{
    this.field=field;this.revision=revision;this.valid=valid;this.builds++;
    this.position.splice(0,3,...this.nextPosition);
    if(valid)this.basis.set(this.nextBasis); // retain last finite orientation on collapse
    return true;
  }
  direction(v:Vec3,out:MutableVec3):void{
    const b=this.basis,x=v[0],y=v[1],z=v[2];
    out[0]=b[0]!*x+b[3]!*y+b[6]!*z;
    out[1]=b[1]!*x+b[4]!*y+b[7]!*z;
    out[2]=b[2]!*x+b[5]!*y+b[8]!*z;
  }
  point(rest:Vec3,out:MutableVec3):void{
    const x=rest[0]-this.rest[0],y=rest[1]-this.rest[1],z=rest[2]-this.rest[2],b=this.basis;
    out[0]=this.position[0]+b[0]!*x+b[3]!*y+b[6]!*z;
    out[1]=this.position[1]+b[1]!*x+b[4]!*y+b[7]!*z;
    out[2]=this.position[2]+b[2]!*x+b[5]!*y+b[8]!*z;
  }
}
