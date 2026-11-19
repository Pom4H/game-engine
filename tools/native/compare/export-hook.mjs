export function installCapture(Renderer){
 const render=Renderer.prototype.render;
 Renderer.prototype.render=function(scene,camera){globalThis.__engineCapture={renderer:this,scene,camera:camera??scene.camera};return render.call(this,scene,camera);};
 const configure=GPUCanvasContext.prototype.configure;
 GPUCanvasContext.prototype.configure=function(options){return configure.call(this,{...options,usage:(options.usage??16)|1});};
 globalThis.__exportGameScene=async destination=>{
  const {scene,renderer}=globalThis.__engineCapture;
  const primitives=[],primitiveIds=new Map(),entities=[],surfaces={};
  const primitive=p=>{if(!p)return null;if(!primitiveIds.has(p)){primitiveIds.set(p,primitives.length);primitives.push(p);}return primitiveIds.get(p);};
  for(const e of scene.entities.values()){
   const {profile,surface,...material}=e.material;
   entities.push({id:e.id,position:[...e.position],rotation:[...e.rotation],scale:[...e.scale],renderOnly:true,
    renderVisible:e.renderVisible,renderCameraVisible:e.renderCameraVisible,material,environmental:e.environmental,light:e.light,
    mesh:primitive(e.mesh),renderMesh:primitive(e.renderMesh)});
   surfaces[e.id]=structuredClone(surface);
  }
  const urls=new Set(entities.flatMap(e=>{const t=e.material.texture;return t?[t.url,t.normalUrl,t.ormUrl,t.heightUrl].filter(Boolean):[];}));
  const assets=[],base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
  for(const url of urls){
   const bitmap=await createImageBitmap(await(await fetch(url)).blob());
   const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
   assets.push({kind:'image',key:url,width:bitmap.width,height:bitmap.height,rgba:base64(ctx.getImageData(0,0,bitmap.width,bitmap.height).data)});bitmap.close();
  }
  const labels=new Map();
  for(const e of entities)if(e.material.label){const {label:text,labelColor:color}=e.material,key=JSON.stringify([text,color??[226/255,217/255,188/255]]);if(labels.has(key))continue;
   const canvas=new OffscreenCanvas(1024,128),ctx=canvas.getContext('2d');ctx.clearRect(0,0,1024,128);ctx.fillStyle=color?`rgb(${color.map(v=>Math.round(v*255)).join(',')})`:'#e2d9bc';ctx.font='58px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64,940);
   const item={kind:'label',key,width:1024,height:128,rgba:base64(ctx.getImageData(0,0,1024,128).data)};labels.set(key,item);assets.push(item);
  }
  const packet={version:1,provenance:{source:'TheGame sole production entry',seed:scene.spec.seed,game:globalThis.__THEGAME_AGENT__.rendering.fixture().revision,renderer:renderer.inspect(),gameSettings:globalThis.__THEGAME_AGENT__.rendering.inspect().settings},
   spec:{...scene.spec,entities:[]},entities,primitives,surfaces,assets,environment:scene.environment,time:scene.time,tick:scene.tick,camera:scene.camera,movers:[...scene.renderMoverIds()]};
  const json=JSON.stringify(packet,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v);
  const compressed=await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const r=await fetch(destination,{method:'POST',headers:{'content-type':'application/octet-stream'},body:compressed});if(!r.ok)throw new Error('Scene export failed');
  return {entities:entities.length,primitives:primitives.length,assets:assets.length,labels:labels.size,jsonBytes:json.length,gzipBytes:compressed.byteLength,camera:scene.camera,stats:renderer.inspect()};
 };
}
