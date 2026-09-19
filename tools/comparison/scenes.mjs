import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const colors={glass:[.16,.84,.96,.62],dark:[.045,.062,.085,1],line:[.08,.26,.34,1],metal:[.9,.4,.07,1]};
function box(id,position,size,color=colors.dark,body){return{id,position,mesh:{kind:'box',size},material:{kind:'default',color},...(body?{body}:{})};}
function stage(width=16,depth=9){
  const entities=[box('stage',[0,-.2,0],[width,.25,depth])];
  for(let x=-width/2;x<=width/2;x+=1)entities.push(box(`grid-x-${x}`,[x,-.067,0],[.012,.008,depth],colors.line));
  for(let z=-depth/2;z<=depth/2;z+=1)entities.push(box(`grid-z-${z}`,[0,-.066,z],[width,.008,.012],colors.line));
  return entities;
}
const common={version:1,seed:7301,ground:-100,clearColor:[.014,.024,.040,1],environment:{sunlight:1,humidity:0,precipitation:'arid',groundMoisture:0},entities:[]};
const fracture={...common,camera:{position:[7.8,7.2,10.8],target:[0,2.2,0],fov:41},entities:[
  ...stage(10,8),
  {id:'catcher',position:[0,-.05,0],mesh:{kind:'box',size:[8,.1,6]},material:{kind:'steel',color:[.12,.15,.2,1]},body:{mass:0,friction:.75}},
  {id:'glass',position:[0,2.3,0],mesh:{kind:'box',size:[3.6,.018,2.6]},material:{kind:'glass',color:colors.glass}},
  ...[-1,1].flatMap(sign=>[box(`stand-${sign}`,[sign*2,1.08,0],[.1,2.25,2.9],[.12,.22,.28,1]),box(`rim-${sign}`,[0,2.28,sign*1.4],[4.1,.08,.06],[.12,.4,.5,1])]),
  {id:'ball',position:[0,6.8,0],mesh:{kind:'sphere',radius:.19,segments:32},material:{kind:'steel',color:colors.metal},body:{mass:5,velocity:[0,-9,0]}},
]};
const momentum={...common,gravity:[0,0,0],camera:{position:[4.0,5.8,13.8],target:[.8,1.5,0],fov:43},entities:[
  ...stage(18,8),
  ...[-2,0,2,4,6].map((x,i)=>box(`milestone-${i}`,[x,.005,1.75],[.035,.08,.55],[.2,.58,.66,1])),
  {id:'glass',position:[-3,2,0],mesh:{kind:'box',size:[2,2,.015]},material:{kind:'glass',color:colors.glass},body:{mass:150,velocity:[3,0,0]}},
  {id:'ball',position:[-3,2,-5],mesh:{kind:'sphere',radius:.16,segments:32},material:{kind:'steel',color:colors.metal},body:{mass:4,velocity:[3,0,25]}},
]};
const friction={...common,camera:{position:[6.8,10.5,12.5],target:[.6,0,0],fov:43},entities:[
  ...stage(21,8),
  ...[-1,1].flatMap(sign=>[
    {id:sign<0?'rough':'slippery',position:[1,-.02,sign*1.65],mesh:{kind:'box',size:[19,.16,2.6]},material:{kind:'asphalt',color:sign<0?[.22,.18,.1,1]:[.08,.3,.36,1]},body:{mass:0,friction:sign<0?.85:.015}},
    {id:sign<0?'rough-slider':'slippery-slider',position:[-6,.15,sign*1.65],mesh:{kind:'box',size:[.65,.18,.65]},material:{kind:'steel',color:colors.metal},body:{mass:2,friction:1,velocity:[7,0,0],restitution:0}},
    ...[-6,-3,0,3,6,9].map((x,i)=>box(`mark-${sign}-${i}`,[x,.07,sign*1.65],[.02,.01,2.6],[.15,.4,.46,1])),
  ]),
]};
const kernel={...common,gravity:[0,0,0],camera:{position:[2,7,16],target:[0,1,0],fov:40},entities:[...stage(14,7),{id:'signal',position:[-4,1,0],mesh:{kind:'sphere',radius:.4},material:{kind:'steel',color:colors.metal},body:{mass:1}}]};
const phases={...common,camera:kernel.camera,entities:[]};
const gpu={...phases};
const validation={...phases};
const snow={...common,environment:{temperatureC:-6,snowfall:'heavy',sunlight:.5,clock:{startHour:12,hoursPerSecond:.1}},camera:{position:[2,12,12],target:[0,0,0],fov:43},entities:[
 ...[-1,1].flatMap(sign=>[
  {id:sign<0?'road-contact':'road-air',position:[0,-.1,sign*2.2],mesh:{kind:'box',size:[12,.2,3.4]},material:{kind:'asphalt'},environmental:{surfaceUse:'road'}},
  {id:sign<0?'sled-contact':'sled-air',position:[-4,sign<0?.25:1.25,sign*2.2],mesh:{kind:'box',size:[1,.5,.8]},material:{kind:'steel',color:colors.metal},body:{motion:'kinematic',mass:1500,velocity:[2.5,0,0]}},
 ])]};
export const scenes={fracture,momentum,friction,kernel,phases,snow,gpu,validation};
export const durations={fracture:2,momentum:2.2,friction:3.3,kernel:3,phases:3,snow:3,gpu:3,validation:3};
if(process.argv[1]===fileURLToPath(import.meta.url)){
 await mkdir(`${root}examples/comparison`,{recursive:true});
 for(const [id,spec] of Object.entries(scenes))await writeFile(`${root}examples/comparison/${id}.json`,JSON.stringify(spec,null,2)+'\n');
}
