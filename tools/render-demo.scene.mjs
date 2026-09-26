export const scene={
  version:1,seed:42,gravity:[0,-9.81,0],ground:0,clearColor:[0.025,0.03,0.04,1],
  camera:{position:[7,3.7,8.5],target:[0,1.0,0],fov:41.2,focusDistance:10,aperture:0.02},
  rendering:{sunDirection:[-0.45,-1,-0.3],sunColor:[1,0.93,0.82],sunIntensity:3.2,skyColor:[0.18,0.23,0.32],exposure:1.05,shadowExtent:40,fogDensity:0.006},
  entities:[
    {id:'ground',position:[0,-0.08,0],mesh:{kind:'plane',size:[24,24]},material:{color:[0.055,0.065,0.075,1],roughness:0.82,metalness:0}},
    {id:'platform',position:[0,0.04,0],mesh:{kind:'box',size:[9,0.12,6]},material:{color:[0.12,0.13,0.15,1],roughness:0.42,metalness:0.15}},
    {id:'body',position:[0,1.0,0],mesh:{kind:'box',size:[3.9,0.82,1.8]},material:{color:[0.72,0.035,0.025,1],roughness:0.22,metalness:0.72,clearcoat:0.85,clearcoatRoughness:0.08}},
    {id:'hood',position:[1.15,1.43,0],mesh:{kind:'box',size:[1.65,0.18,1.72]},material:{color:[0.62,0.025,0.02,1],roughness:0.2,metalness:0.75,clearcoat:0.9,clearcoatRoughness:0.06}},
    {id:'roof',position:[-0.35,1.72,0],mesh:{kind:'box',size:[1.65,0.16,1.55]},material:{color:[0.055,0.065,0.075,1],roughness:0.14,metalness:0.35,clearcoat:0.65}},
    {id:'glass',position:[-0.35,1.81,0],mesh:{kind:'box',size:[1.72,0.13,1.42]},material:{color:[0.025,0.08,0.11,0.9],roughness:0.08,metalness:0.55,clearcoat:0.95}},
    {id:'front',position:[2.01,1.05,0],mesh:{kind:'box',size:[0.08,0.48,1.5]},material:{color:[0.055,0.065,0.07,1],roughness:0.28,metalness:0.8}},
    {id:'grille',position:[2.055,1.02,0],mesh:{kind:'box',size:[0.025,0.34,0.82]},material:{color:[0.008,0.009,0.01,1],roughness:0.16,metalness:0.92}},
    {id:'wheelFL',position:[1.28,0.55,0.98],mesh:{kind:'torus',radius:0.43,tube:0.14,segments:32},rotation:[Math.PI/2,0,0],material:{color:[0.018,0.02,0.023,1],roughness:0.36,metalness:0.25}},
    {id:'wheelFR',position:[1.28,0.55,-0.98],mesh:{kind:'torus',radius:0.43,tube:0.14,segments:32},rotation:[Math.PI/2,0,0],material:{color:[0.018,0.02,0.023,1],roughness:0.36,metalness:0.25}},
    {id:'wheelRL',position:[-1.28,0.55,0.98],mesh:{kind:'torus',radius:0.43,tube:0.14,segments:32},rotation:[Math.PI/2,0,0],material:{color:[0.018,0.02,0.023,1],roughness:0.36,metalness:0.25}},
    {id:'wheelRR',position:[-1.28,0.55,-0.98],mesh:{kind:'torus',radius:0.43,tube:0.14,segments:32},rotation:[Math.PI/2,0,0],material:{color:[0.018,0.02,0.023,1],roughness:0.36,metalness:0.25}},
    {id:'lampL',position:[2.1,1.22,0.57],mesh:{kind:'box',size:[0.06,0.22,0.34]},material:{color:[0.72,0.82,0.9,1],roughness:0.12,metalness:0.5},light:{kind:'point',color:[1,0.82,0.62],intensity:20,range:7}},
    {id:'lampR',position:[2.1,1.22,-0.57],mesh:{kind:'box',size:[0.06,0.22,0.34]},material:{color:[0.72,0.82,0.9,1],roughness:0.12,metalness:0.5},light:{kind:'point',color:[1,0.82,0.62],intensity:20,range:7}},
    {id:'backWall',position:[-1.5,2.7,-4],mesh:{kind:'box',size:[9,5.5,0.2]},material:{color:[0.07,0.075,0.085,1],roughness:0.7,metalness:0.05}},
    {id:'lightBar',position:[-0.8,4.7,1.5],mesh:{kind:'box',size:[4.5,0.08,0.35]},material:{color:[0.8,0.82,0.86,1],roughness:0.2,metalness:0.1},light:{kind:'point',color:[0.75,0.85,1],intensity:35,range:9}}
  ]
};

if(typeof window!=='undefined'){
  try{
    const {BrowserRuntime}=await import('/dist/browser.js');
    const canvas=document.getElementById('c');
    canvas.width=innerWidth;canvas.height=innerHeight;
    const runtime=await BrowserRuntime.create(canvas,scene,{autoplay:false,audio:false,exposeBridge:true});
    globalThis.__CAPTURE__=()=>runtime.capture('image/png');
    document.documentElement.dataset.engineReady='1';
  }catch(error){window.__ENGINE_ERROR__=error?.stack??String(error);throw error}
}
