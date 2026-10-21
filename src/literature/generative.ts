/**
 * Trusted boundary for text-to-WebGPU authoring.
 *
 * A language model returns a proposal, never executable code.
 * The proposal may author visual-only geometry, light and cameras, while
 * physical facts must pass the existing citation/unit contract.
 */
import {compileLiteraryDraft,type LiteraryCompilation,type LiteraryDraft} from './index.js';
import {validateScene} from '../scene/validate.js';
import type {SceneSpec,RenderingSpec} from '../scene/types.js';

export interface GenerativeLiteraryDraft extends LiteraryDraft {
  readonly rendering?:Partial<RenderingSpec>;
}

const MAX_TEXT=50_000;
const MATERIALS=new Set(['default','glass','steel','wood','concrete','asphalt','snow',
  'rubber','plastic','aluminum','mirror']);
function fail(reason:string):never{throw new TypeError('Literary model: '+reason);}
function obj(value:unknown,label:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail(label+' must be an object');
  return value as Record<string,unknown>;
}
function allowed(value:Record<string,unknown>,keys:readonly string[],label:string):void{
  for(const key of Object.keys(value))if(!keys.includes(key))fail(label+' cannot set '+key);
}
function n(value:unknown,label:string,min=-1000,max=1000):number{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(label+' out of bounds');
  return value;
}
function vec(value:unknown,label:string,min=-1000,max=1000,length=3):void{
  if(!Array.isArray(value)||value.length!==length)fail(label+' must be a '+length+'-vector');
  value.forEach((v:unknown,i:number)=>n(v,label+'['+i+']',min,max));
}
function visual(candidate:unknown):void{
  const wrapper=obj(candidate,'visual');
  allowed(wrapper,['claimId','entity'],'visual');
  const e=obj(wrapper.entity,'visual.entity');
  allowed(e,['id','position','rotation','scale','mesh','material','renderOnly','light'],'visual.entity');
  if(e.renderOnly!==true)fail('model entities must be renderOnly');
  if(typeof e.id!=='string'||!(/^[a-z][a-z0-9-]{0,79}$/u).test(e.id))
    fail('visual.entity.id must be a stable lowercase ID');
  if(e.position!==undefined)vec(e.position,'position',-1000,1000);
  if(e.rotation!==undefined)vec(e.rotation,'rotation',-Math.PI*2,Math.PI*2);
  if(e.scale!==undefined)vec(e.scale,'scale',0.001,100);
  if(e.mesh!==undefined){
    const mesh=obj(e.mesh,'visual.mesh');
    if(mesh.kind==='box'){
      allowed(mesh,['kind','size'],'mesh.box');
      vec(mesh.size,'mesh.box.size',0.005,500);
    }else if(mesh.kind==='plane'){
      allowed(mesh,['kind','size'],'mesh.plane');
      vec(mesh.size,'mesh.plane.size',0.005,500,2);
    }else if(mesh.kind==='sphere'){
      allowed(mesh,['kind','radius','segments'],'mesh.sphere');
      n(mesh.radius,'sphere radius',0.005,200);
      if(mesh.segments!==undefined)n(mesh.segments,'sphere segments',8,32);
    }else if(mesh.kind==='cylinder'){
      allowed(mesh,['kind','radius','height','topRadius','segments'],'mesh.cylinder');
      n(mesh.radius,'cylinder radius',0.005,200);
      n(mesh.height,'cylinder height',0.005,500);
      if(mesh.topRadius!==undefined)n(mesh.topRadius,'cylinder topRadius',0,200);
      if(mesh.segments!==undefined)n(mesh.segments,'cylinder segments',8,32);
    }else fail('visual mesh must be box, plane, sphere or cylinder');
  }
  if(e.material!==undefined){
    const material=obj(e.material,'visual.material');
    allowed(material,['kind','color','roughness','metalness','emissive'],'visual.material');
    if(material.kind!==undefined&&!MATERIALS.has(String(material.kind)))fail('unknown visual material');
    if(material.color!==undefined)vec(material.color,'material.color',0,1,4);
    if(material.roughness!==undefined)n(material.roughness,'roughness',0,1);
    if(material.metalness!==undefined)n(material.metalness,'metalness',0,1);
    if(material.emissive!==undefined)vec(material.emissive,'emissive',0,8);
  }
  if(e.light!==undefined){
    const light=obj(e.light,'visual.light');
    allowed(light,['kind','color','intensity','range'],'visual.light');
    if(light.kind!=='point')fail('only point light projections supported');
    if(light.color!==undefined)vec(light.color,'light.color',0,1);
    if(light.intensity!==undefined)n(light.intensity,'light.intensity',0,30);
    if(light.range!==undefined)n(light.range,'light.range',0.01,500);
  }
  if(e.mesh===undefined&&e.light===undefined)fail('visual entity needs geometry or light');
}
function style(value:unknown):Partial<RenderingSpec>{
  const candidate=obj(value,'rendering');
  allowed(candidate,['sunDirection','sunColor','skyColor','backgroundColor',
    'ambientIrradiance','fogColor','sunIntensity','fogDensity','exposure','shadowExtent'],'rendering');
  for(const key of ['sunDirection','sunColor','skyColor','backgroundColor',
    'ambientIrradiance','fogColor'] as const){
    if(candidate[key]!==undefined)vec(candidate[key],key,key==='sunDirection'?-1:0,
      key==='sunDirection'?1:10);
  }
  if(candidate.sunIntensity!==undefined)n(candidate.sunIntensity,'sunIntensity',0,40);
  if(candidate.fogDensity!==undefined)n(candidate.fogDensity,'fogDensity',0,1);
  if(candidate.exposure!==undefined)n(candidate.exposure,'exposure',0,12);
  if(candidate.shadowExtent!==undefined)n(candidate.shadowExtent,'shadowExtent',0.1,2000);
  return candidate as Partial<RenderingSpec>;
}

