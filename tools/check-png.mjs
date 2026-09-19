import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

const file=process.argv[2];if(!file)throw Error('usage: node tools/check-png.mjs <image.png>');
const bytes=readFileSync(file);
if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a')throw Error('not a PNG');
let offset=8,width=0,height=0,bitDepth=0,colorType=0,idat=[];
while(offset<bytes.length){
  const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);offset+=12+length;
  if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];}
  if(type==='IDAT')idat.push(data);
  if(type==='IEND')break;
}
if(bitDepth!==8||![2,6].includes(colorType))throw Error(`unsupported PNG format depth=${bitDepth} color=${colorType}`);
const channels=colorType===6?4:3,stride=width*channels,raw=inflateSync(Buffer.concat(idat)),pixels=Buffer.alloc(stride*height);
let src=0;
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
for(let y=0;y<height;y++){
  const filter=raw[src++],row=y*stride,prev=(y-1)*stride;
  for(let x=0;x<stride;x++){
    const v=raw[src++],a=x>=channels?pixels[row+x-channels]:0,b=y?pixels[prev+x]:0,c=y&&x>=channels?pixels[prev+x-channels]:0;
    pixels[row+x]=(v+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):(()=>{throw Error(`PNG filter ${filter}`)})()))&255;
  }
}
let sum=0,sum2=0,visible=0,count=width*height;
for(let i=0;i<count;i++){
  const r=pixels[i*channels],g=pixels[i*channels+1],b=pixels[i*channels+2],y=.2126*r+.7152*g+.0722*b;sum+=y;sum2+=y*y;if(y>18)visible++;
}
const mean=sum/count,stdev=Math.sqrt(Math.max(0,sum2/count-mean*mean)),visibleRatio=visible/count;
console.log(JSON.stringify({file,width,height,mean:+mean.toFixed(2),stdev:+stdev.toFixed(2),visibleRatio:+visibleRatio.toFixed(4)}));
if(stdev<4||visibleRatio<.02)throw Error(`render is visually empty: stdev=${stdev.toFixed(2)} visible=${(visibleRatio*100).toFixed(2)}%`);
