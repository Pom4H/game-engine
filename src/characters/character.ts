import {bindHumanoid,humanoidMeasurements,sampleWalker,type HumanoidBinding,type HumanoidJoint,type WalkerSpec} from '../animation/locomotion.js';
import {V3,type Vec3} from '../math.js';
import {clothLoftMesh,type ClothRing} from '../procedural/cloth.js';
import {primitiveMesh} from '../procedural/mesh.js';
import type {Color,EntitySpec,MaterialSpec,Primitive} from '../scene/types.js';
import {characterHeadTopOffset,createCharacterHead} from './face.js';

/** A portable recipe. All lengths are metres; proportions are dimensionless.
 * This is authoring data, never a second animation or physics authority. */
export interface CharacterSpec {
 readonly version:1;readonly id:string;readonly seed:number;
 readonly body:{readonly height:number;readonly shoulders:number;readonly hips:number;readonly torso:number;readonly arms:number;readonly legs:number;readonly build:number};
 readonly outfit:{readonly top:'parka'|'jacket'|'sweater';readonly bottom:'jeans'|'cargo';readonly shoes:'boots'|'sneakers';readonly scarf:boolean};
 readonly colors:{readonly skin:string;readonly hair:string;readonly top:string;readonly bottom:string;readonly shoes:string;readonly scarf:string};
 readonly hairStyle:'swept'|'short'|'none';readonly expression:'neutral'|'skeptical'|'smirk';
}
export interface CompiledCharacter {
 readonly spec:CharacterSpec;readonly entities:EntitySpec[];readonly walker:WalkerSpec;
 readonly metrics:{readonly height:number;readonly entityCount:number;readonly triangles:number};
}

export const DEFAULT_CHARACTER_SPEC:CharacterSpec=Object.freeze({
 version:1,id:'skeptic',seed:4217,
 body:Object.freeze({height:1.88,shoulders:.91,hips:.96,torso:1.04,arms:1.04,legs:1.10,build:.28}),
 outfit:Object.freeze({top:'parka',bottom:'jeans',shoes:'boots',scarf:true}),
 colors:Object.freeze({skin:'#c9ac96',hair:'#493126',top:'#856044',bottom:'#303640',shoes:'#513d30',scarf:'#77736a'}),
 hairStyle:'swept',expression:'skeptical',
});

function object(value:unknown,label:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);
 const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)throw new TypeError(`${label} must be plain recipe data`);
 return value as Record<string,unknown>;
}
function fields(value:Record<string,unknown>,allowed:readonly string[],label:string):void{
 for(const key of Object.keys(value))if(!allowed.includes(key))throw new TypeError(`${label}.${key} is not a character field`);
}
function bounded(value:unknown,fallback:number,min:number,max:number,label:string):number{
 if(value===undefined)return fallback;
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new RangeError(`${label} must be finite and within ${min}…${max}`);
 return value;
}
function choice<T extends string>(value:unknown,fallback:T,allowed:readonly T[],label:string):T{
 if(value===undefined)return fallback;
 if(typeof value!=='string'||!allowed.includes(value as T))throw new TypeError(`${label} must be ${allowed.join(', ')}`);
 return value as T;
}
function hex(value:unknown,fallback:string,label:string):string{
 if(value===undefined)return fallback;
 if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw new TypeError(`${label} must be #RRGGBB`);
 return value.toLowerCase();
}
/** Validates JSON imports before allocating any geometry. Missing fields use
 * documented defaults; present invalid values fail instead of being coerced.
 * The result is a new plain object containing only the supported fields. */
