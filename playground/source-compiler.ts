import ts from 'typescript';
import {sourceIndex} from './source-index.js';
export function prepareCompilation(source:string){
 if(typeof source!=='string'||source.length>65536)throw new RangeError('Максимум 64 КБ кода');
 const index=sourceIndex(source);
 const result=ts.transpileModule(source,{fileName:'scene.ts',reportDiagnostics:true,transformers:{before:[index.transformer]},compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,strict:true}});
 const diagnostic=result.diagnostics?.find(d=>d.category===ts.DiagnosticCategory.Error);
 if(diagnostic){const location=diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start??0);throw Object.assign(new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n')),{line:(location?.line??0)+1,column:(location?.character??0)+1});}
 return {javascript:result.outputText,index};
}
