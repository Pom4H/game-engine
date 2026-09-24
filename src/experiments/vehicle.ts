import {M3InteractionRig} from '../vehicles/interaction-physics.js';
import type {Vec3} from '../math.js';
import {numberValue,stringValue,type ExperimentControl,type ExperimentPreset,type ExperimentValues} from './schema.js';
import type {ExperimentAdapter,ExperimentDefinition} from './runtime.js';

export interface VehicleExperimentFrame {
  readonly tick:number;
  readonly time:number;
  readonly maxDisplacementM:number;
  readonly plasticWorkJ:number;
  readonly pendingImpulsePulses:number;
  readonly panelPermanentDepthM:number;
  readonly panelElasticDepthM:number;
  readonly structural:readonly number[];
}

const controls:readonly ExperimentControl[]=[
  {key:'scenario',label:'Scenario',kind:'select',value:'front',choices:['front','side','roof'],help:'Impact face.'},
  {key:'energyJ',label:'Impact energy',kind:'number',value:45000,min:10,max:250000,step:10,unit:'J'},
  {key:'effectiveMassKg',label:'Effective mass',kind:'number',value:450,min:1,max:3000,step:1,unit:'kg'},
  {key:'radiusM',label:'Contact radius',kind:'number',value:.45,min:.03,max:1.5,step:.01,unit:'m'},
  {key:'thicknessM',label:'Panel thickness',kind:'number',value:.0008,min:.0002,max:.02,step:.0001,unit:'m'},
];

const presets:readonly ExperimentPreset[]=[
  {id:'front-64',label:'Front 64 km/h',values:{scenario:'front',energyJ:45000,effectiveMassKg:450,radiusM:.45}},
  {id:'side',label:'Side impact',values:{scenario:'side',energyJ:28000,effectiveMassKg:320,radiusM:.38}},
  {id:'roof',label:'Roof load',values:{scenario:'roof',energyJ:18000,effectiveMassKg:500,radiusM:.50}},
  {id:'light',label:'Light tap',values:{scenario:'front',energyJ:120,effectiveMassKg:8,radiusM:.18}},
];

class VehicleExperimentAdapter implements ExperimentAdapter<VehicleExperimentFrame>{
  readonly tickRate=120;
  private rig=new M3InteractionRig();
  private tick=0;
  private baseline=new Float64Array(this.rig.structure.position);

  reset(values:ExperimentValues):void{
    this.rig=new M3InteractionRig();
    this.tick=0;this.baseline=new Float64Array(this.rig.structure.position);
    const scenario=stringValue(values,'scenario'),point:Vec3=scenario==='front'?[2.0,.72,0]:scenario==='side'?[0,.78,-.88]:[0,1.38,0];
    const normal:Vec3=scenario==='front'?[1,0,0]:scenario==='side'?[0,0,-1]:[0,1,0];
    this.rig.impact({
      time:0,point,normal,
      energyJ:numberValue(values,'energyJ'),
      effectiveMassKg:numberValue(values,'effectiveMassKg'),
      radiusM:numberValue(values,'radiusM'),
      thicknessM:numberValue(values,'thicknessM'),
    });
  }

  step():VehicleExperimentFrame{this.rig.step(1/this.tickRate);this.tick++;return this.snapshot();}
  snapshot():VehicleExperimentFrame{
    const state=this.rig.state,positions=this.rig.structure.position;
    let max=0;for(let i=0;i<positions.length;i++)max=Math.max(max,Math.abs(positions[i]!-this.baseline[i]!));
    return Object.freeze({
      tick:this.tick,time:this.tick/this.tickRate,maxDisplacementM:max,plasticWorkJ:state.structuralPlasticWorkJ,
      pendingImpulsePulses:this.rig.structure.pendingImpulsePulses,
      panelPermanentDepthM:state.panelPermanentDepthM,panelElasticDepthM:state.panelElasticDepthM,
      structural:Object.freeze([...positions]),
    });
  }
}

export const VEHICLE_EXPERIMENT:ExperimentDefinition<VehicleExperimentFrame>=Object.freeze({
  id:'vehicle-crash',title:'Vehicle structural experiment',controls,presets,maxSeconds:4,
  create:()=>new VehicleExperimentAdapter(),
});
