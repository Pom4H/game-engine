import type {SceneSpec} from '../../src/scene/types.js';

// Equivalent native SceneSpec authoring; no deliberately verbose wrappers.
export function makeScene():SceneSpec {
  return {
    version:1, seed:42, gravity:[0,-9.81,0], ground:-100,
    entities:[
      {id:'floor', position:[0,-.1,0], mesh:{kind:'box',size:[100,.2,10]}, material:{kind:'concrete'}, body:{}},
      ...Array.from({length:64}, (_,index)=>({
        id:`ball-${index}`, position:[index*.75,3,0] as [number,number,number],
        mesh:{kind:'sphere' as const,radius:.5}, material:{kind:'steel' as const},
        body:{mass:3,motion:'dynamic' as const},
      })),
    ],
  };
}
