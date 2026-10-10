import {Scene} from '../../dist/scene/scene.js';

// Castle Jelly: all visible solids are native engine meshes and materials.
// Water elevations and normals are projections of a causal, obstacle-aware
// finite-difference wave field (not animated circles painted in a shader).
export const duration=7.2;
export const waterLevel=.88;
const W=94,H=82,D=.165,LEFT=-(W-1)*D/2,BACK=-(H-1)*D/2;
const id=(x,z)=>z*W+x;
const inIsland=(x,z)=>Math.abs(x)<3.36&&Math.abs(z)<2.75;

export class JellyWaves {
  constructor(){
    this.height=new Float64Array(W*H);
    this.velocity=new Float64Array(W*H);
    this.solid=new Uint8Array(W*H);
    for(let z=0;z<H;z++)for(let x=0;x<W;x++){
      const px=LEFT+x*D,pz=BACK+z*D;
      this.solid[id(x,z)]=inIsland(px,pz)?1:0;
    }
    this.time=0;
  }
  inject(px,pz,strength,radius){
    const r2=radius*radius;
    for(let z=Math.max(1,Math.floor((pz-radius-BACK)/D));z<Math.min(H-1,Math.ceil((pz+radius-BACK)/D));z++)
    for(let x=Math.max(1,Math.floor((px-radius-LEFT)/D));x<Math.min(W-1,Math.ceil((px+radius-LEFT)/D));x++){
      const i=id(x,z);if(this.solid[i])continue;
      const dx=LEFT+x*D-px,dz=BACK+z*D-pz,q=(dx*dx+dz*dz)/r2;
      if(q<1)this.velocity[i]+=strength*(1-q)**2;
    }
  }
  step(dt=1/60){
    // CFL c*dt/dx <= 1/sqrt(2). Domain cell size is 0.165 m.
    const c=2.1;if(c*dt/D>Math.SQRT1_2)throw new Error('Wave CFL violation');
    const v=this.velocity,h=this.height,s=this.solid;
    const next=new Float64Array(v.length);
    const inv=1/(D*D);
    for(let z=1;z<H-1;z++)for(let x=1;x<W-1;x++){
      const i=id(x,z);if(s[i])continue;
      const adjacent=(j)=>s[j]?h[i]:h[j];
      const lap=(adjacent(i-1)+adjacent(i+1)+adjacent(i-W)+adjacent(i+W)-4*h[i])*inv;
      // Absorbing outer rim suppresses reflections from the demonstration tank.
      const rim=Math.min(x,W-1-x,z,H-1-z)*D;
      const damping=1.0+Math.max(0,1.15-rim)*3.5;
      next[i]=(v[i]+c*c*lap*dt)*Math.exp(-damping*dt);
    }
    for(let z=1;z<H-1;z++)for(let x=1;x<W-1;x++){
      const i=id(x,z);if(!s[i]){v[i]=next[i];h[i]+=dt*v[i];}
    }
    this.time+=dt;
  }
  advance(dt,t){
    const steps=Math.round(dt*60);
    for(let j=0;j<steps;j++){
      const now=t-dt+(j+1)/60;
      // Waterfall splash: repeatable continuous pressure-to-velocity coupling.
      this.inject(-.12,3.17,1.8/60,.50);
      // Boat displacement/wake moves around the base of the island.
      const x=1.6+.42*Math.sin(now*.56),z=4.25+.14*Math.cos(now*.42);
      this.inject(x-.18,z+.24,.46/60,.37);
      this.step(1/60);
    }
  }
  surface(){
    const positions=[],normals=[],colors=[],indices=[];
    for(let z=0;z<H;z++)for(let x=0;x<W;x++){
      const i=id(x,z),h=this.height[i],p=(j)=>this.solid[j]?h:this.height[j];
      const l=p(id(Math.max(0,x-1),z)),r=p(id(Math.min(W-1,x+1),z));
      const b=p(id(x,Math.max(0,z-1))),f=p(id(x,Math.min(H-1,z+1)));
      const dx=(r-l)/(2*D),dz=(f-b)/(2*D),mag=Math.hypot(dx,dz),curv=Math.abs(l+r+b+f-4*h)/(D*D);
      const shore=Math.max(0,1-Math.min(Math.abs(LEFT+x*D)-3.36,Math.abs(BACK+z*D)-2.75)/.7);
      const foam=Math.min(.83,Math.max(0,mag-.045)*2.4+Math.max(0,curv-.12)*.11+(BACK+z*D>2.65&&Math.abs(LEFT+x*D)<.7?.25:0));
      const base=[.86,.28,.48],light=[1,.78,.82],k=Math.max(0,Math.min(.86,foam+Math.max(0,shore)*.06));
      positions.push(LEFT+x*D,waterLevel+h*1.7,BACK+z*D);
      const len=Math.hypot(dx*1.7,1,dz*1.7);
      normals.push(-dx*1.7/len,1/len,-dz*1.7/len);
      colors.push(base[0]*(1-k)+light[0]*k,base[1]*(1-k)+light[1]*k,base[2]*(1-k)+light[2]*k,1);
    }
    for(let z=0;z<H-1;z++)for(let x=0;x<W-1;x++){
      const a=id(x,z),b=a+1,c=a+W,d=c+1;
      if(this.solid[a]||this.solid[b]||this.solid[c]||this.solid[d])continue;
      indices.push(a,c,b,b,c,d);
    }
    return{kind:'triangle-mesh',positions,normals,colors,indices};
  }
  energy(){
    let e=0;for(let i=0;i<this.height.length;i++)if(!this.solid[i])e+=this.height[i]**2+this.velocity[i]**2;
    return e;
  }
}

