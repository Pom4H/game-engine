import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../artifacts/comparison/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const metrics=await read('metrics.json'),verification={physics:[],architecture:{}};
function compare(a,b,path='root'){
 if(typeof a==='number'&&typeof b==='number'){assert.ok(Math.abs(a-b)<1e-8,`${path}: ${a} != ${b}`);return;}
 if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a),Object.keys(b),path);for(const key of Object.keys(a))compare(a[key],b[key],path+'.'+key);return;}
 assert.equal(a,b,path);
}
for(const version of ['before','after'])for(const id of ['fracture','momentum','friction']){
 const captured=await read(`${id}-${version}-events.json`),expected=metrics[version][id].events;
 compare(captured,expected);verification.physics.push({id,version,eventCount:captured.length,tolerance:1e-8});
}
for(const id of ['kernel','phases','snow','gpu','validation']){
 const before=await read(`${id}-before-evidence.json`),after=await read(`${id}-after-evidence.json`);
 assert.deepEqual(before.errors,[]);assert.deepEqual(after.errors,[]);
 const b=before.evidence,a=after.evidence;
 if(id==='kernel'){assert.equal(b.calls,0);assert.equal(a.calls,90);}
 if(id==='phases'){assert.equal(b.published,0);assert.equal(b.commits,0);assert.equal(a.published,1);assert.equal(a.commits,180);}
 if(id==='snow'){assert.ok(b.surfaceState.find(x=>x.id==='road-air').trackMelt>0);assert.equal(a.surfaceState.find(x=>x.id==='road-air').trackMelt,0);assert.ok(a.surfaceState.find(x=>x.id==='road-contact').trackMelt>0);}
 if(id==='gpu'){assert.equal(b.buffers,60);assert.equal(a.buffers,0);assert.equal(b.emitted,20);assert.equal(a.emitted,20);}
 if(id==='validation'){assert.equal(b.validationResults.length,3);assert.ok(b.validationResults.every(r=>r.accepted));assert.equal(a.validationResults.length,3);assert.ok(a.validationResults.every(r=>!r.accepted));}
 verification.architecture[id]={before:b,after:a};
}
await writeFile(new URL('full-browser-verification.json',root),JSON.stringify(verification,null,2));
console.log('Browser evidence verified: six physical recordings and ten architecture recordings.');
