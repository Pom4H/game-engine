import {modulePlan,project,type ModulePlan} from '../core/project.js';
import {Chess,chess as definition,INITIAL_FEN,squareName,type ChessDefinition} from './chess.js';
export {project,INITIAL_FEN};
/** Event-driven project module. Its direct Chess instance needs no scheduler. */
export function chess(config:Partial<ChessDefinition>={}):ModulePlan<ChessDefinition,Chess>{
  return modulePlan({id:'chess',label:'Шахматы',config:definition(config),
    validate(config){definition(config);},create:config=>new Chess(config),dispose:game=>game.dispose(),
    views:game=>[
      {id:'chess/board',kind:'chess-board',label:'Доска',data:{position:game.position,result:game.result}},
      ...game.position.board.flatMap((piece,index)=>piece?[{id:`chess/square/${squareName(index)}`,kind:'chess-piece',label:squareName(index),data:{square:index,piece}}]:[]),
    ],
  });
}
