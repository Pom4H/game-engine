import {test,expect} from 'bun:test';
import {Scene,type RuntimeEntity} from '../../../src/scene/scene.ts';
import {characterState} from '../../../src/runtime/character-motor.ts';
import {BuildingWorld,LIFT} from '../building.ts';
import {WorldLayer} from '../client/world-view.ts';
import {bindingFor,serverWeather,worldPoint,type Binding,type OfficeState,type Person,type WorldPresentation} from '../shared.ts';

const layout=():OfficeState=>({version:1,revision:1,floors:[{id:'main',name:'Офис',wallpaper:'ivory'},{id:'upper',name:'Мастерская',wallpaper:'mint'}],objects:[{id:'desk',kind:'desk',floor:'main',x:4,z:2,rotation:0,color:'oak',label:'Работа'}],activeFloor:'main',selection:null});
const blankScene=()=>new Scene({version:1,entities:[],ground:-100});
const actor=(binding:Binding,id='visitor',floor=binding.officeFloor):Person=>({id,residentId:id,name:'Гость',position:worldPoint(binding,[1,0,-6],floor),yaw:.5,phase:1.1,speed:1.2,kind:0});
function snapshot(binding:Binding,changes:Partial<WorldPresentation>={}):WorldPresentation{
 return{binding:structuredClone(binding),tick:600,time:10,worldMinute:720,actors:[],vehicles:[],lift:{floor:2,target:2,elevation:6.6,door:1,phase:'idle',velocity:0},weather:serverWeather(720,binding.seed),connected:true,layoutRevision:1,...changes};
}
const geometry=(scene:Scene,prefix:string)=>[...scene.entities.values()].filter(e=>e.id.includes(prefix));
const poses=(scene:Scene)=>geometry(scene,'world:actor:').map(e=>({id:e.id,position:e.position,rotation:e.rotation,scale:e.scale,mesh:e.mesh,material:e.material.color}));
const terrainHeights=(scene:Scene)=>geometry(scene,'world:terrain:').map(e=>e.position[1]+(e.mesh?.kind==='triangle-mesh'?e.mesh.positions[1]!*e.scale[1]:0));

/** Check the baked horizontal triangles, including tile and foundation layers. */
function coversShaftFloor(entity:RuntimeEntity,x:number,z:number,y:number):boolean{
 if(entity.mesh?.kind!=='triangle-mesh')return false;
 const mesh=entity.mesh,p=entity.position,s=entity.scale;
 for(let i=0;i<mesh.indices.length;i+=3){
  const vertices=mesh.indices.slice(i,i+3).map(index=>[mesh.positions[index*3]!*s[0]+p[0],mesh.positions[index*3+1]!*s[1]+p[1],mesh.positions[index*3+2]!*s[2]+p[2]]);
  if(vertices.length!==3||vertices.some(v=>v[1]!<y-.85||v[1]!>y+.09)||Math.max(...vertices.map(v=>v[1]!))-Math.min(...vertices.map(v=>v[1]!))>.001)continue;
  const [a,b,c]=vertices,den=(b![2]!-c![2]!)*(a![0]!-c![0]!)+(c![0]!-b![0]!)*(a![2]!-c![2]!);
  if(Math.abs(den)<1e-9)continue;
  const u=((b![2]!-c![2]!)*(x-c![0]!)+(c![0]!-b![0]!)*(z-c![2]!))/den,v=((c![2]!-a![2]!)*(x-c![0]!)+(a![0]!-c![0]!)*(z-c![2]!))/den;
  if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8)return true;
 }
 return false;
}

