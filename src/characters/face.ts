import type {HumanoidBinding} from '../animation/locomotion.js';
import {V3,type Vec3} from '../math.js';
import type {Color,EntitySpec,Primitive} from '../scene/types.js';
import {characterFaceSurface,neutralFaceSurface,type FaceIdentity,type FaceSurfaceControls} from './face-surface.js';

export type CharacterExpression='neutral'|'skeptical'|'smirk';
export type CharacterHairStyle='swept'|'short'|'none';
export interface CharacterHeadOptions {
  readonly id:string;readonly seed:number;readonly skin:Color;readonly hair:Color;
  readonly expression:CharacterExpression;readonly hairStyle:CharacterHairStyle;
}
export interface CharacterHead {readonly entities:EntitySpec[];readonly bindings:HumanoidBinding[];}
/** Highest actual vertex above the head joint, before the body's uniform scale. */
export const CHARACTER_HEAD_TOP_OFFSET=.265;
export function characterHeadTopOffset(style:CharacterHairStyle):number {
  if(style==='swept')return CHARACTER_HEAD_TOP_OFFSET;
  if(style==='short')return .230;
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
  if(expression==='skeptical')return {...rest,width:.050,gap:.0045,jaw:.028,browLeft:.58,browRight:.08,browTiltLeft:.90,browTiltRight:.22,squintLeft:.12,squintRight:.24,frownLeft:.10,frownRight:.30,sneerRight:.22,chinBunch:.18};
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
function hairPoint(u:number,a:number,seed:number,swept:boolean):Vec3 {
  const front=Math.cos(a),end=1.88-.46*front+.12*Math.max(0,-front)+.024*Math.sin(a*13+seed),p=u*end,c=Math.cos(p),s=Math.sin(p);
  const crest=swept?.014*Math.max(0,c)**2:0,cy=c>0?Math.sqrt(c):c,y=.087+.145*cy+crest,center=.004+.021*clamp((y-.08)/.16);
  const wave=a*15+p*6+1.2*Math.sin(a)+seed*.17,ridge=1+.044*Math.sin(wave)+.016*Math.sin(a*51+p*15+seed);
  return [center+.095*s*front*ridge,y+.003*s*Math.sin(wave)+.006*s*front,.089*s*Math.sin(a)*ridge];
}
function scalp(seed:number,swept:boolean):TrianglePrimitive {
  // Continuous swept locks: broad curvature, finer strand grooves and a fitted
  // hairline. Geometry stays solid under the sparse individual flyaway hairs.
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],colors:number[]=[],rings=56,columns=144;
  for(let i=0;i<=rings;i++)for(let j=0;j<columns;j++){
    const a=j/columns*Math.PI*2,u=i/rings;
    positions.push(...hairPoint(u,a,seed,swept));normals.push(0,1,0);
    const tone=.75+.085*Math.sin(a*15+u*10+1.2*Math.sin(a)+seed*.17)+.045*Math.sin(a*51+u*25+seed);colors.push(tone,tone,tone,1);
    if(i<rings){const q=i*columns+j,r=i*columns+(j+1)%columns;indices.push(q,r,q+columns,r,r+columns,q+columns);}
  }
  return {kind:'triangle-mesh',positions,normals,indices,colors};
}
function hairMesh(style:Exclude<CharacterHairStyle,'none'>,seed:number):TrianglePrimitive {
  let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const swept=style==='swept',locks:TrianglePrimitive[]=[scalp(seed,swept)];
  for(let i=0;i<(swept?92:48);i++){
    const a=random()*Math.PI*2,u=.18+random()*.78,root=hairPoint(u,a,seed,swept),next=hairPoint(Math.min(1,u+.025),a+.012,seed,swept),tangent=V3.normalize(V3.sub(next,root));
    const outward=V3.normalize([root[0]-.02,(root[1]-.04)*.55,root[2]]),length=(swept?.018:.008)+random()*(swept?.024:.009),lift=.003+random()*.006;
    const p1=V3.add(root,V3.add(V3.scale(tangent,length*.32),V3.scale(outward,lift*.25))),p2=V3.add(root,V3.add(V3.scale(tangent,length*.76),V3.scale(outward,lift))),end=V3.add(root,V3.add(V3.scale(tangent,length),V3.scale(outward,lift*.65)));
    locks.push(strand([root,p1,p2,end],.00045+random()*.00055,.0005,seed+i,10,5));
  }
  const mesh=merge(locks),top=Math.max(...mesh.positions.filter((_,i)=>i%3===1)),target=characterHeadTopOffset(style),anchor=.105,stretch=(target-anchor)/(top-anchor);
  const positions=mesh.positions.map((v,i)=>i%3===1&&v>anchor?anchor+(v-anchor)*stretch:v);
  // Recompute normals after crown fitting, so the exact declared height and
  // shading agree. The lower attached scalp is unchanged.
  const normals=Array<number>(positions.length).fill(0);
  for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3),p=ids.map(k=>positions.slice(k*3,k*3+3) as unknown as Vec3),n=V3.cross(V3.sub(p[1]!,p[0]!),V3.sub(p[2]!,p[0]!));for(const id of ids)for(let k=0;k<3;k++)normals[id*3+k]=normals[id*3+k]!+n[k]!;}
  for(let i=0;i<normals.length;i+=3){const n=V3.normalize(normals.slice(i,i+3) as unknown as Vec3);normals.splice(i,3,...n);}
  return {...mesh,positions,normals};
}
/** Frontmost actual skin point at a brow landmark; brows conform to the
 * sculpted forehead rather than hovering over an assumed spherical skull. */
