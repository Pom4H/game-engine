const paintRoughness=[.105,.13,.16,.20];
const clearcoatRoughness=[.055,.08,.11];
const exposure=[.96,1.02];

// Capture the unpatched production scene first. The report's hero_gap output
// must describe what users see, rather than the first experimental material.
// One face per frame: six probe faces, then two frames with complete radiance.
const captures=[{id:'production',time:0,frames:8,patch:{}}];
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

// Road-tone candidates test a large, visually important part of the reference
// without changing the underlying surface physics or shader path.
for(const shade of [.140,.180,.220,.260,.300,.360,.440]){
  const color=[shade,shade+.003,shade+.007,1];
  captures.push({id:`road-${String(shade).replace('.','_')}`,time:0,frames:2,patch:{materials:[{id:'road',set:{color}},{id:'hero-road-skin',set:{color}}]},meta:{roadShade:shade}});
}

// Paint tone is tested on the same physically shaded car assembly.
for(const shade of [.290,.340,.400,.460]){
  const color=[shade,shade+.003,shade+.010,1];
  captures.push({id:`paint-${String(shade).replace('.','_')}`,time:0,frames:2,patch:{materials:[{idPrefix:'passing-',treatment:'painted',set:{color}}]},meta:{paintShade:shade}});
}

export default {assetRoot:'../promo',base:'../promo/clear-day.scene.mjs',captures};
