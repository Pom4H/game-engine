import type {HumanoidBinding} from '../animation/locomotion.js';
import {V3,type Vec3} from '../math.js';
import type {Color,EntitySpec,Primitive} from '../scene/types.js';
import {FACE_REFERENCE} from '../assets/face-reference.js';
import {characterFaceSurface,neutralFaceSurface,type FaceIdentity,type FaceSurfaceControls} from './face-surface.js';

export type CharacterExpression='neutral'|'skeptical'|'smirk';
export type CharacterHairStyle='swept'|'short'|'none';
export interface CharacterHeadOptions {
  readonly id:string;readonly seed:number;readonly skin:Color;readonly hair:Color;
  readonly expression:CharacterExpression;readonly hairStyle:CharacterHairStyle;
}
export interface CharacterHead {readonly entities:EntitySpec[];readonly bindings:HumanoidBinding[];}
/** Highest actual vertex above the head joint, before the body's uniform scale. */
export const CHARACTER_HEAD_TOP_OFFSET=.230;
export function characterHeadTopOffset(style:CharacterHairStyle):number {
  if(style==='swept')return CHARACTER_HEAD_TOP_OFFSET;
  if(style==='short')return .218;
  if(style==='none')return .2048409302963326;
  throw new RangeError('Unknown character hairstyle');
}
type TrianglePrimitive=Extract<Primitive,{kind:'triangle-mesh'}>;
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const sphere:Primitive=Object.freeze({kind:'sphere',radius:.5,segments:32});
const color=(c:Color,label:string)=>{if(c.length!==4||c.some(v=>!Number.isFinite(v)||v<0||v>1)||c[3]!==1)throw new RangeError(label+' must be opaque RGBA within 0..1');};
const identity=(skin:Color):FaceIdentity=>({skin,iris:[.11,.16,.12,1],jawWidth:.70,cheekbone:.003,cheekHollow:.012,noseLength:.071,noseHook:.018,foreheadHeight:1.42,templeWidth:.88,chinLength:.018,chinForward:.013,mouthForward:.011,stubble:true});
function expressionControls(expression:CharacterExpression):FaceSurfaceControls {
  const rest={...neutralFaceSurface(),gap:.0008};
  if(expression==='neutral')return rest;
  if(expression==='skeptical')return {...rest,width:.050,gap:.0045,jaw:.028,browLeft:.58,browRight:.08,browTiltLeft:.90,browTiltRight:.22,squintLeft:.18,squintRight:.36,frownLeft:.10,frownRight:.30,sneerRight:.22,chinBunch:.18};
  if(expression==='smirk')return {...rest,gap:.0015,smileLeft:.12,smileRight:.72,cheekRight:.30,squintRight:.35,browLeft:.45,browTiltRight:.2};
  throw new RangeError('Unknown character expression');
}

/** Closed sculpted strand. Its cross section is three-dimensional at every
 * view angle; the taper and shallow ridges are geometry, not alpha cards. */
