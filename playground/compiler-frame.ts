declare const __COMPILER_SOURCE__:string;declare const __EXECUTION_SOURCE__:string;
let compiler:Worker,executor:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,ready=false,announced=false,current:{id:number;code:string}|undefined;
const compilerURL=URL.createObjectURL(new Blob([__COMPILER_SOURCE__],{type:'text/javascript'}));
const executionURL=URL.createObjectURL(new Blob([__EXECUTION_SOURCE__],{type:'text/javascript'}));
const finish=(result:object)=>{clearTimeout(timer);executor?.terminate();executor=undefined;current=undefined;parent.postMessage({compiler:true,...result},'*');};
const restart=()=>{
 compiler?.terminate();ready=false;compiler=new Worker(compilerURL);
 compiler.onmessage=e=>{
  if(e.data?.ready){ready=true;if(!announced){announced=true;parent.postMessage({compiler:true,ready:true},'*');}if(current)send();return;}
  if(!current||e.data?.id!==current.id)return;
  if(e.data.execute){
   executor?.terminate();executor=new Worker(executionURL);
   executor.onmessage=result=>{if(result.data.id!==current?.id)return;executor?.terminate();executor=undefined;if(result.data.error)finish(result.data);else compiler.postMessage({type:'result',...result.data});};
   executor.onerror=error=>finish({id:current?.id,error:error.message});executor.postMessage({id:current.id,javascript:e.data.execute});
  }else finish(e.data);
 };
 compiler.onerror=e=>{finish({id:current?.id,error:e.message});restart();};
};
const send=()=>{
 if(!current||!ready)return;compiler.postMessage({type:'compile',...current});clearTimeout(timer);
 timer=setTimeout(()=>{finish({id:current?.id,error:'Компиляция/построение превысили 2 секунды. Последняя сцена сохранена.'});restart();},2000);
};
window.addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='compile')return;executor?.terminate();clearTimeout(timer);current={id:e.data.id,code:e.data.code};if(ready)send();});
restart();