test('Game and Office draw one identical server visitor with a head marker and never animate an extra visitor',()=>{
 const binding=bindingFor(),officeScene=blankScene(),gameScene=blankScene(),office=new WorldLayer(officeScene,{binding,mode:'office'}),game=new WorldLayer(gameScene,{binding,mode:'game'}),visitor=actor(binding),packet=snapshot(binding,{actors:[visitor]});
 office.update(packet);game.update(packet);
 expect(poses(officeScene)).toEqual(poses(gameScene));expect(poses(officeScene)).toHaveLength(14);
 expect(office.markers()).toEqual(game.markers());expect(office.markers()).toEqual([{id:'visitor',position:[1,2.02,-6],name:'Гость'}]);
 expect(officeScene.entities.get('world:actor:visitor:head')!.position[1]).toBeGreaterThan(1.4);
 const samePoses=structuredClone(poses(officeScene));office.update(packet);expect(poses(officeScene)).toEqual(samePoses);
 const empty=snapshot(binding);office.update(empty);game.update(empty);
 expect(office.diagnostics.actors).toBe(0);expect(game.diagnostics.actors).toBe(0);expect(office.markers()).toHaveLength(0);expect(poses(officeScene)).toHaveLength(0);
 expect([...officeScene.entities.values()].every(e=>e.renderOnly)).toBe(true);office.dispose();game.dispose();
});

test('Office shows a transparent facade around hidden floors while authority keeps their walls and support',()=>{
 const binding=bindingFor(),scene=blankScene(),layer=new WorldLayer(scene,{binding,mode:'office'}),world=new BuildingWorld();
 layer.configureLayout(layout());world.setLayout(layout());
 layer.update(snapshot(world.binding,{actors:[actor(binding),actor(binding,'upstairs',3)]}));
 expect(layer.diagnostics.actors).toBe(1);expect(layer.markers().map(p=>p.id)).toEqual(['visitor']);
 expect(geometry(scene,'world:slab:')).toHaveLength(0);expect(geometry(scene,'world:office:')).toHaveLength(0);expect(scene.entities.has('world:gate:3:1')).toBe(false);
 const facade=geometry(scene,'world:facade:');expect(facade.length).toBeGreaterThan(0);expect(facade.every(e=>e.material.color[3]>0&&e.material.color[3]<1)).toBe(true);
 for(let floor=0;floor<binding.floorCount;floor++)expect(geometry(scene,`world:facade:${floor}:`).length).toBeGreaterThan(0);
 const floor=worldPoint(world.binding,[5,0,0],3),wall=worldPoint(world.binding,[14,0,0],3);
 expect(world.floor(floor[0],floor[1]+.1,floor[2],.2)?.y).toBeCloseTo(9.9,6);expect(world.blocked(wall[0],wall[1],wall[2],1.8,.29)).toBe(true);
 layer.dispose();world.dispose();
});

test('hiding the city immediately hides the facade and preserves lift, furnishings and in-office visitor',()=>{
 const binding=bindingFor(),scene=blankScene(),layer=new WorldLayer(scene,{binding,mode:'office'}),inside=actor(binding),outside={...actor(binding,'street'),position:worldPoint(binding,[40,0,30]),kind:1},vehicle={id:'bus',position:worldPoint(binding,[30,0,20]),yaw:0,speed:4,mode:0,doors:0};
 scene.add({id:'office:furnishing',position:[4,.5,2],mesh:{kind:'box',size:[2,1,1]},renderOnly:true});
 layer.configureLayout(layout());layer.update(snapshot(binding,{actors:[inside,outside],vehicles:[vehicle]}));
 const visibleCount=scene.entities.size,facade=geometry(scene,'world:facade:').map(e=>e.id),visitor=poses(scene).filter(e=>e.id.includes(':visitor:')),gate=structuredClone(scene.entities.get('world:gate:2:1')!.position);
 expect(layer.diagnostics).toMatchObject({chunks:9,actors:2,traffic:1,presentedTime:10});
 for(let i=0;i<5;i++){
  layer.setCityVisible(false);
  expect(layer.diagnostics).toMatchObject({chunks:0,actors:1,traffic:0,presentedTime:10});expect(geometry(scene,'world:terrain:')).toHaveLength(0);expect(geometry(scene,'world:traffic:')).toHaveLength(0);
  expect(poses(scene)).toEqual(visitor);expect(facade.every(id=>!scene.entities.has(id))).toBe(true);expect(scene.entities.has('office:furnishing')).toBe(true);expect(scene.entities.get('world:gate:2:1')!.position).toEqual(gate);expect(layer.markers().map(p=>p.id)).toEqual(['visitor']);
  const hiddenCount=scene.entities.size;layer.setCityVisible(false);layer.update(snapshot(binding,{actors:[inside,outside],vehicles:[vehicle]}));expect(scene.entities.size).toBe(hiddenCount);
  layer.setCityVisible(true);expect(layer.diagnostics).toMatchObject({chunks:9,actors:2,traffic:1});expect(scene.entities.size).toBe(visibleCount);
 }
 layer.dispose();expect(scene.entities.size).toBe(1);expect(scene.entities.has('office:furnishing')).toBe(true);expect(layer.diagnostics).toMatchObject({chunks:0,actors:0,traffic:0});
});

