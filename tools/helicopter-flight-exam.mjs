import {mkdir,writeFile} from 'node:fs/promises';
import {PhysicsWorld} from '../dist/physics/world.js';
import {Vehicle} from '../dist/vehicles/vehicle.js';
import {
  lightHelicopter,
  LIGHT_HELICOPTER_HOVER_COLLECTIVE,
  LIGHT_HELICOPTER_HOVER_ROLL,
  LIGHT_HELICOPTER_MAIN_RPM,
} from '../dist/vehicles/helicopter.js';

const DT=1/120, OUT='artifacts/helicopter-flight-exam';
const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const deg=r=>r*180/Math.PI;
const rpm=w=>w*30/Math.PI;
const hypot2=(x,z)=>Math.hypot(x,z);

class Pilot {
  constructor(vehicle){this.v=vehicle;}
  fly(target){
    const b=this.v.body,yaw=b.rotation[1],cy=Math.cos(yaw),sy=Math.sin(yaw);
    const desiredVx=target.vx??0,desiredVz=target.vz??0;
    const evx=desiredVx-b.velocity[0],evz=desiredVz-b.velocity[2];
    const forwardError=evx*cy-evz*sy,rightError=evx*sy+evz*cy;
    const altitudeError=(target.altitude??b.position[1])-b.position[1];
    const collective=clamp(
      LIGHT_HELICOPTER_HOVER_COLLECTIVE+altitudeError*.018-b.velocity[1]*.055,
      .08,.72,
    );
    const pitch=clamp(forwardError*.035-b.rotation[2]*1.15-b.angularVelocity[2]*.35,-.72,.72);
    const roll=clamp(LIGHT_HELICOPTER_HOVER_ROLL+rightError*.032-b.rotation[0]*1.0-b.angularVelocity[0]*.30,-1,1);
    const yawError=wrap((target.yaw??yaw)-yaw);
    const yawControl=clamp(yawError*.85-b.angularVelocity[1]*.22,-1,1);
    this.v.setControls({throttle:target.throttle??1,collective,pitch,roll,yaw:yawControl});
  }
}

const world=new PhysicsWorld([0,-9.81,0],0);
const heli=new Vehicle(world,lightHelicopter('ci-flight-exam'),{position:[0,1.0,0]});
const pilot=new Pilot(heli);
const samples=[],phases=[];
let t=0;

function sample(phase){
  const b=heli.body,main=heli.part('main.rotor'),tail=heli.part('tail.rotor');
  samples.push({
    t,phase,x:b.position[0],y:b.position[1],z:b.position[2],
    vx:b.velocity[0],vy:b.velocity[1],vz:b.velocity[2],
    roll:b.rotation[0],yaw:b.rotation[1],pitch:b.rotation[2],
    wx:b.angularVelocity[0],wy:b.angularVelocity[1],wz:b.angularVelocity[2],
    mainRpm:rpm(main.angularSpeed),tailRpm:rpm(tail.angularSpeed),
    mainLift:main.liftN,mainPower:main.powerW,shaftPower:main.shaftPowerW,
    groundEffect:main.groundEffect,vrs:main.vortexRing,retreatingStall:main.retreatingStall,
    blades:main.bladesAttached,
  });
}
function runPhase(name,seconds,target,gate){
  const from=samples.length;
  for(let i=0;i<Math.round(seconds/DT);i++){
    if(typeof target==='function')target(t,i);else pilot.fly(target);
    world.step(DT);t+=DT;if(i%6===0)sample(name);
  }
  const rows=samples.slice(from),result=gate?gate(rows):{pass:true};
  phases.push({name,seconds,...result});
  console.log(JSON.stringify(phases.at(-1)));
}
const tailAvg=rows=>rows.reduce((s,r)=>s+r.y,0)/Math.max(1,rows.length);
const maxOf=(rows,key)=>Math.max(...rows.map(r=>r[key]));
const minOf=(rows,key)=>Math.min(...rows.map(r=>r[key]));
const rms=(rows,fn)=>Math.sqrt(rows.reduce((s,r)=>s+fn(r)**2,0)/Math.max(1,rows.length));

// Spool on the pad: ordinary controls only, no pose freeze.
runPhase('spool',5,()=>heli.setControls({throttle:1,collective:.02,pitch:0,roll:LIGHT_HELICOPTER_HOVER_ROLL,yaw:0}),rows=>{
  const final=rows.at(-1);
  return {pass:final.mainRpm>LIGHT_HELICOPTER_MAIN_RPM*.88&&final.y<2.5,finalRpm:final.mainRpm,altitude:final.y};
});

runPhase('takeoff',8,{altitude:15,yaw:0},rows=>{
  const final=rows.at(-1);
  return {pass:maxOf(rows,'y')>11&&final.y>9&&Math.abs(final.roll)<1.1&&Math.abs(final.pitch)<1.1,finalAltitude:final.y,maxAltitude:maxOf(rows,'y')};
});

runPhase('hover',6,{altitude:15,yaw:0},rows=>{
  const e=rms(rows,r=>r.y-15),horizontal=maxOf(rows,'vx')-minOf(rows,'vx');
  return {pass:e<5&&hypot2(rows.at(-1).vx,rows.at(-1).vz)<8&&maxOf(rows,'mainRpm')>330,altitudeRms:e,finalHorizontalSpeed:hypot2(rows.at(-1).vx,rows.at(-1).vz),meanAltitude:tailAvg(rows)};
});

