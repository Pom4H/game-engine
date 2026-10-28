/** Native-authority storage only. Rendering clients never write world state. */
export async function openSnowArchive(directory){
 const fs=await import('node:fs'),path=await import('node:path');fs.mkdirSync(directory,{recursive:true});const tileM=8,available=new Set(fs.readdirSync(directory).filter(n=>/^8_-?\d+_-?\d+\.json$/.test(n))),cache=new Map();let cachedRows=0;
 function insert(tile,row){const [x,,z]=row[0].split(','),key=x+','+z;let column=tile.columns.get(key);if(!column){column={x:Number(x),z:Number(z),rows:new Map()};tile.columns.set(key,column);}column.rows.set(row[0],row);tile.rows.set(row[0],row);}
 const rowsFor=key=>{if(cache.has(key)){const tile=cache.get(key);cache.delete(key);cache.set(key,tile);return tile;}const file=path.join(directory,key),tile={rows:new Map(),columns:new Map()};for(const row of fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[])insert(tile,row);cache.set(key,tile);cachedRows+=tile.rows.size;while(cache.size>1&&(cache.size>1024||cachedRows>750000)){const oldest=cache.keys().next().value;cachedRows-=cache.get(oldest).rows.size;cache.delete(oldest);}return tile;};
 return{update(world,{evict=true}={}){
  const snow=world.snow,focus=[...world.cars.map(c=>({p:c.rig.body.position,r:24})),{p:world.service.rig.body.position,r:24}];if(world.scene?.camera?.target)focus.push({p:world.scene.camera.target,r:45});
  const small=[...[...world.people.actors.values()].map(a=>({p:a.p,r:6})),...[...(world.people.balls?.values()??[])].map(b=>({p:b.p,r:Math.max(2,b.radius+1)}))],grid=new Map();
  for(const f of small){const key=Math.floor(f.p[0]/8)+':'+Math.floor(f.p[2]/8);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(f);}
  const within=(x,z,f)=>{const dx=x-f.p[0],dz=z-f.p[2];return dx*dx+dz*dz<f.r*f.r;};
  const near=(x,z)=>{if(focus.some(f=>within(x,z,f)))return true;const gx=Math.floor(x/8),gz=Math.floor(z/8);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(grid.get((gx+dx)+':'+(gz+dz))?.some(f=>within(x,z,f)))return true;return false;};
  const groups=new Map();for(const row of evict?snow.detachWhere((x,z)=>!near(x,z)):[]){const [x,,z]=row[0].split(',').map(Number),key='8_'+Math.floor(x*snow.cellM/tileM)+'_'+Math.floor(z*snow.cellM/tileM)+'.json';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const [key,rows]of groups){const tile=rowsFor(key);let dirty=false;for(const row of rows){const old=tile.rows.get(row[0]);if(old&&old.every((v,i)=>v===row[i]))continue;if(!old)cachedRows++;insert(tile,row);dirty=true;}if(dirty){const file=path.join(directory,key),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify([...tile.rows.values()]));fs.renameSync(temp,file);available.add(key);}}
  // Enumerate local candidates, never the whole infinite archive. Check a
  // column once; its material rows are detached and restored together.
  const candidates=new Set();for(const f of [...focus,...small])for(let tx=Math.floor((f.p[0]-f.r)/tileM);tx<=Math.floor((f.p[0]+f.r)/tileM);tx++)for(let tz=Math.floor((f.p[2]-f.r)/tileM);tz<=Math.floor((f.p[2]+f.r)/tileM);tz++){const key='8_'+tx+'_'+tz+'.json';if(available.has(key))candidates.add(key);}
  for(const key of candidates){const tile=rowsFor(key),rows=[];for(const column of tile.columns.values()){if(snow.cells.has(column.rows.keys().next().value)||!near((column.x+.5)*snow.cellM,(column.z+.5)*snow.cellM))continue;rows.push(...column.rows.values());}if(rows.length)snow.apply(rows,true);}
 }};
}