export function characterSpec(input:unknown=DEFAULT_CHARACTER_SPEC):CharacterSpec{
 const raw=object(input,'Character'),defaults=DEFAULT_CHARACTER_SPEC;
 fields(raw,['version','id','seed','body','outfit','colors','hairStyle','expression'],'Character');
 if(raw.version!==undefined&&raw.version!==1)throw new RangeError('Unsupported character recipe version');
 const id=raw.id===undefined?defaults.id:raw.id;
 if(typeof id!=='string'||!/^[A-Za-z\d][A-Za-z\d_.:-]{0,63}$/.test(id))throw new TypeError('Character.id must be a stable 1…64 character identifier');
 const seed=bounded(raw.seed,defaults.seed,0,0xffffffff,'Character.seed');
 if(!Number.isInteger(seed))throw new RangeError('Character.seed must be an integer');
 const b=raw.body===undefined?{}:object(raw.body,'Character.body'),o=raw.outfit===undefined?{}:object(raw.outfit,'Character.outfit'),c=raw.colors===undefined?{}:object(raw.colors,'Character.colors');
 fields(b,['height','shoulders','hips','torso','arms','legs','build'],'Character.body');
 fields(o,['top','bottom','shoes','scarf'],'Character.outfit');
 fields(c,['skin','hair','top','bottom','shoes','scarf'],'Character.colors');
 if(o.scarf!==undefined&&typeof o.scarf!=='boolean')throw new TypeError('Character.outfit.scarf must be boolean');
 return{
  version:1,id,seed,
  body:{height:bounded(b.height,defaults.body.height,1.5,2.05,'Character.body.height'),shoulders:bounded(b.shoulders,defaults.body.shoulders,.7,1.3,'Character.body.shoulders'),hips:bounded(b.hips,defaults.body.hips,.7,1.3,'Character.body.hips'),torso:bounded(b.torso,defaults.body.torso,.7,1.3,'Character.body.torso'),arms:bounded(b.arms,defaults.body.arms,.7,1.3,'Character.body.arms'),legs:bounded(b.legs,defaults.body.legs,.7,1.3,'Character.body.legs'),build:bounded(b.build,defaults.body.build,0,1,'Character.body.build')},
  outfit:{top:choice(o.top,defaults.outfit.top,['parka','jacket','sweater'],'Character.outfit.top'),bottom:choice(o.bottom,defaults.outfit.bottom,['jeans','cargo'],'Character.outfit.bottom'),shoes:choice(o.shoes,defaults.outfit.shoes,['boots','sneakers'],'Character.outfit.shoes'),scarf:o.scarf??defaults.outfit.scarf},
  colors:{skin:hex(c.skin,defaults.colors.skin,'Character.colors.skin'),hair:hex(c.hair,defaults.colors.hair,'Character.colors.hair'),top:hex(c.top,defaults.colors.top,'Character.colors.top'),bottom:hex(c.bottom,defaults.colors.bottom,'Character.colors.bottom'),shoes:hex(c.shoes,defaults.colors.shoes,'Character.colors.shoes'),scarf:hex(c.scarf,defaults.colors.scarf,'Character.colors.scarf')},
  hairStyle:choice(raw.hairStyle,defaults.hairStyle,['swept','short','none'],'Character.hairStyle'),expression:choice(raw.expression,defaults.expression,['neutral','skeptical','smirk'],'Character.expression'),
 };
}

function frozen(spec:CharacterSpec):CharacterSpec{return Object.freeze({...spec,body:Object.freeze(spec.body),outfit:Object.freeze(spec.outfit),colors:Object.freeze(spec.colors)});}
export const CHARACTER_PRESETS:readonly {readonly id:string;readonly name:string;readonly description:string;readonly spec:CharacterSpec}[]=Object.freeze([
 Object.freeze({id:'skeptic',name:'Скептик',description:'Длинная парка, узкие джинсы и тяжёлые ботинки.',spec:DEFAULT_CHARACTER_SPEC}),
 Object.freeze({id:'mechanic',name:'Механик',description:'Широкие плечи, рабочая куртка и карго.',spec:frozen(characterSpec({id:'mechanic',seed:832,body:{height:1.79,shoulders:1.14,hips:1.04,torso:1.01,arms:1,legs:.96,build:.77},outfit:{top:'jacket',bottom:'cargo',shoes:'boots',scarf:false},colors:{skin:'#b59178',hair:'#332821',top:'#58645a',bottom:'#54564c',shoes:'#302c29',scarf:'#7a8174'},hairStyle:'short',expression:'neutral'}))}),
 Object.freeze({id:'wanderer',name:'Наблюдатель',description:'Тёплый свитер, прямые джинсы и кеды.',spec:frozen(characterSpec({id:'wanderer',seed:6029,body:{height:1.83,shoulders:1.02,hips:.99,torso:.98,arms:1.01,legs:1.03,build:.43},outfit:{top:'sweater',bottom:'jeans',shoes:'sneakers',scarf:false},colors:{skin:'#d1af95',hair:'#675044',top:'#47687a',bottom:'#414e5c',shoes:'#afaa9d',scarf:'#777c89'},hairStyle:'swept',expression:'smirk'}))}),
]);

