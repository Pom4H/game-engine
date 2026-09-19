import type {CameraSpec,SceneSpec} from './types.js';
import {validateScene} from './validate.js';

function bytesToBase64(bytes:Uint8Array):string{let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary);}
function base64ToBytes(base64:string):Uint8Array{const binary=atob(base64);const out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out;}
export function encodeScene(scene:SceneSpec):string{return bytesToBase64(new TextEncoder().encode(JSON.stringify(validateScene(scene)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function decodeScene(token:string):SceneSpec{const base64=token.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-token.length%4)%4);return validateScene(JSON.parse(new TextDecoder().decode(base64ToBytes(base64))));}
export function sceneURL(scene:SceneSpec,base='http://localhost:4173/'):string{const url=new URL(base);url.searchParams.delete('src');url.searchParams.delete('scene');url.hash=`scene=${encodeScene(scene)}`;return url.toString();}

export interface URLSceneOptions { time:number; paused:boolean; camera?:CameraSpec }
export async function sceneFromURL(input:string|URL,fetcher:typeof fetch=fetch):Promise<{scene:SceneSpec;options:URLSceneOptions}>{
  const url=input instanceof URL?input:new URL(input,'http://localhost/');const source=url.searchParams.get('src');let scene:SceneSpec;
  if(source){const resolved=new URL(source,url);const response=await fetcher(resolved);if(!response.ok)throw new Error(`Scene fetch failed: ${response.status} ${response.statusText}`);scene=validateScene(await response.json());}
  else {const hash=new URLSearchParams(url.hash.startsWith('#')?url.hash.slice(1):url.hash);const token=url.searchParams.get('scene')??hash.get('scene');if(!token)throw new Error('URL contains neither ?src= nor scene state');scene=decodeScene(token);}
  const time=Math.max(0,Number(url.searchParams.get('t')??0)||0),paused=url.searchParams.get('play')==='0'||time>0;const camera=parseCamera(url.searchParams.get('camera'));
  return{scene,options:{time,paused,...(camera?{camera}:{})}};
}
function parseCamera(value:string|null):CameraSpec|undefined{if(!value)return;const values=value.split(',').map(Number);if(values.length!==6&&values.length!==7)return;if(values.some(v=>!Number.isFinite(v)))return;return{position:[values[0]!,values[1]!,values[2]!],target:[values[3]!,values[4]!,values[5]!],...(values[6]!==undefined?{fov:values[6]}:{})};}
