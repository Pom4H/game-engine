import {freezePrimitive} from '../../dist/procedural/mesh.js';
/** The physical volume supplies heights and optical state. The outer ring
 * keeps a continuous snowfall out to the visible city without fine triangles. */
export class SnowView{
 constructor(world){this.world=world;this.tiles=new Map();this.farKey='';this.flatMeshes=new Map();this.modifiedTiles=new Set();this.farColumns=new Map();}
 sample(x,z){
  // Interpolate the physical cell centres, without inventing a second height field.
  const snow=this.world.snow,s=snow.cellM,fx=x/s-.5,fz=z/s-.5,ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz;
  const samples=[snow.sample((ix+.5)*s,(iz+.5)*s),snow.sample((ix+1.5)*s,(iz+.5)*s),snow.sample((ix+.5)*s,(iz+1.5)*s),snow.sample((ix+1.5)*s,(iz+1.5)*s)],w=[(1-tx)*(1-tz),tx*(1-tz),(1-tx)*tz,tx*tz],result={};
  for(const key of ['height','compaction','liquidFraction'])result[key]=samples.reduce((sum,v,i)=>sum+v[key]*w[i],0);
  return result;
 }
 mesh(x,z,width,depth,nx,nz,flat=false,stitch=[false,false,false,false]){
  const key=[width,depth,nx,nz].join(':');if(flat&&this.flatMeshes.has(key))return this.flatMeshes.get(key);
  const snow=this.world.snow,positions=[],indices=[],normals=[],colors=[],edgeNormals=new Map();
  const at=(px,pz)=>flat?{height:snow.depthM,compaction:0,liquidFraction:0}:this.sample(px,pz);
  const normalAt=(px,pz)=>{const key=px.toFixed(6)+','+pz.toFixed(6);let value=edgeNormals.get(key);if(!value){const s=snow.cellM,dx=(at(px-s,pz).height-at(px+s,pz).height)/(2*s),dz=(at(px,pz-s).height-at(px,pz+s).height)/(2*s),length=Math.hypot(dx,1,dz);value=[dx/length,1/length,dz/length];edgeNormals.set(key,value);}return value;};
  const edgeSpan=(ix,iz)=>{
   if(ix===0&&stitch[0]||ix===nx&&stitch[1]){const value=iz/nz*depth,lo=Math.floor(value),hi=Math.ceil(value);return [[x+ix/nx*width,z+lo],[x+ix/nx*width,z+hi],value-lo];}
   if(iz===0&&stitch[2]||iz===nz&&stitch[3]){const value=ix/nx*width,lo=Math.floor(value),hi=Math.ceil(value);return [[x+lo,z+iz/nz*depth],[x+hi,z+iz/nz*depth],value-lo];}
  };
  const blend=(a,b,t)=>Object.fromEntries(['height','compaction','liquidFraction'].map(k=>[k,a[k]+(b[k]-a[k])*t]));
  const colorOf=s=>{const bare=Math.max(0,1-s.height/.04),dark=Math.min(.55,s.compaction*.22+s.liquidFraction*.36);return [.96,.98,.995].map((v,k)=>v*(1-dark)*(1-bare)+[.1,.12,.15][k]*bare);};
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
   const px=x+ix/nx*width,pz=z+iz/nz*depth,span=edgeSpan(ix,iz),a=span?at(...span[0]):at(px,pz),b=span?at(...span[1]):a,s=span?blend(a,b,span[2]):a,ca=colorOf(a),cb=span?colorOf(b):ca,color=span?ca.map((v,k)=>v+(cb[k]-v)*span[2]):ca;
   positions.push(ix/nx*width,s.height+.002,iz/nz*depth);normals.push(0,1,0);colors.push(...color,1);
  }
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1;indices.push(a,c,b,b,c,c+1);}
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
   const at=(iz*(nx+1)+ix)*3,lo=Math.max(0,ix-1),hi=Math.min(nx,ix+1),down=Math.max(0,iz-1),up=Math.min(nz,iz+1);
   if(!flat&&(ix===0||ix===nx||iz===0||iz===nz)){
    const span=edgeSpan(ix,iz),a=normalAt(x+ix/nx*width,z+iz/nz*depth),n=span?normalAt(...span[0]).map((v,k)=>v+(normalAt(...span[1])[k]-v)*span[2]):a;
    const length=Math.hypot(...n);for(let k=0;k<3;k++)normals[at+k]=n[k]/length;continue;
   }
   const dx=(positions[(iz*(nx+1)+lo)*3+1]-positions[(iz*(nx+1)+hi)*3+1])/((hi-lo)*width/nx),dz=(positions[(down*(nx+1)+ix)*3+1]-positions[(up*(nx+1)+ix)*3+1])/((up-down)*depth/nz),length=Math.hypot(dx,1,dz);normals[at]=dx/length;normals[at+1]=1/length;normals[at+2]=dz/length;
  }
  const result=freezePrimitive({kind:'triangle-mesh',positions,normals,indices,colors},!flat);if(flat)this.flatMeshes.set(key,result);return result;
 }
 install(id,mesh,position){const {scene}=this.world,e=scene.entities.get(id);if(e){e.mesh=mesh;scene.renderStructureRevision++;}else scene.add({id,visualOnly:true,mesh,material:{kind:'snow',color:[1,1,1,1],roughness:.88}});scene.setVisualTransform(id,position);}
 update(){
  const {scene,snow}=this.world,eye=scene.camera.target,size=6,cx=Math.floor(eye[0]/size),cz=Math.floor(eye[2]/size),keep=new Set(),dirty=snow.changedColumns;
  // Changes on tile edges affect both meshes, including their seam normals.
  const farDirty=new Set();for(const key of dirty)for(const index of this.farColumns.get(key)??[])farDirty.add(index);
  const affected=new Set();for(const key of dirty){const [x,z]=key.split(',').map(Number);for(const dx of [-2*snow.cellM,0,2*snow.cellM])for(const dz of [-2*snow.cellM,0,2*snow.cellM])affected.add(Math.floor((x*snow.cellM+dx)/size)+','+Math.floor((z*snow.cellM+dz)/size));}for(const k of affected)this.modifiedTiles.add(k);dirty.clear();
  for(let dz=-6;dz<=6;dz++)for(let dx=-6;dx<=6;dx++){
   const x=cx+dx,z=cz+dz,key=x+','+z,steps=Math.hypot(dx,dz)<3?30:6,stitch=[Math.hypot(dx-1,dz)>=3,Math.hypot(dx+1,dz)>=3,Math.hypot(dx,dz-1)>=3,Math.hypot(dx,dz+1)>=3].map(v=>steps===30&&v),edgeKey=stitch.join(':');keep.add(key);const old=this.tiles.get(key);if(old?.steps===steps&&old?.edgeKey===edgeKey&&!affected.has(key))continue;
   this.install('snow-volume:'+key,this.mesh(x*size,z*size,size,size,steps,steps,!this.modifiedTiles.has(key),stitch),[x*size,0,z*size]);this.tiles.set(key,{steps,edgeKey});
  }
  for(const [key]of this.tiles)if(!keep.has(key)){scene.remove('snow-volume:'+key);this.tiles.delete(key);}
  if(this.modifiedTiles.size>4096){this.modifiedTiles.clear();for(const key of snow.editedColumns()){const [x,z]=key.split(',').map(Number);this.modifiedTiles.add(Math.floor(x*snow.cellM/size)+','+Math.floor(z*snow.cellM/size));}}
  const farKey=cx+','+cz;if(farKey!==this.farKey||farDirty.size){
   const left=(cx-6)*size,right=(cx+7)*size,back=(cz-6)*size,front=(cz+7)*size,extent=144;
   const rectangles=[[left-extent,back-extent,right-left+2*extent,extent],[left-extent,front,right-left+2*extent,extent],[left-extent,back,extent,front-back],[right,back,extent,front-back]];
   const moved=farKey!==this.farKey;if(moved)this.farColumns.clear();
   rectangles.forEach(([x,z,w,d],i)=>{if(!moved&&!farDirty.has(i))return;const nx=Math.ceil(w/6),nz=Math.ceil(d/6);this.install('snow-volume:far'+i,this.mesh(x,z,w,d,nx,nz),[x,0,z]);if(moved)for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){const bx=Math.floor((x+ix/nx*w)/snow.cellM-.5),bz=Math.floor((z+iz/nz*d)/snow.cellM-.5);for(const dx of [0,1])for(const dz of [0,1]){const key=(bx+dx)+','+(bz+dz);if(!this.farColumns.has(key))this.farColumns.set(key,new Set());this.farColumns.get(key).add(i);}}});this.farKey=farKey;
  }
 }
 dispose(){for(const key of this.tiles.keys())this.world.scene.remove('snow-volume:'+key);for(let i=0;i<4;i++)this.world.scene.remove('snow-volume:far'+i);this.tiles.clear();}
}