function strand(points:readonly [Vec3,Vec3,Vec3,Vec3],halfWidth:number,depth:number,seed:number,sections=20,sides=8):TrianglePrimitive {
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],colors:number[]=[];
  const curve=(t:number):Vec3=>{const q=1-t;return [0,1,2].map(k=>q*q*q*points[0][k]!+3*q*q*t*points[1][k]!+3*q*t*t*points[2][k]!+t*t*t*points[3][k]!) as [number,number,number];};
  for(let i=0;i<=sections;i++){
    const t=i/sections,p=curve(t),tangent=V3.normalize(V3.sub(curve(Math.min(1,t+.001)),curve(Math.max(0,t-.001))));
    const axis:Vec3=Math.abs(tangent[2])<.8?[0,0,1]:[1,0,0],across=V3.normalize(V3.sub(axis,V3.scale(tangent,V3.dot(axis,tangent)))),up=V3.normalize(V3.cross(tangent,across));
    const taper=Math.max(.045,Math.sin(Math.PI*(.08+.92*t))**.65),w=halfWidth*taper,h=depth*taper;
    for(let j=0;j<sides;j++){
      const a=j/sides*Math.PI*2,c=Math.cos(a),s=Math.sin(a),ridge=1+.07*Math.cos(a*4+t*9+seed);
      const offset=V3.add(V3.scale(across,c*w*ridge),V3.scale(up,s*h*ridge)),n=V3.normalize(V3.add(V3.scale(across,c/Math.max(w,.00001)),V3.scale(up,s/Math.max(h,.00001))));
      positions.push(...V3.add(p,offset));normals.push(...n);
      const tone=clamp(.83+.085*Math.cos(a*3+t*4+seed)+.045*Math.sin(t*27+seed));colors.push(tone,tone,tone,1);
      if(i<sections){const q=i*sides+j,r=i*sides+(j+1)%sides;indices.push(q,r,q+sides,r,r+sides,q+sides);}
    }
  }
  for(const [row,reverse] of [[0,true],[sections,false]] as const){const center=positions.length/3;positions.push(...curve(row/sections));normals.push(...V3.scale(V3.normalize(V3.sub(curve(1),curve(0))),reverse?-1:1));colors.push(.8,.8,.8,1);for(let j=0;j<sides;j++){const a=row*sides+j,b=row*sides+(j+1)%sides;indices.push(center,reverse?b:a,reverse?a:b);}}
  return {kind:'triangle-mesh',positions,normals,indices,colors};
}
function merge(meshes:readonly TrianglePrimitive[]):TrianglePrimitive {
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],colors:number[]=[];
  for(const mesh of meshes){const offset=positions.length/3;positions.push(...mesh.positions);normals.push(...mesh.normals);indices.push(...mesh.indices.map(i=>i+offset));colors.push(...(mesh.colors??Array.from({length:mesh.positions.length/3*4},(_,i)=>i%4===3?1:.92)));}
  return {kind:'triangle-mesh',positions,normals,indices,colors};
}
function scalp(skin:TrianglePrimitive,seed:number):TrianglePrimitive {
  // A thin shell copied from the actual cranium closes the gaps between locks.
  // Clip a high frontal hairline; never create an independent inflated skull.
  type Vertex={p:Vec3;n:Vec3};
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],colors:number[]=[];
  const distance=(p:Vec3)=>{const front=clamp((p[0]+.025)/.110);return p[1]-(.018+.133*front+.004*Math.sin(p[2]*43+seed*.02)*front);};
  const lerp=(a:Vertex,b:Vertex,t:number):Vertex=>({p:V3.add(a.p,V3.scale(V3.sub(b.p,a.p),t)),n:V3.normalize(V3.add(a.n,V3.scale(V3.sub(b.n,a.n),t)))});
  const emit=(triangle:readonly Vertex[])=>{
    const polygon:Vertex[]=[];
    for(let i=0;i<3;i++){const a=triangle[i]!,b=triangle[(i+1)%3]!,da=distance(a.p),db=distance(b.p);if(da>=0)polygon.push(a);if((da>=0)!==(db>=0))polygon.push(lerp(a,b,da/(da-db)));}
    if(polygon.length<3)return;
    const offset=positions.length/3;
    for(const v of polygon){const groove=Math.sin(v.p[0]*390+v.p[2]*170+seed*.13),tone=.72+.045*groove;positions.push(...V3.add(v.p,V3.scale(v.n,.0033+.00035*groove)));normals.push(...v.n);colors.push(tone,tone,tone,1);}
    for(let i=1;i<polygon.length-1;i++)indices.push(offset,offset+i,offset+i+1);
  };
  for(let i=0;i<skin.indices.length;i+=3){
    const v=skin.indices.slice(i,i+3).map(k=>({p:skin.positions.slice(k*3,k*3+3) as unknown as Vec3,n:skin.normals.slice(k*3,k*3+3) as unknown as Vec3}));
    if(v.every(a=>distance(a.p)<-.015))continue;
    const [a,b,c]=v as [Vertex,Vertex,Vertex],ab=lerp(a,b,.5),bc=lerp(b,c,.5),ca=lerp(c,a,.5);
    for(const triangle of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])emit(triangle);
  }
  return {kind:'triangle-mesh',positions,normals,indices,colors};
}
function hairMesh(style:Exclude<CharacterHairStyle,'none'>,seed:number,skin:TrianglePrimitive):TrianglePrimitive {
  let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const swept=style==='swept',locks:TrianglePrimitive[]=[];
  // Broad flattened clumps start at the exposed forehead and flow backwards.
  // Fine raised filaments share their curves, so the silhouette and direction
  // come from overlapping solid strands at every camera angle.
  const count=swept?55:36;
  for(let i=0;i<count;i++){
    const primary=i<28,z=primary?-.068+.136*i/27+(random()-.5)*.004:-.063+random()*.126,edge=Math.abs(z)/.075;
    const rootY=.147-edge*.028+random()*.009+(primary?0:.016*(1-edge)),root:Vec3=[skinFront(skin,rootY,z)+.002,rootY,z];
    const sweep=(.017+random()*.036)*(1-edge*.55),jitter=(random()-.5)*.022;
    const points:readonly [Vec3,Vec3,Vec3,Vec3]=[root,[root[0]-.005-random()*.009,(swept?.228:.205)-edge*.045+jitter,z+sweep*.40],[-.030+random()*.026,(swept?.277:.238)-edge*.073+jitter,z+sweep],[-.071-random()*.025,.105-edge*.021+random()*.024,z+sweep*.55+(random()-.5)*.014]];
    locks.push(strand(points,.0045+random()*.0035,swept?.0025:.0022,seed+i,12,7));
    for(const sign of [-1,1]){const fine=points.map((p,k)=>[p[0]+(k===0?.0005:.0008),p[1]+.0018,p[2]+sign*.0022] as Vec3) as unknown as readonly [Vec3,Vec3,Vec3,Vec3];locks.push(strand(fine,.00045,.0005,seed+i*7+sign,7,5));}
    if(swept&&i%5===0){const fly=points.map((p,k)=>[p[0]-(k===3?.012:0),p[1]+(k===1?.015:k===2?.021:0),p[2]+(k>1?.009:0)] as Vec3) as unknown as readonly [Vec3,Vec3,Vec3,Vec3];locks.push(strand(fly,.0005,.0005,seed+i*13,13,5));}
  }
  for(const side of [-1,1])for(let i=0;i<(swept?40:20);i++){
    const x=.048-random()*.111,y=Math.max(.028+random()*.094,.024+.133*clamp((x+.025)/.110)),z=skinSide(skin,x,y);
    if(!Number.isFinite(z))continue;
    const root:Vec3=[x,y,side*(z+.003)],length=(swept?.026:.019)+random()*.013;
    const sample=(px:number,py:number,extra:number):Vec3=>{const pz=skinSide(skin,px,py);return [px,py,side*((Number.isFinite(pz)?pz:z)+extra)];};
    const points:readonly [Vec3,Vec3,Vec3,Vec3]=[root,sample(x-.010,y+.004,.004),sample(x-length*.8,y-.008,.008),sample(x-length,y-.023-random()*.014,.006)];
    locks.push(strand(points,.0025+random()*.003,.0018,seed+100+i*side,8,6));
  }
  for(let i=0;i<8;i++){const z=-.060+i*.017,root:Vec3=[-.075,.066+random()*.020,z];locks.push(strand([root,[-.088,.062,z+.008],[-.102,.035,z+.015],[-.086,.006+random()*.019,z+.014]],.006,.0025,seed+i*17,9,5));}
  const mesh=merge(locks),top=Math.max(...mesh.positions.filter((_,i)=>i%3===1)),target=characterHeadTopOffset(style),anchor=.170,stretch=(target-anchor)/(top-anchor);
  const positions=mesh.positions.map((v,i)=>i%3===1&&v>anchor?anchor+(v-anchor)*stretch:v);
  // Fit only the elevated locks to the declared height. The fitted scalp and
  // every hair root remain on the skin, independently of the selected style.
  const normals=Array<number>(positions.length).fill(0);
  for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3),p=ids.map(k=>positions.slice(k*3,k*3+3) as unknown as Vec3),n=V3.cross(V3.sub(p[1]!,p[0]!),V3.sub(p[2]!,p[0]!));for(const id of ids)for(let k=0;k<3;k++)normals[id*3+k]=normals[id*3+k]!+n[k]!;}
  for(let i=0;i<normals.length;i+=3){const n=V3.normalize(normals.slice(i,i+3) as unknown as Vec3);normals.splice(i,3,...n);}
  return merge([scalp(skin,seed),{...mesh,positions,normals}]);
}
/** Frontmost actual skin point at a brow landmark; brows conform to the
 * sculpted forehead rather than hovering over an assumed spherical skull. */
