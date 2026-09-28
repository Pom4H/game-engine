import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import * as TypeScript from 'typescript';
const ts=TypeScript.default??TypeScript;

async function files(dir){
  const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);if(entry.isDirectory())out.push(...await files(path));else if(entry.isFile()&&path.endsWith('.ts'))out.push(path);
  }return out;
}
const persistentKinds=new Set(['Map','Set','WeakMap','WeakSet']);
const tracked=initializer=>ts.isCallExpression(initializer)&&ts.isIdentifier(initializer.expression)&&initializer.expression.text==='trackRuntimeMemory';
const rawKind=initializer=>ts.isNewExpression(initializer)&&ts.isIdentifier(initializer.expression)&&persistentKinds.has(initializer.expression.text)?initializer.expression.text:null;
const offenders=[];
for(const file of await files('src')){
  if(file.endsWith('core/runtime-memory.ts'))continue;
  const source=await readFile(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const report=(node,name,initializer)=>{
    if(!initializer||tracked(initializer))return;
    const kind=rawKind(initializer);if(!kind)return;
    const pos=ast.getLineAndCharacterOfPosition(node.getStart(ast));
    offenders.push(`${relative('.',file)}:${pos.line+1}: ${name} = new ${kind}()`);
  };
  for(const statement of ast.statements){
    if(ts.isVariableStatement(statement))for(const decl of statement.declarationList.declarations)report(decl,decl.name.getText(ast),decl.initializer);
    if(ts.isClassDeclaration(statement))for(const member of statement.members)if(ts.isPropertyDeclaration(member))report(member,member.name.getText(ast),member.initializer);
  }
}
if(offenders.length){
  console.error('Persistent runtime collections must be registered with trackRuntimeMemory():\n'+offenders.map(x=>'  '+x).join('\n'));
  process.exitCode=1;
}
