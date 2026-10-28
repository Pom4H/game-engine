/** One deterministic HDR input for every backend. Radiance is authored before
 * scene creation, so motion does not add Engine-only dynamic IBL work. */
let cached;
export function fixedEnvironmentRadiance(){
 if(cached)return cached;
 const width=256,height=128,bytes=new Uint8Array(width*height*6),view=new DataView(bytes.buffer),float=new Float32Array(1),bits=new Uint32Array(float.buffer);
 function half(value){float[0]=value;const word=bits[0],sign=(word>>>16)&0x8000,exp=((word>>>23)&255)-127+15,mantissa=word&0x7fffff;if(exp<=0)return exp<-10?sign:sign|((mantissa|0x800000)>>(14-exp));return sign|(exp<<10)|(mantissa>>13);}
 const sky=[.16,.24,.38],horizon=[.36,.4,.46],ground=[.12,.13,.15];
 for(let y=0;y<height;y++){const up=Math.cos(y/(height-1)*Math.PI),t=Math.sqrt(Math.abs(up)),target=up>=0?sky:ground;for(let x=0;x<width;x++)for(let c=0;c<3;c++)view.setUint16(((y*width+x)*3+c)*2,half(horizon[c]*(1-t)+target[c]*t),true);}
 let binary='';for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
 cached=Object.freeze({width,height,rgb16fBase64:btoa(binary),convention:'latlong-y-up',intensity:1});return cached;
}