test('the hidden city stays hidden across floors, binding changes and mode changes',()=>{
 const binding=bindingFor(),scene=blankScene(),layer=new WorldLayer(scene,{binding,mode:'office'}),state=layout();
 layer.setCityVisible(false);layer.configureLayout(state);layer.update(snapshot(binding,{actors:[actor(binding)]}));
 expect(geometry(scene,'world:facade:')).toHaveLength(0);
 state.activeFloor='upper';state.revision++;layer.configureLayout(state);layer.update(snapshot(binding,{actors:[actor(binding,'upper',3)]}));
 expect(geometry(scene,'world:facade:')).toHaveLength(0);expect(layer.markers().map(p=>p.id)).toEqual(['upper']);expect(layer.diagnostics.chunks).toBe(0);
 const expanded={...binding,floorCount:8};layer.update(snapshot(expanded));expect(geometry(scene,'world:facade:7:')).toHaveLength(0);expect(geometry(scene,'world:facade:').length).toBeLessThanOrEqual(expanded.floorCount*12);
 layer.setMode('game');layer.update(snapshot(expanded,{actors:[actor(binding,'upper',3)]}));expect(geometry(scene,'world:facade:')).toHaveLength(0);expect(geometry(scene,'world:wall:').length).toBeGreaterThan(0);expect(layer.diagnostics).toMatchObject({chunks:0,actors:1,traffic:0});
 layer.setMode('office');layer.update(snapshot(expanded));expect(geometry(scene,'world:facade:7:')).toHaveLength(0);expect(layer.diagnostics.chunks).toBe(0);layer.dispose();layer.setCityVisible(true);expect(scene.entities.size).toBe(0);
});

test('an embedded Office enters Game mode without adding its selected floor twice',()=>{
 const binding=bindingFor(),scene=blankScene(),layer=new WorldLayer(scene,{binding,mode:'office'}),state=layout();
 layer.configureLayout(state);layer.update(snapshot(binding));layer.setMode('game');
 expect(geometry(scene,'world:office:2:')).toHaveLength(0);expect(geometry(scene,'world:office:3:').length).toBeGreaterThan(0);expect(scene.entities.has('world:gate:0:1')).toBe(true);
 state.activeFloor='upper';state.revision++;layer.configureLayout(state);
 expect(geometry(scene,'world:office:3:')).toHaveLength(0);expect(geometry(scene,'world:office:2:').length).toBeGreaterThan(0);
 layer.setMode('office');expect(geometry(scene,'world:office:')).toHaveLength(0);expect(scene.entities.has('world:gate:0:1')).toBe(false);layer.dispose();
});

