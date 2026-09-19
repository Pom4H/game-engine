const entities=[];
const materials=[
  {kind:'concrete',color:[.42,.44,.45,1],roughness:.72,finish:'weathered',ageYears:28},
  {kind:'asphalt',color:[.11,.12,.13,1],roughness:.82},
  {kind:'steel',color:[.23,.28,.32,1],roughness:.16,metalness:.82},
  {kind:'snow',color:[.90,.94,.98,1],roughness:.9},
];
const cols=44,rows=38;
for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const i=row*cols+col,x=(col-(cols-1)/2)*1.18,z=-31+row*1.52,y=.75+((row+col)%7)*1.45;
  const material=materials[i%materials.length],scale=.72+((i*17)%13)/28;
  entities.push({id:`atom-${i}`,position:[x,y,z],scale:[scale,scale,scale],mesh:{kind:'sphere',radius:.5,segments:48},material});
}
// Smooth transparent layers force depth-tested blending and extra fragment work.
for(let i=0;i<320;i++){
  const col=i%32,row=Math.floor(i/32),x=(col-15.5)*1.45,z=-8+row*2.2,y=2.2+(i%9)*1.15;
  entities.push({id:`glass-${i}`,position:[x,y,z],scale:[.75,.75,.75],mesh:{kind:'sphere',radius:.5,segments:64},material:{kind:'glass',color:[.16,.30,.38,.34],roughness:.10,metalness:.08}});
}
// Large semantic surfaces exercise the expensive concrete/asphalt branches and reflections.
entities.push(
 {id:'ground',position:[0,-.25,-2],mesh:{kind:'box',size:[90,.5,95]},material:{kind:'asphalt',color:[.09,.095,.10,1],roughness:.76},environmental:{surfaceUse:'road',waterDepthM:.0035,snowDepthM:.008,iceDepthM:.0002}},
 {id:'concrete-wall',position:[0,10,-39],mesh:{kind:'box',size:[70,20,.8]},material:{kind:'concrete',color:[.46,.47,.45,1],roughness:.73,finish:'weathered',ageYears:40},environmental:{surfaceUse:'generic',snowDepthM:.018}}
);
// Saturate the forward light grid without exceeding the engine's supported source budget.
for(let i=0;i<128;i++){
  const x=((i%16)-7.5)*3.4,z=-30+Math.floor(i/16)*8.0,y=3.2+(i%4)*2.2;
  const warm=i%2===0;
  entities.push({id:`light-${i}`,position:[x,y,z],light:{kind:'point',color:warm?[1,.52,.24]:[.28,.54,1],intensity:8+(i%5)*2,range:18}});
}
export default {
 version:1,seed:20260919,gravity:[0,-9.81,0],ground:-100,
 camera:{position:[0,28,68],target:[0,7,-6],fov:55,focusDistance:70,aperture:.7},
 clearColor:[.012,.018,.028,1],
 environment:{temperatureC:-4,snowfall:'heavy',sunlight:.34,humidity:.92,precipitation:'frequent',groundMoisture:.9,wind:[3.4,0,1.2],clock:{startHour:6.8,hoursPerSecond:.02}},
 rendering:{sunDirection:[-.45,.56,-.35],sunIntensity:1.5,exposure:1.02,fogDensity:.0018,shadowExtent:90},
 entities,
};
