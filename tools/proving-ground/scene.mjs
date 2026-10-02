// Engine proving ground. Geometry is deliberately simple and modular: every
// physical obstacle/road section is an ordinary Scene entity, not gameplay code.
import {provingGroundZones} from './catalog.mjs';
import {provingGroundExperiments,experimentSceneEntities} from './experiments.mjs';

const A={kind:'asphalt',color:[.055,.06,.065,1],roughness:.82};
const C={kind:'concrete',color:[.42,.43,.44,1],roughness:.88};
const G={kind:'default',color:[.26,.34,.18,1],roughness:.98};
const S={kind:'steel',color:[.30,.32,.34,1],metalness:.72,roughness:.45};
const W={kind:'default',color:[.08,.28,.38,.42],roughness:.08,clearcoat:.35,clearcoatRoughness:.08};
const R={kind:'rubber',color:[.08,.075,.07,1],roughness:.95};
const P={kind:'default',color:[.70,.68,.62,1],roughness:.92};
const B={kind:'default',color:[.36,.37,.38,1],roughness:.88};
const entities=[];
const add=e=>{entities.push(e);return e};
const box=(id,position,size,material=A,extra={})=>add({id,position,mesh:{kind:'box',size},material,...extra});
const cyl=(id,position,radius,height,material=C,extra={})=>add({id,position,mesh:{kind:'cylinder',radius,height,segments:48},material,...extra});
const torus=(id,position,radius,tube,material=C,rotation=[0,0,0])=>add({id,position,rotation,mesh:{kind:'torus',radius,tube,segments:64},material});

const topBox=(id,position,size,material=A,extra={})=>
 box(id,[position[0],position[1]-size[1]/2,position[2]],size,material,extra);

function segmentPose(a,b){
 const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],horizontal=Math.hypot(dx,dz),length=Math.hypot(dx,dy,dz);
 return{
  position:[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],
  rotation:[-Math.atan2(dy,Math.max(1e-9,horizontal)),Math.atan2(dx,dz),0],
  length
 };
}
function roadStrip(id,points,width=9,material=A,{thickness=.28,physical=true,guard=false}={}){
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1],pose=segmentPose(a,b),normalDrop=thickness/2;
  box(`${id}-${String(i).padStart(2,'0')}`,
    [pose.position[0],pose.position[1]-normalDrop,pose.position[2]],
    [width,thickness,pose.length+.18],material,
    {rotation:pose.rotation,...(physical?{body:{}}:{})});
  if(guard){
   const yaw=pose.rotation[1],side=[Math.cos(yaw),0,-Math.sin(yaw)];
   for(const sign of [-1,1])box(`${id}-guard-${i}-${sign>0?'r':'l'}`,
     [pose.position[0]+side[0]*sign*(width/2+.18),pose.position[1]+.42,pose.position[2]+side[2]*sign*(width/2+.18)],
     [.18,.9,pose.length+.1],C,{rotation:[0,yaw,0],body:{}});
  }
 }
}
function sample(count,fn){return Array.from({length:count+1},(_,i)=>fn(i/count));}

// Site base: the authored lawn is visual only. The physical test surfaces below
// are explicit bodies; world ground is below the facility so it cannot mask misses.
box('site-lawn',[0,-.35,5],[220,.5,220],G);
box('site-apron',[0,-.08,-108],[115,.12,24],C);

// 1. Acceleration / braking straight.
roadStrip('straight',[[ -28,0,-108],[-28,0,32]],12,A,{physical:true});
for(const z of [-98,-78,-58,-38,-18,2,22])box(`straight-mark-${z}`,[-28,.008,z],[.14,.012,5.2],P);
box('start-left',[-34,2.1,-101],[.35,4.2,.35],S);
box('start-right',[-22,2.1,-101],[.35,4.2,.35],S);
box('start-bar',[-28,4.15,-101],[12.7,.35,.35],S);

// 2. Obstacle lane.
roadStrip('obstacles-road',[[-58,0,-91],[-58,0,-23]],9,A);
for(let row=0;row<8;row++)for(let side=-1;side<=1;side++){
 const z=-82+row*7.5,x=-58+side*2.2+(row%2?1.05:0);
 box(`obstacle-${row}-${side+1}`,[x,.20+(row%3)*.08,z],[1.9,.40+(row%3)*.16,2.8],C,{body:{}});
}

