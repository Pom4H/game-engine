import test from 'node:test';
import assert from 'node:assert/strict';
import {WalkWorld,walkerInput} from '../dist/runtime/walker-motion.js';
import {BrowserRuntime} from '../dist/runtime/browser.js';
const bounds={min:[-10,-1,-10],max:[10,10,10]},wall={min:[2,0,-5],max:[2.1,5,5]};
test('walking input normalizes diagonals and sprint is faster',()=>{
 assert.equal(walkerInput(0,0,0,false).speed,0);assert.equal(walkerInput(1,1,0,false).speed,walkerInput(1,0,0,false).speed);
 assert.ok(walkerInput(1,0,0,true).speed>walkerInput(1,0,0,false).speed);assert.equal(walkerInput(0,1,0,false).heading,-Math.PI/2);
});
test('swept player cannot tunnel through a thin wall',()=>{const p=new WalkWorld([wall],bounds).move([0,0,0],8,0);assert.ok(p[0]<1.721&&p[0]>1.70);});
test('diagonal contact slides along a facade',()=>{const p=new WalkWorld([wall],bounds).move([0,0,0],4,2);assert.ok(p[0]<1.721);assert.ok(p[2]>1.99);});
test('movement away from a touching wall is permitted',()=>{const p=new WalkWorld([wall],bounds).move([1.72,0,0],-1,0);assert.ok(p[0]<.721);});
test('kerb step and overhead clearance do not form full height walls',()=>{
 const w=new WalkWorld([{min:[1,0,-5],max:[2,.26,5]},{min:[1,2,-5],max:[2,3,5]}],bounds);assert.equal(w.move([0,0,0],3,0)[0],3);
});
test('bounds stop the player at the authored map edge',()=>{const p=new WalkWorld([],bounds).move([0,0,0],25,25);assert.deepEqual(p,[9.72,0,9.72]);});
test('camera boom retracts before crossing geometry',()=>{const p=new WalkWorld([wall],bounds).camera([0,1.3,0],[4,1.8,0]);assert.ok(p[0]<1.86);assert.ok(p[1]>1.3);});
test('walking is timestep independent in an unobstructed scene',()=>{const w=new WalkWorld([],bounds);let a=[0,0,0],b=[0,0,0];for(let i=0;i<60;i++)a=w.move(a,1.6/60,0);for(let i=0;i<120;i++)b=w.move(b,1.6/120,0);assert.ok(Math.abs(a[0]-b[0])<1e-9);});
test('invalid movement and collider bounds fail explicitly',()=>{assert.throws(()=>new WalkWorld([{min:[1,0,0],max:[0,1,1]}],bounds));assert.throws(()=>new WalkWorld([],bounds).move([0,0,0],NaN,0));});
test('browser runtime drives the authored walker and respects static obstacles',t=>{
 const originalWindow=globalThis.window,originalDocument=globalThis.document;
 const listeners=new Map(),surface={addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
 globalThis.window={...surface};globalThis.document={...surface,hidden:false,pointerLockElement:null,exitPointerLock(){}};
 t.after(()=>{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;});
 const canvas={...surface,focus(){},tabIndex:-1},renderer={render(){},inspect(){return{};},dispose(){},async flush(){}};
 const runtime=new BrowserRuntime(canvas,{version:1,animation:{walkers:[{id:'walker',root:[0,0,0],heading:0,speed:0}]},entities:[]},renderer,{audio:false});
 const controls=runtime.controlWalker('walker',{world:new WalkWorld([wall],bounds)});
 listeners.get('keydown')({code:'KeyW',preventDefault(){}});
 runtime.step(120);
 const x=runtime.scene.animation.pose('walker').position[0];
 assert.ok(x>1.6&&x<1.721,x);
 assert.equal(controls.inspect().active,true);
 runtime.dispose();
});
