/** Unified physical environment state for exposed surfaces and moving bodies.
 * Snow, water, ice and slush are phases of the same state, not separate engine
 * subsystems. Future mud, dust, moss and wear belong here as additional
 * consequences of material + environment + contact work.
 */
import type {EnvironmentState} from './types.js';
import type {RuntimeEntity} from '../scene/scene.js';
import type {SurfaceUse} from '../scene/types.js';
import {deriveSurfaceState} from '../materials/surface.js';

export interface SurfaceEnvironmentState {
  readonly id:string;
  readonly use:SurfaceUse;
  temperatureC:number;
  snowDepthM:number;
  waterDepthM:number;
  iceDepthM:number;
  slush:number;
  wetness:number;
  moss:number;
  dirt:number;
  wear:number;
  roughness:number;
  acousticDamping:number;
  darkening:number;
  trafficHeatC:number;
  trackMelt:number;
  puddle:number;
  frictionScale:number;
}

export interface BodyEnvironmentState {
  readonly id:string;
  snowCoverage:number;
  rearSnow:number;
  wetness:number;
  roadDirt:number;
  directionX:number;
  directionZ:number;
}

export interface SurfaceEnvironmentField {readonly center:readonly[number,number];readonly size:readonly[number,number];readonly nx:number;readonly nz:number;readonly cells:SurfaceEnvironmentState[]}
export class SurfaceEnvironmentSystem {
  readonly fields=new Map<string,SurfaceEnvironmentField>();
  remove(id:string):void{this.surfaces.delete(id);this.bodies.delete(id);this.fields.delete(id);}
  field(id:string):SurfaceEnvironmentField|undefined{return this.fields.get(id);}
  sample(id:string,x:number,z:number):SurfaceEnvironmentState|undefined{
    const field=this.fields.get(id);if(!field)return undefined;
    const u=(x-field.center[0])/field.size[0]+.5,v=(z-field.center[1])/field.size[1]+.5;
    if(u<0||u>1||v<0||v>1)return undefined;
    return field.cells[Math.min(field.nz-1,Math.floor(v*field.nz))*field.nx+Math.min(field.nx-1,Math.floor(u*field.nx))];
  }
  readonly surfaces=new Map<string,SurfaceEnvironmentState>();
  readonly bodies=new Map<string,BodyEnvironmentState>();

  step(dt:number,worldSeconds:number,environment:EnvironmentState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    for(const id of [...this.surfaces.keys(),...this.bodies.keys()])if(!entities.has(id))this.remove(id);
    this.ensureStates(environment,entities);
    this.applyTraffic(dt,entities);
    for(const [id,state] of this.surfaces){
      const entity=entities.get(id);if(!entity)continue;
      const field=this.fields.get(id)!;
      for(const cell of field.cells)this.stepSurface(cell,entity,dt,worldSeconds,environment);
      for(const key of ['temperatureC','snowDepthM','waterDepthM','iceDepthM','slush','wetness','moss','dirt','wear','roughness','acousticDamping','darkening','trafficHeatC','puddle','frictionScale'] as const)state[key]=field.cells.reduce((sum,cell)=>sum+cell[key],0)/field.cells.length;
      state.trackMelt=Math.max(...field.cells.map(cell=>cell.trackMelt));
    }
    for(const [id,state] of this.bodies){
      const entity=entities.get(id);if(!entity?.body||( !entity.body.invMass&&!entity.body.kinematic)){this.bodies.delete(id);continue;}
      this.stepBody(state,entity,dt,worldSeconds,environment);
    }
  }

  surface(id:string):SurfaceEnvironmentState|undefined{return this.surfaces.get(id);}
  body(id:string):BodyEnvironmentState|undefined{return this.bodies.get(id);}

