import type {MutableVec3,Vec3} from '../math.js';
import type {AirSample} from './atmosphere.js';

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(v:number)=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit=(v:Vec3):Vec3=>{const n=Math.hypot(...v);if(n<1e-9)throw new RangeError('Direction must be non-zero');return[v[0]/n,v[1]/n,v[2]/n];};

export interface ForceBody{
  readonly position:Vec3;readonly linearVelocity:Vec3;readonly angularVelocity:Vec3;
  worldPoint(local:Vec3,out:MutableVec3):MutableVec3;
  worldDirection(local:Vec3,out:MutableVec3):MutableVec3;
  pointVelocity(point:Vec3,out:MutableVec3):MutableVec3;
  applyForce(force:Vec3,point:Vec3):void;
}
export interface AeroSurface{
  readonly id:string;readonly center:Vec3;readonly chord:Vec3;readonly normal:Vec3;readonly area:number;readonly aspectRatio:number;
  readonly incidence?:number;readonly zeroLiftAngle?:number;readonly cd0?:number;readonly efficiency?:number;readonly stallAngle?:number;readonly stallWidth?:number;
  readonly control?:string;readonly controlGain?:number;readonly maxDeflection?:number;readonly health?:number;
}
export interface BodyDrag{readonly cdArea:Vec3;readonly center:Vec3}
export interface SurfaceTelemetry{readonly id:string;alpha:number;lift:number;drag:number;stall:number;deflection:number;readonly force:MutableVec3;readonly point:MutableVec3}
export interface AeroTelemetry{readonly force:MutableVec3;readonly torque:MutableVec3;airspeed:number;readonly surfaces:readonly SurfaceTelemetry[]}
interface Compiled{source:AeroSurface;chord:Vec3;normal:Vec3;health:number;detached:boolean;telemetry:SurfaceTelemetry}
export function polar(alpha:number,aspectRatio:number,zeroLiftAngle=-.035,cd0=.025,efficiency=.8,stallAngle=.26,stallWidth=.20):{cl:number;cd:number;stall:number}{
  if(![alpha,aspectRatio,zeroLiftAngle,cd0,efficiency,stallAngle,stallWidth].every(Number.isFinite)||aspectRatio<=0||efficiency<=0||cd0<0||stallAngle<=0||stallWidth<=0)throw new RangeError('Invalid aerodynamic polar');
  const effective=alpha-zeroLiftAngle,stall=smooth((Math.abs(effective)-stallAngle)/stallWidth),attached=2*Math.PI*aspectRatio/(aspectRatio+2)*effective,cl=attached*(1-stall)+1.1*Math.sin(2*alpha)*stall,cd=cd0+(1-stall)*cl*cl/(Math.PI*aspectRatio*efficiency)+stall*1.9*Math.sin(alpha)**2;
  return{cl,cd,stall};
}
export class Aerodynamics{
  readonly telemetry:AeroTelemetry;private readonly compiled:Compiled[];private readonly point:MutableVec3=[0,0,0];private readonly chord:MutableVec3=[0,0,0];private readonly normal:MutableVec3=[0,0,0];private readonly velocity:MutableVec3=[0,0,0];
  constructor(surfaces:readonly AeroSurface[],private readonly drag?:BodyDrag){
    if(surfaces.length>64)throw new RangeError('Maximum 64 aerodynamic panels per body');const ids=new Set<string>();
    this.compiled=surfaces.map(source=>{
      if(!source.id||ids.has(source.id)||![...source.center,...source.chord,...source.normal,source.area,source.aspectRatio].every(Number.isFinite)||source.area<=0||source.aspectRatio<=0)throw new RangeError('Invalid aerodynamic surface');
      ids.add(source.id);const chord=unit(source.chord),normal=unit(source.normal);if(Math.abs(dot(chord,normal))>1e-5)throw new RangeError('Chord and normal must be perpendicular');
      return{source:{...source,center:[...source.center] as Vec3,chord:[...source.chord] as Vec3,normal:[...source.normal] as Vec3},chord,normal,health:source.health??1,detached:false,telemetry:{id:source.id,alpha:0,lift:0,drag:0,stall:0,deflection:0,force:[0,0,0],point:[0,0,0]}};
    });
    if(drag&&(![...drag.cdArea,...drag.center].every(Number.isFinite)||drag.cdArea.some(v=>v<0)))throw new RangeError('Invalid body drag');
    this.telemetry={force:[0,0,0],torque:[0,0,0],airspeed:0,surfaces:this.compiled.map(item=>item.telemetry)};
  }
  setSurfaceHealth(id:string,health:number):void{const p=this.compiled.find(item=>item.source.id===id);if(!p||!Number.isFinite(health)||health<0||health>1)throw new RangeError('Invalid aerodynamic surface health');p.health=health;}
  detachSurface(id:string):void{const p=this.compiled.find(item=>item.source.id===id);if(!p)throw new RangeError('Unknown aerodynamic surface');p.detached=true;}
  solve(body:ForceBody,air:AirSample,controls:Readonly<Record<string,number>>={}):AeroTelemetry{
    const total=this.telemetry;total.force.fill(0);total.torque.fill(0);total.airspeed=Math.hypot(body.linearVelocity[0]-air.wind[0],body.linearVelocity[1]-air.wind[1],body.linearVelocity[2]-air.wind[2]);
    for(const p of this.compiled){
      const s=p.source,o=p.telemetry;o.force.fill(0);o.alpha=o.lift=o.drag=o.stall=o.deflection=0;body.worldPoint(s.center,o.point);if(p.detached||p.health<=0||air.density<=0)continue;
      body.worldDirection(p.chord,this.chord);body.worldDirection(p.normal,this.normal);
      const deflection=s.control?clamp(controls[s.control]??0,-1,1)*(s.controlGain??1)*(s.maxDeflection??.35):0;o.deflection=deflection;
      const c=Math.cos((s.incidence??0)+deflection),sn=Math.sin((s.incidence??0)+deflection),cx=this.chord[0],cy=this.chord[1],cz=this.chord[2],nx=this.normal[0],ny=this.normal[1],nz=this.normal[2];
      this.chord[0]=cx*c+nx*sn;this.chord[1]=cy*c+ny*sn;this.chord[2]=cz*c+nz*sn;this.normal[0]=nx*c-cx*sn;this.normal[1]=ny*c-cy*sn;this.normal[2]=nz*c-cz*sn;
      body.pointVelocity(o.point,this.velocity);const vx=this.velocity[0]-air.wind[0],vy=this.velocity[1]-air.wind[1],vz=this.velocity[2]-air.wind[2],speed=Math.hypot(vx,vy,vz);if(speed<1e-6)continue;
      const ux=vx/speed,uy=vy/speed,uz=vz/speed,vn=vx*this.normal[0]+vy*this.normal[1]+vz*this.normal[2],vc=vx*this.chord[0]+vy*this.chord[1]+vz*this.chord[2],alpha=Math.atan2(-vn,vc),coeff=polar(alpha,s.aspectRatio,s.zeroLiftAngle,s.cd0,s.efficiency,s.stallAngle,s.stallWidth);
      const health=p.health,lift=.5*air.density*(vn*vn+vc*vc)*s.area*coeff.cl*health,drag=.5*air.density*speed*speed*s.area*(coeff.cd+(1-health)*.18),un=ux*this.normal[0]+uy*this.normal[1]+uz*this.normal[2];
      let lx=this.normal[0]-ux*un,ly=this.normal[1]-uy*un,lz=this.normal[2]-uz*un;const ln=Math.hypot(lx,ly,lz);if(ln>1e-9){lx/=ln;ly/=ln;lz/=ln;}else{lx=ly=lz=0;}
      o.alpha=alpha;o.stall=coeff.stall;o.lift=lift;o.drag=drag;o.force[0]=lx*lift-ux*drag;o.force[1]=ly*lift-uy*drag;o.force[2]=lz*lift-uz*drag;body.applyForce(o.force,o.point);this.accumulate(body,o.force,o.point);
    }
    if(this.drag&&air.density>0){body.worldPoint(this.drag.center,this.point);body.pointVelocity(this.point,this.velocity);const vx=this.velocity[0]-air.wind[0],vy=this.velocity[1]-air.wind[1],vz=this.velocity[2]-air.wind[2],f:[number,number,number]=[-.5*air.density*this.drag.cdArea[0]*vx*Math.abs(vx),-.5*air.density*this.drag.cdArea[1]*vy*Math.abs(vy),-.5*air.density*this.drag.cdArea[2]*vz*Math.abs(vz)];body.applyForce(f,this.point);this.accumulate(body,f,this.point);}
    return total;
  }
  private accumulate(body:ForceBody,force:Vec3,point:Vec3):void{
    const t=this.telemetry;t.force[0]+=force[0];t.force[1]+=force[1];t.force[2]+=force[2];const rx=point[0]-body.position[0],ry=point[1]-body.position[1],rz=point[2]-body.position[2];t.torque[0]+=ry*force[2]-rz*force[1];t.torque[1]+=rz*force[0]-rx*force[2];t.torque[2]+=rx*force[1]-ry*force[0];
  }
}
