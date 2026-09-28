import test from 'node:test';
import assert from 'node:assert/strict';
import {CarBallArena,arenaDatagram} from '../dist/examples/car-ball.js';
import {CarBallView,arenaOffset as o} from '../dist/examples/car-ball-view.js';
import {ForceFrame} from '../dist/physics/force-frame.js';
import {eulerFromBasis,quaternionFromEuler} from '../dist/physics/rotation.js';

const stamp={epoch:1,sequence:1,tick:0,time:0,paused:false};
function sample(arena,time){
 const f=arenaDatagram.decode(arenaDatagram.encode(arena.capture({...stamp,time,sequence:1+Math.round(time*120),tick:Math.round(time*120)})));
 return {...f,fromTick:f.tick,toTick:f.tick,alpha:0,rows:f.rows.map(r=>({...r,values:Float64Array.from(r.values)}))};
}
test('shared f64 basis conversion preserves all three axes, including singular charts',()=>{
 const frame=new ForceFrame(),again=new ForceFrame(),out=[0,0,0];
 for(const rotation of [[0,0,0],[.3,.7,-1.1],[1,Math.PI/2,.4],[-.6,-Math.PI/2,.9],[4,-2,8]]){
  frame.update(rotation);eulerFromBasis(frame.basis,out);again.update(out);
  for(let i=0;i<9;i++)assert.ok(Math.abs(frame.basis[i]-again.basis[i])<1e-7);
 }
});
test('installed game parts need no per-sample ID lookup or semantic regex parsing',()=>{
 const arena=new CarBallArena(),view=new CarBallView(),f=sample(arena,1),read=view.scene.entities.get,exec=RegExp.prototype.exec;
 let lookups=0,patterns=0;
 view.scene.entities.get=function(key){lookups++;return read.call(this,key);};
 RegExp.prototype.exec=function(value){patterns++;return exec.call(this,value);};
 try{view.apply(f);}finally{view.scene.entities.get=read;RegExp.prototype.exec=exec;}
 assert.equal(lookups,0);assert.equal(patterns,0);
 assert.equal(view.scene.physics.bodies.size,0);assert.equal(view.scene.physics.steps,0);
 const tire=view.scene.entities.get('car:0/tire-front-left'),rim=view.scene.entities.get('car:0/rim-front-left');
 assert.ok(tire&&rim);assert.deepEqual(tire.rotation,rim.rotation);
 view.dispose();arena.dispose();
});
test('bound views retain scene identity through seek, epoch reset and appearance edits',()=>{
 const arena=new CarBallArena(),view=new CarBallView(),identities=[...view.scene.entities.values()],vertices=view.ballMesh.vertices;
 const before=sample(arena,1),after=structuredClone(before);after.time=2;after.tick=240;after.epoch=2;after.rows[0].generation=1;
 const v=after.rows[0].values;v[o.car0]=8;v[o.pads]=4;v[o.nodes]+=.03;v.set(quaternionFromEuler([.4,.6,-.2]),o.rotation0);v[o.spin]=9.7;v[o.compression]=.1;
 view.apply(before);view.apply(after);const poses=[...view.scene.entities.values()].map(e=>[...e.position,...e.rotation,...e.scale]);
 view.apply(before);view.apply(after);assert.deepEqual([...view.scene.entities.values()].map(e=>[...e.position,...e.rotation,...e.scale]),poses);
 assert.equal(view.scene.entities.get('pad:0').scale[0],.22);assert.equal(view.ballMesh.positions[0],v[o.nodes]);
 view.scene.patchAppearance({materials:[{id:'car:0/body',set:{roughness:.8}}]});view.apply({...after,time:3});assert.equal(view.scene.entities.get('car:0/body').material.roughness,.8);
 [...view.scene.entities.values()].forEach((e,i)=>assert.equal(e,identities[i]));assert.equal(view.ballMesh.vertices,vertices);
 assert.equal(view.scene.physics.steps,0);view.dispose();arena.dispose();
});
