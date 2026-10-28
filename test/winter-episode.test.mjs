import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/index.js';
import {makeWinterScene,walkingWorld} from '../tools/winter/scene.mjs';
import {WinterEpisode} from '../tools/winter/episode.mjs';

test('winter episode requires proximity, uses native rolling contacts and can be completed',()=>{
 const data=makeWinterScene(),scene=new Scene(data.spec),episode=new WinterEpisode(scene,data.vehicleParts);
 const walk=(ticks,heading,speed=1.6)=>{scene.animation.driveWalker('walker',speed,heading);for(let i=0;i<ticks;i++)scene.step();};
 assert.equal(episode.interact(),false,'distant input cannot launch the car');
 walk(225,0);assert.ok(episode.inspect().footprints>=8);assert.equal(episode.inspect().goals[0],true);
 walk(55,Math.PI/2);assert.equal(episode.interact(),true);assert.equal(episode.interact(),false,'car can only launch once');
 const before=scene.entities.get('car-body').position[0];walk(120,0,0);
 assert.ok(scene.entities.get('car-body').position[0]>before+4);
 assert.ok(scene.contacts.sprayEmitted>=12,'real wet tyre contacts must emit spray');
 assert.ok(scene.contacts.wetness>.4);assert.equal(episode.inspect().goals[1],true);
 walk(337,0);walk(45,-Math.PI/2);assert.equal(episode.inspect().complete,true);
 walk(600,0,0);assert.equal(scene.entities.has('car-body'),false,'departed car releases its render and contact entities');
 assert.ok(walkingWorld(scene,data.obstacles).move([-2,.16,2],0,-4)[2]<-1.9);
 const reset=new WinterEpisode(new Scene(data.spec),data.vehicleParts);
 assert.equal(reset.started,false);assert.equal(reset.inspect().complete,false);assert.equal(reset.inspect().footprints,0);
});

test('walking collision follows the moving car rather than leaving a parked ghost',()=>{
 const data=makeWinterScene(),scene=new Scene(data.spec),world=walkingWorld(scene,data.obstacles);
 const before=world.move([-2,.16,2],0,-4);assert.ok(before[2]>.06);
 const car=scene.entities.get('car-body');car.position[0]=8;
 assert.ok(world.move([-2,.16,2],0,-4)[2]<-1.9);
 assert.ok(world.camera([-2,1.4,2],[-2,1.4,-3])[2]<-2.9);
 assert.ok(world.move([8,.14,2.4],0,2)[2]<2.92,'the elevated snowy bench seat is an obstacle, not a ground surface');
});
