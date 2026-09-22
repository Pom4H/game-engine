const paintRoughness=[.105,.13,.16,.20];
const clearcoatRoughness=[.055,.08,.11];
const exposure=[.96,1.02];

const captures=[];
for(const pr of paintRoughness)for(const cr of clearcoatRoughness)for(const ex of exposure){
  const id=`p${String(pr).replace('.','_')}-c${String(cr).replace('.','_')}-e${String(ex).replace('.','_')}`;
  captures.push({
    id,time:0,frames:2,
    patch:{
      rendering:{exposure:ex},
      materials:[{idPrefix:'passing-',treatment:'painted',set:{roughness:pr,clearcoatRoughness:cr}}],
    },
    meta:{paintRoughness:pr,clearcoatRoughness:cr,exposure:ex},
  });
}

export default {assetRoot:'../promo',base:'../promo/clear-day.scene.mjs',captures};