runPhase('forward-flight',10,{altitude:20,yaw:0,vx:18,vz:0},rows=>{
  const final=rows.at(-1),peak=hypot2(...[rows.reduce((best,r)=>hypot2(r.vx,r.vz)>hypot2(best.vx,best.vz)?r:best,rows[0])].map(r=>[r.vx,r.vz]).flat());
  return {pass:maxOf(rows,'vx')>11&&final.y>10&&maxOf(rows,'mainLift')>0,peakForwardSpeed:maxOf(rows,'vx'),finalAltitude:final.y,peakHorizontalSpeed:peak};
});

runPhase('turn',9,{altitude:22,yaw:Math.PI/2,vx:0,vz:-10},rows=>{
  const final=rows.at(-1),yawError=Math.abs(wrap(Math.PI/2-final.yaw));
  return {pass:yawError<.75&&final.y>10&&hypot2(final.vx,final.vz)>3,yawDeg:deg(final.yaw),yawErrorDeg:deg(yawError),speed:hypot2(final.vx,final.vz)};
});

runPhase('climb',9,{altitude:55,yaw:Math.PI/2,vx:0,vz:-6},rows=>{
  const final=rows.at(-1);
  return {pass:maxOf(rows,'y')>38&&final.y>30&&maxOf(rows,'vy')>1.2,finalAltitude:final.y,peakAltitude:maxOf(rows,'y'),peakClimbRate:maxOf(rows,'vy')};
});

// Engine-out segment. The harness does not hold position or RPM; it only commands a sane
// autorotation collective and attitude. Rotor energy must come from the descending flow.
runPhase('autorotation',6,()=>heli.setControls({throttle:0,collective:.18,pitch:0,roll:LIGHT_HELICOPTER_HOVER_ROLL,yaw:0}),rows=>{
  const initial=rows[0],final=rows.at(-1),minRpm=minOf(rows,'mainRpm');
  return {pass:final.y>8&&final.y<initial.y&&minRpm>120&&final.vy<0,initialAltitude:initial.y,finalAltitude:final.y,minRpm,finalDescentRate:final.vy};
});

runPhase('recovery',8,{altitude:18,yaw:Math.PI/2,vx:0,vz:0,throttle:1},rows=>{
  const final=rows.at(-1);
  return {pass:final.mainRpm>330&&final.y>8&&final.vy>-8,finalRpm:final.mainRpm,finalAltitude:final.y,verticalSpeed:final.vy};
});

runPhase('landing',12,{altitude:1.0,yaw:Math.PI/2,vx:0,vz:0},rows=>{
  const final=rows.at(-1),impact=Math.max(...rows.filter((r,i)=>i>0).map((r,i)=>Math.max(0,-r.vy)));
  return {pass:final.y<3&&Math.abs(final.vy)<4&&hypot2(final.vx,final.vz)<5&&final.blades>0,finalAltitude:final.y,verticalSpeed:final.vy,horizontalSpeed:hypot2(final.vx,final.vz),maxDescentRate:impact,blades:final.blades};
});

heli.dispose();
await mkdir(OUT,{recursive:true});
const pass=phases.every(p=>p.pass);
const report={pass,dt:DT,duration:t,phases,samples:samples.length,headings:{x:'forward',y:'up',z:'right'}};
await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,2));
const keys=Object.keys(samples[0]??{});
await writeFile(`${OUT}/flight.csv`,keys.join(',')+'\n'+samples.map(r=>keys.map(k=>r[k]).join(',')).join('\n')+'\n');

const W=1200,H=720,pad=60,plotW=W-pad*2,plotH=H-pad*2;
const minT=0,maxT=Math.max(1,t),maxY=Math.max(60,...samples.map(r=>r.y)),maxS=Math.max(20,...samples.map(r=>hypot2(r.vx,r.vz)));
const path=(value,max,baseY)=>samples.map((r,i)=>`${i?'L':'M'} ${(pad+(r.t-minT)/(maxT-minT)*plotW).toFixed(1)} ${(baseY-value(r)/max*plotH*.42).toFixed(1)}`).join(' ');
const altitudePath=path(r=>Math.max(0,r.y),maxY,H*.48);
const speedPath=path(r=>hypot2(r.vx,r.vz),maxS,H*.94);
const markers=phases.map((p,i)=>{const start=phases.slice(0,i).reduce((s,x)=>s+x.seconds,0),x=pad+start/maxT*plotW;return `<line x1="${x}" y1="40" x2="${x}" y2="${H-35}" stroke="#555" stroke-dasharray="4 5"/><text x="${x+4}" y="28" font-size="12">${p.name}</text>`;}).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#111"/><g fill="#ddd" font-family="system-ui, sans-serif">${markers}<text x="20" y="${H*.08}" font-size="20">Helicopter black-box flight exam: ${pass?'PASS':'FAIL'}</text><text x="20" y="${H*.46}" font-size="14">altitude, m</text><text x="20" y="${H*.92}" font-size="14">horizontal speed, m/s</text><path d="${altitudePath}" fill="none" stroke="#8bd3ff" stroke-width="3"/><path d="${speedPath}" fill="none" stroke="#ffd166" stroke-width="3"/>${phases.map((p,i)=>`<text x="20" y="${H*.52+i*18}" font-size="13" fill="${p.pass?'#7ee787':'#ff7b72'}">${p.pass?'✓':'✗'} ${p.name}</text>`).join('')}</g></svg>`;
await writeFile(`${OUT}/flight.svg`,svg);
console.log(JSON.stringify(report,null,2));
if(!pass){console.error('HELICOPTER FLIGHT EXAM FAILED');process.exitCode=1;}
