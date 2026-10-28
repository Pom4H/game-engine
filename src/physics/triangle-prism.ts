type V=readonly number[];
type Vec=[number,number,number];
const add=(a:V,b:V):Vec=>[a[0]!+b[0]!,a[1]!+b[1]!,a[2]!+b[2]!],sub=(a:V,b:V):Vec=>[a[0]!-b[0]!,a[1]!-b[1]!,a[2]!-b[2]!],scale=(a:V,s:number):Vec=>[a[0]!*s,a[1]!*s,a[2]!*s],dot=(a:V,b:V)=>a[0]!*b[0]!+a[1]!*b[1]!+a[2]!*b[2]!,cross=(a:V,b:V):Vec=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!],norm=(a:V)=>Math.hypot(a[0]!,a[1]!,a[2]!),unit=(a:V)=>scale(a,1/norm(a));
const PRISM_FACES:readonly(readonly number[])[]=[[0,1,2],[3,5,4],[0,3,4,1],[1,4,5,2],[2,5,3,0]];
const PRISM_EDGES:readonly(readonly[number,number])[]=[[0,1],[1,2],[2,0],[3,4],[4,5],[5,3],[0,3],[1,4],[2,5]];
for(const face of PRISM_FACES)Object.freeze(face);for(const edge of PRISM_EDGES)Object.freeze(edge);Object.freeze(PRISM_FACES);Object.freeze(PRISM_EDGES);
export type TrianglePrism={triangle:readonly[Vec,Vec,Vec];halfThickness:number;vertices:readonly Vec[];normals:readonly Vec[];planes:readonly{n:Vec;offset:number;vertices:readonly number[]}[];edgeDirections:readonly Vec[];edges:typeof PRISM_EDGES;center:Vec;bounds:readonly[number,number,number,number,number,number]};
export type TrianglePrismAdjacency={readonly edges:readonly(readonly TrianglePrism[])[];readonly vertices:readonly(readonly TrianglePrism[])[]};
export type PrismGeometry={p:V;axes:readonly V[];half:V;triangle?:TrianglePrism|null;triangleAdjacency?:TrianglePrismAdjacency};
/** Six corners and five actual material planes; an AABB remains broad phase only. */
export function trianglePrism(triangle:readonly[V,V,V],thickness:number):TrianglePrism|null{
 if(!(thickness>0&&Number.isFinite(thickness))||triangle.some(p=>p.length!==3||!p.every(Number.isFinite)))throw new RangeError('Invalid material triangle prism');
 const [a,b,c]=triangle.map(p=>[...p] as Vec) as [Vec,Vec,Vec],ab=sub(b,a),bc=sub(c,b),ca=sub(a,c),normal=cross(ab,sub(c,a)),area=norm(normal),size=Math.max(dot(ab,ab),dot(bc,bc),dot(ca,ca));if(!(area>64*Number.EPSILON*size))return null;
 const n=scale(normal,1/area),halfThickness=thickness/2,extrude=scale(n,halfThickness),vertices=[add(a,extrude),add(b,extrude),add(c,extrude),sub(a,extrude),sub(b,extrude),sub(c,extrude)],side=[unit(cross(ab,n)),unit(cross(bc,n)),unit(cross(ca,n))],normals=[n,...side],allNormals=[n,scale(n,-1),...side],planes=PRISM_FACES.map((indices,i)=>({n:allNormals[i]!,offset:dot(allNormals[i]!,vertices[indices[0]!]!),vertices:indices})),bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity] as [number,number,number,number,number,number];
 for(const p of vertices)for(let k=0;k<3;k++){bounds[k]=Math.min(bounds[k]!,p[k]!);bounds[k+3]=Math.max(bounds[k+3]!,p[k]!);}
 return{triangle:[a,b,c],halfThickness,vertices,normals,planes,edgeDirections:[unit(ab),unit(bc),unit(ca),n],edges:PRISM_EDGES,center:scale(add(add(a,b),c),1/3),bounds};
}
export function closestTrianglePoint(p:V,a:V,b:V,c:V):{point:Vec;weights:[number,number,number]}{
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);let weights:[number,number,number];
 if(d1<=0&&d2<=0)weights=[1,0,0];else{const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)weights=[0,1,0];else{const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);weights=[1-v,v,0];}else{const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)weights=[0,0,1];else{const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const v=d2/(d2-d6);weights=[1-v,0,v];}else{const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){const v=(d4-d3)/(d4-d3+d5-d6);weights=[0,1-v,v];}else{const inverse=1/(va+vb+vc),v=vb*inverse,w=vc*inverse;weights=[1-v-w,v,w];}}}}}}
 return{weights,point:[0,1,2].map(k=>a[k]!*weights[0]+b[k]!*weights[1]+c[k]!*weights[2]) as Vec};
}
export function prismInside(p:V,prism:TrianglePrism,margin=0){for(const plane of prism.planes)if(dot(p,plane.n)>plane.offset+margin)return false;return true;}
export function prismSupport(prism:TrianglePrism,direction:V):Vec{let extreme=-Infinity,count=0;const p:Vec=[0,0,0];for(const v of prism.vertices){const d=dot(v,direction);if(d>extreme+1e-10){extreme=d;p[0]=v[0];p[1]=v[1];p[2]=v[2];count=1;}else if(Math.abs(d-extreme)<=1e-10){for(let k=0;k<3;k++)p[k]!+=v[k]!;count++;}}return scale(p,1/count);}
function vertices(shape:PrismGeometry):Vec[]{if(shape.triangle)return shape.triangle.vertices as Vec[];const out:Vec[]=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])out.push(add(shape.p,add(scale(shape.axes[0]!,x*shape.half[0]!),add(scale(shape.axes[1]!,y*shape.half[1]!),scale(shape.axes[2]!,z*shape.half[2]!)))));return out;}
function inside(p:V,shape:PrismGeometry,margin=0){if(shape.triangle!==undefined)return !!shape.triangle&&prismInside(p,shape.triangle,margin);const d=sub(p,shape.p);return shape.axes.every((n,k)=>Math.abs(dot(d,n))<=shape.half[k]!+margin);}
function projection(shape:PrismGeometry,axis:V):[number,number]{if(shape.triangle){let lo=Infinity,hi=-Infinity;for(const p of shape.triangle.vertices){const value=dot(p,axis);lo=Math.min(lo,value);hi=Math.max(hi,value);}return[lo,hi];}const center=dot(shape.p,axis),radius=shape.axes.reduce((sum,n,i)=>sum+Math.abs(dot(n,axis))*shape.half[i]!,0);return[center-radius,center+radius];}
export function prismSAT(a:PrismGeometry,b:PrismGeometry,margin=0):{n:Vec;depth:number}|null{
 if(a.triangle===null||b.triangle===null)return null;
 const aa=a.triangle?.normals??a.axes,bb=b.triangle?.normals??b.axes,ae=a.triangle?.edgeDirections??a.axes,be=b.triangle?.edgeDirections??b.axes;let depth=Infinity,separation=Infinity,n:Vec=[0,0,0];
 const test=(axis:V,boxFace=false)=>{const A=projection(a,axis),B=projection(b,axis),left=A[1]-B[0],right=B[1]-A[0];if(left< -margin||right< -margin)return false;const overlap=Math.min(left,right);separation=Math.min(separation,overlap);if(overlap<depth){const candidate=scale(axis,left<right?-1:1);if(boxFace||prismFeatureNormalAllowed(a,scale(candidate,-1))&&prismFeatureNormalAllowed(b,candidate)){depth=overlap;n=candidate;}}return true;};
 // A hidden seam is still an exact separating axis. A speculative pair must
 // not turn into positive penetration just because its exposed normal came
 // from a different axis: only actual intersection may load position rows.
 // Eligibility belongs to the feature which generated an axis. An exposed
 // box face may touch a welded edge of the other surface: that edge is not an
 // artificial sidewall of the box. Requiring both support cones here rejects
 // the real face and can replace millimetres of penetration with a far-axis
 // ejection. Triangle/triangle and edge/edge axes retain both local cones;
 // otherwise two welded shell boundaries can demand opposite separations.
 for(const axis of aa)if(!test(axis,!a.triangle))return null;for(const axis of bb)if(!test(axis,!b.triangle))return null;for(const x of ae)for(const y of be){const axis=cross(x,y),length=norm(axis);if(length>1e-8&&!test(scale(axis,1/length)))return null;}return Number.isFinite(depth)?{n,depth:separation<0?separation:depth}:null;
}
/** A welded neighbour hides an internal prism sidewall. Every axis still
 * participates in SAT separation; only the normal of an actual exposed
 * material feature can become a penetration constraint. The local union's
 * support cone is independent of triangle winding and preserves open edges. */
