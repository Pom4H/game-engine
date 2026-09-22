const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));

function gradient(values,width,height,x,y){
  const at=(xx,yy)=>values[Math.max(0,Math.min(height-1,yy))*width+Math.max(0,Math.min(width-1,xx))];
  const gx=-at(x-1,y-1)+at(x+1,y-1)-2*at(x-1,y)+2*at(x+1,y)-at(x-1,y+1)+at(x+1,y+1);
  const gy=-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1)+at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1);
  return [gx,gy];
}

function nearMaskBoundary(active,width,height,x,y,radius){
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(dx*dx+dy*dy>radius*radius)continue;
    const xx=x+dx,yy=y+dy;
    if(xx<0||yy<0||xx>=width||yy>=height||!active[yy*width+xx])return true;
  }
  return false;
}

export function measureEdgeAttribution({
  width,
  height,
  active,
  productionLuma,
  referenceLuma,
  boundaryRadiusPx=Math.max(2,Math.round(Math.min(width,height)/128)),
}){
  if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1)throw new RangeError('Edge attribution dimensions must be positive integers');
  const n=width*height;
  if(active.length!==n||productionLuma.length!==n||referenceLuma.length!==n)throw new RangeError('Edge attribution buffers must match dimensions');
  if(!Number.isFinite(boundaryRadiusPx)||boundaryRadiusPx<1)throw new RangeError('Edge attribution boundary radius must be positive');
  const radius=Math.max(1,Math.round(boundaryRadiusPx));
  let totalNumerator=0,totalDenominator=0,boundaryNumerator=0,boundaryDenominator=0,interiorNumerator=0,interiorDenominator=0,boundaryPixels=0,interiorPixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(!active[i])continue;
    const [px,py]=gradient(productionLuma,width,height,x,y),[rx,ry]=gradient(referenceLuma,width,height,x,y),pm=Math.hypot(px,py),rm=Math.hypot(rx,ry);
    const magnitude=Math.abs(pm-rm),orientation=pm>.005&&rm>.005?1-clamp((px*rx+py*ry)/(pm*rm),-1,1)*.5-.5:0;
    const numerator=magnitude+orientation*rm*.35,denominator=rm+.025;
    totalNumerator+=numerator;totalDenominator+=denominator;
    if(nearMaskBoundary(active,width,height,x,y,radius)){
      boundaryNumerator+=numerator;boundaryDenominator+=denominator;boundaryPixels++;
    }else{
      interiorNumerator+=numerator;interiorDenominator+=denominator;interiorPixels++;
    }
  }
  const score=(numerator,denominator)=>clamp(numerator/Math.max(1e-9,denominator));
  const share=(part,total)=>total>1e-12?part/total:0;
  return Object.freeze({
    aggregate:score(totalNumerator,totalDenominator),
    boundary:score(boundaryNumerator,boundaryDenominator),
    interior:score(interiorNumerator,interiorDenominator),
    radiusPx:radius,
    boundaryPixels,
    interiorPixels,
    errorShare:Object.freeze({
      boundary:share(boundaryNumerator,totalNumerator),
      interior:share(interiorNumerator,totalNumerator),
    }),
    referenceWeightShare:Object.freeze({
      boundary:share(boundaryDenominator,totalDenominator),
      interior:share(interiorDenominator,totalDenominator),
    }),
  });
}
