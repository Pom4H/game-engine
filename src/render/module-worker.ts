/** Module workers must start on the document origin, even when Vite serves
 * their bundled entry from a separate development origin. Imports use CORS. */
export const ModuleWorker=function(url:URL,options:WorkerOptions):Worker{
  const external=url.origin!==location.origin;
  const bootstrap=external?URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`],{type:'text/javascript'})):null;
  let worker:Worker;
  try{worker=new globalThis.Worker(bootstrap??url,options);}catch(error){if(bootstrap)URL.revokeObjectURL(bootstrap);throw error;}
  if(bootstrap){
    let released=false;
    const release=()=>{if(!released){released=true;URL.revokeObjectURL(bootstrap);}};
    worker.addEventListener('message',release,{once:true});worker.addEventListener('error',release,{once:true});
    const terminate=worker.terminate.bind(worker);worker.terminate=()=>{release();terminate();};
  }
  return worker;
} as unknown as {new(url:URL,options:WorkerOptions):Worker};
