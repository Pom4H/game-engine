import type {CameraSpec,SceneSnapshot} from '../scene/types.js';
import type {Scene} from '../scene/scene.js';
export interface RenderStats {backend:'webgpu';width:number;height:number;drawCalls:number;triangles:number;meshes:number;objects?:number;buffers?:number;textures?:number;errors:readonly string[];pointLights?:number;lightOverflow?:number;materialTextures?:number}
export interface Renderer {setResolution?(width:number,height:number):void;prepareMaterials?(scene:Scene):Promise<void>;render(scene:Scene,camera?:CameraSpec):void;resize():void;inspect():RenderStats;flush():Promise<void>;dispose():void}
export interface EngineBridge {snapshot():SceneSnapshot;pause():void;resume():void;step(count?:number):SceneSnapshot;seek(seconds:number):SceneSnapshot;setCamera(camera:CameraSpec):void;render():RenderStats;flush():Promise<void>;inspect():Record<string,unknown>}