type Mesh=Extract<Primitive,{kind:'triangle-mesh'}>;
function color(hex:string):Color{return[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,1];}
function shade(c:Color,factor:number):Color{return[Math.min(1,c[0]*factor),Math.min(1,c[1]*factor),Math.min(1,c[2]*factor),c[3]];}
function fabric(c:Color):MaterialSpec{return{kind:'default',color:c,roughness:.91,pattern:'fabric'};}
function loft(rings:readonly ClothRing[],seed:number,folds=.002,roundness=.85,radialSegments=32,subdivisions=3):Mesh{
 return clothLoftMesh({rings,radialSegments,subdivisions,roundness,folds,seed}) as Mesh;
}
function moved(mesh:Mesh,offset:Vec3,scale:Vec3=[1,1,1]):Mesh{
 const positions:number[]=[],normals:number[]=[];
 for(let i=0;i<mesh.positions.length;i+=3){positions.push(offset[0]+mesh.positions[i]!*scale[0],offset[1]+mesh.positions[i+1]!*scale[1],offset[2]+mesh.positions[i+2]!*scale[2]);normals.push(...V3.normalize([mesh.normals[i]!/scale[0],mesh.normals[i+1]!/scale[1],mesh.normals[i+2]!/scale[2]]));}
 return{kind:'triangle-mesh',positions,normals,indices:[...mesh.indices]};
}
function joined(meshes:readonly Mesh[]):Mesh{
 const positions:number[]=[],normals:number[]=[],indices:number[]=[];
 for(const mesh of meshes){const start=positions.length/3;positions.push(...mesh.positions);normals.push(...mesh.normals);indices.push(...mesh.indices.map(i=>i+start));}
 return{kind:'triangle-mesh',positions,normals,indices};
}
/** Small rounded cords carry seams, stitching and laces. They remain ordinary
 * mesh data, attached to the same articulated part as the garment beneath. */
function cord(points:readonly Vec3[],radius:number,segments=6):Mesh{
 const positions:number[]=[],normals:number[]=[],indices:number[]=[];
 for(let i=0;i<points.length;i++){
  const tangent=V3.normalize(V3.sub(points[Math.min(points.length-1,i+1)]!,points[Math.max(0,i-1)]!)),helper:Vec3=Math.abs(tangent[1])<.85?[0,1,0]:[0,0,1],a=V3.normalize(V3.cross(tangent,helper)),b=V3.cross(tangent,a),p=points[i]!;
  for(let j=0;j<segments;j++){const angle=j/segments*Math.PI*2,n=V3.add(V3.scale(a,Math.cos(angle)),V3.scale(b,Math.sin(angle)));positions.push(...V3.add(p,V3.scale(n,radius)));normals.push(...n);}
 }
 for(let i=0;i<points.length-1;i++)for(let j=0;j<segments;j++){const a=i*segments+j,b=i*segments+(j+1)%segments;indices.push(a,b,a+segments,b,b+segments,a+segments);}
 for(const end of [0,points.length-1]){const centre=positions.length/3,p=points[end]!,direction=V3.normalize(V3.sub(p,points[end===0?1:points.length-2]!));positions.push(...p);normals.push(...direction);for(let j=0;j<segments;j++){const a=end*segments+j,b=end*segments+(j+1)%segments;indices.push(centre,end===0?b:a,end===0?a:b);}}
 return{kind:'triangle-mesh',positions,normals,indices};
}
function panel(height:number,depth:number,width:number,seed:number):Mesh{return loft([[-height/2,depth*.75,width*.40],[-height*.40,depth,width*.5],[height*.40,depth,width*.5],[height/2,depth*.75,width*.40]],seed,.0002,.55,24,2);}
/** Intersect the authored surface, so a seam/lace uses the real garment as
 * its cause even when folds or proportions move that surface. */
