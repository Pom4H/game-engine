/* Local authored TypeScript only. Import/share never autoruns. Killable, not a security sandbox. */
importScripts('./vendor/typescript.js','./compile.cjs','./bindings.cjs');
const api=import('./engine/dsl/index.js');
let session;
self.onmessage=async({data})=>{
 let analyzed;
 try{
  analyzed=DSLBindings.analyze(ts,data.source);
  const started=performance.now(),dsl=await api;session??=dsl.authoringSession();
  session.begin();
  const program=compileSource(ts,{...dsl,assembly:session.assembly},data.source);
  session.end();
  self.postMessage({id:data.id,program,...analyzed,compileMs:performance.now()-started,compilers:session.diagnostics()});
 }catch(error){session?.end();self.postMessage({id:data.id,...analyzed,error:error instanceof Error?error.message:String(error)});}
};
