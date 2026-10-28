import {test,expect} from 'bun:test';
import {Scene} from '../../../src/scene/scene.ts';
import {RenderMeshQuery} from '../../../src/render/mesh-ray.ts';
import {SubjectCamera} from '../../../src/render/subject-camera.ts';
import type {CameraSpec} from '../../../src/scene/types.ts';
const desired:CameraSpec={position:[0,1.15,8],target:[0,1.15,0],fov:39},head:[number,number,number]=[0,1.62,.03];
function fixture(z=1.15){const scene=new Scene({version:1,ground:-100,entities:[{id:'wall',position:[0,1.4,z],mesh:{kind:'box',size:[3,2.8,.1]},renderOnly:true}]}),query=new RenderMeshQuery(scene),camera=new SubjectCamera();return{scene,query,camera,resolve:(id:string|null='npc',p:typeof head|null=head)=>camera.resolve(query,desired,{subjectId:id,head:p})};}
test('a constrained real mesh boom uses its supplied model head and preserves view direction without any physics',()=>{
 const f=fixture(),before=structuredClone(desired),r=f.resolve();expect(r.mode).toBe('first-person');expect(r.hiddenSubject).toBe('npc');expect(r.distance).toBeCloseTo(.98,6);for(let i=0;i<3;i++){expect(r.camera.position[i]).toBeCloseTo([0,1.66,.03][i]!,10);expect(r.camera.target[i]).toBeCloseTo([0,1.66,-1.97][i]!,10);}expect(r.camera.fov).toBe(54);expect(desired).toEqual(before);expect(f.scene.physics.bodies.size).toBe(0);expect(f.scene.tick).toBe(0);
});
test('hysteresis prevents threshold flicker and a different subject cannot inherit the previous first-person state',()=>{
 const f=fixture();expect(f.resolve().mode).toBe('first-person');f.scene.entities.get('wall')!.position[2]=1.82;expect(f.resolve().distance).toBeCloseTo(1.65,6);expect(f.resolve().mode).toBe('first-person');expect(f.resolve('other').mode).toBe('third-person');f.scene.entities.get('wall')!.position[2]=1.15;expect(f.resolve('other').mode).toBe('first-person');f.scene.entities.get('wall')!.position[2]=2;expect(f.resolve('other').mode).toBe('third-person');
});
test('the head route respects a low ceiling and retains a finite nonzero look direction',()=>{
 const f=fixture();f.scene.add({id:'ceiling',position:[0,1.48,0],mesh:{kind:'box',size:[3,.1,3]},renderOnly:true});const r=f.resolve();expect(r.mode).toBe('first-person');expect(r.camera.position[1]).toBeLessThan(1.40);expect(r.camera.position[1]).toBeGreaterThan(1.15);expect(Math.hypot(...r.camera.target.map((v,i)=>v-r.camera.position[i]!))).toBeCloseTo(2,8);
});
test('missing head, absent subject, degenerate desired camera and clear space restore the ordinary camera',()=>{
 const f=fixture();expect(f.resolve().mode).toBe('first-person');expect(f.resolve('npc',null).mode).toBe('third-person');expect(f.resolve(null).hiddenSubject).toBe(null);expect(f.resolve('npc',[NaN,1,0]).mode).toBe('third-person');const zero={position:[0,1,0] as const,target:[0,1,0] as const};expect(f.camera.resolve(f.query,zero,{subjectId:'npc',head}).mode).toBe('third-person');f.scene.remove('wall');const clear=f.resolve();expect(clear.camera).toBe(desired);expect(clear.hiddenSubject).toBe(null);expect(clear.hit).toBe(null);
});
