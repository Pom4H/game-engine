export const VEHICLE_ABUSE_DURATION=32;

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};

export const ABUSE_PHASES=Object.freeze([
  {start:0,end:3.1,label:'ПОДХОД'},
  {start:3.1,end:7.9,label:'ДВЕРЬ · РАЗНАЯ СИЛА'},
  {start:7.9,end:10.8,label:'РУКА · КРЫША / СТЕКЛО / КАПОТ'},
  {start:10.8,end:16.8,label:'КАПОТ · ЛЕВАЯ / ПРАВАЯ НОГА'},
  {start:16.8,end:22.8,label:'КРЫША · ДВЕ НОГИ'},
  {start:22.8,end:30.4,label:'ПИНКИ · РАЗНАЯ ЭНЕРГИЯ'},
  {start:30.4,end:32,label:'ПОСЛЕ НАГРУЗКИ'},
]);

const events=Object.freeze([
  {time:8.35,key:'tap-roof',kind:'impact',input:{point:[.05,1.43,-.18],normal:[0,1,0],energyJ:1.8,radiusM:.12,thicknessM:.00072,effectiveMassKg:1.4}},
  {time:9.18,key:'tap-glass',kind:'impact',input:{point:[.45,1.12,-.945],normal:[0,0,-1],energyJ:.7,radiusM:.075,thicknessM:.004,material:'glass',effectiveMassKg:.7}},
  {time:10.03,key:'knock-hood',kind:'impact',input:{point:[1.42,.96,-.10],normal:[0,1,0],energyJ:6.5,radiusM:.15,thicknessM:.00078,effectiveMassKg:1.8}},
  {time:10.48,key:'knock-hood-hard',kind:'impact',input:{point:[1.20,.95,.18],normal:[0,1,0],energyJ:18,radiusM:.17,thicknessM:.00078,effectiveMassKg:2.3}},
  {time:17.35,key:'roof-jump-1',kind:'impact',input:{point:[-.05,1.44,0],normal:[0,1,0],energyJ:55,radiusM:.22,thicknessM:.00072,effectiveMassKg:34}},
  {time:18.52,key:'roof-jump-2',kind:'impact',input:{point:[-.02,1.44,-.05],normal:[0,1,0],energyJ:115,radiusM:.22,thicknessM:.00072,effectiveMassKg:40}},
  {time:19.70,key:'roof-jump-3',kind:'impact',input:{point:[.02,1.44,.04],normal:[0,1,0],energyJ:180,radiusM:.23,thicknessM:.00072,effectiveMassKg:44}},
  {time:20.88,key:'roof-jump-4',kind:'impact',input:{point:[-.08,1.44,.06],normal:[0,1,0],energyJ:255,radiusM:.24,thicknessM:.00072,effectiveMassKg:48}},
  {time:22.04,key:'roof-jump-5',kind:'impact',input:{point:[.06,1.44,-.04],normal:[0,1,0],energyJ:320,radiusM:.25,thicknessM:.00072,effectiveMassKg:52}},
  {time:23.28,key:'kick-1',kind:'impact',input:{point:[-1.55,.62,-.94],normal:[0,0,-1],energyJ:7,radiusM:.105,thicknessM:.00078,effectiveMassKg:2.8}},
  {time:24.26,key:'kick-2',kind:'impact',input:{point:[-.92,.78,-.94],normal:[0,0,-1],energyJ:15,radiusM:.11,thicknessM:.00078,effectiveMassKg:3.3}},
  {time:25.24,key:'kick-3',kind:'impact',input:{point:[-.20,.68,-.94],normal:[0,0,-1],energyJ:30,radiusM:.115,thicknessM:.00078,effectiveMassKg:3.8}},
  {time:26.22,key:'kick-4',kind:'impact',input:{point:[.62,.72,-.94],normal:[0,0,-1],energyJ:58,radiusM:.12,thicknessM:.00078,effectiveMassKg:4.2}},
  {time:27.20,key:'kick-5',kind:'impact',input:{point:[1.32,.60,-.89],normal:[0,0,-1],energyJ:98,radiusM:.125,thicknessM:.00078,effectiveMassKg:4.8}},
  {time:28.18,key:'kick-6',kind:'impact',input:{point:[2.18,.60,-.45],normal:[1,0,0],energyJ:165,radiusM:.13,thicknessM:.00082,effectiveMassKg:5.2}},
  {time:29.18,key:'kick-7',kind:'impact',input:{point:[-2.12,.58,-.42],normal:[-1,0,0],energyJ:240,radiusM:.14,thicknessM:.00082,effectiveMassKg:5.5}},
]);

