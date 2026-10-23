import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';
test('native environment factory starts without browser location and stops on disable',()=>{
 const renderer=Object.create(WebGPURenderer.prototype),worker={onmessage:null,onerror:null,postMessage(){},terminated:false,terminate(){this.terminated=true;}};
 renderer.setBackgroundEnvironmentMaps(true,()=>worker);assert.equal(renderer.environmentWorker.inspect().failed,false);renderer.setBackgroundEnvironmentMaps(false);assert.equal(worker.terminated,true);
});
test('cached immutable geometry avoids repeated integrity scans while retaining mutable edit observation',()=>{
 const scene=new Scene({version:1,entities:[{id:'mesh',position:[60,0,0],mesh:{kind:'triangle-mesh',positions:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]}}]});
 buildSceneRadianceProbe(scene,[0,0,0]);const original=Object.isFrozen;let checks=0;Object.isFrozen=v=>{checks++;return original(v);};try{buildSceneRadianceProbe(scene,[1,0,0]);}finally{Object.isFrozen=original;}assert.equal(checks,0);
 const e=scene.entities.get('mesh');e.mesh={...e.mesh,positions:[...e.mesh.positions]};const before=buildSceneRadianceProbe(scene,[0,0,0]);e.mesh.positions[3]=5;assert.notDeepEqual(buildSceneRadianceProbe(scene,[0,0,0]),before);
});
