// Generic indexed meshes produced by analytic lofts; all dimensions in metres.
const normalize=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sample=(points,x)=>{for(let i=1;i<points.length;i++)if(x<=points[i][0]){const a=points[i-1],b=points[i],t=Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0])));return a[1]+(b[1]-a[1])*(t*t*(3-2*t));}return points.at(-1)[1];};
export function loft(surface,nx=100,ny=48){
 const positions=[],normals=[],indices=[],e=.0003;
 for(let i=0;i<=nx;i++)for(let j=0;j<=ny;j++){
  const u=i/nx,v=j/ny,p=surface(u,v),pa=surface(Math.min(1,u+e),v),pb=surface(Math.max(0,u-e),v),pc=surface(u,v+e),pd=surface(u,v-e);
  const a=pa.map((x,k)=>x-pb[k]),b=pc.map((x,k)=>x-pd[k]),normal=normalize(cross(b,a));positions.push(...p);normals.push(...normal);
  if(i<nx&&j<ny){const a=i*(ny+1)+j,b=a+ny+1;indices.push(a,b,a+1,a+1,b,b+1);}
 }
 return{kind:'triangle-mesh',positions,normals,indices};
}
export function bodyMesh(){return loft((u,v)=>{
 const x=-2.25+u*4.5,t=v*Math.PI*2,curve=Math.sign(Math.cos(t))*Math.pow(Math.abs(Math.cos(t)),.38),side=Math.sign(Math.sin(t))*Math.pow(Math.abs(Math.sin(t)),.33);
 const width=sample([[-2.25,.14],[-2.15,.66],[-1.85,.85],[-.8,.88],[1.6,.87],[2.08,.74],[2.25,.12]],x);
 const top=sample([[-2.25,.67],[-2.10,.86],[-1.75,1.02],[-.80,1.08],[.85,1.07],[1.75,.97],[2.25,.67]],x);
 let bottom=.39;for(const wheel of [-1.36,1.36]){const d=x-wheel;if(Math.abs(d)<.385)bottom=Math.max(bottom,.33+Math.sqrt(.385*.385-d*d));}
 const y=(top+bottom)/2+curve*(top-bottom)/2;return[x,y,side*width];
});}
export function cabinMesh(){return loft((u,v)=>{
 const x=-1.14+u*2.44,t=v*Math.PI*2,roof=x<-.62?1.07+(x+1.14)/.52*.57:x<.61?1.64-(x+.62)/1.23*.03:1.61-(x-.61)/.69*.53,y=1.045+(roof-1.045)*(Math.cos(t)*.5+.5);
 const width=.79-(y-1.045)*.16;return[x,y,Math.sign(Math.sin(t))*Math.pow(Math.abs(Math.sin(t)),.23)*width];
},70,40);}
export function quad(vertices,expected){if(expected){const n=cross(vertices[1].map((v,i)=>v-vertices[0][i]),vertices[2].map((v,i)=>v-vertices[0][i]));if(n.reduce((v,x,i)=>v+x*expected[i],0)<0)vertices=[...vertices].reverse();}const n=normalize(cross(vertices[1].map((v,i)=>v-vertices[0][i]),vertices[2].map((v,i)=>v-vertices[0][i])));return{kind:'triangle-mesh',positions:vertices.flat(),normals:vertices.flatMap(()=>n),indices:[0,1,2,0,2,3]};}
