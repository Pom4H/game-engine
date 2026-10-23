/** Full-precision world XYZ is observed, not reconstructed from a different
 * renderer. Validate the accompanying exact float32 instance index against
 * the actual frustum set; -1 identifies regular draws and depth 1 background. */
export function worldInputIndexAgreement(probe,depth,sourceCount,visible){
 if(probe.encoding!=='rgba32float raw words'||probe.channels!==4||depth.encoding!=='depth32float raw words'||depth.channels!==1||probe.width!==depth.width||probe.height!==depth.height||probe.pixels.length!==depth.pixels.length*4||!Number.isSafeInteger(sourceCount)||sourceCount<1||sourceCount>16777216)throw new Error('Unexpected full-precision world input format/extent');
 const allowed=new Set(visible);if(allowed.size!==visible.length||[...allowed].some(index=>!Number.isSafeInteger(index)||index<0||index>=sourceCount))throw new Error('Invalid world input visible set');
 const values=new Float32Array(probe.pixels.buffer,probe.pixels.byteOffset,probe.pixels.length),depthValues=new Float32Array(depth.pixels.buffer,depth.pixels.byteOffset,depth.pixels.length);
 let backgroundPixels=0,nonInstancedPixels=0,instancedPixels=0,invalidIndexPixels=0;const coordinates=[];
 for(let n=0;n<depthValues.length;n++){
  const d=depthValues[n];if(!Number.isFinite(d)||d<0||d>1)throw new Error('Invalid world input depth');if(d===1){backgroundPixels++;continue;}
  const index=values[n*4+3];for(let channel=0;channel<4;channel++)if(!Number.isFinite(values[n*4+channel]))throw new Error('Non-finite world input');
  if(index===-1){nonInstancedPixels++;continue;}instancedPixels++;
  if(!Number.isSafeInteger(index)||!allowed.has(index)){invalidIndexPixels++;if(coordinates.length<12)coordinates.push({x:n%probe.width,y:Math.floor(n/probe.width),index});}
 }
 const coveredPixels=nonInstancedPixels+instancedPixels;if(!coveredPixels)throw new Error('World input has no covered pixels');
 return{sourceCount,backgroundPixels,nonInstancedPixels,instancedPixels,coveredPixels,invalidIndexPixels,checkedChannels:coveredPixels*4,coordinates};
}
