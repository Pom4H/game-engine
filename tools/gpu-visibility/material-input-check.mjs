import {halfToFloat} from '../engine-compare/fixture.mjs';

const positiveHalves=Float32Array.from({length:0x7c00},(_,word)=>halfToFloat(word));
// WGSL permits either adjacent representable result when conversion is inexact.
// These bounds describe input conversion; cross-frame pixel checks stay exact.
function conversionBounds(value){
 if(!Number.isFinite(value)||value<0||value>65504)throw new Error('Unsupported material input color');
 let low=0,high=0x7bff;while(low<high){const middle=(low+high)>>>1;if(positiveHalves[middle]<value)low=middle+1;else high=middle;}
 return[positiveHalves[low]===value?low:low-1,low];
}

/** Source index is exported as a binary16 word in [1024, count+1023], using
 * exactly representable normal values. This avoids a lossy f32 -> f16 integer
 * cast. The sentinel 0x7bff identifies non-instanced material entry points. */
export function materialInputAgreement(probe,depth,source,visible){
 const {width,height}=probe,count=source.length/40,pixels=width*height;
 if(!(source instanceof Float32Array)||!Number.isSafeInteger(count)||count<1||count>30719)throw new Error('Material input source ABI/count changed');
 if(!(probe.pixels instanceof Uint16Array)||probe.channels!==4||probe.encoding!=='rgba16float raw words'||probe.pixels.length!==pixels*4||!(depth.pixels instanceof Uint32Array)||depth.width!==width||depth.height!==height||depth.channels!==1||depth.encoding!=='depth32float raw words'||depth.pixels.length!==pixels)throw new Error('Material input format/extent changed');
 const bounds=new Uint16Array(count*6),visibleMask=new Uint8Array(count),depths=new Float32Array(depth.pixels.buffer,depth.pixels.byteOffset,depth.pixels.length);
 for(let index=0;index<count;index++)for(let channel=0;channel<3;channel++)bounds.set(conversionBounds(source[index*40+32+channel]),index*6+channel*2);
 for(const index of visible){if(!Number.isSafeInteger(index)||index<0||index>=count)throw new Error('Invalid material input visible set');visibleMask[index]=1;}
 let backgroundPixels=0,nonInstancedPixels=0,instancedPixels=0,invalidIndexPixels=0,changedChannels=0,maxEncodedError=0;const coordinates=[];
 for(let pixel=0;pixel<pixels;pixel++){
  const d=depths[pixel];if(!Number.isFinite(d)||d<0||d>1)throw new Error('Invalid material input depth');if(d===1){backgroundPixels++;continue;}
  const indexWord=probe.pixels[pixel*4+3];if(indexWord===0x7bff){nonInstancedPixels++;continue;}
  instancedPixels++;const index=indexWord-1024;
  if(index<0||index>=count||!visibleMask[index]){invalidIndexPixels++;if(coordinates.length<12)coordinates.push({x:pixel%width,y:Math.floor(pixel/width),indexWord,index,reason:'source index is outside the recorded visible set'});continue;}
  for(let channel=0;channel<3;channel++){
   const actual=probe.pixels[pixel*4+channel],floor=bounds[index*6+channel*2],ceil=bounds[index*6+channel*2+1];
   if(actual<floor||actual>ceil){changedChannels++;maxEncodedError=Math.max(maxEncodedError,Math.min(Math.abs(actual-floor),Math.abs(actual-ceil)));if(coordinates.length<12)coordinates.push({x:pixel%width,y:Math.floor(pixel/width),channel,index,actual,floor,ceil,source:source[index*40+32+channel],linearActual:halfToFloat(actual)});}
  }
 }
 if(!instancedPixels)throw new Error('Material input observation has no instanced pixels');
 return{sourceCount:count,backgroundPixels,nonInstancedPixels,instancedPixels,invalidIndexPixels,checkedChannels:(instancedPixels-invalidIndexPixels)*3,changedChannels,maxEncodedError,coordinates};
}
