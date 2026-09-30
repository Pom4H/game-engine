#!/usr/bin/env bun
/** Thin trusted-source CLI over the same project contract; no second project format. */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const args=process.argv.slice(2),command=args.shift();
const schema={check:{arguments:['project.ts'],options:['--preset name'],effect:'read authored configuration; no module factories'},inspect:{arguments:['project.ts'],options:['--preset name'],effect:'start, inspect and dispose a local project'},perft:{arguments:['depth 0..5'],effect:'bounded chess move-tree computation'},serve:{arguments:['[thegame]'],effect:'serve built product; thegame also runs its authoritative multiplayer server'}};
try {
 if(command==='--schema'||command==='schema'){console.log(JSON.stringify(schema,null,2));}
 else if(command==='check'||command==='inspect'){
  const file=args.shift();if(!file)throw Error('Expected project path');let preset;
  if(args.length){if(args.length!==2||args[0]!=='--preset')throw Error('Expected --preset name');preset=args[1];}
  if(file.endsWith('.ts')&&!process.versions.bun)throw Error('TypeScript projects: bun tools/engine.mjs '+command+' '+file);
  const {default:project}=await import(pathToFileURL(resolve(file)).href);
  if(typeof project?.check!=='function'||typeof project?.start!=='function')throw Error('Expected an engine project default export');
  if(command==='check')console.log(JSON.stringify(project.check(preset),null,2));
  else{const runtime=project.start(preset);try{console.log(JSON.stringify(runtime.inspect(),null,2));}finally{runtime.dispose();}}
 }else if(command==='perft'){
  if(args.length!==1||!/^\d$/.test(args[0])||Number(args[0])>5)throw Error('Expected perft depth 0..5');
  const {perft,parsePosition,INITIAL_FEN}=await import('../dist/games/chess.js'),depth=Number(args[0]),start=performance.now(),nodes=perft(parsePosition(INITIAL_FEN),depth);
  console.log(JSON.stringify({depth,nodes,elapsedMs:performance.now()-start}));
 }else if(command==='serve'){
  if(args.length===1&&args[0]==='thegame')await import('./thegame/server.mjs');
  else{if(args.length)throw Error('Expected serve [thegame]; set PORT in the environment');await import('./docs/server.mjs');}
 }else throw Error('Usage: bun cli check|inspect project.ts [--preset name] | perft 4 | serve [thegame] | --schema');
}catch(error){console.error(error.message??String(error));process.exitCode=1;}
