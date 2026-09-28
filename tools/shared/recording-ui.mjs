import {FrameRecording,chromeTrace} from './recording.mjs';

/** A tab in the existing Ё drawer. Recorded pixels never mutate the live world. */
export function mountRecording({host,canvas,runtime,metadata,download}) {
  host.innerHTML=`<div class="record-toolbar"><button data-do="start">● Запись</button><button data-do="stop" disabled>■ Стоп</button><label><input data-images type="checkbox" checked> Кадры · до 10 FPS</label><button data-do="export">JSON ↓</button><button data-do="trace">Chrome trace ↓</button><button data-do="clear">Очистить</button><output data-status></output></div>
  <div class="record-navigation"><button data-do="previous" aria-label="Предыдущий записанный кадр">←</button><button data-do="play">▶ Просмотр</button><button data-do="next" aria-label="Следующий записанный кадр">→</button><input data-time type="range" min="0" max="0" value="0" step="1" aria-label="Кадр записи; не перематывает симуляцию"><button data-do="zoomOut" aria-label="Уменьшить масштаб">−</button><button data-do="zoomIn" aria-label="Увеличить масштаб">+</button><button data-do="all">Вся запись</button></div>
  <div class="record-timeline"><canvas data-timeline aria-label="Временная шкала измеренных CPU-проходов"></canvas></div>
  <div class="record-view"><figure><img data-image hidden alt="Сохранённый кадр рендера"><figcaption data-caption>Нажмите «Запись», воспроизведите проблему и остановите запись.</figcaption></figure><pre data-detail></pre></div>
  <div data-filmstrip class="record-filmstrip" aria-label="Лента сохранённых кадров"></div>`;
  const q=s=>host.querySelector(s),model=new FrameRecording(),events=new AbortController();
  const status=q('[data-status]'),seek=q('[data-time]'),image=q('[data-image]'),chart=q('[data-timeline]'),strip=q('[data-filmstrip]');
  let release=null,busy=false,lastImageAt=-Infinity,selected=0,lastPaint=0,playing=false,playAt=0,playStart=0,zoom=1,disposed=false,dirty=true,imageError='';
  let paintedImages=0,shownImage='',stopping=false;
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>{dirty=true;}):null;resize?.observe(host);
  const stop=()=>{
    model.stop(model.reason||'Stopped');playing=false;dirty=true;if(stopping)return;stopping=true;
    // Drain only when recording stops, never synchronously in the render loop.
    const detach=release;Promise.resolve(runtime()?.renderer.flush()).catch(()=>{}).finally(()=>{detach?.();if(release===detach){release=null;stopping=false;}dirty=true;});
  };
  const toDataURL=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  const capture=frame=>{
    if(busy||!q('[data-images]').checked||frame.startMs-lastImageAt<100||model.images>=model.limits.maxImages||model.imageBytes>=model.limits.maxImageBytes)return;
    busy=true;lastImageAt=frame.startMs;const session=model.session,at=performance.now();
    try{
      const scale=Math.min(1,640/canvas.width,360/canvas.height),width=Math.max(1,Math.round(canvas.width*scale)),height=Math.max(1,Math.round(canvas.height*scale));
      const copy=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
      copy.getContext('2d').drawImage(canvas,0,0,width,height);const copyMs=performance.now()-at;
      const blob=copy.convertToBlob?copy.convertToBlob({type:'image/jpeg',quality:.75}):new Promise((yes,no)=>copy.toBlob(b=>b?yes(b):no(new Error('Canvas capture failed')),'image/jpeg',.75));
      void blob.then(toDataURL).then(data=>{if(!disposed)model.attachImage(session,frame.key,data,copyMs);}).catch(error=>{if(session===model.session){imageError=String(error.message);q('[data-images]').checked=false;}}).finally(()=>{busy=false;dirty=true;});
    }catch(error){busy=false;imageError=String(error.message);q('[data-images]').checked=false;}
  };
  const start=()=>{
    const engine=runtime();if(!engine?.renderer.subscribeFrames)throw new Error('Renderer does not support frame recording');
    release?.();release=null;stopping=false;model.start(performance.now());strip.replaceChildren();paintedImages=0;selected=0;playing=false;lastImageAt=-Infinity;zoom=1;shownImage='';image.hidden=true;imageError='';
    try{release=engine.renderer.subscribeFrames(event=>{
      const frame=model.receive(event,event.kind==='cpu'&&model.active?metadata():{});
      if(frame){selected=frame.index;capture(frame);}
      if(event.kind==='cpu'&&!model.active&&release)stop();dirty=true;
    });}catch(error){model.stop(error.message);dirty=true;throw error;}dirty=true;
  };
  function choose(index){selected=Math.max(0,Math.min(model.frames.length-1,index));dirty=true;}
  const actions={start,stop,clear:()=>{release?.();release=null;model.clear();playing=false;strip.replaceChildren();paintedImages=0;shownImage='';image.hidden=true;dirty=true;},
    export:()=>download('engine-recording.json',new Blob([JSON.stringify(model.export())],{type:'application/json'})),
    trace:()=>download('engine-trace.json',new Blob([JSON.stringify(chromeTrace(model))],{type:'application/json'})),
    previous:()=>{playing=false;choose(selected-1);},next:()=>{playing=false;choose(selected+1);},
    play:()=>{if(model.active)stop();playing=!playing;playAt=performance.now();if(selected>=model.frames.length-1)choose(0);playStart=model.at(selected)?.startMs??0;dirty=true;},
    zoomIn:()=>{zoom=Math.min(64,zoom*2);dirty=true;},zoomOut:()=>{zoom=Math.max(1,zoom/2);dirty=true;},all:()=>{zoom=1;dirty=true;}};
  host.addEventListener('click',event=>{const action=event.target.closest('[data-do]')?.dataset.do;if(action)try{actions[action]();}catch(error){status.textContent=error.message;}},{signal:events.signal});
  seek.addEventListener('input',()=>{playing=false;choose(seek.valueAsNumber);},{signal:events.signal});
  function windowMs(){const first=model.frames[0]?.startMs??0,last=model.frames.at(-1),end=last?last.startMs+last.cpu.totalMs:first+1,width=Math.max(1,end-first)/zoom,center=model.at(selected)?.startMs??first;const lo=Math.max(first,Math.min(end-width,center-width/2));return[lo,lo+width];}
  chart.addEventListener('pointerdown',event=>{if(!model.frames.length)return;const [lo,hi]=windowMs(),bounds=chart.getBoundingClientRect(),at=lo+Math.max(0,event.clientX-bounds.left-130)/Math.max(1,bounds.width-130)*(hi-lo);let index=0;for(const frame of model.frames){if(frame.startMs>at)break;index=frame.index;}playing=false;choose(index);},{signal:events.signal});
  function draw(){
    const names=[...new Set(model.frames.flatMap(f=>f.spans.map(s=>s.name)))],height=30+20*(names.length+1),width=Math.max(300,Math.round(chart.parentElement.clientWidth)),ratio=devicePixelRatio||1;
    chart.width=width*ratio;chart.height=height*ratio;chart.style.width=width+'px';chart.style.height=height+'px';const ctx=chart.getContext('2d');ctx.scale(ratio,ratio);
    ctx.fillStyle='#11171b';ctx.fillRect(0,0,width,height);ctx.font='10px monospace';ctx.fillStyle='#aab8c1';const [lo,hi]=windowMs(),x=t=>130+(t-lo)/(hi-lo)*(width-130);
    ctx.fillText('CPU render',5,40);names.forEach((name,i)=>ctx.fillText(name,5,60+i*20));
    for(let i=0;i<=5;i++){const at=lo+(hi-lo)*i/5;ctx.fillText(((at-(model.frames[0]?.startMs??0))/1000).toFixed(3)+'s',Math.min(width-55,x(at)),14);}
    ctx.save();ctx.beginPath();ctx.rect(130,20,width-130,height-20);ctx.clip();
    for(const frame of model.frames){if(frame.startMs>hi||frame.startMs+frame.cpu.totalMs<lo)continue;
      ctx.fillStyle=frame.index===selected?'#efbc70':'#598fbe';ctx.fillRect(x(frame.startMs),26,Math.max(1,x(frame.startMs+frame.cpu.totalMs)-x(frame.startMs)),16);
      ctx.fillStyle='#77b8a7';for(const span of frame.spans)ctx.fillRect(x(frame.startMs+span.offsetMs),46+names.indexOf(span.name)*20,Math.max(1,span.durationMs/(hi-lo)*(width-130)),14);
    }
    const frame=model.at(selected);if(frame){ctx.fillStyle='#f1d6a5';ctx.fillRect(x(frame.startMs),20,1,height-20);}ctx.restore();
  }
  return{
    model,
    command(tail){if(!['start','stop','clear','export','trace'].includes(tail))throw new Error('record start | stop | clear | export | trace');actions[tail]();return JSON.stringify(model.inspect());},
    refresh(now=performance.now()){
      if(disposed||host.hidden||host.closest('[hidden]'))return;
      if(playing&&model.frames.length){const at=playStart+now-playAt;while(selected<model.frames.length-1&&model.frames[selected+1].startMs<=at)selected++;if(selected===model.frames.length-1)playing=false;dirty=true;}
      if(!dirty||now-lastPaint<100)return;lastPaint=now;dirty=false;
      q('[data-do=start]').disabled=model.active;q('[data-do=stop]').disabled=!model.active;q('[data-do=play]').textContent=playing?'Ⅱ Просмотр':'▶ Просмотр';
      status.textContent=`${model.active?'REC':'Запись'} · ${model.frames.length} кадров · ${model.images} снимков · ${(model.imageBytes/1048576).toFixed(1)} MiB${model.reason?' · '+model.reason:''}${imageError?' · '+imageError:''}`;
      seek.max=String(Math.max(0,model.frames.length-1));seek.value=String(selected);seek.disabled=!model.frames.length;
      const frame=model.at(selected),picture=model.imageAt(selected);
      if(picture){if(shownImage!==picture.key){image.src=picture.image;shownImage=picture.key;}image.hidden=false;}else image.hidden=true;
      q('[data-caption]').textContent=frame?`Выбран ${frame.key} · снимок ${picture?.key??'не записан'}${picture&&picture!==frame?' (предыдущий, '+(frame.startMs-picture.startMs).toFixed(1)+' мс назад)':''}. Это просмотр записи, живая симуляция не перематывается.`:'Нажмите «Запись», воспроизведите проблему и остановите запись.';
      q('[data-detail]').textContent=frame?JSON.stringify({frame:frame.key,...frame.meta,cpuRenderMs:frame.cpu.totalMs,gpuPassSumMs:frame.gpu?.totalMs??'нет замера этого кадра',gpuPassesMs:frame.gpu?.quanta??{},imageCopyCpuMs:picture?.captureMs??null,work:frame.cpu.work},null,2):'';
      if(model.images!==paintedImages){strip.replaceChildren();for(const f of model.frames)if(f.image){const b=document.createElement('button'),img=document.createElement('img');img.src=f.image;img.alt=`Кадр ${f.key}`;b.title=`${f.key}, ${(f.startMs-model.frames[0].startMs).toFixed(1)} ms`;b.append(img);b.onclick=()=>{playing=false;choose(f.index);};strip.append(b);}paintedImages=model.images;}
      draw();
    },
    dispose(){disposed=true;resize?.disconnect();release?.();release=null;events.abort();model.clear();strip.replaceChildren();image.removeAttribute('src');},
  };
}
