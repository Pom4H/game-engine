import {ExperimentPanel} from './panel.js';
import {VEHICLE_EXPERIMENT,type VehicleExperimentFrame} from './vehicle.js';

export function mountVehicleExperiment(root:HTMLElement):ExperimentPanel<VehicleExperimentFrame>{
  return new ExperimentPanel(root,VEHICLE_EXPERIMENT,{
    render:(frame,host)=>{
      host.replaceChildren();
      const pre=document.createElement('pre');
      pre.textContent=[
        't          '+frame.time.toFixed(3)+' s',
        'crush      '+(frame.maxDisplacementM*1000).toFixed(1)+' mm',
        'plastic    '+frame.plasticWorkJ.toFixed(1)+' J',
        'panel      '+(frame.panelPermanentDepthM*1000).toFixed(2)+' mm permanent',
        'pulse      '+frame.pendingImpulsePulses,
      ].join('\n');
      host.append(pre);
    },
    csv:(frame,index)=>({frame:index,time_s:frame.time,crush_m:frame.maxDisplacementM,plastic_J:frame.plasticWorkJ,panel_permanent_m:frame.panelPermanentDepthM,pulses:frame.pendingImpulsePulses}),
  });
}
