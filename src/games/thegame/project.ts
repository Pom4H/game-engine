import {modulePlan,project} from '../../core/project.js';
import {ThegameAuthority,thegameConfig,type ThegameConfig} from './session.js';
export {project};
export function thegame(config:Partial<ThegameConfig>={}){
 return modulePlan({id:'thegame',label:'Thegame · открытый мир',config:thegameConfig(config),validate:thegameConfig,
  create:config=>new ThegameAuthority(config),dispose:game=>game.dispose(),
  views:game=>[{id:'thegame/world',kind:'open-world',label:'Мир',data:game.world.inspect()},...Array.from(game.peers.values(),peer=>({id:peer.id,kind:'character',label:peer.name,data:{...peer.state,ack:peer.ack,queued:peer.inputs.length}}))],
 });
}