export function prismFeatureNormalAllowed(shape:PrismGeometry,outward:V){
 const prism=shape.triangle,adjacency=shape.triangleAdjacency;if(!prism||!adjacency)return true;const anchor=prism.triangle[0],b=prism.triangle[1],c=prism.triangle[2],x=outward[0]!,y=outward[1]!,z=outward[2]!,v1=(b[0]-anchor[0])*x+(b[1]-anchor[1])*y+(b[2]-anchor[2])*z,v2=(c[0]-anchor[0])*x+(c[1]-anchor[1])*y+(c[2]-anchor[2])*z,maximum=Math.max(0,v1,v2),B=prism.bounds,magnitude=Math.max(Math.abs(B[0]),Math.abs(B[1]),Math.abs(B[2]),Math.abs(B[3]),Math.abs(B[4]),Math.abs(B[5])),tolerance=128*Number.EPSILON*Math.max(Number.MIN_VALUE,magnitude,Math.abs(maximum)),mask=(maximum<=tolerance?1:0)|(maximum-v1<=tolerance?2:0)|(maximum-v2<=tolerance?4:0);if(mask===7)return true;
 const neighbors=mask===3||mask===5||mask===6?adjacency.edges[mask===3?0:mask===6?1:2]:adjacency.vertices[mask===1?0:mask===2?1:2];if(!neighbors?.length)return true;
 const support=maximum+prism.halfThickness*Math.abs(dot(prism.normals[0]!,outward));for(const neighbor of neighbors){let far=-Infinity;for(const p of neighbor.triangle)far=Math.max(far,(p[0]-anchor[0])*x+(p[1]-anchor[1])*y+(p[2]-anchor[2])*z);far+=neighbor.halfThickness*Math.abs(dot(neighbor.normals[0]!,outward));if(far>support+tolerance)return false;}return true;
}
function planes(shape:PrismGeometry){if(shape.triangle)return shape.triangle.planes;return shape.axes.flatMap((n,k)=>[{n:n as Vec,offset:dot(shape.p,n)+shape.half[k]!},{n:scale(n,-1),offset:-dot(shape.p,n)+shape.half[k]!}]);}
function edges(shape:PrismGeometry,points:readonly Vec[]):readonly(readonly[number,number])[]{if(shape.triangle)return PRISM_EDGES;const out:[number,number][]=[];for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit))out.push([i,i|bit]);return out;}
export function prismManifold(a:PrismGeometry,b:PrismGeometry,n:V,margin=.006):Vec[]{
 const av=vertices(a),bv=vertices(b),candidates:Vec[]=[];for(const p of av)if(inside(p,b,margin))candidates.push(p);for(const p of bv)if(inside(p,a,margin))candidates.push(p);
 for(const [shape,points,other]of [[a,av,b],[b,bv,a]] as const)for(const edge of edges(shape,points)){const p=points[edge[0]]!,q=points[edge[1]]!,delta=sub(q,p);for(const face of planes(other)){const d=dot(delta,face.n);if(Math.abs(d)<1e-12)continue;const t=(face.offset-dot(p,face.n))/d;if(t<0||t>1)continue;const point=add(p,scale(delta,t));if(inside(point,other,margin))candidates.push(point);}}
 if(!candidates.length){const pa=a.triangle?prismSupport(a.triangle,scale(n,-1)):vertices(a).reduce((p,q)=>dot(q,n)<dot(p,n)?q:p),pb=b.triangle?prismSupport(b.triangle,n):vertices(b).reduce((p,q)=>dot(q,n)>dot(p,n)?q:p);candidates.push(scale(add(pa,pb),.5));}
 const result:Vec[]=[];for(let p of candidates){if(a.triangle)p=closestTrianglePoint(p,...a.triangle.triangle).point;else if(b.triangle)p=closestTrianglePoint(p,...b.triangle.triangle).point;if(!result.some(q=>norm(sub(p,q))<.02))result.push(p);}
 if(result.length<=4)return result;const chosen=[result[0]!];while(chosen.length<4){let best:Vec|undefined,score=-1;for(const p of result){if(chosen.includes(p))continue;const distance=Math.min(...chosen.map(q=>dot(sub(p,q),sub(p,q))));if(distance>score){score=distance;best=p;}}chosen.push(best!);}return chosen;
}
export function rayTrianglePrism(origin:V,direction:V,maxDistance:number,prism:TrianglePrism):{t:number;n:Vec;p:Vec}|null{
 let lo=0,hi=maxDistance,n:Vec|undefined;for(const plane of prism.planes){const speed=dot(direction,plane.n),gap=plane.offset-dot(origin,plane.n);if(Math.abs(speed)<1e-12){if(gap<0)return null;continue;}const t=gap/speed;if(speed<0){if(t>lo){lo=t;n=plane.n;}}else hi=Math.min(hi,t);if(lo>hi)return null;}return n&&lo>=0&&lo<=maxDistance?{t:lo,n:[...n],p:add(origin,scale(direction,lo))}:null;
}
export function closestPrismPoint(point:V,prism:TrianglePrism):{point:Vec;normal:Vec;distance:number}{
 let nearest=Infinity,normal:Vec=[0,1,0],within=true;for(const plane of prism.planes){const gap=plane.offset-dot(point,plane.n);if(gap<0)within=false;if(gap<nearest){nearest=gap;normal=plane.n;}}
 if(within)return{point:add(point,scale(normal,nearest)),normal:[...normal],distance:-nearest};let distance=Infinity,best:Vec=[0,0,0];for(const face of prism.planes)for(let i=1;i+1<face.vertices.length;i++){const q=closestTrianglePoint(point,prism.vertices[face.vertices[0]!]!,prism.vertices[face.vertices[i]!]!,prism.vertices[face.vertices[i+1]!]!).point,d=norm(sub(point,q));if(d<distance){distance=d;best=q;}}return{point:best,normal:distance>0?scale(sub(point,best),1/distance):normal,distance};
}
/** Exact Minkowski sphere sweep: true face interiors, nine finite cylinders,
 * and six endpoint balls. Expanded AABB/plane corners never become contacts. */