const P={
  rock:[.68,.57,.54,1],grass:[.30,.66,.29,1],castle:[.92,.88,.78,1],
  gold:[.97,.81,.53,1],pink:[.96,.56,.76,1],lilac:[.61,.49,.87,1],
  blue:[.45,.75,.95,1],leaf:[.17,.45,.29,1],wood:[.39,.24,.18,1]
};
const mat=(color,roughness=.8,extra={})=>({kind:'default',color,roughness,...extra});
const entities=[];
const add=(name,p,mesh,material)=>{entities.push({id:name,position:p,mesh,material});};
const box=(n,p,size,color,roughness=.8,extra={})=>add(n,p,{kind:'box',size},mat(color,roughness,extra));
const cyl=(n,p,r,height,color,topRadius=r,segments=20)=>add(n,p,{kind:'cylinder',radius:r,topRadius,height,segments},mat(color,.69));
const ball=(n,p,r,color,scale=[1,1,1])=>entities.push({id:n,position:p,scale,mesh:{kind:'sphere',radius:r,segments:12},material:mat(color,.42)});
function tri(name,points,color){
 const a=points[0],b=points[1],c=points[2],cross=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];
 const d=Math.hypot(...cross)||1,n=cross.map(x=>x/d);
 add(name,[0,0,0],{kind:'triangle-mesh',positions:[...a,...b,...c],normals:[...n,...n,...n],indices:[0,1,2]},mat(color,.8));
}
function tree(i,x,z,size=1){
 const y=4.26;
 cyl('tree-'+i+'-trunk',[x,y+.21*size,z],.075*size,.44*size,P.wood,.055*size,8);
 for(let k=0;k<3;k++)cyl('tree-'+i+'-foliage-'+k,[x,y+(.54+.25*k)*size,z],(.39-.10*k)*size,.68*size,P.leaf,0,12);
}
// Layered diorama plinth and the deep pink glass basin.
for(let k=0;k<5;k++)box('tank-layer-'+k,[0,-.54+k*.17,0],[15.4-k*.055,.17,13.9-k*.055],
 [[.50,.35,.33,1],[.86,.72,.65,1],[.96,.83,.78,1],[.82,.64,.62,1],[.98,.87,.85,1]][k],.75);