// 3. Surface/friction/braking pads.
const pads=[
 ['asphalt',[-1,0,-96],A],
 ['concrete',[13,0,-96],C],
 ['rubber',[27,0,-96],R],
 ['wet-asphalt',[41,0,-96],{...A,color:[.045,.055,.065,1],clearcoat:.35,clearcoatRoughness:.22}],
];
for(const [name,p,m] of pads)topBox(`surface-${name}`,p,[12,.16,18],m,{
 body:{},
 environmental:{surfaceUse:'road',...(name==='wet-asphalt'?{waterDepthM:.004}:{})}
});

// 4. Circular skidpad / centripetal test area.
const circle=[-72,0,42];
cyl('circle-pad',[circle[0],-.11,circle[2]],34,.22,A);
box('circle-physics',[circle[0],-.13,circle[2]],[68,.26,68],A,{body:{},environmental:{surfaceUse:'road'}});
for(const radius of [10,20,30])torus(`circle-ring-${radius}`,[circle[0],.025,circle[2]],radius,.10,P);

// 5. Jump ramps / landing durability.
roadStrip('ramp-main',[[-28,0,28],[-28,0,39],[-28,3.5,48],[-28,7.5,56]],10,A,{guard:true});
roadStrip('ramp-landing',[[-28,0,74],[-28,1.2,68],[-28,4.0,63]],11,A,{guard:true});
roadStrip('ramp-side',[[-6,0,20],[-6,2.0,28],[-6,5.0,34]],8,A,{guard:true});

// 6. Vertical loop: ordinary tangent road segments around a circle.
const loopCenter=[3,18,58],loopRadius=18;
const loopPoints=sample(48,t=>{
 const a=Math.PI+t*Math.PI*2;
 return[loopCenter[0],loopCenter[1]+Math.cos(a)*loopRadius,loopCenter[2]+Math.sin(a)*loopRadius];
});
roadStrip('loop',loopPoints,8,A,{thickness:.34,guard:true});
for(const sign of [-1,1])box(`loop-support-${sign}`,[loopCenter[0]+sign*5.2,8.5,loopCenter[2]],[.65,17,.65],S,{body:{}});

// 7. Handling / winding elevated track.
const handlingPoints=sample(32,t=>{
 const z=8+t*88;
 const x=30+17*Math.sin(t*Math.PI*2.15)+5*Math.sin(t*Math.PI*5.1);
 const y=2.2+1.2*Math.sin(t*Math.PI*1.4);
 return[x,y,z];
});
roadStrip('handling',handlingPoints,8.5,A,{guard:true});
for(let i=2;i<handlingPoints.length-2;i+=4)box(`handling-pier-${i}`,
 [handlingPoints[i][0],handlingPoints[i][1]/2-.1,handlingPoints[i][2]],[.75,handlingPoints[i][1]+.2,.75],C,{body:{}});

// 8. Power/brake hill.
const hillPoints=[
 [73,0,15],[73,0,28],[73,3,38],[73,10,49],[73,20,60],[73,29,72],
 [73,32,84],[73,29,96],[73,20,108],[73,9,119],[73,1,130],
];
roadStrip('hill',hillPoints,10,A,{guard:true});

// 9. Rough terrain / suspension articulation.
topBox('rough-base',[55,0,-62],[48,.24,28],{kind:'default',color:[.24,.20,.15,1],roughness:1},{body:{}});
for(let lane=0;lane<4;lane++)for(let i=0;i<10;i++){
 const x=39+lane*9.2,z=-72+i*2.8,h=.15+((i*7+lane*3)%5)*.12;
 box(`rough-${lane}-${i}`,[x,h/2,z],[6.8,h,1.4],i%2?C:P,{rotation:[0,(i%3-1)*.06,(i%2?.055:-.055)],body:{}});
}

// 10. Water basin. It is intentionally not a solid collision plane: later fluid
// physics must own buoyancy/drag/sealing instead of faking water with ground contact.
cyl('water-basin',[12,-1.1,-27],20,2.0,B);
cyl('water-volume',[12,-1.0,-27],18.7,2.0,W);
torus('water-rim',[12,.02,-27],20,.55,B);
roadStrip('water-entry',[[-28,0,-10],[-12,0,-10],[0,0,-18],[4,-.7,-24]],7,A,{guard:true});
roadStrip('water-exit',[[20,-.7,-24],[28,0,-17],[38,0,-12]],7,A,{guard:true});