function skinFront(mesh:TrianglePrimitive,y:number,z:number):number {
  let front=-Infinity;
  for(let i=0;i<mesh.indices.length;i+=3){const [ia,ib,ic]=mesh.indices.slice(i,i+3).map(k=>k*3),p=mesh.positions,ay=p[ia!+1]!,az=p[ia!+2]!,by=p[ib!+1]!,bz=p[ib!+2]!,cy=p[ic!+1]!,cz=p[ic!+2]!,den=(bz-cz)*(ay-cy)+(cy-by)*(az-cz);if(Math.abs(den)<1e-12)continue;const a=((bz-cz)*(y-cy)+(cy-by)*(z-cz))/den,b=((cz-az)*(y-cy)+(ay-cy)*(z-cz))/den,c=1-a-b;if(Math.min(a,b,c)<-1e-6)continue;front=Math.max(front,a*p[ia!]!+b*p[ib!]!+c*p[ic!]!);}
  return Number.isFinite(front)?front:.091;
}
function skinSide(mesh:TrianglePrimitive,x:number,y:number):number {
  let side=-Infinity;const p=mesh.positions;
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map(k=>k*3),den=(p[b!+1]!-p[c!+1]!)*(p[a!]!-p[c!]!)+(p[c!]!-p[b!]!)*(p[a!+1]!-p[c!+1]!);if(Math.abs(den)<1e-12)continue;const u=((p[b!+1]!-p[c!+1]!)*(x-p[c!]!)+(p[c!]!-p[b!]!)*(y-p[c!+1]!))/den,v=((p[c!+1]!-p[a!+1]!)*(x-p[c!]!)+(p[a!]!-p[c!]!)*(y-p[c!+1]!))/den,w=1-u-v;if(Math.min(u,v,w)>=-1e-6)side=Math.max(side,u*p[a!+2]!+v*p[b!+2]!+w*p[c!+2]!);}
  return side;
}
/** Curved sclera ends behind the actual lid loop. A complete sphere would
 * protrude through the cheek when the authored eye becomes wider or squints. */
