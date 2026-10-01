import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './vehicle-runtime-fixture.mjs';

const OUT='artifacts/vehicle-physics-proof';
const run=(world,seconds)=>{for(let i=0;i<Math.round(seconds*120);i++)world.step(1/120);};
const frameKey=r=>r.tick+'.'+r.substep;
const f=fixture({incidenceRad:0});f.car.setControls({throttle:1});run(f.world,15);
const trace=f.world.traceCauses({runId:'ci-winged-car-liftoff',maxRecords:50_000});f.car.setControls({flap:1});
let airborne=false;
for(let i=0;i<300;i++){f.world.step(1/120);airborne=['front.left','front.right','rear.left','rear.right'].every(id=>!f.car.part(id).contact);if(airborne&&i>20)break;}
const records=trace.snapshot(),frames=new Map();
for(const r of records){
 if(r.type!=='physics.contribution')continue;
 const key=frameKey(r),entry=frames.get(key)??{tick:r.tick,substep:r.substep,laws:new Set(),contacts:0};
 entry.laws.add(r.component_id+'\0'+r.law_id);if(r.law_id==='wheel-contact.v1')entry.contacts++;frames.set(key,entry);
}
const list=[...frames.values()],before=list.find(x=>x.contacts>0&&[...x.laws].some(v=>v.endsWith('\0finite-wing.v1'))),after=[...list].reverse().find(x=>x.contacts===0&&[...x.laws].some(v=>v.endsWith('\0finite-wing.v1')));
const additions=before&&after?[...after.laws].filter(x=>!before.laws.has(x)):[];
const writers=[...new Set(records.filter(r=>r.type==='physics.state-mutation'&&r.body_id==='vehicle').map(r=>r.writer_id))];
const manifestsAfterStart=records.filter(r=>(r.type==='manifest.component'||r.type==='manifest.law')&&r.seq>(records.find(x=>x.type==='frame.begin')?.seq??Infinity));
const summary={
 schema:'cause-proof',schema_version:'1.0',body_id:'vehicle',airborne,
 before:before?{tick:before.tick,substep:before.substep,active_contacts:before.contacts,laws:[...before.laws].sort()}:null,
 after:after?{tick:after.tick,substep:after.substep,active_contacts:after.contacts,laws:[...after.laws].sort()}:null,
 new_laws_after_liftoff:additions,
 manifest_changes_after_start:manifestsAfterStart.length,
 state_writers:writers,
 unattributed_force_max_N:trace.proof.maxForceResidualN,
 unattributed_torque_max_Nm:trace.proof.maxTorqueResidualNm,
 records:trace.proof.records,
 pass:airborne&&!!before&&!!after&&additions.length===0&&manifestsAfterStart.length===0&&writers.length===1&&writers[0]==='PhysicsWorld.integrate'&&trace.proof.maxForceResidualN===0&&trace.proof.maxTorqueResidualNm===0,
};
await mkdir(OUT,{recursive:true});await writeFile(OUT+'/trace.jsonl',trace.toJSONL());await writeFile(OUT+'/proof.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));f.car.dispose();if(!summary.pass)process.exitCode=1;
