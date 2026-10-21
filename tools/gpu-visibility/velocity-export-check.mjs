/** Compare two binary16 exports of the same interpolated fragment velocity.
 * Depth 1 is background: its normal and velocity clear values intentionally
 * differ. Compare every covered channel, including signed zero, exactly. */
export function velocityExportAgreement(probe,velocity,depth){
 const {width,height}=probe;
 for(const [stage,channels,encoding] of [[probe,4,'rgba16float raw words'],[velocity,2,'rg16float raw words'],[depth,1,'depth32float raw words']]){
  if(stage.width!==width||stage.height!==height||stage.channels!==channels||stage.encoding!==encoding||stage.pixels.length!==width*height*channels)throw new Error('Velocity export format/extent changed');
 }
 if(!(probe.pixels instanceof Uint16Array)||!(velocity.pixels instanceof Uint16Array)||!(depth.pixels instanceof Uint32Array))throw new Error('Velocity export word type changed');
 const depths=new Float32Array(depth.pixels.buffer,depth.pixels.byteOffset,depth.pixels.length),coordinates=[];
 let coveredPixels=0,backgroundPixels=0,changedChannels=0,maxEncodedError=0;
 for(let pixel=0;pixel<width*height;pixel++){
  const d=depths[pixel];if(!Number.isFinite(d)||d<0||d>1)throw new Error('Invalid velocity export depth');
  if(d===1){backgroundPixels++;continue;}
  coveredPixels++;
  for(let channel=0;channel<2;channel++){
   const before=probe.pixels[pixel*4+channel],after=velocity.pixels[pixel*2+channel];
   if((before&0x7c00)===0x7c00||(after&0x7c00)===0x7c00)throw new Error('Non-finite velocity export');
   if(before!==after){changedChannels++;maxEncodedError=Math.max(maxEncodedError,Math.abs(before-after));if(coordinates.length<12)coordinates.push({x:pixel%width,y:Math.floor(pixel/width),channel,before,after});}
  }
 }
 if(!coveredPixels)throw new Error('Velocity export observation has no covered pixels');
 return{coveredPixels,backgroundPixels,checkedChannels:coveredPixels*2,changedChannels,maxEncodedError,coordinates};
}