function eyeSurface(skin:TrianglePrimitive,side:number):TrianglePrimitive {
  const boundary=FACE_REFERENCE.eyes.find(ids=>skin.positions[ids[0]!*3+2]!*side>0)!,centerZ=side*.03385;
  const positions:number[]=[.0881,.029,centerZ],normals:number[]=[1,0,0],indices:number[]=[],rings=4,count=boundary.length;
  for(let row=1;row<=rings;row++)for(const index of boundary){
    const t=row/rings,y=.029+(skin.positions[index*3+1]!-.029)*t,z=centerZ+(skin.positions[index*3+2]!-centerZ)*t;
    const x=.07456+.014*Math.sqrt(Math.max(0,1-((z-centerZ)/.0175)**2-((y-.029)/.014)**2))-.00035;
    positions.push(x,y,z);normals.push(...V3.normalize([(x-.07456)/(.014**2),(y-.029)/(.014**2),(z-centerZ)/(.0175**2)]));
  }
  for(let j=0;j<count;j++){indices.push(0,1+j,1+(j+1)%count);for(let row=0;row<rings-1;row++){const a=1+row*count+j,b=1+row*count+(j+1)%count;indices.push(a,a+count,b,b,a+count,b+count);}}
  // The source loops run in opposite directions. Normalize winding once so
  // front-face culling treats both sclerae consistently on the GPU.
  for(let i=0;i<indices.length;i+=3){const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;if((positions[b+1]!-positions[a+1]!)*(positions[c+2]!-positions[a+2]!)-(positions[b+2]!-positions[a+2]!)*(positions[c+1]!-positions[a+1]!)<0)[indices[i+1],indices[i+2]]=[indices[i+2]!,indices[i+1]!];}
  return {kind:'triangle-mesh',positions,normals,indices,colors:Array.from({length:positions.length/3*4},()=>1)};
}