// 11. Aerodynamic tunnel shell. Airflow is a future physics field; geometry and
// a measurement section exist now so the same scene can validate it.
topBox('tunnel-floor',[70,0,-32],[38,.22,13],C,{body:{}});
for(const side of [-1,1])box(`tunnel-wall-${side}`,[70,4.8,-32+side*6.35],[38,9.6,.35],C,{body:{}});
box('tunnel-roof',[70,9.5,-32],[38,.35,13],C,{body:{}});
for(let i=0;i<4;i++){
 const x=84+i*2.8;
 cyl(`tunnel-fan-${i}`,[x,4.6,-32],2.0,.30,S,{rotation:[0,0,Math.PI/2]});
 torus(`tunnel-fan-ring-${i}`,[x,4.6,-32],2.35,.18,S,[0,0,Math.PI/2]);
}

// 12. Split-μ lane: left wheels see a wet low-friction half, right wheels dry asphalt.
// The seam is a physical boundary, not a controller hint.
topBox('split-mu-wet',[-96.0,0,-54],[4.0,.16,42],{...A,color:[.045,.052,.058,1],clearcoat:.32,clearcoatRoughness:.18},{
 body:{},environmental:{surfaceUse:'road',waterDepthM:.0035,iceDepthM:.0024}
});
topBox('split-mu-dry',[-92.0,0,-54],[4.0,.16,42],A,{body:{},environmental:{surfaceUse:'road'}});
for(const z of [-72,-62,-52,-42,-32])box(`split-mu-seam-${z}`,[-94,.012,z],[.08,.02,5.5],P);

// 13. Banked / off-camber lane. Each slab is a real oriented collision body.
// Positive bank assists a turn; the second half reverses sign and deliberately hurts it.
for(let i=0;i<12;i++){
 const z=54+i*3.5,bank=(i<6?1:-1)*(6+i%3*3)*Math.PI/180;
 box(`banked-${i}`,[-96,-.12,z],[8,.24,3.7],A,{rotation:[0,0,bank],body:{}});
}

// 14. Washboard: high-frequency vertical road excitation for wheel-hop/damper validation.
topBox('washboard-base',[-88,0,-12],[8,.16,30],A,{body:{}});
for(let i=0;i<26;i++){
 const z=-25+i*1.08,h=.035+.025*(.5+.5*Math.sin(i*.91));
 box(`washboard-crest-${i}`,[-88,h/2+.002,z],[8,h,.28],C,{body:{}});
}

// 15. Three bump families: stepped rounded approximation, square curb, and asymmetric crest.
topBox('bumps-base',[-76,0,-12],[8,.16,30],A,{body:{}});
const bumpProfiles=[
 {id:'rounded',z:-20,heights:[.03,.08,.14,.18,.14,.08,.03]},
 {id:'square',z:-10,heights:[.16,.16,.16]},
 {id:'asymmetric',z:1,heights:[.03,.06,.10,.15,.20,.12,.05]},
];
for(const profile of bumpProfiles)for(let i=0;i<profile.heights.length;i++){
 const h=profile.heights[i],z=profile.z+(i-(profile.heights.length-1)/2)*.34;
 box(`bumps-${profile.id}-${i}`,[-76,h/2+.005,z],[8,h,.36],R,{body:{}});
}

// 16. Pothole lane: depressed physical slabs create actual loss/recovery of support.
for(let i=0;i<18;i++){
 const z=-96+i*2.1,depression=i===5?-.20:i===11?-.32:i===14?-.14:0;
 topBox(`potholes-${i}`,[91,depression,z],[7.5,.18,2.16],i%4===0?C:A,{body:{}});
}

// 17. Diagonal articulation course. Left/right wheel tracks deliberately disagree in height.
const articulationZ=[-42,-34,-26,-18,-10,-2,6];
const leftY=[0,.18,.42,.12,-.26,-.05,.20],rightY=[0,-.14,-.38,-.08,.30,.06,-.16];
for(let i=0;i<articulationZ.length-1;i++){
 roadStrip(`articulation-left-${i}`,[[106,leftY[i],articulationZ[i]],[106,leftY[i+1],articulationZ[i+1]]],2.5,A,{thickness:.18});
 roadStrip(`articulation-right-${i}`,[[110,rightY[i],articulationZ[i]],[110,rightY[i+1],articulationZ[i+1]]],2.5,A,{thickness:.18});
}

