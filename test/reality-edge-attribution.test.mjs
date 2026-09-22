import test from 'node:test';
import assert from 'node:assert/strict';
import {measureEdgeAttribution} from '../tools/reality/edge-attribution.mjs';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function legacyEdge(width,height,active,production,reference){
  const grad=(values,x,y)=>{
    const at=(xx,yy)=>values[Math.max(0,Math.min(height-1,yy))*width+Math.max(0,Math.min(width-1,xx))];
    const gx=-at(x-1,y-1)+at(x+1,y-1)-2*at(x-1,y)+2*at(x+1,y)-at(x-1,y+1)+at(x+1,y+1);
    const gy=-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1)+at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1);
    return [gx,gy];
  };
  let numerator=0,denominator=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(!active[i])continue;
    const [px,py]=grad(production,x,y),[rx,ry]=grad(reference,x,y),pm=Math.hypot(px,py),rm=Math.hypot(rx,ry);
    const magnitude=Math.abs(pm-rm),orientation=pm>.005&&rm>.005?1-clamp((px*rx+py*ry)/(pm*rm),-1,1)*.5-.5:0;
    numerator+=magnitude+orientation*rm*.35;denominator+=rm+.025;
  }
  return clamp(numerator/Math.max(1e-9,denominator));
}

test('edge attribution preserves the existing aggregate RealityGap edge component exactly',()=>{
  const width=13,height=11,n=width*height,active=new Uint8Array(n),production=new Float32Array(n),reference=new Float32Array(n);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;active[i]=1;
    reference[i]=x<6?.18:.82;
    production[i]=x<7?.22:.78;
  }
  const measured=measureEdgeAttribution({width,height,active,productionLuma:production,referenceLuma:reference,boundaryRadiusPx:1});
  assert.equal(measured.aggregate,legacyEdge(width,height,active,production,reference));
  assert.equal(measured.boundaryPixels+measured.interiorPixels,active.reduce((sum,value)=>sum+value,0));
  assert.ok(Math.abs(measured.errorShare.boundary+measured.errorShare.interior-1)<1e-12);
  assert.ok(Math.abs(measured.referenceWeightShare.boundary+measured.referenceWeightShare.interior-1)<1e-12);
});

test('edge attribution separates interior appearance error from mask-boundary error',()=>{
  const width=17,height=17,n=width*height,active=new Uint8Array(n),production=new Float32Array(n),reference=new Float32Array(n);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;active[i]=1;
    reference[i]=x<8?.1:.9;
    production[i]=x<9?.1:.9;
  }
  const measured=measureEdgeAttribution({width,height,active,productionLuma:production,referenceLuma:reference,boundaryRadiusPx:1});
  assert.ok(measured.interiorPixels>measured.boundaryPixels);
  assert.ok(measured.errorShare.interior>.60);
  assert.ok(measured.interior>measured.boundary);
});

test('edge attribution rejects mismatched buffers and invalid radii',()=>{
  assert.throws(()=>measureEdgeAttribution({width:2,height:2,active:new Uint8Array(3),productionLuma:new Float32Array(4),referenceLuma:new Float32Array(4)}),/buffers/);
  assert.throws(()=>measureEdgeAttribution({width:2,height:2,active:new Uint8Array(4),productionLuma:new Float32Array(4),referenceLuma:new Float32Array(4),boundaryRadiusPx:0}),/radius/);
});
