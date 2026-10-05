import {characterSpec} from '../../dist/characters/character.js';
export const DRAFT_KEY='rom4.character-creator.v1';
const keys=new Set(['body.height','body.shoulders','body.hips','body.torso','body.arms','body.legs','body.build','outfit.top','outfit.bottom','outfit.shoes','outfit.scarf','colors.skin','colors.hair','colors.top','colors.bottom','colors.shoes','colors.scarf','hairStyle','expression','seed']);
export const readPath=(spec,path)=>path.split('.').reduce((value,key)=>value[key],spec);
export function changedSpec(spec,path,value){
  if(!keys.has(path))throw new TypeError('Неизвестный параметр');
  const next=structuredClone(spec),parts=path.split('.');let target=next;
  for(const key of parts.slice(0,-1))target=target[key];target[parts.at(-1)]=value;
  return characterSpec(next);
}
export function parseCharacterJSON(text){
  if(typeof text!=='string'||text.length>65536)throw new RangeError('Файл параметров не должен превышать 64 КБ');
  return characterSpec(JSON.parse(text));
}
/** The editor keeps only 30 committed steps; slider input coalesces until change. */
export class CharacterHistory {
  constructor(spec){this.items=[characterSpec(spec)];this.index=0;}
  push(spec){
    const next=characterSpec(spec);if(JSON.stringify(next)===JSON.stringify(this.items[this.index]))return;
    this.items.splice(this.index+1);this.items.push(next);if(this.items.length>30)this.items.shift();this.index=this.items.length-1;
  }
  undo(){if(this.index>0)this.index--;return structuredClone(this.items[this.index]);}
  redo(){if(this.index<this.items.length-1)this.index++;return structuredClone(this.items[this.index]);}
  get canUndo(){return this.index>0;}get canRedo(){return this.index<this.items.length-1;}
}
export function characterTypeScript(spec){
  return "import {compileCharacter,type CharacterSpec,type SceneSpec} from '@rom4/game-engine';\n\n"+
    "export const character = "+JSON.stringify(characterSpec(spec),null,2)+" satisfies CharacterSpec;\n\n"+
    "const actor = compileCharacter(character);\n\n"+
    "export const scene = {\n  version: 1,\n  entities: actor.entities,\n  animation: {walkers: [actor.walker]},\n} satisfies SceneSpec;\n\nexport default scene;\n";
}