  private ensureStates(environment:EnvironmentState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    for(const entity of entities.values()){
      const use=entity.environmental?.surfaceUse;
      if(use&&!this.surfaces.has(entity.id)){
        const authored=entity.material.surface;
        this.surfaces.set(entity.id,{
          id:entity.id,use,temperatureC:environment.temperatureC,snowDepthM:entity.environmental?.snowDepthM??0,waterDepthM:entity.environmental?.waterDepthM??0,iceDepthM:entity.environmental?.iceDepthM??0,
          slush:0,wetness:authored.wetness,moss:authored.moss,dirt:authored.dirt,wear:authored.wear,roughness:authored.roughness,acousticDamping:authored.acousticDamping,darkening:authored.darkening,
          trafficHeatC:0,trackMelt:0,puddle:0,frictionScale:authored.frictionScale,
        });
      }
      if(use&&!this.fields.has(entity.id)){
        const half=horizontalHalf(entity),size=[half[0]*2,half[1]*2] as const,nx=Math.min(64,Math.max(1,Math.ceil(size[0]/.5))),nz=Math.min(64,Math.max(1,Math.ceil(size[1]/.5)));
        this.fields.set(entity.id,{center:[entity.position[0],entity.position[2]],size,nx,nz,cells:Array.from({length:nx*nz},()=>({...this.surfaces.get(entity.id)!}))});
      }
      if((entity.body?.invMass||entity.body?.kinematic)&&!this.bodies.has(entity.id)){
        this.bodies.set(entity.id,{id:entity.id,snowCoverage:0,rearSnow:0,wetness:0,roadDirt:0,directionX:1,directionZ:0});
      }
    }
  }

  private applyTraffic(dt:number,entities:ReadonlyMap<string,RuntimeEntity>):void{
    for(const [bodyId,bodyState] of this.bodies){
      const bodyEntity=entities.get(bodyId),body=bodyEntity?.body;if(!bodyEntity||!body)continue;
      const vx=body.velocity[0],vz=body.velocity[2],speed=Math.hypot(vx,vz);
      if(speed>.1){bodyState.directionX=vx/speed;bodyState.directionZ=vz/speed;}
      if(speed<.45)continue;
      for(const [surfaceId,summary] of this.surfaces){
        const surfaceEntity=entities.get(surfaceId);if(!surfaceEntity||summary.use!=='road'||!containsXZ(surfaceEntity,bodyEntity.position[0],bodyEntity.position[2]))continue;
        const top=surfaceTop(surfaceEntity),bottom=bodyEntity.position[1]-verticalHalf(bodyEntity);
        // A supported contact is required; an airborne body deposits no work.
        if(Math.abs(bottom-top)>.025||Math.abs(body.velocity[1])>.2)continue;
        const surface=this.sample(surfaceId,bodyEntity.position[0],bodyEntity.position[2]);if(!surface)continue;
        // Sliding work estimate at the supported footprint (kinematic motor load uses m*g).
        const load=Math.max(1,body.mass)*9.81,contactWork=load*Math.sqrt(Math.max(0,body.friction*surfaceEntity.body!.friction))*speed*dt;
        const field=this.fields.get(surfaceId)!,half=horizontalHalf(bodyEntity),touched:SurfaceEnvironmentState[]=[];
        for(let iz=0;iz<field.nz;iz++)for(let ix=0;ix<field.nx;ix++){
          const x=field.center[0]+((ix+.5)/field.nx-.5)*field.size[0],z=field.center[1]+((iz+.5)/field.nz-.5)*field.size[1];
          if(Math.abs(x-body.position[0])<=half[0]+field.size[0]/field.nx/2&&Math.abs(z-body.position[2])<=half[1]+field.size[1]/field.nz/2)touched.push(field.cells[iz*field.nx+ix]!);
        }
        const workPerCell=contactWork/Math.max(1,touched.length);
        for(const surface of touched){
        surface.trafficHeatC=Math.min(12,surface.trafficHeatC+workPerCell/1.8e6);
        surface.trackMelt=Math.min(1,surface.trackMelt+Math.min(1,workPerCell/85_000)*.12);
        surface.dirt=Math.min(1,surface.dirt+dt*speed*.0008*(surface.waterDepthM>0||surface.snowDepthM>0?1:.1));
        }
        const spray=Math.min(1,(surface.slush+surface.puddle)*speed/8);
        bodyState.rearSnow=Math.min(1,bodyState.rearSnow+spray*dt*.13);
        bodyState.roadDirt=Math.min(1,bodyState.roadDirt+spray*dt*.09);
        bodyState.wetness=Math.min(1,bodyState.wetness+spray*dt*.15);
      }
    }
  }

