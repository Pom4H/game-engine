import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const input=resolve(process.argv[2]??'artifacts/m3-reference-import/m3.json');
const output=resolve(process.argv[3]??'artifacts/m3-shell.generated.ts');
const targetFit=Number(process.env.M3_SHELL_TARGET_FIT??.9999);
if(!Number.isFinite(targetFit)||targetFit<=0||targetFit>1)throw new RangeError('M3_SHELL_TARGET_FIT must be in (0,1]');

const asset=JSON.parse(await readFile(input,'utf8'));
const part=asset.parts?.find(part=>part.name==='Body-CarPaint'||part.material==='CarPaint'&&!part.wheel);
if(!part?.mesh?.positions||!part.mesh.indices||!part.mesh.normals)throw new Error('Reference contains no exterior CarPaint body');
const source=part.mesh.positions,sourceNormals=part.mesh.normals,sourceIndices=part.mesh.indices;
if(source.length!==sourceNormals.length)throw new Error('Reference position/normal counts differ');

const vertices=[],map=new Map(),geometricPositions=new Set(),remap=new Uint16Array(source.length/3);
for(let i=0;i<source.length/3;i++){
  const position=[source[i*3],source[i*3+1],source[i*3+2]],normal=[sourceNormals[i*3],sourceNormals[i*3+1],sourceNormals[i*3+2]];
  const positionKey=position.join(',');geometricPositions.add(positionKey);
  const key=positionKey+'|'+normal.join(',');
  let index=map.get(key);
  if(index===undefined){
    index=vertices.length;if(index>65535)throw new RangeError('Packed shell exceeds uint16 vertex budget');
    map.set(key,index);vertices.push({position,normal});
  }
  remap[i]=index;
}
const indices=Uint16Array.from(sourceIndices.map(index=>remap[index]));
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
for(const {position} of vertices)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],position[axis]);max[axis]=Math.max(max[axis],position[axis]);}
const scale=min.map((value,axis)=>(max[axis]-value)/65535),quantized=new Uint16Array(vertices.length*3),normalBytes=new Uint8Array(vertices.length*2),positionErrors=[],normalErrors=[];

function octEncode(input){
  let [x,y,z]=input;const length=Math.abs(x)+Math.abs(y)+Math.abs(z)||1;x/=length;y/=length;z/=length;
  if(z<0){const ox=x,oy=y;x=(1-Math.abs(oy))*Math.sign(ox||1);y=(1-Math.abs(ox))*Math.sign(oy||1);}
  return[Math.max(0,Math.min(255,Math.round((x*.5+.5)*255))),Math.max(0,Math.min(255,Math.round((y*.5+.5)*255)))];
}
function octDecode(a,b){
  let x=a/255*2-1,y=b/255*2-1,z=1-Math.abs(x)-Math.abs(y);
  if(z<0){const ox=x,oy=y;x=(1-Math.abs(oy))*Math.sign(ox||1);y=(1-Math.abs(ox))*Math.sign(oy||1);}
  const length=Math.hypot(x,y,z)||1;return[x/length,y/length,z/length];
}
for(let i=0;i<vertices.length;i++){
  const {position,normal}=vertices[i];let error2=0;
  for(let axis=0;axis<3;axis++){
    const q=Math.round((position[axis]-min[axis])/scale[axis]);quantized[i*3+axis]=q;
    const decoded=min[axis]+q*scale[axis],error=decoded-position[axis];error2+=error*error;
  }
  positionErrors.push(Math.sqrt(error2));
  const encoded=octEncode(normal);normalBytes[i*2]=encoded[0];normalBytes[i*2+1]=encoded[1];
  const decoded=octDecode(...encoded),dot=Math.max(-1,Math.min(1,decoded[0]*normal[0]+decoded[1]*normal[1]+decoded[2]*normal[2]));
  normalErrors.push(Math.acos(dot)*180/Math.PI);
}
positionErrors.sort((a,b)=>a-b);normalErrors.sort((a,b)=>a-b);
const maxError=positionErrors.at(-1)??0,mean=positionErrors.reduce((sum,value)=>sum+value,0)/Math.max(1,positionErrors.length),p99=positionErrors[Math.min(positionErrors.length-1,Math.floor(positionErrors.length*.99))]??0;
const meanNormal=normalErrors.reduce((sum,value)=>sum+value,0)/Math.max(1,normalErrors.length),p99Normal=normalErrors[Math.min(normalErrors.length-1,Math.floor(normalErrors.length*.99))]??0,maxNormal=normalErrors.at(-1)??0;
const diagonal=Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2]),fit=1-maxError/diagonal;
if(fit<targetFit)throw new Error(`Packed shell fit ${fit} is below target ${targetFit}`);

function bytesU16(values){const bytes=new Uint8Array(values.length*2),view=new DataView(bytes.buffer);for(let i=0;i<values.length;i++)view.setUint16(i*2,values[i],true);return bytes;}
const base64=bytes=>Buffer.from(bytes).toString('base64');
const report={
  sourceVertices:source.length/3,geometricUniquePositions:geometricPositions.size,packedVertices:vertices.length,triangles:indices.length/3,
  meanPositionErrorMm:mean*1000,p99PositionErrorMm:p99*1000,maxPositionErrorMm:maxError*1000,
  meanNormalErrorDeg:meanNormal,p99NormalErrorDeg:p99Normal,maxNormalErrorDeg:maxNormal,
  normalizedMaxFit:fit,binaryPayloadBytes:quantized.byteLength+normalBytes.byteLength+indices.byteLength,
};
const code=`import {decodePackedShell,type PackedShell} from './packed-shell.js';

export const M3_SHELL_FIDELITY=Object.freeze(${JSON.stringify(report,null,2)});

export const M3_HIGH_FIDELITY_SHELL:PackedShell=Object.freeze({
  min:${JSON.stringify(min)} as const,
  max:${JSON.stringify(max)} as const,
  vertices:${vertices.length},
  triangles:${indices.length/3},
  positionsU16Base64:'${base64(bytesU16(quantized))}',
  normalsOct8Base64:'${base64(normalBytes)}',
  indicesU16Base64:'${base64(bytesU16(indices))}',
});

let cached:ReturnType<typeof decodePackedShell>|undefined;
export function m3HighFidelityBody(){return cached??=decodePackedShell(M3_HIGH_FIDELITY_SHELL);}
`;
await writeFile(output,code);
console.log(JSON.stringify({...report,input,output},null,2));