// 18. Crosswind corridor. Geometry marks the measurement volume now; spatial wind
// remains a blocked physics requirement until a wind-field primitive owns it.
topBox('crosswind-road',[100,0,32],[9,.16,42],A,{body:{}});
for(let i=0;i<7;i++){
 const z=14+i*6;
 for(const side of [-1,1])box(`crosswind-pylon-${i}-${side>0?'r':'l'}`,[100+side*5.2,3.2,z],[.28,6.4,.28],S);
 box(`crosswind-beam-${i}`,[100,6.3,z],[10.7,.24,.24],S);
}

// 19. Soft-ground pad. Visual geometry stays non-rigid; SoilField owns bearing height,
// rut persistence, shear traction and rolling resistance.
topBox('soft-ground-visual',[97,0,-112],[20,.10,16],{kind:'default',color:[.27,.19,.11,1],roughness:1});
for(let i=0;i<8;i++)box(`soft-ground-rut-${i}`,[90+i*2.2,.012,-112+(i%2?.7:-.7)],[1.2,.018,12],{kind:'default',color:[.19,.13,.08,1],roughness:1});

// 20. Water depth markers extend the existing basin into a measurable gradient.
// They are visual only; fluid/buoyancy remains blocked until the solver owns the volume.
for(let i=0;i<5;i++){
 const depth=.25+i*.35,x=2+i*5;
 box(`water-depth-marker-${i}`,[x,-depth/2-.02,-27],[.10,depth,.10],P);
}

// 21. Brake endurance strip. Long enough for repeated physical acceleration / braking
// in both directions without teleporting the vehicle or resetting thermal state.
roadStrip('brake-endurance-road',[[-150,0,-420],[-150,0,420]],30,A,{physical:true});
for(const z of [-400,-300,-200,-100,0,100,200,300,400])box(`brake-endurance-mark-${z}`,[-150,.009,z],[.10,.018,18],P);

// Service roads bind all stations into one coherent facility.
roadStrip('service-north',[[-58,0,85],[-18,0,90],[22,0,91],[55,0,100],[73,0,115]],6.5,A);
roadStrip('service-south',[[-58,0,-12],[-35,0,-5],[-5,0,-4],[25,0,-7],[50,0,-13],[70,0,-15]],6.5,A);

// Minimal facility silhouettes for scale.
for(const [id,p,s] of [
 ['lab-west',[-20,3.0,96],[26,6,12]],['lab-center',[22,2.5,108],[24,5,10]],
 ['hangar',[52,4.0,72],[28,8,16]],['control-base',[43,2.2,118],[10,4.4,10]],
])box(id,p,s,C);
box('control-tower',[43,12,118],[4.6,20,4.6],C);
box('control-cab',[43,22.5,118],[8,5,8],{kind:'glass',color:[.18,.25,.28,.55],roughness:.1});

entities.push(...experimentSceneEntities);

export const provingGroundMeta=Object.freeze({
 name:'Engine Proving Ground',
 reference:'diagnostics-and-durability',
 zones:provingGroundZones,
 experiments:provingGroundExperiments.map(({id,title,domain})=>({id,title,domain})),
 boundsM:[360,860],
});
export const camera={position:[128,96,-150],target:[0,6,20],fov:47,aperture:0};
export default {
 version:1,
 seed:20261001,
 gravity:[0,-9.81,0],
 ground:-2,
 clearColor:[.42,.58,.72,1],
 camera,
 environment:{temperatureC:18,sunlight:.82,humidity:.48,wind:[1.5,0,.3],precipitation:'arid'},
 rendering:{sunDirection:[-.45,.72,-.31],sunColor:[1,.93,.84],skyColor:[.35,.52,.70],sunIntensity:1.0,exposure:1.05,shadowExtent:190,fogDensity:.0025},
 fluids:[{id:'water-basin-fluid',shape:'cylinder',center:[12,-1.05,-27],radiusM:18.7,depthM:2.1,densityKgM3:998.2,velocity:[0,0,0],dragCoefficient:.9}],
 windVolumes:[{id:'crosswind.field',center:[100,3.2,32],sizeM:[14,7,44],wind:[18,0,0],densityKgM3:1.225,blendM:2.0}],
 soilVolumes:[{id:'soft-ground',center:[97,0,-112],sizeM:[20,16],cells:[20,16],pressureScalePa:85000,sinkageExponent:.85,maxSinkageM:.30,cohesionPa:7000,frictionAngleDeg:27,compactionRatePerSecond:.55,rollingResistance:.055}],
 entities
};
