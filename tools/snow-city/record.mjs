// Bake one authoritative 60 Hz physical visit. Workers share its compact states
// and spend their GPU time on assigned frames rather than resimulating gaps.
import {writeFile,readFile,readdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Scene} from '../../dist/scene/scene.js';
import spec from './scene.mjs';
import {SnowCitySimulation} from './simulation.mjs';
import {EPISODE_SECONDS} from './timing.mjs';
import {TAPE_REVISION} from './timeline.mjs';
const scene=new Scene(spec),sim=new SnowCitySimulation(scene),frames=[],soft=[],skins=[];
let lastSkin='',skinIndex=-1;const softIndices=[-1,-1,-1],softRevisions=[-1,-1,-1],phases=[0,0,0];
const start=performance.now();
for(let tick=0;tick<=EPISODE_SECONDS*60;tick++){
 if(tick){scene.step(1/60);scene.drainEvents();scene.contacts.drainFootsteps();}
 const people=sim.people,stamps=people.skin.stamps,skinKey=JSON.stringify([sim.peopleVisit,stamps]);
 if(lastSkin!==skinKey){lastSkin=skinKey;skinIndex=skins.length;skins.push(stamps);}
 const cars=sim.cars.map((c,i)=>{
  if(c.softUntil>=0&&tick%6===0&&softRevisions[i]!==c.softRevision){softRevisions[i]=c.softRevision;softIndices[i]=soft.length;soft.push({nodes:[...c.soft.structure.position],panels:c.soft.panels.presentationState(),revision:soft.length});}
  const b=c.rig.body,wheels=c.wheelIds.map(id=>{const p=c.rig.part(id);return{point:[...p.point],contactNormal:[...p.contactNormal],contact:p.contact,spinRad:p.spinRad,effectiveRadiusM:p.effectiveRadiusM};}),rpm=c.rig.drivetrainState.engineRpm;
  const phase=phases[i];phases[i]+=rpm/60*3/60;
  return{body:[...b.position,...b.rotation,...b.velocity,...b.angularVelocity],steer:c.steer,throttle:c.throttle??0,wheels,rpm,gear:c.rig.drivetrainState.gear,slip:c.maxSlip,distance:c.distanceM,fullThrottleTicks:c.fullThrottleTicks,driftTicks:c.driftTicks,soft:softIndices[i],phase};
 });
 const balls=people.balls.map(e=>[...e.body.position,...e.body.rotation]);
 const projectiles=people.projectiles.map(p=>{const e=scene.entities.get(p.id);return{index:Number(p.id.split(':ball').at(-1)),body:[...e.body.position,...e.body.rotation]};});
 frames.push({camera:structuredClone(scene.camera),cars,people:{actors:people.actors.map(a=>a.presentation),balls,projectiles,radius:people.rollingRadius,stock:people.stockM3,used:people.usedM3,rollDistance:people.rollDistance,action:people.action,knocked:people.knocked,skin:skinIndex},collisions:sim.collisionCount,prediction:structuredClone(sim.director.prediction),shot:sim.director.shot});
 if(tick%1920===0)console.log(`Recorded ${tick}/${EPISODE_SECONDS*60} ticks`);
}
const files=['scene.mjs','simulation.mjs','cars.mjs','people.mjs','pedestrian.mjs','city.mjs','director.mjs','timing.mjs','math.mjs'];
async function engineFiles(prefix){for(const entry of await readdir(new URL(prefix,import.meta.url),{withFileTypes:true})){const file=prefix+entry.name;if(entry.isDirectory())await engineFiles(file+'/');else if(entry.name.endsWith('.js'))files.push(file);}}
await engineFiles('../../dist/');
const sources={};for(const file of files.sort())sources[file]=createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex');
const tape={version:TAPE_REVISION,tickRate:60,duration:EPISODE_SECONDS,sources,frames,soft,skins},bytes=gzipSync(JSON.stringify(tape),{level:9});
await writeFile(new URL('timeline.bin',import.meta.url),bytes);sim.dispose();
console.log(JSON.stringify({frames:frames.length,soft:soft.length,skins:skins.length,bytes:bytes.length,buildMs:performance.now()-start}));
