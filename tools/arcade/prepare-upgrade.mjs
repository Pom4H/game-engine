import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const replacements=new Map();
replacements.set('tools/arcade/scene.mjs',[
 ["position:[16.6,3.1,-18.4],target:[-5.2,4.6,.4],fov:43","position:[7.2707,2.35,-8.8992],target:[-5.7446,2.35,6.2854],intrinsics:{fx:638.8486,fy:638.8486,cx:640,cy:526.8103,width:1280,height:720}"],
 ["const warm=[1,.77,.55];","const detail=(name,sizeM,albedoStrength=.42)=>({url:'/tools/arcade/assets/'+name+'.png',normalUrl:'/tools/arcade/assets/'+name+'-normal.png',ormUrl:'/tools/arcade/assets/'+name+'-orm.png',sizeM,albedoStrength,normalStrength:.65,ormStrength:.55,bumpStrength:.22});\nP.wall.texture=detail('plaster',2.9);P.side.texture=detail('plaster',2.9);P.wood.texture=detail('wood',1.9,.38);P.trim.texture=detail('plaster',2.9,.25);P.roof.texture=detail('stone',1.8,.32);P.snow.texture=detail('snow',1.2,.30);P.stone.texture=detail('stone',1.35,.44);\nconst warm=[1,.85,.71];"],
 ["color:[.24,.215,.18,1],pattern:'plaster',roughness:.96,ageYears:95","color:[.36,.315,.265,1],pattern:'plaster',roughness:.96,ageYears:45"],
 ["color:[.10,.065,.047,1],pattern:'plaster',roughness:.78,ageYears:65","color:[.18,.112,.072,1],pattern:'plaster',roughness:.78,ageYears:35"],
 ["color:[.10,.108,.106,1],metalness:.45","color:[.16,.164,.158,1],metalness:.45"],
 ["const start=-8.2,bay=3.55,count=10","const start=-2.5,bay=3.55,count=9"],
 ["glow=b<2?.10:1","glow=1"],
 ["const curt={kind:'default',pattern:'fabric'","const curt={kind:'default',texture:detail('lace',.75,.38),pattern:'fabric'"],
 ["archRib(id+'-front-rib',x,-2.87,r,ry,3.19);","const archFace=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI;return[r*Math.cos(a),ry*Math.sin(a)];});\n add(id+'-arch-face',[x,3.19,-2.875],{kind:'polygon-prism',points:archFace,axis:2,thickness:.045},{...P.wall,color:[.29,.22,.175,1]});\n archRib(id+'-front-rib',x,-2.91,r,ry,3.19);"],
 ["[[-3.0,7.00,8.6,","[[2.7,7.00,8.6,"],
 ["[8.3,6.98,9.0,","[14.0,6.98,9.0,"],
 ["[19.7,7.0,7.9,","[25.4,7.0,7.9,"],
 ["const lamp=[-11.4,0,-4.55]","const lamp=[-6.7116,0,-.4714]"],
 ["light('lamp-light',[lx,3.65,lz],24,15,[1,.87,.68]);","light('lamp-light',[lx,3.65,lz],38,19,[1,.92,.80]);"],
 ["for(let i=0;i<85;i++)","for(let i=0;i<360;i++)"],
 ["const x=-21+random()*72,z=-4-random()*15;","const x=-18+random()*58,z=-4-random()*14;"],
 ["sunIntensity:.10,skyColor:[.022,.025,.029],fogDensity:.028,exposure:1.08","sunIntensity:.22,skyColor:[.047,.049,.051],fogDensity:.038,exposure:1.08"],
 ["box('distant-building',[38,5.6,4.8],[18,11.2,10],P.side);",`box('distant-building',[38,5.6,4.8],[18,11.2,10],P.side);
// A side porch wraps around the building corner ahead of the main facade.
const sideZ=3.30,sideRadius=2.24,sideRise=1.23;
surface('side-canopy',[start,3.19,sideZ],72,20,(u,v)=>[-2.88+v*2.9,sideRise*Math.sin(u*Math.PI),-sideRadius*Math.cos(u*Math.PI)],P.roof);
surface('side-canopy-snow',[start,3.19,sideZ],96,32,(u,v)=>{
 const a=(.025+.95*u)*Math.PI,h=.046+.022*Math.sin(u*49+v*17)*Math.sin(v*46);
 return[-2.9+v*2.91,(sideRise+h)*Math.sin(a),-(sideRadius+h)*Math.cos(a)];
},P.snow);
const sideProfile=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI;return[sideRise*Math.sin(a),-sideRadius*Math.cos(a)];});
add('side-canopy-face',[start-2.89,3.19,sideZ],{kind:'polygon-prism',axis:0,points:sideProfile,thickness:.05},{...P.wall,color:[.22,.20,.17,1]});
for(const z of [sideZ-sideRadius,sideZ+sideRadius])capital('side-column-'+z,start-2.89,z);
for(let i=0;i<64;i++){
 const a=i/64*Math.PI,b=(i+1)/64*Math.PI;
 rod('side-arch-trim-'+i,[start-2.94,3.19+sideRise*Math.sin(a),sideZ-sideRadius*Math.cos(a)],[start-2.94,3.19+sideRise*Math.sin(b),sideZ-sideRadius*Math.cos(b)],.027);
}
box('side-window-dark',[start-.275,1.73,sideZ],[.03,2.70,3.61],{kind:'default',pattern:'window',color:[.072,.068,.057,1],roughness:.35,emissive:[.006,.005,.003]});
for(const z of [sideZ-1.88,sideZ-.64,sideZ+.64,sideZ+1.88])box('side-window-jamb-'+z,[start-.33,1.70,z],[.17,3.0,.09]);
for(const y of [.26,.49,2.68,3.0])box('side-window-crossbar-'+y,[start-.34,y,sideZ],[.18,.085,3.86]);
box('side-walk',[start-1.55,.035,4.35],[3.6,.07,10.6],P.stone,{environmental:{surfaceUse:'sidewalk',snowDepthM:.012}});
box('side-curb',[start-3.46,.07,4.35],[.22,.14,10.6],P.stone);
for(let i=0;i<20;i++)snow('side-curb-snow-'+i,[start-3.38,.06,-.8+i*.53],[.47,.09+random()*.05,.67],14);
`]
]);
replacements.set('src/render/webgpu.ts',[
 ["from './light-grid.js';","from './light-grid.js';\nimport {FOG_WGSL} from './fog.js';"],
 ["FRAME_WGSL+LIGHT_GRID_WGSL+`","FRAME_WGSL+LIGHT_GRID_WGSL+FOG_WGSL+`"],
 ["color=mix(color,f.sky.rgb*1.22+f.sunColor.rgb*f.sun.w*.027,clamp(fog,0.0,.96));","color=mix(color,f.sky.rgb*1.22+f.sunColor.rgb*f.sun.w*.027,clamp(fog,0.0,.96));\n  color+=pointFog(eye,in.worldPos,f.sky.w);"]
]);
replacements.set('src/render/lighting.ts',[
 ["color=mix(color,mix(f.sky.rgb*1.18,vec3<f32>(.82,.86,.90),haze*.55),cloudOpacity);","// Cloud radiance follows incident light rather than a fixed white term.\n let cloudRadiance=f.sky.rgb*(1.45+.25*haze)+f.sunColor.rgb*f.sun.w*.10;\n color=mix(color,cloudRadiance,cloudOpacity);"]
]);
replacements.set('tools/arcade/capture.mjs',[
 ["import scene,{authoredEntityCount,quality} from './scene.mjs';","import scene,{authoredEntityCount,quality} from './scene.mjs';\nimport {prepareArcadeTextures} from './textures.mjs';"],
 ["run(process.execPath,['tools/render-harness.mjs'","await prepareArcadeTextures();\nrun(process.execPath,['tools/render-harness.mjs'"],
 ["profile:r.profile","profile:{cpu:r.profile?.cpuTotal,gpu:r.profile?.gpuTotal,snowInstances:r.profile?.latestGpu?.work?.snowInstances}"]
]);
assert(process.env.GITHUB_TOKEN,'A repository-scoped token is required');
const result=[];
for(const [path,edits] of replacements){
 let source=await readFile(path,'utf8');
 for(const [before,after] of edits){assert.equal(source.split(before).length-1,1,'Non-unique patch anchor in '+path+': '+before);source=source.replace(before,after);}
 const response=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+'/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({encoding:'utf-8',content:source})});
 if(!response.ok)throw new Error('Blob upload failed '+response.status+' '+await response.text());
 const blob=await response.json();result.push({path,mode:'100644',type:'blob',sha:blob.sha});
}
console.log('PREPARED_IMMUTABLE_BLOBS='+JSON.stringify(result));
