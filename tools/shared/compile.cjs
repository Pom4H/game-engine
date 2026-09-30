/* Shared by the actual browser worker and Node tests. No DOM, network or UI physics. */
(function(scope){
 const MAX_SOURCE=64000;
 function compileSource(ts,api,source,moduleName='@rom4/game-engine/dsl'){
  if(typeof source!=='string'||source.length>MAX_SOURCE)throw new RangeError('Code budget: 64000 characters');
  const result=ts.transpileModule(source,{fileName:'scene.ts',reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,strict:true,esModuleInterop:false}});
  const error=result.diagnostics?.find(d=>d.category===ts.DiagnosticCategory.Error);
  if(error){const pos=error.file&&error.start!==undefined?error.file.getLineAndCharacterOfPosition(error.start):null;throw new SyntaxError((pos?`${pos.line+1}:${pos.character+1} `:'')+ts.flattenDiagnosticMessageText(error.messageText,'\n'));}
  const module={exports:{}};
  const require=name=>{if(name!==moduleName)throw new TypeError(`Unsupported import ${name}. Use ${moduleName}`);return api;};
  new Function('require','module','exports',result.outputText+'\n//# sourceURL=scene.ts')(require,module,module.exports);
  const program=module.exports.default;api.validateProgram(program);
  return program;
 }
 if(typeof module!=='undefined')module.exports={compileSource,MAX_SOURCE};else scope.compileSource=compileSource;
})(globalThis);
