import {modulePlan,project,type ModulePlan} from '../core/project.js';
import {CarBallArena,carBallConfig,type CarBallConfig} from '../examples/car-ball.js';
export {project};
/** Uses the production arena recipe and its existing fixed-step physics path. */
export function arena(config:Partial<CarBallConfig>={}):ModulePlan<CarBallConfig,CarBallArena>{
 return modulePlan<CarBallConfig,CarBallArena>({id:'car-ball',label:'Car / Ball',config:carBallConfig(config),validate:carBallConfig,
  create:config=>new CarBallArena(config),dispose:game=>game.dispose(),
  views:game=>[
   {id:'arena/world',kind:'physical-world',label:'Мир',data:game.dump()},
   {id:'arena/ball',kind:'soft-body',label:'Мяч',data:{nodes:game.ball.position,stats:game.ball.stats}},
   ...game.cars.map(car=>({id:car.body.id,kind:'vehicle',label:car.body.id,data:{position:car.body.position,velocity:car.body.velocity,boost:car.boost}})),
  ],
 });
}