export function castRoundedTrianglePrism(origin:V,direction:V,maxDistance:number,radius:number,prism:TrianglePrism):{t:number;n:Vec;p:Vec}|null{
 let enter=0,exit=maxDistance;for(let k=0;k<3;k++){const speed=direction[k]!,lo=prism.bounds[k]!-radius,hi=prism.bounds[k+3]!+radius,o=origin[k]!;if(Math.abs(speed)<1e-12){if(o<lo||o>hi)return null;continue;}let a=(lo-o)/speed,b=(hi-o)/speed;if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);if(enter>exit)return null;}
 const initial=closestPrismPoint(origin,prism);if(initial.distance>0&&initial.distance<=radius)return{t:0,n:initial.normal,p:initial.point};let best:{t:number;n:Vec;p:Vec}|null=null;
 const accept=(t:number,p:Vec,n:Vec)=>{if(t>=0&&t<=maxDistance&&(!best||t<best.t))best={t,p,n};};
 for(const face of prism.planes){const speed=dot(direction,face.n);if(speed>=-1e-12)continue;const t=(face.offset+radius-dot(origin,face.n))/speed;if(t<0||t>maxDistance)continue;const point=sub(add(origin,scale(direction,t)),scale(face.n,radius));if(prismInside(point,prism,1e-9))accept(t,point,face.n);}
 const root=(A:number,B:number,C:number)=>{if(C<=0)return 0;if(A<1e-20)return Infinity;const discriminant=B*B-4*A*C;return discriminant>=0?(-B-Math.sqrt(discriminant))/(2*A):Infinity;};
 for(const [i,j]of PRISM_EDGES){const a=prism.vertices[i]!,b=prism.vertices[j]!,edge=sub(b,a),length=norm(edge);if(!(length>0))continue;const u=scale(edge,1/length),o=sub(origin,a),along=dot(o,u),speed=dot(direction,u),r=sub(o,scale(u,along)),d=sub(direction,scale(u,speed)),t=root(dot(d,d),2*dot(r,d),dot(r,r)-radius*radius),at=along+speed*t;if(!(at>=0&&at<=length)||!Number.isFinite(t))continue;const point=add(a,scale(u,at)),delta=sub(add(origin,scale(direction,t)),point),normDelta=norm(delta);if(normDelta>1e-12)accept(t,point,scale(delta,1/normDelta));}
 for(const point of prism.vertices){const o=sub(origin,point),t=root(dot(direction,direction),2*dot(o,direction),dot(o,o)-radius*radius);if(!Number.isFinite(t))continue;const delta=sub(add(origin,scale(direction,t)),point),length=norm(delta);if(length>1e-12)accept(t,point,scale(delta,1/length));}return best;
}