/**
 * User text is injected from trusted IO, never accepted from the model as a
 * different source. Unexpected model properties are rejected, not ignored.
 */
export function compileGeneratedLiterature(
  source:string,proposal:unknown,baseline?:SceneSpec,
):LiteraryCompilation{
  if(typeof source!=='string'||source.length<2||source.length>MAX_TEXT)
    fail('original text must contain 2..50000 characters');
  const draft=obj(proposal,'proposal');
  allowed(draft,['version','source','claims','facts','visuals','shots','rendering'],'proposal');
  if(draft.source!==source)fail('model returned text that differs from the original');
  if(!Array.isArray(draft.visuals)||draft.visuals.length>160)fail('at most 160 visual entities');
  for(const item of draft.visuals)visual(item);
  if(!Array.isArray(draft.shots)||draft.shots.length<1||draft.shots.length>4)
    fail('model must return 1..4 cameras');
  for(const raw of draft.shots){
    const shot=obj(raw,'shot');
    allowed(shot,['id','camera'],'shot');
    const camera=obj(shot.camera,'shot.camera');
    allowed(camera,['position','target','fov'],'shot.camera');
    vec(camera.position,'camera.position',-2000,2000);
    vec(camera.target,'camera.target',-2000,2000);
    if(camera.fov!==undefined)n(camera.fov,'camera.fov',5,140);
  }
  const visualStyle=draft.rendering===undefined?{}:style(draft.rendering);
  const world:SceneSpec=baseline??{
    version:1,seed:42,ground:-100,
    environment:{temperatureC:10,snowfall:'none'},
    entities:[],
    rendering:{skyColor:[0.12,0.16,0.22],ambientIrradiance:[0.18,0.19,0.23]},
  };
  const compiled=compileLiteraryDraft(draft,world);
  if(!compiled.scene.entities.length)fail('no visible world was generated');
  const scene=validateScene({...compiled.scene,
    rendering:{...compiled.scene.rendering,...visualStyle},
    camera:compiled.shots[0]!.camera,
  });
  return {...compiled,scene};
}
