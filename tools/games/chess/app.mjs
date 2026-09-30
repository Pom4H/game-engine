import {project,chess} from '../../engine/games/chess-project.js';
import {legalMoves,squareName,positionFEN} from '../../engine/games/chess.js';
import {workbench} from '../../shared/workbench.mjs';
const $=id=>document.getElementById(id),make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const glyphs=['','♟','♞','♝','♜','♛','♚'],names=['','Пешка','Конь','Слон','Ладья','Ферзь','Король'];
let runtime,game,selected=-1,flipped=false,pending=[];
const cells=Array.from({length:64},(_,index)=>{const cell=make('button',undefined,'cell');cell.type='button';cell.setAttribute('role','gridcell');cell.dataset.square=squareName(index);cell.onclick=()=>choose(index);return cell;});
function error(message){$('game-error').hidden=!message;$('game-error').textContent=message;}
function stateName(result){if(result.kind==='checkmate')return (result.winner===1?'Белые':'Чёрные')+' победили';if(result.kind==='draw')return 'Ничья · '+({stalemate:'пат','dead-material':'недостаточно материала',fivefold:'пятикратное повторение','seventy-five-move':'75 ходов',repetition:'повторение','fifty-move':'50 ходов'}[result.reason]??result.reason);return (game.position.turn===1?'Ход белых':'Ход чёрных')+(result.check?' · шах':'');}
function draw(){if(!game)return;const p=game.position,result=game.result,history=game.history,last=history.at(-1)?.move,legal=selected<0?[]:legalMoves(p,selected);$('state').textContent=stateName(result);$('turn-dot').className=p.turn===1?'white':'black';
 const order=Array.from({length:64},(_,i)=>flipped?Math.floor(i/8)*8+(7-i%8):56-Math.floor(i/8)*8+i%8);
 // Cell nodes stay mounted between moves. Reorder only when changing board orientation.
 if($('board').dataset.flipped!==String(flipped)){$('board').replaceChildren(...order.map(i=>cells[i]));$('board').dataset.flipped=String(flipped);}
 for(let i=0;i<64;i++){const cell=cells[i],piece=p.board[i];cell.className='cell '+((i%8+Math.floor(i/8))%2?'light':'dark')+(i===selected?' selected':'')+(last&&(last.from===i||last.to===i)?' last':'')+(legal.some(m=>m.to===i)?(piece?' capture':' legal'):'');
  cell.setAttribute('aria-label',squareName(i)+(piece?' '+(piece>0?'белые ':'чёрные ')+names[Math.abs(piece)]:' пусто'));cell.setAttribute('aria-selected',String(i===selected));
  if(cell.dataset.piece!==String(piece)){const shape=make('span',glyphs[Math.abs(piece)],'piece '+(piece>0?'white':'black'));shape.setAttribute('aria-hidden','true');cell.replaceChildren(shape);cell.dataset.piece=piece;}
  cell.tabIndex=i===(selected>=0?selected:(flipped?60:4))?0:-1;
 }
 $('undo-move').disabled=!history.length;$('moves').replaceChildren(...history.map((h,i)=>{const row=make('li');if(i%2===0)row.append(make('small',String(Math.floor(i/2)+1)+'.'));row.append(make('b',h.san));return row;}));$('move-count').textContent=history.length;$('moves').scrollTop=$('moves').scrollHeight;
 $('claim').hidden=result.kind!=='playing'||!result.canClaim.length;
 const piece=p.board[selected]??0;$('square-name').textContent=selected<0?'—':squareName(selected);$('piece-view').replaceChildren(make('span',piece?glyphs[Math.abs(piece)]:'♞','piece-large '+(piece>0?'white':'black')));const info=make('div');info.append(make('h3',piece?names[Math.abs(piece)]:'Выбери фигуру'),make('p',piece?`${piece>0?'Белые':'Чёрные'} · ${legal.length} доступных ходов`:'Кликни фигуру, затем клетку. Можно управлять стрелками и Enter.'));$('piece-view').append(info);
 $('white-material').textContent=p.board.filter(n=>n>0).length+' фигур';$('black-material').textContent=p.board.filter(n=>n<0).length+' фигур';
}
function choose(index){if(!game)return;error('');const legal=selected<0?[]:legalMoves(game.position,selected).filter(m=>m.to===index);
 if(legal.length>1){pending=legal;$('promotion-options').replaceChildren(...legal.map(move=>{const button=make('button',glyphs[move.promotion]);button.setAttribute('aria-label',names[move.promotion]);button.onclick=()=>{commit(move);$('promotion').close();};return button;}));$('promotion').showModal();return;}
 if(legal.length===1){commit(legal[0]);return;}
 selected=selected===index?-1:index;draw();
}
function commit(move){try{game.move(move);selected=-1;draw();}catch(e){error(e.message);}}
$('board').onkeydown=event=>{const cell=event.target.closest('[data-square]');if(!cell)return;let i=cells.indexOf(cell),next=i;const direction=flipped?-1:1;if(event.key==='ArrowLeft')next=i-direction;if(event.key==='ArrowRight')next=i+direction;if(event.key==='ArrowUp')next=i+direction*8;if(event.key==='ArrowDown')next=i-direction*8;if(next!==i&&next>=0&&next<64){event.preventDefault();cell.tabIndex=-1;cells[next].tabIndex=0;cells[next].focus();}};
$('undo-move').onclick=()=>{game?.undo();selected=-1;draw();};$('flip').onclick=()=>{flipped=!flipped;draw();};$('restart').onclick=()=>wb.apply();$('cancel-promotion').onclick=()=>{$('promotion').close();pending=[];};
$('claim').onclick=()=>{try{game.claimDraw(game.result.canClaim[0]);draw();}catch(e){error(e.message);}};
$('source-toggle').onclick=()=>{$('workbench').hidden=!$('workbench').hidden;$('source-toggle').setAttribute('aria-expanded',String(!$('workbench').hidden));if(!$('workbench').hidden)$('workbench').scrollIntoView({behavior:'smooth',block:'nearest'});};
$('to-source').onclick=()=>{try{wb.setParameter('fen',positionFEN(game.position));$('workbench').hidden=false;$('workbench').scrollIntoView({behavior:'smooth'});}catch(e){error(e.message);}};
const source=await fetch('./project.ts').then(r=>{if(!r.ok)throw Error('Не найден проект шахмат');return r.text();});
const wb=workbench({host:$('workbench'),game:'chess',source,onApply(compiled,preset){
 const next=project({id:compiled.id,modules:{rules:chess(compiled.config)},presets:compiled.presets}).start(preset);runtime?.dispose();runtime=next;game=next.values.rules;selected=-1;error('');draw();
}});
window.addEventListener('pagehide',()=>{wb.dispose();runtime?.dispose();},{once:true});
globalThis.__CHESS__={get game(){return game;},get source(){return wb.source;},get views(){return runtime?.inspect();}};
