const heli=(id,mesh,position,material={kind:'aluminum',color:[.18,.2,.22,1],roughness:.34})=>({id,collision:'none',mesh,position,material});
const entities=[
  {id:'ground',collision:'none',mesh:{kind:'plane',size:[240,240]},position:[0,0,0],material:{kind:'concrete',color:[.16,.17,.18,1],roughness:.92}},
  {id:'pad',collision:'none',mesh:{kind:'cylinder',radius:8,height:.025,segments:64},position:[0,.015,0],material:{kind:'concrete',color:[.28,.29,.30,1],roughness:.82}},
  heli('heli/cabin',{kind:'box',size:[2.8,1.45,1.55]},[0,1,0],{kind:'aluminum',color:[.16,.22,.28,1],metalness:.55,roughness:.25}),
  heli('heli/nose',{kind:'box',size:[1.1,1.0,1.25]},[1.55,1,0],{kind:'glass',color:[.09,.18,.23,.72],roughness:.08}),
  heli('heli/tail',{kind:'box',size:[5.1,.22,.22]},[-3,1,0]),
  heli('heli/fin',{kind:'box',size:[.9,1.25,.10]},[-5.0,1.45,0]),
  heli('heli/skid-l',{kind:'box',size:[3.8,.08,.08]},[-.1,.15,-.72],{kind:'steel',color:[.08,.09,.1,1],roughness:.35}),
  heli('heli/skid-r',{kind:'box',size:[3.8,.08,.08]},[-.1,.15,.72],{kind:'steel',color:[.08,.09,.1,1],roughness:.35}),
  heli('heli/main-a',{kind:'box',size:[10.4,.035,.26]},[-.2,2.25,0],{kind:'aluminum',color:[.09,.1,.11,1],metalness:.65,roughness:.22}),
  heli('heli/main-b',{kind:'box',size:[10.4,.035,.26]},[-.2,2.25,0],{kind:'aluminum',color:[.09,.1,.11,1],metalness:.65,roughness:.22}),
  heli('heli/tail-a',{kind:'box',size:[1.9,.12,.035]},[-5.0,2.25,0],{kind:'aluminum',color:[.09,.1,.11,1],metalness:.65,roughness:.22}),
];
for(let x=-100;x<=100;x+=20)entities.push({id:`grid-x-${x}`,collision:'none',mesh:{kind:'box',size:[.08,.015,200]},position:[x,.01,0],material:{kind:'default',color:[.25,.26,.27,1],roughness:.9}});
for(let z=-100;z<=100;z+=20)entities.push({id:`grid-z-${z}`,collision:'none',mesh:{kind:'box',size:[200,.015,.08]},position:[0,.01,z],material:{kind:'default',color:[.25,.26,.27,1],roughness:.9}});
export default {
  version:1,ground:-1000,gravity:[0,0,0],clearColor:[.055,.075,.095,1],
  rendering:{sunDirection:[-.35,-1,-.25],sunIntensity:3.2,skyColor:[.32,.43,.56],exposure:1.1,shadowExtent:90,fogDensity:.0015},
  camera:{position:[-14,8,14],target:[0,2,0],fov:42},
  entities,
};
