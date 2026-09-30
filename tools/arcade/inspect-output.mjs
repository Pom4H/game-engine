import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const path='artifacts/snowy-arcade.png';
const png=await readFile(path);
assert.equal(png.subarray(1,4).toString(),'PNG');
const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
const ffmpeg=args=>{const r=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',path,...args],{maxBuffer:width*height*4+1048576,windowsHide:true});if(r.status!==0)throw new Error(String(r.stderr));return r.stdout;};
const pixels=ffmpeg(['-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
assert.equal(pixels.length,width*height*3);
const hist=Array(256).fill(0);let edges=0,squares=0,sum=0;
for(let i=0;i<pixels.length;i+=3){const l=Math.round(pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722);hist[l]++;sum+=l;squares+=l*l;if((i/3)%width)edges+=Math.abs(pixels[i]-pixels[i-3]);}
const summary={width,height,pngBytes:png.length,pngSha256:createHash('sha256').update(png).digest('hex'),meanLuma:sum/(width*height),lumaStd:Math.sqrt(squares/(width*height)-(sum/(width*height))**2),meanHorizontalRedEdge:edges/(width*height),usedLumaLevels:hist.filter(Boolean).length};
await writeFile('artifacts/pixel-inspection.json',JSON.stringify(summary,null,2));
console.log('PIXEL_INSPECTION='+JSON.stringify(summary));
// Lossless native-pixel crop of the nearest illuminated shop. No resampling,
// grading or generated detail: distinguish actual renderer blur from preview loss.
const crop=[512,320,Math.floor(width*.42),Math.floor(height*.62)];
ffmpeg(['-vf',`crop=${crop.join(':')}`,'-c:v','libwebp','-lossless','1','-compression_level','6','artifacts/native-crop.webp']);
console.log('NATIVE_CROP_WEBP='+(await readFile('artifacts/native-crop.webp')).toString('base64'));
ffmpeg(['-vf','scale=960:-2:flags=lanczos','-c:v','libwebp','-lossless','1','artifacts/lossless-review.webp']);
const review=await readFile('artifacts/lossless-review.webp');
console.log('LOSSLESS_REVIEW_BYTES='+review.length);
console.log('LOSSLESS_REVIEW_SHA256='+createHash('sha256').update(review).digest('hex'));
console.log('LOSSLESS_REVIEW_WEBP='+review.toString('base64'));
