/* Syntax-bound authoring metadata. Runtime never imports TypeScript or this module. */
(function(scope){
 const number=(label,min,max,step,unit='')=>({label,shape:'number',min,max,step,unit});
 const choices=(label,options)=>({label,shape:'select',options});
 const meta={
  wingsEnabled:{label:'Крылья в конструкции',shape:'boolean'},
  exposure:number('Экспозиция',.1,3,.01),sunIntensity:number('Интенсивность солнца',0,8,.05),fogDensity:number('Плотность тумана',0,.05,.0001),shadowExtent:number('Область теней',5,100,1,'м'),
  roughness:number('Шероховатость',0,1,.01),metalness:number('Металличность',0,1,.01),clearcoat:number('Слой лака',0,1,.01),clearcoatRoughness:number('Шероховатость лака',.02,1,.01),
  throttle:number('Газ',-1,1,.01),brake:number('Тормоз',0,1,.01),steer:number('Руль',-1,1,.01),flap:number('Закрылки',-1,1,.01),roll:number('Крен',-1,1,.01),pitch:number('Тангаж',-1,1,.01),
  springNPerM:number('Жёсткость пружины',5000,150000,500,'Н/м'),damperNsPerM:number('Демпфирование',0,15000,100,'Н·с/м'),wearEnergyJ:number('Ресурс протектора',1000,100000000,1000,'Дж'),
  grip:number('Сцепление',.1,3,.01),massKg:number('Масса',1,5000,1,'кг'),mass:number('Масса',0,10000,1,'кг'),restitution:number('Упругость контакта',0,1,.01),friction:number('Трение',0,3,.01),
  driveTorqueNm:number('Момент привода',0,10000,50,'Н·м'),drivePowerW:number('Мощность привода',0,500000,1000,'Вт'),brakeTorqueNm:number('Тормозной момент',0,10000,50,'Н·м'),
  spanM:number('Размах',.1,20,.1,'м'),chordM:number('Хорда',.1,5,.05,'м'),incidenceRad:number('Угол установки',-.6,.6,.005,'рад'),zeroLiftRad:number('Угол нулевой подъёмной силы',-.3,.3,.005,'рад'),controlGainRad:number('Ход управления',-.6,.6,.005,'рад'),
  dragAreaM2:number('Лобовое сопротивление Cd·A',0,5,.01,'м²'),densityKgM3:number('Плотность воздуха',0,2,.01,'кг/м³'),radiusM:number('Радиус воздействия',.05,2,.01,'м'),maxDentM:number('Предел вмятины',.01,.8,.01,'м'),skinThicknessM:number('Толщина панели',.0001,.005,.0001,'м'),
  temperatureC:number('Температура',-30,40,1,'°C'),sunlight:number('Солнечный свет',0,1,.01),humidity:number('Влажность',0,1,.01),groundMoisture:number('Влага поверхности',0,1,.01),snowDepthM:number('Глубина снега',0,.3,.005,'м'),waterDepthM:number('Глубина воды',0,.02,.0001,'м'),
  snowfall:choices('Снегопад',['none','light','moderate','heavy']),precipitation:choices('Осадки',['arid','rare','occasional','frequent']),
  durationSeconds:number('Длительность',1,60,.5,'с'),speed:number('Скорость походки',0,3,.05,'м/с'),heading:number('Направление',-3.14,3.14,.01,'рад'),period:number('Период шага',.5,2,.01,'с'),heightScale:number('Рост',.6,1.4,.01),spokes:number('Спицы',3,32,1),
  position:{label:'Положение',shape:'vector',unit:'м'},velocity:{label:'Начальная скорость',shape:'vector',unit:'м/с'},wind:{label:'Ветер',shape:'vector',unit:'м/с'},sunDirection:{label:'Направление солнца',shape:'vector',unit:''},
  color:{label:'Цвет',shape:'color'},sunColor:{label:'Солнце',shape:'color'},skyColor:{label:'Небо',shape:'color'},
  at:{label:'Положение детали',shape:'vector',unit:'м'},mountAt:{label:'Крепление',shape:'vector',unit:'м'},root:{label:'Начало маршрута',shape:'vector',unit:'м'},modelOriginM:{label:'Начало модели',shape:'vector',unit:'м'},
 };
 const groups={camera:'Камера',render:'Рендер',material:'Покрытие',input:'Управление',environment:'Среда',mechanics:'Конструкция',scene:'Сцена'};
 function analyze(ts,source){
  const file=ts.createSourceFile('scene.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  // A checker resolves lexical scope, including shadowed constants. No regex symbol lookup.
  const host={getSourceFile:n=>n==='scene.ts'?file:undefined,getDefaultLibFileName:()=>'',writeFile(){},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:n=>n==='scene.ts',readFile:n=>n==='scene.ts'?source:undefined,getCanonicalFileName:n=>n,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
  const checker=ts.createProgram(['scene.ts'],{noLib:true,noResolve:true},host).getTypeChecker();
  const bindings=[],seen=new Map();
  const propName=n=>ts.isIdentifier(n)||ts.isStringLiteral(n)?n.text:'';
  function context(node){
   const props=[],calls=[];for(let n=node.parent;n;n=n.parent){
    if(ts.isPropertyAssignment(n))props.unshift(propName(n.name));
    if(ts.isCallExpression(n)){const name=n.expression.getText(file);const first=n.arguments[0];calls.push({name,id:first&&(ts.isStringLiteral(first)||name==='assembly'&&ts.isIdentifier(first))?first.text:'',node:n});}
   }
   const paths=props.join('.'),names=calls.map(c=>c.name);
   const group=paths.includes('rendering')?'render':paths.includes('paint')||paths.includes('material')?'material':paths.includes('controls')||paths.includes('timeline')?'input':paths.includes('environment')||paths.includes('air')?'environment':names.some(n=>['chassis','roadWheels','wing','wheel','vehicle'].includes(n))?'mechanics':'scene';
   const call=calls.find(c=>c.id)||calls.find(c=>!['scene'].includes(c.name));
   return {group,where:call?(call.id||call.name):'',path:paths};
  }
  function resolve(node,visited=new Set()){
   if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node))return resolve(node.expression,visited);
   if(ts.isIdentifier(node)){
    const d=checker.getSymbolAtLocation(node)?.valueDeclaration;
    if(d&&ts.isVariableDeclaration(d)&&d.initializer&&(d.parent.flags&ts.NodeFlags.Const)&&!visited.has(d))return resolve(d.initializer,new Set([...visited,d]));
    return null;
   }
   const start=node.getStart(file),end=node.end,raw=source.slice(start,end);
   if(ts.isNumericLiteral(node))return {start,end,raw,value:Number(node.text),shape:'number'};
   if(ts.isPrefixUnaryExpression(node)&&[ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(node.operator)&&ts.isNumericLiteral(node.operand))return {start,end,raw,value:(node.operator===ts.SyntaxKind.MinusToken?-1:1)*Number(node.operand.text),shape:'number'};
   if(node.kind===ts.SyntaxKind.TrueKeyword||node.kind===ts.SyntaxKind.FalseKeyword)return {start,end,raw,value:node.kind===ts.SyntaxKind.TrueKeyword,shape:'boolean'};
   if(ts.isStringLiteral(node))return {start,end,raw,value:node.text,shape:'select'};
   if(ts.isArrayLiteralExpression(node)&&node.elements.length>=2&&node.elements.length<=4){
    const elements=node.elements.map(e=>resolve(e,visited));
    if(elements.every(e=>e?.shape==='number')&&new Set(elements.map(e=>e.start)).size===elements.length)return {start,end,raw,value:elements.map(e=>e.value),shape:'vector',elements};
   }
   return null;
  }
  function add(node,config,ctx,key){
   const v=resolve(node),at=node.getStart(file),editable=!!v&&config.shape!==undefined&&(config.shape===v.shape||(config.shape==='color'&&v.shape==='vector'&&v.value.length>=3));
   const start=v?.start??at,end=v?.end??node.end;
   const rangeKey=start+':'+end;
   if(seen.has(rangeKey)){seen.get(rangeKey).uses++;return;}
   const item={...config,...ctx,key,id:key+':'+at,start,end,raw:source.slice(start,end),value:v?.value??node.getText(file),editable,uses:1,line:file.getLineAndCharacterOfPosition(start).line+1};
   if(v?.elements)item.elements=v.elements;
   if(!editable)item.reason='Выражение — измените его в коде. Оно не заменяется вычисленным числом.';
   bindings.push(item);seen.set(rangeKey,item);
  }
  function visit(n){
   if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&n.name.text==='wingsEnabled')add(n.initializer,meta.wingsEnabled,{group:'mechanics',where:'vehicle',path:''},'wingsEnabled');
   if(ts.isPropertyAssignment(n)&&propName(n.name)==='kind'&&context(n).group==='material')add(n.initializer,choices('Материал',['steel','aluminum','glass','rubber','wood','concrete','asphalt','plastic','snow','ice']),context(n),'kind');
   if((ts.isPropertyAssignment(n)||ts.isShorthandPropertyAssignment(n))&&meta[propName(n.name)]){
    const key=propName(n.name),config=meta[key],node=ts.isPropertyAssignment(n)?n.initializer:n.name;
    add(node,config,context(n),key);
   }
   if(ts.isCallExpression(n)&&n.expression.getText(file)==='orbit'){
    const configs=[{label:'Цель камеры',shape:'vector',unit:'м'},number('Расстояние',2,60,.1,'м'),number('Поворот',-Math.PI,Math.PI,.01,'рад'),number('Высота взгляда',-.1,1.45,.01,'рад'),number('Поле зрения',15,85,1,'°')];
    n.arguments.forEach((arg,i)=>{if(configs[i])add(arg,configs[i],{group:'camera',where:'orbit',path:'camera'},'orbit.'+i);});
   }
   ts.forEachChild(n,visit);
  }
  visit(file);
  const scan=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,source),tokens=[];let token;
  while((token=scan.scan())!==ts.SyntaxKind.EndOfFileToken){
   const cls=token===ts.SyntaxKind.SingleLineCommentTrivia||token===ts.SyntaxKind.MultiLineCommentTrivia?'comment':token===ts.SyntaxKind.StringLiteral||token===ts.SyntaxKind.NoSubstitutionTemplateLiteral?'string':token===ts.SyntaxKind.NumericLiteral?'number':token>=ts.SyntaxKind.FirstKeyword&&token<=ts.SyntaxKind.LastKeyword?'keyword':'';
   if(cls)tokens.push([scan.getTokenPos(),scan.getTextPos(),cls]);
  }
  const occurrences=new Map();for(const b of bindings){const key=[b.group,b.where,b.path,b.key].join('/'),i=occurrences.get(key)??0;occurrences.set(key,i+1);b.id=key+'/'+i;}
  return {bindings:bindings.slice(0,120),tokens,groups};
 }
 function editsFor(source,binding,value){
  if(!binding.editable)throw new TypeError('Expression is read-only');
  if(source.slice(binding.start,binding.end)!==binding.raw)throw new Error('Source changed; wait for binding refresh');
  const literal=(v,shape)=>{
   if(shape==='number'){if(!Number.isFinite(v))throw new TypeError('Expected finite number');return String(Number(v.toPrecision(12)));}
   if(shape==='boolean'){if(typeof v!=='boolean')throw new TypeError('Expected boolean');return String(v);}
   if(typeof v!=='string'||!binding.options?.includes(v))throw new TypeError('Unknown enum value');
   const quote=binding.raw[0]==="'"?"'":'"';return quote+v.replaceAll('\\','\\\\').replaceAll(quote,'\\'+quote)+quote;
  };
  if(binding.elements){
   if(!Array.isArray(value)||value.length!==binding.elements.length)throw new TypeError('Vector shape mismatch');
   return binding.elements.map((e,i)=>{if(source.slice(e.start,e.end)!==e.raw)throw new Error('Source changed');return {from:e.start,to:e.end,insert:literal(value[i],'number')};}).filter((e,i)=>value[i]!==binding.elements[i].value);
  }
  const insert=literal(value,binding.shape);
  return value===binding.value?[]:[{from:binding.start,to:binding.end,insert}];
 }
 function applyEdits(source,edits){
  let previous=source.length+1;for(const e of [...edits].sort((a,b)=>b.from-a.from)){if(e.to>previous||e.from<0||e.to<e.from||e.to>source.length)throw new RangeError('Overlapping/invalid edits');source=source.slice(0,e.from)+e.insert+source.slice(e.to);previous=e.from;}return source;
 }
 const api={analyze,editsFor,applyEdits,meta,groups};
 if(typeof module!=='undefined')module.exports=api;else scope.DSLBindings=api;
})(globalThis);
