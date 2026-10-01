// Bevelled granite setts: shared mesh per road, seeded colour and relief.
export function cobbledRoad(x0,x1,z0,z1,seed=311,exclude=()=>false){
 const positions=[],normals=[],indices=[],colors=[];
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 function face(points,tone){
  const a=points[1].map((x,k)=>x-points[0][k]),b=points[2].map((x,k)=>x-points[0][k]);
  const normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...normal),offset=positions.length/3;
  for(const p of points){positions.push(...p);normals.push(...normal.map(x=>x/length));colors.push(tone,tone*.985,tone*.95,1);}
  indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
 }
 for(let row=0,z=z0+.145;z<z1-.1;row++,z+=.29)for(let x=x0+.19+(row%2)*.19;x<x1-.16;x+=.38){
  if(exclude(x,z))continue;
  const width=.352+(random()-.5)*.012,depth=.263+(random()-.5)*.01,top=.010+(random()-.5)*.012,tone=.66+random()*.31;
  const ring=(w,d,y)=>[[-w,y,-d],[-w,y,d],[w,y,d],[w,y,-d]].map(p=>[x+p[0],p[1],z+p[2]]);
  const crown=ring(width/2-.013,depth/2-.013,top),edge=ring(width/2,depth/2,top-.011),bottom=ring(width/2,depth/2,-.028);
  face(crown,tone);
  for(let i=0;i<4;i++){const j=(i+1)%4;face([crown[i],edge[i],edge[j],crown[j]],tone);face([edge[i],bottom[i],bottom[j],edge[j]],tone*.93);}
 }
 return {kind:'triangle-mesh',positions,normals,indices,colors};
}

export const lanternEmission={axis:[0,-1,0],innerAngle:1.17,outerAngle:1.70,panelCount:4,panelRotation:Math.PI/4,frameWidth:.075};
export function streetLantern(id,x,z){
 const entities=[],iron={kind:'default',color:[.045,.049,.052,1],metalness:.72,roughness:.44};
 const add=(suffix,position,mesh,material=iron,extra={})=>entities.push({id:id+'-'+suffix,position,mesh,material,...extra});
 add('base',[x,.085,z],{kind:'box',size:[.38,.17,.38]});
 add('post',[x,1.76,z],{kind:'cylinder',radius:.064,topRadius:.038,height:3.3,segments:12});
 add('collar',[x,3.35,z],{kind:'cylinder',radius:.115,height:.08,segments:12});
 add('glass',[x,3.70,z],{kind:'cylinder',radius:.20,topRadius:.27,height:.62,segments:4},
  {kind:'default',color:[.72,.65,.48,.13],roughness:.13},{rotation:[0,Math.PI/4,0]});
 add('bulb',[x,3.70,z],{kind:'sphere',radius:.065,segments:12},{kind:'default',color:[1,.88,.68,1],emissive:[10,6.8,3.8],roughness:.3});
 for(let i=0;i<4;i++){
  const a=Math.PI/4+i*Math.PI/2,dx=Math.cos(a)*.23,dz=Math.sin(a)*.23;
  add('rib-'+i,[x+dx,3.70,z+dz],{kind:'cylinder',radius:.015,height:.65,segments:6});
 }
 add('cap',[x,4.09,z],{kind:'cylinder',radius:.34,topRadius:.045,height:.20,segments:4},iron,{rotation:[0,Math.PI/4,0]});
 add('cap-snow',[x,4.15,z],{kind:'snowdrift',size:[.44,.035,.44],seed:Math.round((x+40)*91),segments:10},{kind:'snow',color:[.88,.90,.91,1],roughness:.96});
 entities.push({id:id+'-light',position:[x,3.70,z],light:{kind:'point',color:[1,.70,.40],intensity:23,range:10,emission:lanternEmission}});
 return entities;
}
