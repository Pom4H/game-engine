import type {Scene} from '../../../src/scene/scene.js';
/** Hide only the editor-owned projection while canonical walking uses the
 * original multi-floor Office meshes. Visibility is restored on return. */
export class OfficeAuthoringVisibility{
 private saved=new Map<string,boolean>();hidden=false;
 constructor(private readonly scene:Scene){}
 setHidden(hidden:boolean,ids:Iterable<string>){
  if(this.hidden===hidden)return;this.hidden=hidden;
  if(hidden){for(const id of ids){const entity=this.scene.entities.get(id);if(!entity)continue;this.saved.set(id,entity.renderVisible!==false);this.scene.setRenderVisible(id,false);}}
  else{for(const [id,visible]of this.saved)if(this.scene.entities.has(id))this.scene.setRenderVisible(id,visible);this.saved.clear();}
 }
 get suppressed(){return this.saved.size;}
}
