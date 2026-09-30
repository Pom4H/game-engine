import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Worker} from 'node:worker_threads';
import * as chess from '../dist/games/chess-project.js';import * as arena from '../dist/games/car-ball-project.js';import {CarBallArena} from '../dist/examples/car-ball.js';
const require=createRequire(import.meta.url),ts=createRequire(new URL('../tools/docs/package.json',import.meta.url))('typescript'),{compileSource}=require('../tools/shared/compile.cjs'),bindings=require('../tools/shared/bindings.cjs');
const compile=(source,api,name)=>compileSource(ts,{...api,validateProgram:p=>p.check()},source,name);
test('both authored projects compile through the SAME source compiler and exact public imports',async()=>{
 for(const [game,api,name] of [['chess',chess,'chess'],['car-ball',arena,'car-ball']]){const source=await readFile(new URL('../examples/'+game+'/project.ts',import.meta.url),'utf8'),p=compile(source,api,'@rom4/game-engine/games/'+name+'/project');assert.equal(p.check().modules.length,1);const runtime=p.start();assert.ok(runtime.inspect().length);runtime.dispose();}
});
test('text source binding preserves comments and requires valid FEN before installation',async()=>{
 const source=await readFile(new URL('../examples/chess/project.ts',import.meta.url),'utf8'),metadata={fen:{shape:'text',label:'FEN',maxLength:200}},first=bindings.analyze(ts,source,metadata).bindings.find(b=>b.key==='fen');assert.ok(first?.editable);const next=bindings.applyEdits(source,bindings.editsFor(source,first,'7k/8/8/8/8/8/8/R5K1 w - - 0 1'));const p=compile(next,chess,'@rom4/game-engine/games/chess/project');assert.equal(p.start().values.rules.position.board[0],4);assert.ok(next.includes('//'));
});
test('the default arena DSL leaves existing physical results exactly unchanged',()=>{
 const a=new CarBallArena(),r=arena.project({id:'arena',modules:{rules:arena.arena()}}).start(),b=r.values.rules;
 try{for(let tick=0;tick<40;tick++){a.step();b.step();}const stamp={epoch:1,sequence:1,tick:a.tick,time:a.time,paused:false};assert.deepEqual(a.capture(stamp),b.capture(stamp));}finally{a.dispose();r.dispose();}
});
test('arena presets cannot change wire ranges or secretly activate absent modules',()=>{
 assert.throws(()=>arena.arena({matchSeconds:301}));assert.throws(()=>arena.arena({gravity:NaN}));assert.throws(()=>arena.project({id:'arena',modules:{rules:arena.arena()},presets:{bad:{audio:{}}}}));const p=arena.project({id:'arena',modules:{rules:arena.arena()},presets:{moon:{rules:{gravity:2}}}}),r=p.start('moon');assert.equal(r.values.rules.world.gravity[1],-2);r.dispose();
});
test('CLI static check does not call module factories',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'engine-cli-'));try{const file=join(dir,'project.mjs'),url=new URL('../dist/core/project.js',import.meta.url).href;await writeFile(file,`import {project,modulePlan} from ${JSON.stringify(url)};export default project({id:'cli',modules:{rules:modulePlan({id:'rules',label:'Rules',config:{},validate(){},create(){throw Error('must not start');}})}});`);const result=JSON.parse(execFileSync(process.execPath,['tools/engine.mjs','check',file],{encoding:'utf8'}));assert.equal(result.modules[0].id,'rules');}finally{await rm(dir,{recursive:true,force:true});}
});
