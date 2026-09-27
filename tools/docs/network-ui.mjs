import {Replica,SceneReplicaView,sceneMotion} from './engine/network/index.js';
/** Optional local authority panel in the EXISTING editor. No second renderer, scene clock or writable settings store. */
export class NetworkPanel{
 active=false;lastArrival=0;networkStatus='';pendingGpu=0;skippedFrames=0;buffer=null;view=null;worker=null;runtime=null;token='';epoch=0;tick=0;paused=true;mode='live';playhead=0;lastUpdate=0;frameCount=0;serial=0;
 constructor({runtime,program,pause,restore,onError,download}){
  this.getRuntime=runtime;this.getProgram=program;this.pauseLocal=pause;this.restore=restore;this.onError=onError;this.download=download;
  this.root=document.querySelector('#network-panel');this.label=document.querySelector('#network-status');
  const action=(id,fn)=>document.querySelector('#'+id).onclick=()=>void Promise.resolve().then(fn).catch(onError);
  action('network-connect',()=>this.active?this.disconnect():this.connect());
  action('network-pause',()=>this.paused?this.resumeServer():this.pauseServer());
  action('network-step',()=>this.command('step'));
  action('network-dump',async()=>{const r=await this.command('dump');download('authority-domain.json',new Blob([JSON.stringify(r.dump,null,2)],{type:'application/json'}));});
  action('network-heap',async()=>{const r=await this.command('heap');this.label.textContent='V8 heap · '+r.path+' · файл остался на сервере';});
  action('network-replay',()=>this.requestReplay());
  action('network-live',()=>{this.mode='live';this.runtime.scene.cutPresentation();this.clip=null;this.update();});
  document.querySelector('#network-time').oninput=e=>this.seek(e.target.valueAsNumber);
  for(const id of ['network-pause','network-step','network-dump','network-heap','network-replay','network-live','network-time'])document.querySelector('#'+id).disabled=true;
 }
 async request(action,body={}){
  const response=await fetch('/debug-network/'+action,{method:'POST',headers:{'content-type':'application/json','x-debug-token':this.token},body:JSON.stringify({...body,epoch:this.epoch,expectedTick:this.tick})});
  const value=await response.json();if(!response.ok)throw new Error(value.error??'Network command failed');return value;
 }
 async connect(){
  if(!this.getRuntime()||this.active)return;
  const response=await fetch('/debug-network/config');if(!response.ok)throw new Error('Запустите локально: NETWORK_DEBUG=1 bun dev. Действующий игровой сервер не затрагивается.');
  this.token=(await response.json()).token;this.pauseLocal();this.runtime=this.getRuntime();
  const ready=await this.request('init',{program:this.getProgram()});await this.install(ready);
  this.active=true;this.serial++;const serial=this.serial;
  this.worker=new Worker('./network-worker.js',{type:'module'});
  this.worker.onmessage=({data})=>{
   if(!this.active||data.serial!==this.serial)return;
   try{
    if(data.kind==='frame'){const accepted=this.buffer.receive(data.frame,performance.now()/1000);if(accepted){this.tick=data.frame.tick;this.paused=data.frame.paused;this.lastArrival=performance.now();this.networkStatus='';}this.worker?.postMessage({kind:'ack',serial});}
    else if(data.kind==='clip-start'){if(data.epoch!==this.epoch)return;this.clipPending=new Replica(sceneMotion,this.epoch,600,32_000_000,0);}
    else if(data.kind==='clip-chunk'){for(const f of data.frames)this.clipPending?.receive(f,performance.now()/1000);this.worker?.postMessage({kind:'clip-ack',serial});}
    else if(data.kind==='clip-end'){if(!this.clipPending)return;this.clip=this.clipPending;this.clipPending=null;this.mode='replay';this.seek(this.clip.inspect().oldest);}
    else if(data.kind==='error')this.onError(new Error(data.error));
    else if(data.kind==='status'){this.networkStatus=data.status;this.update();}
   }catch(error){this.onError(error);this.worker?.postMessage({kind:'ack',serial});}
  };
  this.worker.postMessage({kind:'connect',serial});document.querySelector('#network-connect').textContent='Локальная симуляция';
  for(const id of ['play','step','reset','time','audio'])document.querySelector('#'+id).disabled=true;
  this.root.hidden=false;this.update();
 }
 async install(ready){
  const previousCamera=this.runtime.scene.camera;await this.runtime.replaceScene(ready.scene);this.runtime.scene.setCamera(previousCamera);
  this.view?.dispose();this.epoch=ready.epoch;this.tick=ready.tick;this.paused=ready.paused;
  this.buffer=new Replica(sceneMotion,this.epoch,600,32_000_000,.1);this.buffer.receive(ready.frame,performance.now()/1000);
  this.lastArrival=performance.now();this.networkStatus='';this.view=new SceneReplicaView(this.runtime.scene,ready.motionIds);this.mode='live';this.clip=null;this.clipPending=null;this.heldSample=null;this.worker?.postMessage({kind:'cancel-replay'});this.runtime.scene.cutPresentation();this.view.apply(this.buffer.at(ready.time));
  const follow=this.getProgram()?.follow;this.followOrigin=follow?[...this.runtime.scene.entities.get(follow)?.position??[0,0,0]]:null;
 }
 async command(action){const reply=await this.request(action);this.tick=reply.tick;this.paused=reply.paused;
  if(reply.frame){this.lastArrival=performance.now();this.buffer.receive(reply.frame,performance.now()/1000);this.view.apply(this.buffer.at(reply.time));this.runtime.scene.cutPresentation();}
  this.update();return reply;
 }
 pauseServer(){return this.command('pause');}
 resumeServer(){this.mode='live';this.clip=null;return this.command('resume');}
 requestReplay(){if(!this.active)return;this.worker.postMessage({kind:'replay',serial:this.serial,epoch:this.epoch,from:0,to:this.buffer.inspect().newest,token:this.token});this.label.textContent='Подготовка серверного повтора в worker…';}
 seek(time){if(!Number.isFinite(time)||!this.active)return;this.mode='replay';this.playhead=time;this.heldSample=structuredClone((this.clip??this.buffer).at(time));this.runtime.scene.cutPresentation();this.frame(performance.now());}
 /** Optical/camera edits stay local. Physical edits require the explicit server pause barrier. */
 async edit(previous,next,edit){
  const physical=edit.mode!=='live'||JSON.stringify(previous.vehicles.map(v=>[v.controls,v.air]))!==JSON.stringify(next.vehicles.map(v=>[v.controls,v.air]));
  if(physical){if(!this.paused)throw new Error('Для изменения физики сначала нажмите «Пауза сервера».');const reply=await this.request('edit',{program:next});if(reply.mode==='rebuild')await this.install(reply);else if(reply.frame){this.lastArrival=performance.now();this.buffer.receive(reply.frame,performance.now()/1000);this.tick=reply.tick;}}
  if(edit.patch)this.runtime.scene.patchAppearance(edit.patch);if(edit.camera)this.runtime.scene.setCamera(edit.camera);
  return physical?edit.mode:'live';
 }
 frame(now){
  if(!this.active||!this.buffer)return;if(this.pendingGpu>=2){this.skippedFrames++;return;}
  const source=this.mode==='replay'?(this.clip??this.buffer):this.buffer;
  const sample=this.mode==='replay'?(this.heldSample??source.at(this.playhead)):this.paused?source.at(source.inspect().newest):source.present(now/1000);
  this.view.apply(sample);
  const program=this.getProgram(),follow=program?.follow,camera=program?.scene.camera,entity=follow&&this.runtime.scene.entities.get(follow);
  if(entity&&camera&&this.followOrigin){const delta=entity.position.map((v,k)=>v-this.followOrigin[k]);this.runtime.scene.setCamera({...camera,position:camera.position.map((v,k)=>v+delta[k]),target:camera.target.map((v,k)=>v+delta[k])});}
  this.runtime.render();this.frameCount++;this.pendingGpu++;
  void this.runtime.drain().catch(this.onError).finally(()=>this.pendingGpu--);
  if(now-this.lastUpdate>250){this.lastUpdate=now;this.update();}
 }
 update(){
  if(!this.active)return;const state=this.buffer.inspect(),replay=(this.clip??this.buffer).inspect();
  this.label.textContent=`${this.mode==='replay'?'ПОВТОР':'LIVE'} · epoch ${this.epoch} · сервер ${this.tick} / рендер ${this.runtime.scene.tick} · ${state.frames} кадров · ${(state.payloadBytes/1024).toFixed(0)} КиБ проекции · ${this.paused?'сервер на паузе':'сервер работает'}${!this.paused&&performance.now()-this.lastArrival>500?' · НЕТ СВЕЖЕГО СОСТОЯНИЯ':''}${this.networkStatus?' · '+this.networkStatus:''}`;
  for(const id of ['network-pause','network-replay','network-live','network-time'])document.querySelector('#'+id).disabled=false;
  for(const id of ['network-step','network-dump','network-heap'])document.querySelector('#'+id).disabled=!this.paused;
  document.querySelector('#network-pause').textContent=this.paused?'▶ Сервер':'Ⅱ Пауза сервера';
  const time=document.querySelector('#network-time');time.min=String(replay.oldest);time.max=String(replay.newest);if(document.activeElement!==time)time.value=String(this.mode==='replay'?this.playhead:state.newest);
 }
 stop(){this.active=false;this.serial++;this.worker?.terminate();this.worker=null;this.view?.dispose();this.view=null;this.buffer=null;this.clip=null;this.root.hidden=true;document.querySelector('#network-connect').textContent='Серверный стенд';}
 async disconnect(){this.stop();await this.restore();for(const id of ['play','step','reset','time','audio'])document.querySelector('#'+id).disabled=false;}
 inspect(){return{active:this.active,epoch:this.epoch,tick:this.tick,paused:this.paused,mode:this.mode,renderedFrames:this.frameCount,pendingGpu:this.pendingGpu,skippedFrames:this.skippedFrames,buffer:this.buffer?.inspect(),clientPhysicsSteps:this.runtime?.scene.physics.steps,clientBodies:this.runtime?.scene.physics.bodies.size};}
}
