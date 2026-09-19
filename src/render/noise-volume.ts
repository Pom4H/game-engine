/** A shared, periodic value-noise lattice for procedural material shading.
 * Upload once per renderer: the fragment shader interpolates eight neighbouring
 * values in hardware instead of recomputing eight vector hashes per octave. */
export const NOISE_VOLUME_SIZE=64;
export function createNoiseVolume(device:any):any{
 const size=NOISE_VOLUME_SIZE,data=new Uint8Array(size**3);
 for(let i=0;i<data.length;i++){
  let h=Math.imul(i^0x9e3779b9,0x85ebca6b);h=Math.imul(h^(h>>>13),0xc2b2ae35);h^=h>>>16;data[i]=h>>>24;
 }
 const texture=device.createTexture({label:'Procedural material noise lattice',size:[size,size,size],dimension:'3d',format:'r8unorm',usage:0x04|0x02});
 device.queue.writeTexture({texture},data,{bytesPerRow:size,rowsPerImage:size},[size,size,size]);return texture;
}
