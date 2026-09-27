import ts from 'typescript';
import type {Binding} from './source-document.js';
export interface CallSite {index:number;name:string;call:ts.CallExpression;values:unknown[]}
const factories=new Set(['scene','body','ground','place','sedan','vehicle','wheel','wing','walker','arm','spatial','schedule','softBody','camera']);
const named=(n:ts.PropertyName|ts.BindingName):string|undefined=>ts.isIdentifier(n)||ts.isStringLiteral(n)||ts.isNumericLiteral(n)?n.text:undefined;
function declaration(id:ts.Identifier):ts.Expression|undefined {
 for(let scope:ts.Node|undefined=id.parent;scope;scope=scope.parent){
  if(ts.isFunctionLike(scope)&&scope.parameters.some(p=>p.name.getText()===id.text))return;
  if(ts.isBlock(scope)||ts.isSourceFile(scope))for(const statement of scope.statements){
   if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)if(named(d.name)===id.text)return statement.declarationList.flags&ts.NodeFlags.Const?d.initializer:undefined;
  }
 }
}
function resolve(node:ts.Expression,seen=new Set<ts.Node>()):ts.Expression {
 if(seen.has(node)||seen.size>32)return node;seen.add(node);
 if(ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isParenthesizedExpression(node))return resolve(node.expression,seen);
 if(ts.isIdentifier(node)){const init=declaration(node);if(init)return resolve(init,seen);}
 if(ts.isPropertyAccessExpression(node)){
  const root=resolve(node.expression,seen);if(ts.isObjectLiteralExpression(root))for(const p of [...root.properties].reverse())if(ts.isPropertyAssignment(p)&&named(p.name)===node.name.text)return resolve(p.initializer,seen);
 }
 return node;
}
export function sourceIndex(source:string){
 const file=ts.createSourceFile('scene.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),aliases=new Map<string,string>(),namespaces=new Set<string>(),calls:CallSite[]=[];
 for(const statement of file.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)&&statement.moduleSpecifier.text==='@rom4/game-engine/dsl'){
  const bindings=statement.importClause?.namedBindings;
  if(bindings&&ts.isNamedImports(bindings))for(const spec of bindings.elements)aliases.set(spec.name.text,spec.propertyName?.text??spec.name.text);
  else if(bindings&&ts.isNamespaceImport(bindings))namespaces.add(bindings.name.text);
 }
 const nameOf=(call:ts.CallExpression)=>ts.isIdentifier(call.expression)?aliases.get(call.expression.text):ts.isPropertyAccessExpression(call.expression)&&ts.isIdentifier(call.expression.expression)&&namespaces.has(call.expression.expression.text)?call.expression.name.text:undefined;
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)){const name=nameOf(node);if(name&&factories.has(name))calls.push({index:calls.length,name,call:node,values:[]});}ts.forEachChild(node,visit);};visit(file);
 const byStart=new Map(calls.map(c=>[c.call.getStart(file),c.index]));
 const transformer:ts.TransformerFactory<ts.SourceFile>=context=>root=>{
  const walk:ts.Visitor=node=>{const index=ts.isCallExpression(node)?byStart.get(node.getStart()):undefined;
   const result=ts.visitEachChild(node,walk,context);
   return index===undefined?result:ts.factory.createCallExpression(ts.factory.createIdentifier('__dslTrace'),undefined,[ts.factory.createNumericLiteral(index),result as ts.Expression]);
  };return ts.visitNode(root,walk) as ts.SourceFile;
 };
 const trace=(index:number,value:unknown)=>{calls[index]?.values.push(value);return value;};
 const bindings=():Binding[]=>{
  const result:Binding[]=[];
  for(const site of calls){
   if(!site.values.length)continue;
   const first=site.values[0] as {id?:string;source?:{id:string};blueprint?:{source:{id:string}};kind?:string}|undefined;
   const owner=site.name==='scene'?'Сцена':site.name==='camera'?'Камера':first?.id??first?.source?.id??first?.blueprint?.source?.id??site.name;
   const add=(path:string,expression:ts.Expression)=>{
    if(result.length>=256)return;
    const node=resolve(expression);let value:Binding['value'],writable=true;
    if(ts.isNumericLiteral(node))value=Number(node.text);
    else if(ts.isPrefixUnaryExpression(node)&&ts.isNumericLiteral(node.operand)&&(node.operator===ts.SyntaxKind.MinusToken||node.operator===ts.SyntaxKind.PlusToken))value=Number(node.operand.text)*(node.operator===ts.SyntaxKind.MinusToken?-1:1);
    else if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))value=node.text;
    else if(node.kind===ts.SyntaxKind.TrueKeyword||node.kind===ts.SyntaxKind.FalseKeyword)value=node.kind===ts.SyntaxKind.TrueKeyword;
    else {value=expression.getText(file);writable=false;}
    const start=node.getStart(file),end=node.end;
    if(ts.isPrefixUnaryExpression(node)&&/\/\*|\/\//.test(source.slice(start,node.operand.getStart(file))))writable=false;
    result.push({key:`${site.index}:${path}`,owner,factory:site.name,path,value,writable,shared:site.values.length,span:{start,end,text:source.slice(start,end)},call:{start:site.call.getStart(file),end:site.call.end}});
   };
   const descend=(path:string,expression:ts.Expression,depth=0,ancestors=new Set<ts.Node>())=>{
    const node=resolve(expression);if(depth>10||ancestors.has(node))return;const next=new Set(ancestors).add(node);
    if(ts.isCallExpression(node)&&byStart.has(node.getStart(file))||ts.isArrowFunction(node)||ts.isFunctionExpression(node))return;
    if(ts.isObjectLiteralExpression(node)){
     const properties=new Map<string,ts.Expression>();
     const collect=(o:ts.ObjectLiteralExpression,d=0)=>{if(d>10)return;for(const p of o.properties){if(ts.isSpreadAssignment(p)){const target=resolve(p.expression);if(ts.isObjectLiteralExpression(target)&&target!==o)collect(target,d+1);}else if(ts.isPropertyAssignment(p)&&named(p.name))properties.set(named(p.name)!,p.initializer);else if(ts.isShorthandPropertyAssignment(p))properties.set(p.name.text,p.name);}};
     collect(node);for(const [key,value]of properties)descend(path?`${path}.${key}`:key,value,depth+1,next);
    }else if(ts.isArrayLiteralExpression(node))node.elements.forEach((element,index)=>{if(!ts.isSpreadElement(element)&&!ts.isOmittedExpression(element))descend(`${path}[${index}]`,element,depth+1,next);});
    else add(path,expression);
   };
   if(site.name==='camera'){site.call.arguments.forEach((a,i)=>descend(['position','target','fov'][i]??`${i}`,a));}
   else {const arg=site.call.arguments[site.name==='scene'?0:1];if(arg)descend('',arg);}
  }
  // A shared const initializer may control more than one object/property.
  const counts=new Map<string,number>();for(const b of result){const key=`${b.span.start}:${b.span.end}`;counts.set(key,(counts.get(key)??0)+b.shared);}
  for(const b of result)b.shared=counts.get(`${b.span.start}:${b.span.end}`)!;
  return result;
 };
 return {file,transformer,trace,bindings};
}