function frontSurface(mesh:Mesh,y:number,z:number):number{
 let front=-Infinity;const p=mesh.positions;
 for(let i=0;i<mesh.indices.length;i+=3){
  const a=mesh.indices[i]!*3,b=mesh.indices[i+1]!*3,c=mesh.indices[i+2]!*3,by=p[b+1]!-p[a+1]!,bz=p[b+2]!-p[a+2]!,cy=p[c+1]!-p[a+1]!,cz=p[c+2]!-p[a+2]!,denominator=by*cz-bz*cy;
  if(Math.abs(denominator)<1e-12)continue;
  const dy=y-p[a+1]!,dz=z-p[a+2]!,u=(dy*cz-dz*cy)/denominator,v=(by*dz-bz*dy)/denominator;
  if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8)front=Math.max(front,p[a]!+u*(p[b]!-p[a]!)+v*(p[c]!-p[a]!));
 }
 if(!Number.isFinite(front))throw new Error('Character detail lies outside its garment surface');
 return front;
}

/** Compile once from a recipe; the Scene AnimationSystem subsequently owns
 * every transform. Garment dimensions and bone lengths share measurements,
 * so changing proportions also changes the contact-preserving skeleton. */
export function compileCharacter(input:CharacterSpec|unknown=DEFAULT_CHARACTER_SPEC):CompiledCharacter{
 const spec=characterSpec(input),b=spec.body,proportions={shoulders:b.shoulders,hips:b.hips,torso:b.torso,arms:b.arms,legs:b.legs},m=humanoidMeasurements(proportions),heightScale=b.height/(m.headHeight+characterHeadTopOffset(spec.hairStyle));
 const entities:EntitySpec[]=[],bindings:HumanoidBinding[]=[],skin=color(spec.colors.skin),top=color(spec.colors.top),bottom=color(spec.colors.bottom),shoes=color(spec.colors.shoes),scarf=color(spec.colors.scarf),stitch=shade(top,.73),hardware:MaterialSpec={color:[.32,.30,.25,1],roughness:.52,metalness:.45};
 const width=.85+b.build*.30,depth=.82+b.build*.47,coat=spec.outfit.top,torso=m.shoulderOffset,hem=coat==='parka'?-.19:coat==='jacket'?-.062:-.028,extra=coat==='parka'?1.09:coat==='jacket'?1.03:1;
 // Shoulder span is skeletal: changing soft-tissue build must not pull the
 // torso away from its sleeve sockets at the widest shoulder setting.
 const chestWidth=(Math.max(.16,m.shoulderHalfWidth)+.012+(b.build-.5)*.028)*extra,hipWidth=m.hipHalfWidth+.077*width,bodyDepth=.128*depth*extra,front=.012;
 const seed=(name:string)=>{let h=spec.seed;for(let i=0;i<name.length;i++)h=Math.imul(h^name.charCodeAt(i),16777619)>>>0;return(h%100003)/137;};
 const add=(key:string,joint:HumanoidJoint,mesh:Mesh,material:MaterialSpec,options:Omit<HumanoidBinding,'entity'|'joint'>={})=>{
  const id=`${spec.id}:${key}`;entities.push({id,mesh,material,renderOnly:true});bindings.push({entity:id,joint,...options});
 };
 const bodyRings:ClothRing[]=[
  [hem,.93*bodyDepth,hipWidth*extra,front],
  [hem+.025,bodyDepth,hipWidth*extra*1.015,front],
  [Math.max(.045,hem+.085),bodyDepth*.96,hipWidth*extra*.97,front],
  [torso*.47,bodyDepth*.94,chestWidth*.93,front],
  [torso*.77,bodyDepth*1.02,chestWidth,front],
  [torso*.94,bodyDepth*.95,chestWidth*.98,front],
  [torso+.022,bodyDepth*.72,chestWidth*.80,front],
  [m.neckOffset-.022,.061*depth,.078,front],
 ];
 add('top','pelvis',loft(bodyRings,seed('top'),coat==='sweater'?.0030:.0038,.85,48,4),fabric(top));
 add('waist','pelvis',loft([[-.13,.085*depth,hipWidth*.88],[-.05,.119*depth,hipWidth],[.074,.109*depth,hipWidth*.95],[.108,.103*depth,hipWidth*.93]],seed('waist'),.002),fabric(bottom));
 add('neck','neck',loft([[-.060,.043,.049],[-.035,.052,.052],[.070,.048,.050],[.10,.044,.048]],seed('neck'),0,1,40,3),{color:skin,roughness:.79});
 const torsoFront=(y:number)=>{
  let i=0;while(i<bodyRings.length-2&&y>bodyRings[i+1]![0])i++;
  const a=bodyRings[i]!,c=bodyRings[i+1]!,t=Math.max(0,Math.min(1,(y-a[0])/(c[0]-a[0])));return front+a[1]+(c[1]-a[1])*t+.005;
 };
 const hemMesh=loft([[hem-.002,bodyDepth*.935,hipWidth*extra*1.005,front],[hem+.010,bodyDepth*1.003,hipWidth*extra*1.016,front],[hem+.026,bodyDepth*1.009,hipWidth*extra*1.017,front]],seed('hem'),.0015,.85,40,2);
 add('top-hem','pelvis',hemMesh,fabric(shade(top,.82)));
 if(coat!=='sweater'){
  const zipBottom=hem+.043,zipTop=m.neckOffset-.025,steps=18,zip:Vec3[]=[],zipEdges:Mesh[]=[],teeth:Mesh[]=[];
  for(let i=0;i<=steps;i++){const y=zipBottom+(zipTop-zipBottom)*i/steps;zip.push([torsoFront(y)+.002,y,0]);}
  for(const side of [-1,1])zipEdges.push(cord(zip.map(p=>[p[0],p[1],side*.007] as Vec3),.0023));
  for(let y=zipBottom;y<zipTop-.015;y+=.012)teeth.push(moved(panel(.003,.0013,.008,1),[torsoFront(y)+.004,y,0]));
  add('zipper-tape','pelvis',joined(zipEdges),fabric(shade(top,.54)));
  add('zipper-teeth','pelvis',joined(teeth),hardware);
  const pullY=zipTop-.033,pullX=torsoFront(pullY)+.009;
  add('zipper-pull','pelvis',cord([[pullX,pullY,0],[pullX+.008,pullY-.013,-.003],[pullX+.007,pullY-.027,0],[pullX+.003,pullY-.012,.003],[pullX,pullY,0]],.0021,8),hardware);
 }
 if(coat==='parka'){
  add('hood','neck',loft([[-.21,.045,.09,-.11],[-.15,.072,.139,-.115],[-.07,.078,.157,-.116],[.006,.065,.147,-.113],[.035,.025,.112,-.103]],seed('hood'),.003,.8,40,3),fabric(shade(top,.94)));
  add('hood-edge','neck',cord([[-.10,.023,-.112],[-.12,-.015,-.143],[-.16,-.07,-.137],[-.185,-.10,0],[-.16,-.07,.137],[-.12,-.015,.143],[-.10,.023,.112]],.008,8),fabric(shade(top,.77)));
 }
 const collarColor=coat==='sweater'?shade(top,.80):shade(top,.92);
 add('collar','neck',loft([[-.056,.073,.083],[-.025,.075,.085],[.026,.067,.076],[.044,.060,.069]],seed('collar'),coat==='sweater'?.0015:.0022,.87,36,3),fabric(collarColor));
 if(coat==='sweater'){
  const ribs:Mesh[]=[];
  for(let i=0;i<28;i++){const a=i/28*Math.PI*2;ribs.push(cord([[.074*Math.cos(a),-.041,.084*Math.sin(a)],[.071*Math.cos(a),.015,.080*Math.sin(a)]],.0013));}
  add('collar-knit','neck',joined(ribs),fabric(shade(top,1.14)));
 }
 if(spec.outfit.scarf){
  add('scarf-wrap','neck',loft([[-.055,.083,.093],[-.035,.09,.10],[.008,.085,.096],[.043,.076,.082]],seed('scarf'),.0036,.82,40,3),fabric(scarf));
  add('scarf-tail','chest',moved(loft([[-.17,.007,.031],[-.14,.012,.038],[.075,.018,.043],[.10,.012,.036]],seed('scarf-tail'),.0013,.65,28,3),[bodyDepth+.023,.06,-.084]),fabric(shade(scarf,.96)));
  const fringe:Mesh[]=[];for(let i=0;i<8;i++)fringe.push(cord([[bodyDepth+.023,-.108,-.11+i*.008],[bodyDepth+.025,-.128-(i%3)*.003,-.108+i*.008]],.0016));
  add('scarf-fringe','chest',joined(fringe),fabric(shade(scarf,.85)));
 }
 for(const side of [-1,1] as const){
  const name=side<0?'left':'right',joint=(suffix:'Hip'|'Knee'|'Ankle'|'Foot'|'Shoulder'|'Elbow'|'Hand')=>`${name}${suffix}` as HumanoidJoint;
  const armWidth=(.88+b.build*.24)*extra,legWidth=.87+b.build*.23;
  // A segment is authored along unit +Y, proximal at -.5, distal at +.5.
  // The binding stretches only its length to the actual IK bone.
  const upperBinding={boneTo:joint('Elbow')},lowerBinding={boneTo:joint('Hand')},thighBinding={boneTo:joint('Knee')},shinBinding={boneTo:joint('Ankle')};
  add(`${name}-upper-sleeve`,joint('Shoulder'),loft([[-.60,.048*armWidth,.052*armWidth],[-.51,.075*armWidth,.082*armWidth],[-.38,.078*armWidth,.081*armWidth],[.08,.073*armWidth,.076*armWidth],[.42,.064*armWidth,.067*armWidth],[.56,.060*armWidth,.064*armWidth]],seed(name+'-upper-sleeve'),.0028,.9,36,3),fabric(top),upperBinding);
  add(`${name}-lower-sleeve`,joint('Elbow'),loft([[-.56,.060*armWidth,.064*armWidth],[-.34,.064*armWidth,.067*armWidth],[.02,.058*armWidth,.061*armWidth],[.34,.048*armWidth,.051*armWidth],[.49,.044*armWidth,.046*armWidth],[.52,.042*armWidth,.044*armWidth]],seed(name+'-lower-sleeve'),.0028,.9,36,3),fabric(top),lowerBinding);
  add(`${name}-sleeve-cuff`,joint('Elbow'),loft([[.39,.0485*armWidth,.0515*armWidth],[.45,.047*armWidth,.049*armWidth],[.54,.0425*armWidth,.0445*armWidth]],seed(name+'-cuff'),.0012,.89,28,2),fabric(shade(top,.80)),lowerBinding);
  add(`${name}-sleeve-stitch`,joint('Shoulder'),cord([[0,-.49,side*.083*armWidth],[.006,-.33,side*.083*armWidth],[.004,.10,side*.078*armWidth],[0,.42,side*.069*armWidth]],.0012),fabric(stitch),upperBinding);
  add(`${name}-thigh`,joint('Hip'),loft([[-.57,.084*depth,.082*legWidth],[-.43,.097*depth,.095*legWidth],[-.15,.092*depth,.094*legWidth],[.24,.080*depth,.081*legWidth],[.48,.073*depth,.074*legWidth],[.56,.069*depth,.071*legWidth]],seed(name+'-thigh'),.0024,.88,36,3),fabric(bottom),thighBinding);
  add(`${name}-shin`,joint('Knee'),loft([[-.57,.072*depth,.073*legWidth],[-.43,.076*depth,.074*legWidth],[-.10,.069*depth,.068*legWidth],[.16,.062*depth,.061*legWidth],[.43,.058*depth,.058*legWidth],[.56,.059*depth,.059*legWidth]],seed(name+'-shin'),.0028,.86,36,3),fabric(bottom),shinBinding);
  add(`${name}-denim-seam`,joint('Hip'),cord([[0,-.43,side*.096*legWidth],[.002,-.1,side*.094*legWidth],[0,.24,side*.083*legWidth],[.002,.49,side*.075*legWidth]],.0011),fabric(shade(bottom,1.28)),thighBinding);
  add(`${name}-lower-seam`,joint('Knee'),cord([[0,-.49,side*.075*legWidth],[.002,-.1,side*.070*legWidth],[0,.21,side*.063*legWidth],[.002,.49,side*.061*legWidth]],.0011),fabric(shade(bottom,1.23)),shinBinding);
  if(spec.outfit.bottom==='cargo'){
   const pocket=loft([[-.20,.036,.008],[.12,.042,.012],[.18,.04,.009]],seed(name+'-cargo'),.0006,.55,24,2);
   add(`${name}-cargo-pocket`,joint('Hip'),moved(pocket,[.004,.012,side*.095*legWidth]),fabric(shade(bottom,.95)),thighBinding);
   add(`${name}-cargo-flap`,joint('Hip'),moved(loft([[-.015,.043,.012],[.085,.042,.013]],seed(name+'-flap'),.0003,.50,24,2),[.004,-.18,side*.098*legWidth]),fabric(shade(bottom,.84)),thighBinding);
  }
  if(coat!=='sweater'){
   const y=coat==='parka'?.035:.14,z=side*hipWidth*.60,x=torsoFront(y)-.010;
   add(`${name}-top-pocket`,'pelvis',moved(panel(.136,.006,.103,seed(name+'-pocket')),[x,y,z]),fabric(shade(top,.94)));
   add(`${name}-top-pocket-flap`,'pelvis',moved(panel(.034,.008,.11,seed(name+'-flap')),[x+.003,y+.061,z]),fabric(shade(top,.87)));
   add(`${name}-pocket-stitch`,'pelvis',cord([[x+.008,y+.063,z-side*.051],[x+.008,y-.057,z-side*.049],[x+.008,y-.065,z],[x+.008,y-.057,z+side*.049],[x+.008,y+.063,z+side*.051]],.001),fabric(stitch));
   if(coat==='jacket')add(`${name}-chest-pocket`,'chest',moved(panel(.094,.004,.080,seed(name+'-chest-pocket')),[bodyDepth+.016,-.035,side*chestWidth*.52]),fabric(shade(top,.90)));
  }
  // The palm and four curved digits are one smooth surfaced mesh. Their local
  // wrist overlaps the cuff; no ball joint or mitten proxy is exposed.
  const handParts:Mesh[]=[loft([[-.096,.016,.026],[-.080,.022,.034],[-.027,.024,.039],[.012,.023,.030],[.026,.020,.025]],seed(name+'-palm'),0,.87,28,3)];
  const fingerLengths=[.063,.079,.075,.059];
  for(let finger=0;finger<4;finger++){
   const length=fingerLengths[finger]!,z=(finger-1.5)*.016;
   handParts.push(moved(loft([[-length,.004,.004,.013],[-length+.008,.008,.007,.014],[-length*.59,.009,.008,.010],[-.012,.010,.009,.003],[.012,.011,.009,0]],seed(name+'-finger-'+finger),0,.96,16,3),[0,-.073,z]));
  }
  handParts.push(moved(loft([[-.066,.006,.007,.011],[-.054,.010,.011,.010],[-.02,.014,.013,.004],[.008,.015,.013]],seed(name+'-thumb'),0,.94,20,3),[.018,-.010,-side*.032]));
  add(`${name}-hand`,joint('Hand'),joined(handParts),{color:skin,roughness:.79},{orientFrom:joint('Elbow')});
  const boot=spec.outfit.shoes==='boots',shoeBinding:Omit<HumanoidBinding,'entity'|'joint'>={foot:name,rotation:[0,side*.025,0]},shoeWidth=1+(b.build-.5)*.07;
  const shoeMesh=loft(boot?[[.033,.145,.072*shoeWidth,.035],[.048,.148,.076*shoeWidth,.035],[.076,.142,.074*shoeWidth,.033],[.112,.104,.071*shoeWidth,.006],[.162,.073,.062*shoeWidth,-.031],[.206,.061,.055*shoeWidth,-.036]]:[[.028,.142,.074*shoeWidth,.035],[.043,.147,.077*shoeWidth,.035],[.067,.140,.075*shoeWidth,.034],[.094,.112,.067*shoeWidth,.013],[.131,.065,.055*shoeWidth,-.036]],seed(name+'-shoe'),.0008,.68,40,3);
  add(`${name}-shoe`,joint('Foot'),shoeMesh,{color:shoes,roughness:boot?.66:.84,...(boot?{}:{pattern:'fabric' as const})},shoeBinding);
  add(`${name}-sole`,joint('Foot'),loft([[0,.137,.071*shoeWidth,.035],[.007,.151,.079*shoeWidth,.035],[.027,.150,.079*shoeWidth,.035],[.035,.146,.076*shoeWidth,.035]],seed(name+'-sole'),0,.65,40,2),{color:boot?[.11,.105,.099,1]:[.71,.70,.65,1],roughness:.93,pattern:'rubber'},shoeBinding);
  add(`${name}-welt`,joint('Foot'),loft([[.031,.149,.078*shoeWidth,.035],[.036,.150,.079*shoeWidth,.035],[.041,.148,.077*shoeWidth,.035]],seed(name+'-welt'),0,.66,40,2),{color:shade(shoes,boot?1.15:.76),roughness:.78},shoeBinding);
  const onShoe=(y:number,z:number):Vec3=>[frontSurface(shoeMesh,y,z)+.0027,y,z];
  const laces:Mesh[]=[];for(let row=0;row<5;row++){
   const y=(boot?.179:.111)-row*(boot?.018:.010),span=.025+row*.0015;
   laces.push(cord([onShoe(y,-span),onShoe(y-.004,0),onShoe(y-.012,span)],.0020,6),cord([onShoe(y,span),onShoe(y-.003,0),onShoe(y-.012,-span)],.0020,6));
  }
  add(`${name}-laces`,joint('Foot'),joined(laces),{color:boot?[.24,.215,.18,1]:[.79,.78,.72,1],roughness:.88},shoeBinding);
  if(boot){
   add(`${name}-boot-collar`,joint('Foot'),loft([[.187,.063,.056*shoeWidth,-.036],[.201,.064,.057*shoeWidth,-.036],[.215,.059,.053*shoeWidth,-.036]],seed(name+'-boot-collar'),.0006,.75,32,2),{color:shade(shoes,.75),roughness:.86},shoeBinding);
   add(`${name}-heel-pull`,joint('Foot'),cord([[-.100,.134,-.015],[-.104,.200,-.015],[-.100,.215,0],[-.104,.200,.015],[-.100,.134,.015]],.0030,8),{color:shade(shoes,.68),roughness:.81},shoeBinding);
  }
 }
 const head=createCharacterHead({id:spec.id,seed:spec.seed,skin,hair:color(spec.colors.hair),expression:spec.expression,hairStyle:spec.hairStyle});
 entities.push(...head.entities);bindings.push(...head.bindings);
 const walker:WalkerSpec={id:spec.id,root:[0,0,0],heading:0,speed:0,period:1.3,heightScale,proportions,bindings};
 const transforms=new Map(bindHumanoid(sampleWalker(walker,0),bindings).map(transform=>[transform.entity,transform]));
 const initialized=entities.map(entity=>{const transform=transforms.get(entity.id);if(!transform)throw new Error(`Unbound character part ${entity.id}`);return{...entity,position:transform.position,rotation:transform.rotation,scale:transform.scale,renderOnly:true};});
 const triangles=initialized.reduce((total,entity)=>{const mesh=entity.renderMesh??entity.mesh;return total+(mesh?mesh.kind==='triangle-mesh'?mesh.indices.length/3:primitiveMesh(mesh).indices.length/3:0);},0);
 return{spec,entities:initialized,walker,metrics:{height:b.height,entityCount:initialized.length,triangles}};
}