/** The approved elongated adult head as ordinary engine scene data. All
 * features share one skeletal attachment; body dimensions never skew the face. */
export function createCharacterHead(options:CharacterHeadOptions):CharacterHead {
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(options.id))throw new TypeError('Character head requires a stable ID');
  if(!Number.isSafeInteger(options.seed)||options.seed<0||options.seed>0xffffffff)throw new RangeError('Character seed must be uint32');
  color(options.skin,'Skin');color(options.hair,'Hair');characterHeadTopOffset(options.hairStyle);
  const controls=expressionControls(options.expression),who=identity(options.skin),skin=characterFaceSurface(who,controls),entities:EntitySpec[]=[],bindings:HumanoidBinding[]=[];
  const add=(key:string,mesh:Primitive,offset:Vec3,scale:Vec3,tint:Color,roughness=.68)=>{const id=options.id+'-head-'+key;entities.push({id,mesh,renderOnly:true,material:{kind:'default',color:[...tint],roughness}});bindings.push({entity:id,joint:'head',offset,scale});};
  add('skin',skin,[0,0,0],[1,1,1],options.skin,.70);
  const cy=-.043-controls.gap*.30-.011*Math.sin(controls.jaw);
  add('mouth',sphere,[.092,cy,0],[.035,Math.max(.0006,controls.gap),controls.width],[.027,.009,.011,1],.92);
  add('upper-teeth',sphere,[.105,-.041,0],[.007,.004,.031],[.77,.74,.66,1],.42);
  add('lower-teeth',sphere,[.103,cy-controls.gap*.32-.004,0],[.006,.0034,.029],[.73,.70,.63,1],.44);
  add('tongue',sphere,[.097,cy-controls.gap*.35-.003,0],[.016,.004,.024],[.40,.16,.17,1],.62);
  for(const side of [-1,1]){
    const name=side<0?'left':'right',z=side*.03385;
    const gazeZ=options.expression==='skeptical'?.0060:options.expression==='smirk'?.0035:0,gazeY=options.expression==='skeptical'?.0004:0,eyeX=.07456+.014*Math.sqrt(1-(gazeZ/.0175)**2-(gazeY/.014)**2);
    add(name+'-eye',eyeSurface(skin,side),[0,0,0],[1,1,1],[.71,.72,.68,1],.30);
    add(name+'-iris',sphere,[eyeX,.029+gazeY,z+gazeZ],[.0022,.0108,.0108],who.iris,.25);
    add(name+'-pupil',sphere,[eyeX+.00115,.029+gazeY,z+gazeZ],[.0014,.0048,.0048],[.008,.008,.008,1],.23);
    const raised=side<0?controls.browLeft:controls.browRight,tilt=(side<0?controls.browTiltLeft:controls.browTiltRight)-.5;
    const points=[.015,.025,.045,.060].map((w,i)=>{const y=.047+.006*Math.sin(i/3*Math.PI)+.007*raised+.29*(w-.015)*(options.expression==='skeptical'?(side<0?1.8:.75):1)+.10*tilt*(w-.035);return [skinFront(skin,y,side*w)+.0014,y,side*w] as Vec3;}) as unknown as readonly [Vec3,Vec3,Vec3,Vec3];
    add(name+'-brow',strand(points,.0032,.0033,options.seed+side,16),[0,0,0],[1,1,1],[options.hair[0]*.55,options.hair[1]*.55,options.hair[2]*.55,1],.87);
  }
  if(options.hairStyle!=='none')add('hair',hairMesh(options.hairStyle,options.seed,skin),[0,0,0],[1,1,1],options.hair,.82);
  return {entities,bindings};
}
