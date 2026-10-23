import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';

export async function startTeaServer({root,planPath,audioPath,port=0}){
  root=resolve(root);
  const mime={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.wav':'audio/wav'};
  const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://127.0.0.1');let path;
    if(url.pathname==='/'){res.writeHead(302,{location:'/tools/tea-scene/player.html'});res.end();return;}
    if(url.pathname==='/plan.json')path=planPath;
    else if(url.pathname==='/dialogue.wav')path=audioPath;
    else if(url.pathname.startsWith('/assets/'))path=resolve(root,'tools/promo',url.pathname.slice(1));
    else if(/^\/(dist|tools\/tea-scene|tools\/promo)\//.test(url.pathname))path=resolve(root,'.'+url.pathname);
    else{res.writeHead(404);res.end();return;}
    if(path!==planPath&&path!==audioPath&&!path.startsWith(root+sep)){res.writeHead(404);res.end();return;}
    res.setHeader('content-type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(path));
  }catch(error){res.writeHead(500);res.end(String(error));}});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  return server;
}
