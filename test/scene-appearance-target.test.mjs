import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';

test('targeted appearance patches update emission without replacing shared geometry or matching another id',()=>{
 const scene=new Scene({version:1,entities:[{id:'window:one',mesh:{kind:'box'},renderOnly:true},{id:'window:two',mesh:{kind:'box'},renderOnly:true}]}),first=scene.entities.get('window:one'),second=scene.entities.get('window:two'),mesh=first.mesh,structure=scene.renderStructureRevision;
 scene.patchAppearance({materials:[{id:'window:one',set:{emissive:[.7,.4,.2]}}]});
 assert.deepEqual(first.material.emissive,[.7,.4,.2]);assert.equal(second.material.emissive,undefined);assert.equal(first.mesh,mesh);assert.equal(scene.renderStructureRevision,structure);assert.equal(scene.appearanceRevision,1);
 scene.patchAppearance({materials:[{id:'window:one',idPrefix:'other:',set:{emissive:[1,1,1]}},{id:'missing',set:{emissive:[1,1,1]}}]});assert.deepEqual(first.material.emissive,[.7,.4,.2]);assert.equal(scene.appearanceRevision,1);
 scene.patchAppearance({materials:[{idPrefix:'window:',set:{emissive:[0,0,0]}}]});assert.deepEqual(first.material.emissive,[0,0,0]);assert.deepEqual(second.material.emissive,[0,0,0]);assert.equal(scene.physics.bodies.size,0);
});
