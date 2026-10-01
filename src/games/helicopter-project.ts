import {modulePlan,project,type ModulePlan} from '../core/project.js';
import {HelicopterSandbox,helicopterSandboxConfig,type HelicopterSandboxConfig} from '../examples/helicopter.js';
export {project};
/** Helicopter as a normal project module, not a privileged engine mode. */
export function helicopter(config:Partial<HelicopterSandboxConfig>={}):ModulePlan<HelicopterSandboxConfig,HelicopterSandbox>{
 return modulePlan({
  id:'helicopter',label:'Helicopter physics',config:helicopterSandboxConfig(config),validate:helicopterSandboxConfig,
  create:config=>new HelicopterSandbox(config),dispose:game=>game.dispose(),
  views:game=>[
   {id:'helicopter/body',kind:'vehicle',label:'Helicopter',data:{position:[...game.helicopter.body.position],velocity:[...game.helicopter.body.velocity],rotation:[...game.helicopter.body.rotation]}},
   {id:'helicopter/main-rotor',kind:'rotor',label:'Main rotor',data:{rpm:game.helicopter.part('main.rotor').angularSpeed*30/Math.PI,thrust:game.helicopter.part('main.rotor').liftN,power:game.helicopter.part('main.rotor').powerW}},
   {id:'helicopter/tail-rotor',kind:'rotor',label:'Tail rotor',data:{rpm:game.helicopter.part('tail.rotor').angularSpeed*30/Math.PI,thrust:game.helicopter.part('tail.rotor').liftN,power:game.helicopter.part('tail.rotor').powerW}},
  ],
 });
}
