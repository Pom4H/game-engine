import type {EnvironmentState} from './types.js';
import type {RuntimeEntity} from '../scene/scene.js';
import type {SurfaceUse} from '../scene/types.js';

export interface WinterSurfaceState {
  readonly id:string;
  readonly use:SurfaceUse;
  temperatureC:number;
  snowDepthM:number;
  waterDepthM:number;
  iceDepthM:number;
  slush:number;
  dirt:number;
  trafficHeatC:number;
  trackMelt:number;
  puddle:number;
  frictionScale:number;
}

export interface WinterBodyState {
  readonly id:string;
  snowCoverage:number;
  rearSnow:number;
  wetness:number;
  roadDirt:number;
  directionX:number;
  directionZ:number;
}

export class WinterSystem {
  readonly surfaces=new Map<string,WinterSurfaceState>();
  readonly bodies=new Map<string,WinterBodyState>();

  step(dt:number,worldSeconds:number,environment:EnvironmentState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    this.ensureStates(environment,entities);
    this.applyTraffic(dt,entities);
    for(const [id,state] of this.surfaces){
      const entity=entities.get(id);if(!entity)continue;
      this.stepSurface(state,entity,dt,worldSeconds,environment);
    }
    for(const [id,state] of this.bodies){
      const entity=entities.get(id);if(!entity?.body?.invMass){this.bodies.delete(id);continue;}
      this.stepBody(state,entity,dt,worldSeconds,environment);
    }
  }

  surface(id:string):WinterSurfaceState|undefined{return this.surfaces.get(id);}
  body(id:string):WinterBodyState|undefined{return this.bodies.get(id);}

  private ensureStates(environment:EnvironmentState,entities:ReadonlyMap<string,RuntimeEntity>):void{
    for(const entity of entities.values()){
      const use=entity.environmental?.surfaceUse;
      if(use&&!this.surfaces.has(entity.id)){
        this.surfaces.set(entity.id,{
          id:entity.id,use,temperatureC:environment.temperatureC,snowDepthM:0,waterDepthM:0,iceDepthM:0,
          slush:0,dirt:entity.material.surface.dirt*.25,trafficHeatC:0,trackMelt:0,puddle:0,frictionScale:1,
        });
      }
      if(entity.body?.invMass&&!this.bodies.has(entity.id)){
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
      for(const [surfaceId,surface] of this.surfaces){
        const surfaceEntity=entities.get(surfaceId);if(!surfaceEntity||surface.use!=='road'||!containsXZ(surfaceEntity,bodyEntity.position[0],bodyEntity.position[2]))continue;
        const top=surfaceTop(surfaceEntity),bottom=bodyEntity.position[1]-verticalHalf(bodyEntity);
        if(bottom>top+1.2||bottom<top-.35)continue;
        // Friction/contact work is deliberately derived from mass and velocity.
        const load=Math.max(1,body.mass)*9.81,contactWork=load*Math.max(.05,body.friction)*speed*dt;
        surface.trafficHeatC=Math.min(12,surface.trafficHeatC+contactWork/1.8e6);
        surface.trackMelt=Math.min(1,surface.trackMelt+Math.min(1,contactWork/85_000)*.12);
        surface.dirt=Math.min(1,surface.dirt+dt*speed*.0008*(surface.waterDepthM>0||surface.snowDepthM>0?1:.1));
        const spray=Math.min(1,(surface.slush+surface.puddle)*speed/8);
        bodyState.rearSnow=Math.min(1,bodyState.rearSnow+spray*dt*.13);
        bodyState.roadDirt=Math.min(1,bodyState.roadDirt+spray*dt*.09);
        bodyState.wetness=Math.min(1,bodyState.wetness+spray*dt*.15);
      }
    }
  }

  private stepSurface(state:WinterSurfaceState,entity:RuntimeEntity,dt:number,worldSeconds:number,environment:EnvironmentState):void{
    const use=state.use,material=entity.material.kind;
    const drift=use==='curb'?1.9:use==='sidewalk'?1.2:use==='road'?.78:1;
    const wind=Math.hypot(environment.wind[0],environment.wind[2]),windDeposit=1+Math.min(.55,wind/12)*(use==='curb'?.8:use==='sidewalk'?.25:-.08);
    const coldSnow=environment.temperatureC<=1.2?1:Math.max(0,1-(environment.temperatureC-1.2)/2.5);
    state.snowDepthM+=environment.snowfallRate*worldSeconds*drift*windDeposit*coldSnow;

    // Surface thermal inertia: dark asphalt absorbs sun, traffic adds local heat.
    const solarGain=material==='asphalt'?8.5:material==='concrete'?5.1:3;
    const target=environment.temperatureC+environment.sunlight*solarGain+state.trafficHeatC;
    const thermalTau=material==='asphalt'?1200:1800;
    const thermalBlend=1-Math.exp(-worldSeconds/thermalTau);
    state.temperatureC+=(target-state.temperatureC)*thermalBlend;
    state.trafficHeatC*=Math.exp(-worldSeconds/950);
    state.trackMelt*=Math.exp(-worldSeconds/5400);

    // Snow/water phase change. Traffic concentrates melt in wheel paths; the scalar
    // is later spatialized procedurally by the renderer.
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

    const snowFactor=Math.min(1,state.snowDepthM/.025),iceFactor=Math.min(1,state.iceDepthM/.003),waterFactor=Math.min(1,state.waterDepthM/.003);
    state.frictionScale=Math.max(.16,1-snowFactor*.42-iceFactor*.72-state.slush*.5-waterFactor*.12);
    if(entity.body)entity.body.friction=entity.material.profile.friction*entity.material.surface.frictionScale*state.frictionScale;
  }

  private stepBody(state:WinterBodyState,entity:RuntimeEntity,dt:number,worldSeconds:number,environment:EnvironmentState):void{
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
  const half=horizontalHalf(entity);return Math.abs(x-entity.position[0])<=half[0]&&Math.abs(z-entity.position[2])<=half[1];
}
function horizontalHalf(entity:RuntimeEntity):readonly[number,number]{
  const mesh=entity.mesh;
  if(mesh?.kind==='box'||mesh?.kind==='shard')return[(mesh.size?.[0]??1)*entity.scale[0]/2,(mesh.size?.[2]??1)*entity.scale[2]/2];
  if(mesh?.kind==='plane')return[(mesh.size?.[0]??1)*entity.scale[0]/2,(mesh.size?.[1]??1)*entity.scale[2]/2];
  if(mesh?.kind==='sphere'){const r=(mesh.radius??1)*Math.max(entity.scale[0],entity.scale[2]);return[r,r];}
  return[.5,.5];
}
function surfaceTop(entity:RuntimeEntity):number{
  const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return entity.position[1]+(mesh.size?.[1]??1)*entity.scale[1]/2;
  return entity.position[1];
}
function verticalHalf(entity:RuntimeEntity):number{
  const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return(mesh.size?.[1]??1)*entity.scale[1]/2;
  if(mesh?.kind==='sphere')return(mesh.radius??1)*entity.scale[1];
  return.5;
}
