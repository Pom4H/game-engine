// Small, immutable review evidence stays in this same private repository.
// Full-resolution captures remain release assets; no source branch is rewritten.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {GITHUB_TOKEN:token,GITHUB_REPOSITORY:repo,GITHUB_SHA:source,GITHUB_RUN_ID:run}=process.env;
if(!token||!repo||!source||!run)throw new Error('GitHub evidence context is missing');
const api=`https://api.github.com/repos/${repo}`;
const post=async(path,data)=>{
 const response=await fetch(api+path,{method:'POST',headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Evidence publish ${path}: ${response.status} ${await response.text()}`);
 return response.json();
};
const evidence=JSON.parse(await readFile('artifacts/arcade-evidence.json','utf8'));
const pixels=JSON.parse(await readFile('artifacts/pixel-inspection.json','utf8'));
const tests=await readFile('artifacts/unit-tests.log','utf8');
const count=key=>{const m=tests.match(new RegExp('# '+key+' (\\d+)'));return m?Number(m[1]):null;};
const r=evidence.hud.views[0].renderer;
const manifest={source,run,runner:evidence.runner,adapter:evidence.hud.adapter,pixels,
 renderer:{backend:r.backend,width:r.width,height:r.height,triangles:r.triangles,drawCalls:r.drawCalls,pointLights:r.pointLights,materialTextures:r.materialTextures,errors:r.errors},
 gpu:r.profile?.gpuTotal,cpu:r.profile?.cpuTotal,tests:{total:count('tests'),pass:count('pass'),fail:count('fail')},
 provenance:'Untouched native engine canvas; review.webp is Lanczos-downsampled lossless WebP, native-crop.webp is a lossless pixel crop. Neither contains generated image detail.'};
const assets=[['review.webp',await readFile('artifacts/lossless-review.webp')],['native-crop.webp',await readFile('artifacts/native-crop.webp')]];
manifest.assets=assets.map(([name,bytes])=>({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
assets.push(['manifest.json',Buffer.from(JSON.stringify(manifest,null,2))]);
const tree=[];
for(const [path,bytes]of assets){const blob=await post('/git/blobs',{content:bytes.toString('base64'),encoding:'base64'});tree.push({path,mode:'100644',type:'blob',sha:blob.sha});}
const object=await post('/git/trees',{tree});
const commit=await post('/git/commits',{message:`Arcade GPU review ${source} run ${run}`,tree:object.sha,parents:[]});
const branch=`render-evidence/arcade-${source.slice(0,7)}-${run}`;
await post('/git/refs',{ref:`refs/heads/${branch}`,sha:commit.sha});
console.log(JSON.stringify({branch,commit:commit.sha,assets:manifest.assets}));
