import {readFile,writeFile} from 'node:fs/promises';
import {deflateSync,inflateSync} from 'node:zlib';

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,n)=>{
  let c=n;
  for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
  return c>>>0;
});
const crc32=buffer=>{
  let c=0xffffffff;
  for(const byte of buffer)c=crcTable[(c^byte)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
};
const chunk=(type,data)=>{
  const name=Buffer.from(type,'ascii'),out=Buffer.allocUnsafe(12+data.length);
  out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);
  out.writeUInt32BE(crc32(Buffer.concat([name,data])),8+data.length);
  return out;
};

export async function writePng(path,width,height,rgb){
  if(rgb.length!==width*height*3)throw new RangeError('RGB buffer size mismatch');
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  const raw=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++){const row=y*(width*3+1);raw[row]=0;Buffer.from(rgb.buffer,rgb.byteOffset+y*width*3,width*3).copy(raw,row+1);}
  await writeFile(path,Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]));
}

const paeth=(a,b,c)=>{
  const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
};
export async function readPng(path){
  const bytes=await readFile(path);
  if(bytes.length<33||!bytes.subarray(0,8).equals(signature))throw new TypeError('Not a PNG file');
  let offset=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0;const idat=[];
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);offset+=12+length;
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];interlace=data[12];}
    else if(type==='IDAT')idat.push(data);else if(type==='IEND')break;
  }
  if(bitDepth!==8||interlace!==0||![0,2,4,6].includes(colorType))throw new TypeError('PNG decoder supports non-interlaced grayscale/RGB/RGBA8 only');
  const channels=colorType===0?1:colorType===2?3:colorType===4?2:4,stride=width*channels,packed=inflateSync(Buffer.concat(idat)),scan=Buffer.alloc(stride*height);
  let source=0;
  for(let y=0;y<height;y++){
    const filter=packed[source++],row=y*stride,previous=(y-1)*stride;
    for(let x=0;x<stride;x++){
      const raw=packed[source++],left=x>=channels?scan[row+x-channels]:0,up=y?scan[previous+x]:0,upperLeft=y&&x>=channels?scan[previous+x-channels]:0;
      scan[row+x]=(raw+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,upperLeft):(()=>{throw new TypeError('Unsupported PNG filter');})()))&255;
    }
  }
  const rgb=new Uint8Array(width*height*3);
  for(let i=0,j=0;i<scan.length;i+=channels,j+=3){if(colorType===0||colorType===4){rgb[j]=scan[i];rgb[j+1]=scan[i];rgb[j+2]=scan[i];}else{rgb[j]=scan[i];rgb[j+1]=scan[i+1];rgb[j+2]=scan[i+2];}}
  return{width,height,rgb};
}

const z=value=>Buffer.from(value+'\0','ascii');
const i32=value=>{const b=Buffer.alloc(4);b.writeInt32LE(value);return b;};
const f32=value=>{const b=Buffer.alloc(4);b.writeFloatLE(value);return b;};
const attr=(name,type,data)=>Buffer.concat([z(name),z(type),i32(data.length),data]);
const channel=name=>Buffer.concat([z(name),i32(1),Buffer.from([0,0,0,0]),i32(1),i32(1)]);
const halfScratch=new Float32Array(1),halfBits=new Uint32Array(halfScratch.buffer);
export function floatToHalf(value){
  if(!Number.isFinite(value))return value<0?0xfc00:0x7c00;
  halfScratch[0]=value;const x=halfBits[0],sign=(x>>>16)&0x8000,exp=((x>>>23)&255)-127+15,mantissa=x&0x7fffff;
  if(exp<=0){if(exp<-10)return sign;return sign|((mantissa|0x800000)>>(14-exp));}
  if(exp>=31)return sign|0x7c00;
  return sign|(exp<<10)|(mantissa>>13);
}
export async function writeExr(path,width,height,linearRgb){
  if(linearRgb.length!==width*height*3)throw new RangeError('EXR buffer size mismatch');
  const channels=Buffer.concat([channel('B'),channel('G'),channel('R'),Buffer.from([0])]);
  const box=Buffer.alloc(16);box.writeInt32LE(0,0);box.writeInt32LE(0,4);box.writeInt32LE(width-1,8);box.writeInt32LE(height-1,12);
  const header=Buffer.concat([
    Buffer.from([0x76,0x2f,0x31,0x01]),Buffer.from([2,0,0,0]),
    attr('channels','chlist',channels),attr('compression','compression',Buffer.from([0])),
    attr('dataWindow','box2i',box),attr('displayWindow','box2i',box),
    attr('lineOrder','lineOrder',Buffer.from([0])),attr('pixelAspectRatio','float',f32(1)),
    attr('screenWindowCenter','v2f',Buffer.concat([f32(0),f32(0)])),attr('screenWindowWidth','float',f32(1)),Buffer.from([0]),
  ]);
  const scanlineSize=8+width*2*3,offsetTable=Buffer.alloc(height*8),blocks=[];let cursor=header.length+offsetTable.length;
  for(let y=0;y<height;y++){
    offsetTable.writeBigUInt64LE(BigInt(cursor),y*8);
    const block=Buffer.alloc(scanlineSize);block.writeInt32LE(y,0);block.writeInt32LE(width*6,4);let p=8;
    for(const channelIndex of [2,1,0])for(let x=0;x<width;x++){block.writeUInt16LE(floatToHalf(linearRgb[(y*width+x)*3+channelIndex]),p);p+=2;}
    blocks.push(block);cursor+=block.length;
  }
  await writeFile(path,Buffer.concat([header,offsetTable,...blocks]));
}