function skinFront(mesh:TrianglePrimitive,y:number,z:number):number {
  let front=-Infinity;
  for(let i=0;i<mesh.indices.length;i+=3){const [ia,ib,ic]=mesh.indices.slice(i,i+3).map(k=>k*3),p=mesh.positions,ay=p[ia!+1]!,az=p[ia!+2]!,by=p[ib!+1]!,bz=p[ib!+2]!,cy=p[ic!+1]!,cz=p[ic!+2]!,den=(bz-cz)*(ay-cy)+(cy-by)*(az-cz);if(Math.abs(den)<1e-12)continue;const a=((bz-cz)*(y-cy)+(cy-by)*(z-cz))/den,b=((cz-az)*(y-cy)+(ay-cy)*(z-cz))/den,c=1-a-b;if(Math.min(a,b,c)<-1e-6)continue;front=Math.max(front,a*p[ia!]!+b*p[ib!]!+c*p[ic!]!);}
  return Number.isFinite(front)?front:.091;
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
    add(name+'-eye',sphere,[.07456,.029,z],[.027,.028,.028],[.71,.72,.68,1],.30);
    add(name+'-iris',sphere,[.08856,.029,z],[.0022,.0105,.0105],who.iris,.25);
    add(name+'-pupil',sphere,[.08971,.029,z],[.0014,.0046,.0046],[.008,.008,.008,1],.23);
    const raised=side<0?controls.browLeft:controls.browRight,tilt=(side<0?controls.browTiltLeft:controls.browTiltRight)-.5;
    const points=[.015,.025,.045,.060].map((w,i)=>{const y=.047+.006*Math.sin(i/3*Math.PI)+.007*raised+.29*(w-.015)*(options.expression==='skeptical'?(side<0?1.8:.75):1)+.10*tilt*(w-.035);return [skinFront(skin,y,side*w)+.0014,y,side*w] as Vec3;}) as unknown as readonly [Vec3,Vec3,Vec3,Vec3];
    add(name+'-brow',strand(points,.0032,.0022,options.seed+side,16),[0,0,0],[1,1,1],[options.hair[0]*.55,options.hair[1]*.55,options.hair[2]*.55,1],.87);
  }
  if(options.hairStyle!=='none')add('hair',hairMesh(options.hairStyle,options.seed),[0,0,0],[1,1,1],options.hair,.82);
  return {entities,bindings};
}
