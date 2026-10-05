import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
function revision(){
  if(process.env.GITHUB_SHA)return process.env.GITHUB_SHA;
  try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return 'local';}
}
export async function startServer({port=4174,host='127.0.0.1'}={}){
  if(!existsSync(resolve(root,'dist/characters/character.js')))throw new Error('Сначала собери движок: bun run build');
  const meta={sourceRevision:revision(),runId:process.env.GITHUB_RUN_ID??null};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??'/','http://localhost');
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
      if(url.pathname==='/meta.json'){
        res.writeHead(200,{'content-type':mime['.json'],'cache-control':'no-store'});res.end(JSON.stringify(meta));return;
      }
      const requested=['/','/characters','/characters/'].includes(url.pathname)?'/tools/character-creator/index.html':decodeURIComponent(url.pathname);
      const prefix=['/dist/','/tools/character-creator/','/licenses/'].find(prefix=>requested.startsWith(prefix));
      if(!prefix){res.writeHead(404);res.end('Not found');return;}
      const path=resolve(root,'.'+requested);
      const allowedRoot=resolve(root,'.'+prefix);
      if(!path.startsWith(allowedRoot+sep)){res.writeHead(403);res.end();return;}
      const data=await readFile(path);
      res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(error){res.writeHead(error.code==='ENOENT'?404:400);res.end('Unable to read requested file');}
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,host,yes);});return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const port=Number(process.env.PORT??4174),host=process.env.HOST??'127.0.0.1';
  const server=await startServer({port,host});console.log(`Конструктор персонажа: http://${host}:${server.address().port}/characters/`);
}