export function phaseAt(time){return ABUSE_PHASES.find(phase=>time>=phase.start&&time<phase.end)??ABUSE_PHASES.at(-1);}

export function createVehicleAbuseScript(rig){
  let time=0;
  const fired=new Set();
  const fireBetween=(from,to,event)=>{
    if(fired.has(event.key)||event.time<=from||event.time>to)return;
    fired.add(event.key);
    if(event.kind==='impact')rig.impact({...event.input,time:event.time});
  };
  return{
    get time(){return time;},
    reset(){time=0;fired.clear();},
    step(dt){
      const from=time,to=time+dt,mid=(from+to)/2;
      // Door: gentle close, medium slam, hard slam.
      if(mid>=3.15&&mid<3.80)rig.door.drive(1.02,26);
      if(mid>=3.95&&mid<4.90)rig.door.drive(0,5.0);
      if(mid>=5.05&&mid<5.60)rig.door.drive(.96,28);
      if(from<5.70&&to>=5.70&&!fired.has('door-medium')){fired.add('door-medium');rig.door.addAngularImpulse(-11.5);}
      if(mid>=6.15&&mid<6.72)rig.door.drive(1.05,30);
      if(from<6.86&&to>=6.86&&!fired.has('door-hard')){fired.add('door-hard');rig.door.addAngularImpulse(-19.5);}

      for(const event of events)fireBetween(from,to,event);

      // Person on the hood. Ordinary standing load + alternating dynamic landings.
      if(mid>=10.85&&mid<16.70){
        const u=(mid-10.85)/.72,cycle=Math.floor(u),phase=u-cycle,left=cycle%2===0;
        const z=left?-.34:.34,landing=Math.exp(-(((phase-.10)/.12)**2));
        rig.applyBodyLoad([1.22,0,z],790+2_650*landing);
        const key='hood-land-'+cycle;
        if(phase>.08&&phase<.18&&!fired.has(key)){
          fired.add(key);
          rig.impact({time:mid,point:[1.22,.95,z],normal:[0,1,0],energyJ:18+cycle*2.4,radiusM:.16,thicknessM:.00078,effectiveMassKg:18});
        }
      }

      // Two-foot roof jumps. Static bodyweight while planted; strong short landing pulse.
      if(mid>=16.95&&mid<22.65){
        const u=(mid-16.95)/1.18,phase=u-Math.floor(u),landing=Math.exp(-(((phase-.34)/.105)**2));
        rig.applyBodyLoad([-.04,0,0],760+4_250*landing);
      }

      rig.step(dt);time=to;
      return{time,phase:phaseAt(time),human:humanPose(time)};
    },
  };
}

export function humanPose(time){
  let root=[0,0,0],jump=0,action='idle',strike=0,side=-1;
  if(time<3.1){
    const u=smooth(time/3.1);root=[mix(-4.4,.42,u),0,-1.60];action='walk';strike=time*2.2;
  }else if(time<7.9){root=[.45,0,-1.58];action='door';strike=time*2.6;}
  else if(time<10.8){const u=clamp((time-7.9)/2.9);root=[mix(.35,1.28,u),0,-1.58];action='hand';strike=(time-7.9)*Math.PI*2.1;}
  else if(time<16.8){
    const u=(time-10.85)/.72,phase=u-Math.floor(u);side=Math.floor(u)%2===0?-1:1;jump=.09*Math.sin(Math.PI*clamp((phase-.10)/.72));
    root=[1.22,.96+jump,side*.08];action='hood';strike=phase;
  }else if(time<22.8){
    const u=(time-16.95)/1.18,phase=u-Math.floor(u);jump=.22*Math.max(0,Math.sin(Math.PI*(phase-.16)/.72));
    root=[-.04,1.45+jump,0];action='roof';strike=phase;
  }else if(time<30.4){
    const kick=Math.max(0,Math.min(6,Math.floor(time-23.0))),x=[-1.55,-.92,-.20,.62,1.32,1.88,-1.80][kick];
    root=[x,0,-1.62];action='kick';strike=((time-23.0)%1);side=kick%2?-1:1;
  }else{root=[-2.6,0,-1.7];action='inspect';}
  return{root,jump,action,strike,side};
}
