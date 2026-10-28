/** Native floating-point texture copies preserve raw words, including signed
 * zero. Strip row padding without converting or packing the pixel values. */
export function colorCopyPlan(format,width,height){
 if(!['rgba16float','rgba32float'].includes(format)||![width,height].every(value=>Number.isSafeInteger(value)&&value>0))throw new Error('Unexpected floating color format/extent');
 const componentBytes=format==='rgba32float'?4:2,pixelBytes=componentBytes*4,row=Math.ceil(width*pixelBytes/256)*256;
 return{format,width,height,componentBytes,pixelBytes,row,bytes:row*height};
}
export function decodeColorCopy(mapped,plan){
 if(!(mapped instanceof Uint8Array)||mapped.byteLength<plan.bytes)throw new Error('Incomplete floating color copy');
 const pixels=plan.componentBytes===4?new Uint32Array(plan.width*plan.height*4):new Uint16Array(plan.width*plan.height*4),line=plan.width*plan.pixelBytes;
 for(let y=0;y<plan.height;y++)new Uint8Array(pixels.buffer,y*line,line).set(mapped.subarray(y*plan.row,y*plan.row+line));
 const mask=plan.componentBytes===4?0x7f800000:0x7c00;
 if(pixels.some(word=>(word&mask)===mask))throw new Error('Non-finite floating color copy');
 return{width:plan.width,height:plan.height,channels:4,encoding:plan.format+' raw words',pixels};
}
