import {createServer,type Server} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {dirname,extname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScene} from '../scene/validate.js';
import type {SceneSpec} from '../scene/types.js';

export interface LocalSceneServerOptions {
  readonly port?:number;
  /** Local material paths are rooted at the directory containing the scene file. */
  readonly sceneDirectory?:string;
  readonly distributionDirectory?:string;
}
export interface HostedScene {server:Server;port:number;url:string;close():Promise<void>}
interface LocalAssets {root:string;files:ReadonlyMap<string,string>}
const ORIGIN='http://scene-assets.invalid/';
const HTML=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Game Engine</title><style>html,body,canvas{width:100%;height:100%;margin:0;display:block;background:#07101a;overflow:hidden}#badge{position:fixed;left:12px;top:12px;font:12px ui-monospace,monospace;color:#dfe8f5;background:#07101acc;padding:7px 9px;border:1px solid #ffffff20;z-index:2}</style></head><body><div id="badge">GAME ENGINE · WebGPU</div><canvas data-game-engine></canvas><script type="module" src="/dist/browser-entry.js"></script></body></html>`;

/** Hosts only validated scene data, engine modules and explicitly referenced local
 * material images. A scene never grants directory-wide file serving permission. */
export async function serveScene(input?:SceneSpec,options:LocalSceneServerOptions={}):Promise<HostedScene>{
  const scene=input?validateScene(input):undefined;
  const assets=await localAssets(scene,options.sceneDirectory??process.cwd());
  const distribution=await realpath(options.distributionDirectory??resolve(dirname(fileURLToPath(import.meta.url)),'..'));
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;res.setHeader('allow','GET, HEAD');res.end('Method not allowed');return;}
      const url=new URL(req.url??'/',ORIGIN),path=decodeURIComponent(url.pathname);
      if(path.includes('\0')||path.includes('\\')){res.statusCode=400;res.end('Invalid URL');return;}
      res.setHeader('x-content-type-options','nosniff');
      if(path==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(HTML);return;}
      if(path==='/scene.json'&&scene){res.setHeader('content-type','application/json');res.end(JSON.stringify(scene));return;}
      const asset=assets.files.get(path),module=path.startsWith('/dist/')?resolve(distribution,path.slice('/dist/'.length)):undefined;
      const file=asset??module;
      if(!file){res.statusCode=404;res.end('Not found');return;}
      const root=asset?assets.root:distribution;
      // Recheck canonical containment so replacing a directory with a symlink
      // after startup cannot widen the explicitly granted asset tree.
      const canonical=await realpath(file);
      if(!inside(root,canonical)||!(await stat(canonical)).isFile()){res.statusCode=404;res.end('Not found');return;}
      const data=await readFile(canonical);res.setHeader('content-type',mime(canonical));res.setHeader('content-length',data.length);res.end(data);
    }catch(error){
      res.statusCode=error instanceof URIError||error instanceof TypeError?400:(error as NodeJS.ErrnoException).code==='ENOENT'||(error as NodeJS.ErrnoException).code==='ENOTDIR'?404:500;
      res.end(res.statusCode===400?'Invalid URL':res.statusCode===404?'Not found':'Unable to read scene asset');
    }
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Unable to resolve server address');
  const base=`http://127.0.0.1:${address.port}/`;
  return{server,port:address.port,url:scene?`${base}?src=/scene.json`:base,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}

async function localAssets(scene:SceneSpec|undefined,directory:string):Promise<LocalAssets>{
  const urls=new Set<string>();
  for(const entity of scene?.entities??[]){
    if(entity.material?.texture)urls.add(entity.material.texture.url);
    if(entity.environmental?.snowMaterial?.texture)urls.add(entity.environmental.snowMaterial.texture.url);
  }
  for(const surface of scene?.surfaceContacts?.snow??[])if(surface.material?.texture)urls.add(surface.material.texture.url);
  const root=await realpath(directory),files=new Map<string,string>();
  for(const url of urls){
    // Absolute and protocol-relative network URLs retain normal browser/CORS
    // semantics; they do not authorize a local file or a server-side fetch.
    if(/^https?:\/\//i.test(url)||url.startsWith('//'))continue;
    let path:string,local:string;
    try{path=decodeURIComponent(new URL(url,ORIGIN).pathname);local=decodeURIComponent(url.split(/[?#]/,1)[0]!);}
    catch{throw new TypeError(`Invalid local material asset URL: ${url}`);}
    if(path==='/'||path==='/scene.json'||path==='/dist'||path.startsWith('/dist/'))throw new TypeError(`Local material asset uses a reserved engine URL: ${url}`);
    if(/[\0\\]/.test(local))throw new TypeError(`Invalid local material asset path: ${url}`);
    const candidate=resolve(root,local.replace(/^\/+/,''));
    if(!inside(root,candidate))throw new TypeError(`Local material asset must remain inside the scene directory: ${url}`);
    const canonical=await realpath(candidate);
    if(!inside(root,canonical))throw new TypeError(`Local material asset symlink leaves the scene directory: ${url}`);
    if(!(await stat(canonical)).isFile())throw new TypeError(`Local material asset must be a file: ${url}`);
    if(files.has(path)&&files.get(path)!==canonical)throw new TypeError(`Conflicting local material asset URL: ${url}`);
    files.set(path,canonical);
  }
  return{root,files};
}
function inside(root:string,path:string):boolean{const suffix=relative(root,path);return suffix!==''&&!isAbsolute(suffix)&&suffix!=='..'&&!suffix.startsWith(`..${sep}`);}
function mime(file:string):string{
  const types:Record<string,string>={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.map':'application/json','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.bmp':'image/bmp','.svg':'image/svg+xml','.ico':'image/x-icon','.wasm':'application/wasm'};
  return types[extname(file).toLowerCase()]??'application/octet-stream';
}