test('layout floor changes shift city and actors together, and streaming removes old chunks and traffic',()=>{
 const binding=bindingFor(),scene=blankScene(),layer=new WorldLayer(scene,{binding,mode:'game'}),state=layout(),visitor=actor(binding),vehicle={id:'bus',position:[binding.origin[0]+20,0,binding.origin[2]] as const,yaw:.3,speed:4,mode:0,doors:0};
 layer.configureLayout(state);layer.update(snapshot(binding,{actors:[visitor],vehicles:[vehicle]}));
 const oldCity=geometry(scene,'world:terrain:').map(e=>e.id),groundBefore=terrainHeights(scene);
 expect(oldCity).toHaveLength(9);expect(layer.diagnostics.chunks).toBe(9);expect(layer.diagnostics.traffic).toBe(1);
 state.activeFloor='upper';state.revision++;layer.configureLayout(state);layer.update(snapshot(binding,{actors:[visitor],vehicles:[vehicle]}));
 expect(layer.toLocal(visitor.position)[1]).toBeCloseTo(-3.3,6);terrainHeights(scene).forEach((y,i)=>expect(y).toBeCloseTo(groundBefore[i]!-3.3,6));expect(layer.markers()[0]!.position[1]).toBeCloseTo(-1.28,6);
 const position=[binding.origin[0]+2048,0,binding.origin[2]+2048] as const,self={id:'self',position,yaw:0,ack:0,state:characterState(...position)};
 layer.update(snapshot(binding,{self}));expect(layer.diagnostics.chunks).toBe(9);expect(oldCity.every(id=>!scene.entities.has(id))).toBe(true);expect(layer.diagnostics.traffic).toBe(0);expect(geometry(scene,'world:traffic:')).toHaveLength(0);expect(layer.diagnostics.actors).toBe(0);
 layer.dispose();expect(scene.entities.size).toBe(0);layer.update(snapshot(binding));expect(scene.entities.size).toBe(0);
});

test('rendered gates and moving cabin track the same authority collision and support state',()=>{
 const world=new BuildingWorld(),binding=world.binding,scene=blankScene(),layer=new WorldLayer(scene,{binding,mode:'game'});
 for(const door of [0,1]){
  Object.assign(world.lift,{floor:2,elevation:6.6,door});layer.update(snapshot(binding,{lift:{...world.lift}}));
  expect(scene.entities.get('world:gate:2:1')!.position).toEqual([.8+door*1.6,1.3,LIFT.front]);
  const threshold=worldPoint(binding,[0,0,LIFT.front],2);expect(world.blocked(threshold[0],threshold[1],threshold[2],1.8,.29)).toBe(door===0);
 }
 Object.assign(world.lift,{floor:2,target:4,elevation:8,door:0,phase:'moving',velocity:2.2});layer.update(snapshot(binding,{lift:{...world.lift}}));
 const floor=scene.entities.get('world:cabin:floor')!;expect(floor.position[1]).toBeCloseTo(8-6.6-.06,6);
 const cabin=worldPoint(binding,[0,8.1,LIFT.z]);expect(world.floor(cabin[0],cabin[1],cabin[2],.2)?.y).toBe(8);
 expect(floor.position[1]+.06+6.6).toBeCloseTo(8,6);expect(scene.entities.get('world:gate:4:1')!.position[0]).toBe(.8);layer.dispose();world.dispose();
});

test('connected Office slabs leave the physical lift shaft open through every foundation and tile layer',()=>{
 const binding=bindingFor(),scene=blankScene(),layer=new WorldLayer(scene,{binding,mode:'game'}),world=new BuildingWorld();
 const state=layout();layer.configureLayout(state);world.setLayout(state);layer.update(snapshot(binding));
 const entities=geometry(scene,'world:office:2:');expect(entities.length).toBeGreaterThan(0);
 for(const [x,z] of [[0,-9.4],[1,-8.7],[-1,-9.7]])expect(entities.some(e=>coversShaftFloor(e,x!,z!,0))).toBe(false);
 expect(entities.some(e=>coversShaftFloor(e,0,-6,0))).toBe(true);
 const shaft=worldPoint(binding,[0,0,-9.4],3);expect(world.floor(shaft[0],shaft[1]+.1,shaft[2],.2)).toBeNull();layer.dispose();world.dispose();
});
