import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess,chess,INITIAL_FEN,parsePosition,positionFEN,positionKey,legalMoves,play,perft,square,chessResult} from '../dist/games/chess.js';
const move=(from,to,promotion)=>({from:square(from),to:square(to),...(promotion?{promotion}:{})});
test('chess initial position round trips and enumerates orthodox move tree',()=>{
 const p=parsePosition(INITIAL_FEN);assert.equal(positionFEN(p),INITIAL_FEN);
 assert.deepEqual([1,2,3,4].map(depth=>perft(p,depth)),[20,400,8902,197281]);
});
test('Kiwipete exercises castling, pins and captures',()=>{
 const p=parsePosition('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
 assert.deepEqual([1,2,3].map(depth=>perft(p,depth)),[48,2039,97862]);
});
test('rook endgame exercises en passant and discovered check',()=>{
 const p=parsePosition('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
 assert.deepEqual([1,2,3].map(depth=>perft(p,depth)),[14,191,2812]);
});
test('illegal moves and implicit promotion cannot mutate a match',()=>{
 const game=new Chess();assert.throws(()=>game.move(move('e2','e5')));assert.equal(positionFEN(game.position),INITIAL_FEN);assert.equal(game.history.length,0);
 const p=parsePosition('7k/P7/8/8/8/8/8/7K w - - 0 1');assert.equal(legalMoves(p,square('a7')).length,4);
 assert.throws(()=>play(p,move('a7','a8')));assert.equal(play(p,move('a7','a8',2)).board[square('a8')],2);
});
test('castling moves the same rook and removes rights',()=>{
 const game=new Chess(chess({fen:'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'}));
 assert.equal(game.move(move('e1','g1')).san,'O-O');assert.equal(game.position.board[square('f1')],4);assert.equal(game.position.board[square('h1')],0);assert.equal(game.position.castling,12);
 assert.ok(game.undo());assert.equal(game.position.castling,15);
 const attacked=parsePosition('r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1');assert.ok(!legalMoves(attacked).some(m=>m.from===square('e1')&&m.to===square('g1')));
});
test('en passant removes the pawn and cannot expose own king',()=>{
 const p=parsePosition('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');const next=play(p,move('e5','d6'));
 assert.equal(next.board[square('d5')],0);assert.equal(next.board[square('d6')],1);
 const pinned=parsePosition('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');assert.throws(()=>play(pinned,move('e5','d6')));
 assert.equal(positionKey(pinned),positionKey(parsePosition('k3r3/8/8/3pP3/8/8/8/4K3 w - - 0 2')));
});
test('checkmate and stalemate are distinct and notation records mate',()=>{
 const game=new Chess();for(const [a,b] of [['f2','f3'],['e7','e5'],['g2','g4']])game.move(move(a,b));
 assert.equal(game.move(move('d8','h4')).san,'Qh4#');assert.deepEqual(game.result,{kind:'checkmate',winner:-1});assert.throws(()=>game.move(move('a2','a3')));
 assert.deepEqual(chessResult(parsePosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')),{kind:'draw',reason:'stalemate'});
});
test('repetition has explicit threefold claim and automatic fivefold',()=>{
 const game=new Chess();const cycle=()=>{for(const [a,b] of [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']])game.move(move(a,b));};
 cycle();cycle();assert.deepEqual(game.result.canClaim,['repetition']);cycle();cycle();assert.deepEqual(game.result,{kind:'draw',reason:'fivefold'});
 assert.ok(game.undo());assert.equal(game.result.kind,'playing');
});
test('50 move claim differs from automatic 75 move rule; mate has priority',()=>{
 assert.deepEqual(chessResult(parsePosition('7k/8/8/8/8/8/8/R5K1 w - - 100 80')).canClaim,['fifty-move']);
 assert.deepEqual(chessResult(parsePosition('7k/8/8/8/8/8/8/R5K1 w - - 150 80')),{kind:'draw',reason:'seventy-five-move'});
 assert.deepEqual(chessResult(parsePosition('7k/6Q1/5K2/8/8/8/8/8 b - - 150 80')),{kind:'checkmate',winner:1});
});
test('history is bounded and returned data cannot mutate the position',()=>{
 const game=new Chess(chess({historyLimit:1}));game.move(move('e2','e4'));assert.throws(()=>game.move(move('e7','e5')),/budget/);
 assert.throws(()=>{game.position.board[0]=0;});const copy=game.history;copy.pop();assert.equal(game.history.length,1);
});
test('invalid authored positions fail before a match is installed',()=>{
 for(const fen of ['8/8/8/8/8/8/8/8 w - - 0 1','7k/8/8/8/8/8/8/4K3 w K - 0 1','7k/8/8/8/8/8/8/4K3 w - e3 0 1','7k/8/8/8/8/8/8/P3K3 w - - 0 1'])assert.throws(()=>parsePosition(fen));
});