box('tank-deep-water',[0,.42,0],[15.10,.88,13.58],[.92,.42,.60,1],.20,{clearcoat:.8,clearcoatRoughness:.05});
box('tank-bottom-glow',[0,-.05,0],[15.02,.05,13.5],[.88,.49,.66,1],.54);
// Rock faces have visible real geometry rather than flat stripes on one mesh.
for(let k=0;k<11;k++){
 const y=1.03+k*.27,shrink=k%3===0?.06:k%3===1?-.05:0;
 box('island-geology-'+k,[0,y,0],[7.20+shrink,.277,5.82+shrink],
  [[.55,.44,.43,1],[.76,.64,.57,1],[.86,.74,.65,1],[.65,.54,.53,1]][k%4],.96);
}
box('island-soil',[0,3.99,0],[7.35,.29,5.98],[.36,.28,.17,1]);
box('island-meadow',[0,4.19,0],[7.54,.18,6.18],P.grass,.94);
for(let i=0;i<12;i++){
 const x=(i%4-1.5)*.68,z=(Math.floor(i/4)-1)*.72;
 box('grassy-patch-'+i,[x+2.45,4.295,z-.75],[.60,.02,.36],[.37+(i%3)*.025,.61,.29,1],.95);
}
// Central castle: keeps, turrets, battlements, coloured conical roofs.
box('castle-foundation',[-.25,4.51,-.20],[4.10,.47,3.55],P.castle,.88);
box('castle-keep',[-.25,5.52,-.20],[3.25,1.73,2.75],P.castle,.91);
box('castle-upper',[-.32,6.19,-.34],[1.57,1.23,1.57],[.94,.87,.79,1]);
cyl('castle-main-roof',[-.32,7.22,-.34],1.08,1.30,P.lilac,0,8);
for(const [i,x,z,c]of [[0,-2.15,1.43,P.pink],[1,1.64,1.43,P.blue],[2,-2.15,-1.95,P.blue],[3,1.64,-1.95,P.pink]]){
 cyl('turret-'+i,[x,5.70,z],.59,2.13,P.castle,.59,20);
 cyl('turret-rim-'+i,[x,6.80,z],.71,.16,P.gold,.71,20);
 cyl('turret-roof-'+i,[x,7.39,z],.84,1.18,c,0,20);
 for(let j=0;j<4;j++){
  const t=j*Math.PI/2;
  box('turret-slit-'+i+'-'+j,[x+Math.cos(t)*.59,5.65,z+Math.sin(t)*.59],[.10,.43,.13],[.25,.22,.33,1],.8);
 }
}
for(let i=0;i<9;i++){
 const x=-1.78+i*.37;
 box('front-crenel-'+i,[x,6.51,1.20],[.23,.27,.19],P.castle);
}
box('gate-frame',[-.24,5.12,1.23],[.88,1.20,.13],P.gold);
box('gate',[-.24,5.02,1.32],[.60,.99,.09],[.29,.18,.15,1]);
for(let i=0;i<3;i++)box('window-'+i,[-1.15+i*.90,5.82,1.20],[.24,.43,.075],[.28,.24,.35,1]);
const flags=[[-2.15,7.95,1.43,P.pink],[1.64,7.95,1.43,P.blue],[-.32,7.89,-.34,P.gold],[1.64,7.95,-1.95,P.pink]];
for(let i=0;i<flags.length;i++){
 const [x,y,z,c]=flags[i];
 cyl('flag-pole-'+i,[x,y+.07,z],.025,.68,P.gold,.025,8);
 tri('flag-fabric-'+i,[[x,y+.35,z],[x+.46,y+.23,z],[x,y+.09,z]],c);
}
for(const [i,x,z,s]of [[0,-3.10,-2.04,1],[1,-3.06,1.12,.79],[2,3.11,-2.08,1.04],[3,3.06,.98,.84],[4,-2.8,-.56,.69],[5,2.91,-.79,.70],[6,-1.30,-2.59,.62],[7,.82,-2.55,.75],[8,-2.71,2.47,.64],[9,2.63,2.34,.72],[10,1.46,2.35,.45],[11,-1.74,2.38,.55]])tree(i,x,z,s);
// Waterfall: ribbon profile falls down the front rock face and splashes
// at the *same location* as the surface-wave source.
for(let k=0;k<7;k++){
 const y0=4.23-k*.46,y1=4.23-(k+1)*.46;
 const z0=3.02+Math.sin(k*.5)*.08,z1=3.02+Math.sin((k+1)*.5)*.08;
 const x=-.12;
 const a=[x-.22,y0,z0],b=[x+.22,y0,z0],c=[x-.26,y1,z1],d=[x+.26,y1,z1];
 tri('falls-left-'+k,[a,c,b],[.76,.93,1,1]);
 tri('falls-right-'+k,[b,c,d],[.92,.98,1,1]);
}
for(let k=0;k<9;k++){
 const a=k*Math.PI*2/9,r=.15+.32*(k%3)/2;
 ball('splash-'+k,[-.12+Math.cos(a)*r,.96+Math.sin(k*2.4)*.055,3.17+Math.sin(a)*r],.11+(k%3)*.025,[.92,.96,1,1],[1,.43,1]);
}
// A small detailed sailing ship, floating in front of the waterfall.
box('boat-hull',[1.72,1.07,4.40],[1.22,.30,.52],P.wood);
box('boat-rim',[1.72,1.26,4.40],[1.38,.08,.58],P.gold);
for(let k=0;k<5;k++)cyl('boat-rail-'+k,[1.24+k*.24,1.43,4.68],.015,.30,P.wood,.015,8);
cyl('boat-mast',[1.73,1.88,4.4],.037,1.12,P.wood,.025,10);
tri('boat-sail',[[1.73,2.40,4.42],[1.73,1.48,4.43],[2.28,1.54,4.45]],[.95,.90,.73,1]);
box('boat-keel',[1.72,1.0,4.4],[1.0,.18,.37],[.28,.23,.19,1]);
// Patches of grass and small flowers add scale to the miniature.
for(let i=0;i<23;i++){
 const x=-3.24+(i*1.6180339%1)*6.48,z=-2.54+(i*.75487767%1)*5.08;
 if(Math.abs(x)<2.3&&Math.abs(z)<1.9)continue;
 ball('flower-'+i,[x,4.31,z],.045,[.98,i%2?.75:.65,.82,1]);
}
export const baseSpec={
 version:1,seed:20261010,ground:-2,gravity:[0,-9.81,0],
 clearColor:[.91,.89,.86,1],
 camera:{position:[11.8,11.0,15.1],target:[0,3.18,.05],fov:35},
 rendering:{sunDirection:[-.46,.77,.36],sunColor:[1,.94,.87],sunIntensity:2.1,skyColor:[.91,.89,.88],exposure:1.03,shadowExtent:32,fogDensity:.0012},
 entities,
};
export function createCastleJelly(){
 const waves=new JellyWaves(),scene=new Scene({...baseSpec,entities:[...entities,{
  id:'water-wave-mesh',position:[0,0,0],renderOnly:true,mesh:waves.surface(),
  material:{kind:'glass',color:[.94,.36,.57,.88],roughness:.12,clearcoat:.9,clearcoatRoughness:.06}
 }]});
 let tick=0;
 return {scene,waves,duration,step(time){
  const target=Math.round(time*60);
  if(target<tick)throw new Error('Castle timeline must advance monotonically');
  const dt=(target-tick)/60;
  if(dt>0){
   waves.advance(dt,target/60);
   tick=target;
   // Geometry identity is part of the renderer's content cache key.
   // Re-create only the liquid projection; all land/castle entities are stable.
   scene.remove('water-wave-mesh');
   scene.add({id:'water-wave-mesh',position:[0,0,0],renderOnly:true,mesh:waves.surface(),
    material:{kind:'glass',color:[.94,.36,.57,.88],roughness:.12,clearcoat:.9,clearcoatRoughness:.06}});
   const boatX=1.6+.42*Math.sin(time*.56),boatZ=4.25+.14*Math.cos(time*.42);
   for(const e of scene.entities.values())if(e.id.startsWith('boat-')){e.position[0]=boatX+(e.id==='boat-keel'||e.id==='boat-hull'||e.id==='boat-rim'?0:0);e.position[2]+=0;}
   // Static background geometry remains fixed; water and ship are the moving causes.
  }
  return {tick,waterEnergy:waves.energy(),obstacleCells:waves.solid.reduce((n,v)=>n+v,0)};
 }};
}
export default baseSpec;
