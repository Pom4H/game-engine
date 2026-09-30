/* Killable authoring worker; not a hostile-code sandbox. Network access is denied by CSP.
 * Analyze does not execute source. Only an explicit Apply sends a compile request. */
importScripts('./vendor/typescript.js','./compile.cjs','./bindings.cjs');
const modules={chess:['@rom4/game-engine/games/chess/project','../engine/games/chess-project.js','chess'],arena:['@rom4/game-engine/games/car-ball/project','../engine/games/car-ball-project.js','car-ball']};
const metadata={fen:{label:'Исходная позиция · FEN',shape:'text',maxLength:120},historyLimit:{label:'Лимит ходов в истории',shape:'number',min:1,max:16384,step:1},gravity:{label:'Гравитация',shape:'number',min:1,max:30,step:.1,unit:'м/с²'},matchSeconds:{label:'Длительность матча',shape:'number',min:10,max:300,step:1,unit:'с'},kickoffSeconds:{label:'Подготовка старта',shape:'number',min:0,max:10,step:.1,unit:'с'}};
self.onmessage=async({data})=>{
 try{
  if(typeof data.source!=='string'||data.source.length>64000)throw Error('Максимум 64 000 символов');
  const analyzed=DSLBindings.analyze(ts,data.source,metadata);
  if(data.kind==='analyze'){self.postMessage({id:data.id,...analyzed});return;}
  const choice=modules[data.game];if(!choice)throw Error('Неизвестный игровой модуль');
  const api=await import(choice[1]);
  const validateProgram=program=>{
   if(!program||typeof program.start!=='function'||Object.keys(program.modules??{}).join(',')!=='rules'||program.modules.rules.id!==choice[2])throw Error('Игра требует ровно один активный модуль rules');
   program.modules.rules.validate(program.modules.rules.config);
  };
  const program=compileSource(ts,{...api,validateProgram},data.source,choice[0]);
  // Derived portable configuration, never another writable authoring model.
  self.postMessage({id:data.id,...analyzed,compiled:{id:program.id,config:program.modules.rules.config,presets:program.presets}});
 }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
