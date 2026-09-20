import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const input=resolve(process.argv[2]??'artifacts/m3-reference-import/m3.json');
const output=resolve(process.argv[3]??'artifacts/m3-shell.generated.ts');
const targetFit=Number(process.env.M3_SHELL_TARGET_FIT??.9999);
if(!Number.isFinite(targetFit)||targetFit<=0||targetFit>1)throw new RangeError('M3_SHELL_TARGET_FIT must be in (0,1]');

const asset=JSON.parse(await readFile(input,'utf8'));
const part=asset.parts?.find(part=>part.name==='Body-CarPaint'||part.material==='CarPaint'&&!part.wheel);
if(!part?.mesh?.positions||!part.mesh.indices)throw new Error('Reference contains no exterior CarPaint body');
const source=part.mesh.positions,sourceIndices=part.mesh.indices;

const unique=[],map=new Map(),remap=new Uint16Array(source.length/3);
for(let i=0;i<source.length/3;i++){
  const key=`${source[i*3]},${source[i*3+1]},${source[i*3+2]}`;
  let index=map.get(key);
  if(index===undefined){index=unique.length/3;if(index>65535)throw new RangeError('Packed shell exceeds uint16 vertex budget');map.set(key,index);unique.push(source[i*3],source[i*3+1],source[i*3+2]);}
  remap[i]=index;
}
const indices=Uint16Array.from(sourceIndices.map(index=>remap[index]));
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
for(let i=0;i<unique.length;i+=3)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],unique[i+axis]);max[axis]=Math.max(max[axis],unique[i+axis]);}
const scale=min.map((value,axis)=>(max[axis]-value)/65535),quantized=new Uint16Array(unique.length),errors=[];
for(let i=0;i<unique.length;i+=3){
  let error2=0;
  for(let axis=0;axis<3;axis++){
    const q=Math.round((unique[i+axis]-min[axis])/scale[axis]);quantized[i+axis]=q;
    const decoded=min[axis]+q*scale[axis],error=decoded-unique[i+axis];error2+=error*error;
  }
  errors.push(Math.sqrt(error2));
}
errors.sort((a,b)=>a-b);
const maxError=errors.at(-1)??0,mean=errors.reduce((sum,value)=>sum+value,0)/Math.max(1,errors.length),p99=errors[Math.min(errors.length-1,Math.floor(errors.length*.99))]??0;
const diagonal=Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2]),fit=1-maxError/diagonal;
if(fit<targetFit)throw new Error(`Packed shell fit ${fit} is below target ${targetFit}`);

function base64(values){
  const bytes=new Uint8Array(values.length*2),view=new DataView(bytes.buffer);
  for(let i=0;i<values.length;i++)view.setUint16(i*2,values[i],true);
  return Buffer.from(bytes).toString('base64');
}
const report={
  sourceVertices:source.length/3,uniqueVertices:unique.length/3,triangles:indices.length/3,
  meanPositionErrorMm:mean*1000,p99PositionErrorMm:p99*1000,maxPositionErrorMm:maxError*1000,
  normalizedMaxFit:fit,binaryPayloadBytes:quantized.byteLength+indices.byteLength,
};
const code=`import {decodePackedShell,type PackedShell} from './packed-shell.js';

export const M3_SHELL_FIDELITY=Object.freeze(${JSON.stringify(report,null,2)});

export const M3_HIGH_FIDELITY_SHELL:PackedShell=Object.freeze({
  min:${JSON.stringify(min)} as const,
  max:${JSON.stringify(max)} as const,
  vertices:${unique.length/3},
  triangles:${indices.length/3},
  positionsU16Base64:'${base64(quantized)}',
  indicesU16Base64:'${base64(indices)}',
});

let cached:ReturnType<typeof decodePackedShell>|undefined;
export function m3HighFidelityBody(){return cached??=decodePackedShell(M3_HIGH_FIDELITY_SHELL);}
`;
await writeFile(output,code);
console.log(JSON.stringify({...report,input,output},null,2));
