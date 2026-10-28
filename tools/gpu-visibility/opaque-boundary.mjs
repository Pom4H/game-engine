import {differences} from './temporal-diagnostic.mjs';
import {colorCopyPlan,decodeColorCopy} from './color-copy.mjs';

/** Copy observable MRT state immediately after the opaque render pass. The
 * packed attachments are read through the existing compute codecs because
 * production RG16/RGBA8 textures do not have COPY_SRC usage. No render shader
 * or texture usage changes; inline observations can change GPU scheduling. */
export class OpaqueBoundary {
 constructor(renderer,reader,width,height,normalTexture){
  this.renderer=renderer;this.reader=reader;this.width=width;this.height=height;this.armed=false;this.copies=0;
  this.normalTexture=normalTexture;
  const device=renderer.device;this.targets={};
  for(const name of ['opaque','normal']){const plan=colorCopyPlan(name==='normal'&&normalTexture?normalTexture.format:'rgba16float',width,height);this.targets[name]={plan,readback:device.createBuffer({label:'opaque boundary '+name,size:plan.bytes,usage:0x01|0x08})};}
  for(const name of ['specular','velocity'])this.targets[name]={output:device.createBuffer({label:'opaque boundary '+name+' words',size:reader.bytes,usage:0x80|0x04}),readback:device.createBuffer({label:'opaque boundary '+name,size:reader.bytes,usage:0x01|0x08})};
  this.originalCreate=device.createCommandEncoder;const boundary=this;
  device.createCommandEncoder=function(descriptor){
   const encoder=boundary.originalCreate.call(this,descriptor),originalBegin=encoder.beginRenderPass;
   encoder.beginRenderPass=function(descriptor){
    const pass=originalBegin.call(this,descriptor);if(descriptor.label==='render.main.opaque'&&boundary.armed){const originalEnd=pass.end;pass.end=function(){originalEnd.call(this);boundary.encode(encoder);};}return pass;
   };return encoder;
  };
 }
 beginFrame(){if(this.armed)throw new Error('Opaque boundary already armed');this.armed=true;this.copies=0;}
 encode(encoder){
  if(++this.copies!==1)throw new Error('Expected one opaque pass');
  const renderer=this.renderer;
  for(const [name,texture] of [['opaque',renderer.opaqueScene],['normal',this.normalTexture??renderer.normal]]){
   const target=this.targets[name];if(texture.format!==target.plan.format||texture.width!==this.width||texture.height!==this.height)throw new Error('Opaque boundary format/extent changed');
   encoder.copyTextureToBuffer({texture},{buffer:target.readback,bytesPerRow:target.plan.row,rowsPerImage:this.height},[this.width,this.height,1]);
  }
  for(const name of ['specular','velocity'])this.reader.encodePacked(encoder,renderer[name],name,this.targets[name].output,this.targets[name].readback);
 }
 async read(finalStages){
  if(!this.armed||this.copies!==1)throw new Error('Missing opaque boundary observation');
  this.armed=false;const stages={},checks={};
  for(const [name,target] of Object.entries(this.targets)){
   const buffer=target.readback;try{
    await buffer.mapAsync(1);const mapped=new Uint8Array(buffer.getMappedRange());let stage;
    if(name==='opaque'||name==='normal'){
     stage=decodeColorCopy(mapped,target.plan);
    }else{const bytes=mapped.slice(),pixels=name==='specular'?bytes:new Uint16Array(bytes.buffer),channels=name==='specular'?4:2,encoding=name==='specular'?'rgba8unorm raw words':'rg16float raw words';if(name==='velocity'&&pixels.some(word=>(word&0x7c00)===0x7c00))throw new Error('Non-finite opaque boundary '+name);stage={width:this.width,height:this.height,channels,encoding,pixels};}
    stages[name+'AfterOpaque']=stage;
    checks[name]=differences(stage,finalStages[name]);
   }finally{buffer.unmap();}
  }return{stages,checks};
 }
 destroy(){this.renderer.device.createCommandEncoder=this.originalCreate;for(const target of Object.values(this.targets)){target.output?.destroy();target.readback.destroy();}}
}