  private stepSurface(state:SurfaceEnvironmentState,entity:RuntimeEntity,dt:number,worldSeconds:number,environment:EnvironmentState):void{
    const use=state.use;
    const drift=use==='curb'?1.9:use==='sidewalk'?1.2:use==='road'?.78:1;
    const wind=Math.hypot(environment.wind[0],environment.wind[2]),windDeposit=1+Math.min(.55,wind/12)*(use==='curb'?.8:use==='sidewalk'?.25:-.08);
    const coldSnow=environment.temperatureC<=1.2?1:Math.max(0,1-(environment.temperatureC-1.2)/2.5);
    state.snowDepthM+=environment.snowfallRate*worldSeconds*drift*windDeposit*coldSnow;

    // Thermal response is a consequence of material properties, never its name.
    // solarAbsorptivity controls equilibrium gain; volumetric heat capacity and
    // conductivity control how quickly the exposed layer approaches it.
    const profile=entity.material.profile,thermal=profile.thermal;
    const volumetricCapacity=Math.max(1,profile.density*thermal.specificHeatJkgK);
    const referenceCapacity=2_000_000;
    const inertia=Math.sqrt(volumetricCapacity/referenceCapacity);
    const solarGain=10*thermal.solarAbsorptivity/Math.max(.45,inertia);
    const target=environment.temperatureC+environment.sunlight*solarGain+state.trafficHeatC;
    // Higher conductivity couples the exposed skin to more bulk material instead
    // of making the surface magically absorb solar energy faster.
    const bulkCoupling=1+Math.sqrt(Math.max(.01,thermal.conductivityWmK))*.12;
    const thermalTau=Math.max(180,900*inertia*bulkCoupling);
    const thermalBlend=1-Math.exp(-worldSeconds/thermalTau);
    state.temperatureC+=(target-state.temperatureC)*thermalBlend;
    state.trafficHeatC*=Math.exp(-worldSeconds/950);
    state.trackMelt*=Math.exp(-worldSeconds/5400);

    // Integrate phase change independently in each contacted grid cell.
    const positive=Math.max(0,state.temperatureC),trafficMelt=use==='road'?state.trackMelt*1.7e-5*worldSeconds:0;
    const thermalMelt=Math.min(state.snowDepthM,positive*1.3e-6*worldSeconds+trafficMelt);
    state.snowDepthM-=thermalMelt;state.waterDepthM+=thermalMelt;

    if(state.temperatureC<-.25&&state.waterDepthM>0){
      const freeze=Math.min(state.waterDepthM,Math.abs(state.temperatureC)*5e-7*worldSeconds);
      state.waterDepthM-=freeze;state.iceDepthM+=freeze;
    }else if(state.temperatureC>.2&&state.iceDepthM>0){
      const thaw=Math.min(state.iceDepthM,state.temperatureC*7e-7*worldSeconds);
      state.iceDepthM-=thaw;state.waterDepthM+=thaw;
    }

    const snowWetRatio=state.waterDepthM/(state.waterDepthM+state.snowDepthM+.002);
    state.slush=Math.max(0,Math.min(1,(state.snowDepthM>.0005?snowWetRatio*1.45:0)+(use==='road'?state.trackMelt*.5:0)));
    state.dirt=Math.min(1,state.dirt+state.slush*(use==='road'?.00012:.00003)*worldSeconds);

    // Drainage leaves water in low procedural depressions; roads drain faster but
    // tyre ruts retain local puddles.
    const drainageTau=use==='road'?2900:use==='sidewalk'?5200:use==='curb'?7600:4200;
    const drained=state.waterDepthM*(1-Math.exp(-worldSeconds/drainageTau));
    state.waterDepthM=Math.max(0,state.waterDepthM-drained);
    const retention=use==='road'?.55+state.trackMelt*.55:use==='curb'?.85:.66;
    state.puddle=Math.max(0,Math.min(1,state.waterDepthM/.006*retention));

    const exposure=deriveSurfaceState(profile,entity.material,environment);
    const waterFactor=Math.min(1,state.waterDepthM/.003),snowFactor=Math.min(1,state.snowDepthM/.025),iceFactor=Math.min(1,state.iceDepthM/.003);
    state.wetness=Math.max(exposure.wetness,waterFactor,state.slush*.72);
    state.moss=exposure.moss;
    state.wear=exposure.wear;
    // Traffic/slush dirt is persistent state; authored aging supplies its floor.
    state.dirt=Math.max(exposure.dirt,state.dirt);
    state.roughness=Math.max(.02,Math.min(1,exposure.roughness+state.dirt*.045-state.wetness*.07+state.slush*.05));
    state.acousticDamping=Math.max(0,Math.min(1,profile.acoustic.damping+state.wetness*.22+state.moss*.34+state.slush*.12));
    state.darkening=Math.max(0,Math.min(1,exposure.darkening+state.wetness*.18+state.dirt*.08));
    const phaseFriction=Math.max(.16,1-snowFactor*.42-iceFactor*.72-state.slush*.5-waterFactor*.12);
    state.frictionScale=Math.max(.08,Math.min(1.18,exposure.frictionScale*phaseFriction));

  }

