import base from '../promo/clear-day.scene.mjs';

const paintRoughness=[.105,.13,.16,.20];
const clearcoatRoughness=[.055,.08,.11];
const exposure=[.96,1.02];

function candidate(pr,cr,exposureValue){
  const scene=structuredClone(base);
  scene.rendering={...scene.rendering,exposure:exposureValue};
  for(const entity of scene.entities){
    if(entity.id.startsWith('passing-')&&entity.material?.treatment==='painted'){
      entity.material={...entity.material,roughness:pr,clearcoatRoughness:cr};
    }
  }
  return scene;
}

const captures=[];
for(const pr of paintRoughness)for(const cr of clearcoatRoughness)for(const ex of exposure){
  const id=`p${String(pr).replace('.','_')}-c${String(cr).replace('.','_')}-e${String(ex).replace('.','_')}`;
  captures.push({id,scene:candidate(pr,cr,ex),time:0,frames:2,meta:{paintRoughness:pr,clearcoatRoughness:cr,exposure:ex}});
}

export default {assetRoot:'../promo',captures};