  private stepBody(state:BodyEnvironmentState,entity:RuntimeEntity,dt:number,worldSeconds:number,environment:EnvironmentState):void{
    const body=entity.body;if(!body)return;
    const speed=Math.hypot(body.velocity[0],body.velocity[2]),cold=environment.temperatureC<1.5?1:Math.max(0,1-(environment.temperatureC-1.5)/3);
    const deposition=environment.snowfallRate*worldSeconds*42*cold;
    const shedding=Math.min(.9,speed/24);
    state.snowCoverage=Math.min(1,Math.max(0,state.snowCoverage+deposition*(1-shedding*.72)-speed*dt*.00045));
    // Wake/recirculation makes the rear retain more snow than forward-facing areas.
    state.rearSnow=Math.min(1,Math.max(0,state.rearSnow+deposition*(.25+shedding*.95)-speed*dt*.00012));
    if(environment.temperatureC>0||environment.sunlight>.2){
      const melt=(Math.max(0,environment.temperatureC)*.0018+environment.sunlight*.0045)*worldSeconds/60;
      state.snowCoverage=Math.max(0,state.snowCoverage-melt);
      state.rearSnow=Math.max(0,state.rearSnow-melt*.62);
      state.wetness=Math.min(1,state.wetness+melt*.8);
    }
    state.wetness*=Math.exp(-worldSeconds/2600);
  }
}

function containsXZ(entity:RuntimeEntity,x:number,z:number):boolean{
  const mesh=entity.mesh,dx=x-entity.position[0],dz=z-entity.position[2];
  if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1){
    const c=Math.cos(entity.rotation[1]),s=Math.sin(entity.rotation[1]),u=(c*dx-s*dz)/entity.scale[0],v=(s*dx+c*dz)/entity.scale[2];let inside=false;
    for(let i=0,j=mesh.points.length-1;i<mesh.points.length;j=i++){
      const a=mesh.points[i]!,b=mesh.points[j]!;if((a[1]>v)!==(b[1]>v)&&u<(b[0]-a[0])*(v-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;
  }
  const half=horizontalHalf(entity);return Math.abs(dx)<=half[0]&&Math.abs(dz)<=half[1];
}
function horizontalHalf(entity:RuntimeEntity):readonly[number,number]{
  const mesh=entity.mesh;
  if(mesh?.kind==='box'||mesh?.kind==='shard')return[(mesh.size?.[0]??1)*entity.scale[0]/2,(mesh.size?.[2]??1)*entity.scale[2]/2];
  if(mesh?.kind==='plane')return[(mesh.size?.[0]??1)*entity.scale[0]/2,(mesh.size?.[1]??1)*entity.scale[2]/2];
  if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1){const c=Math.cos(entity.rotation[1]),s=Math.sin(entity.rotation[1]);let x=0,z=0;for(const p of mesh.points){const u=p[0]*entity.scale[0],v=p[1]*entity.scale[2];x=Math.max(x,Math.abs(c*u+s*v));z=Math.max(z,Math.abs(-s*u+c*v));}return[x,z];}
  if(mesh?.kind==='sphere'){const r=(mesh.radius??1)*Math.max(entity.scale[0],entity.scale[2]);return[r,r];}
  return[.5,.5];
}
function surfaceTop(entity:RuntimeEntity):number{
  const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return entity.position[1]+(mesh.size?.[1]??1)*entity.scale[1]/2;
  if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1)return entity.position[1]+mesh.thickness*entity.scale[1]/2;
  return entity.position[1];
}
function verticalHalf(entity:RuntimeEntity):number{
  const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return(mesh.size?.[1]??1)*entity.scale[1]/2;
  if(mesh?.kind==='sphere')return(mesh.radius??1)*entity.scale[1];
  return.5;
}
