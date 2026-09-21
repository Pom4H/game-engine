import {compileVehicle,compareTriangleSurfaces,PICKUP_CANOPY_VEHICLE_DEFINITION} from '../dist/index.js';
import {loadGLBReference,mergeReferenceSurface,referenceReport} from './glb-reference.mjs';

const url=process.env.REFERENCE_GLB_URL||PICKUP_CANOPY_VEHICLE_DEFINITION.reference.url;
const reference=await loadGLBReference(url),report=referenceReport(reference),vehicle=compileVehicle(PICKUP_CANOPY_VEHICLE_DEFINITION);
const mergeGenerated=(predicate)=>{
 const positions=[],indices=[];
 for(const part of vehicle.parts.filter(predicate)){if(part.mesh.kind!=='triangle-mesh')continue;const base=positions.length/3,[tx,ty,tz]=part.position;for(let i=0;i<part.mesh.positions.length;i+=3)positions.push(part.mesh.positions[i]+tx,part.mesh.positions[i+1]+ty,part.mesh.positions[i+2]+tz);for(const index of part.mesh.indices)indices.push(base+index);}
 return{positions,indices};
};

const bands=(surface,count=12)=>{
 const xs=[];for(let i=0;i<surface.positions.length;i+=3)xs.push(surface.positions[i]);
 const min=Math.min(...xs),max=Math.max(...xs),width=(max-min)/count,result=[];
 for(let b=0;b<count;b++){const x0=min+b*width,x1=b===count-1?max+1e-9:x0+width,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],points=[];for(let i=0;i<surface.positions.length;i+=3){const x=surface.positions[i];if(x<x0||x>=x1)continue;const p=[surface.positions[i],surface.positions[i+1],surface.positions[i+2]];points.push(p);for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],p[a]);hi[a]=Math.max(hi[a],p[a]);}}if(points.length)result.push({x:[x0,x1],points:points.length,y:[lo[1],hi[1]],z:[lo[2],hi[2]]});}return result;
};

const paint=mergeReferenceSurface(reference,p=>p.material==='paint');
const glass=mergeReferenceSurface(reference,p=>p.material==='glass');
const wheels=mergeReferenceSurface(reference,p=>p.node.startsWith('wheel-'));
const generatedGlass=mergeGenerated(p=>p.role==='glass'),generatedWheels=mergeGenerated(p=>p.role==='tire'||p.role==='rim');
const result={
 reference:{bytes:report.bytes,sha256:report.sha256,triangles:report.totalTriangles,bounds:report.bounds},
 definitionBytes:Buffer.byteLength(JSON.stringify(PICKUP_CANOPY_VEHICLE_DEFINITION)),
 body:compareTriangleSurfaces(vehicle.body,paint),
 glass:compareTriangleSurfaces(generatedGlass,glass),
 wheels:compareTriangleSurfaces(generatedWheels,wheels),
 generated:{bodyTriangles:vehicle.bodyTriangles,totalTriangles:vehicle.generatedTriangles},
 referenceBands:{paint:bands(paint),glass:bands(glass)},
 referenceTriangles:{paint:paint.triangles,glass:glass.triangles,wheels:wheels.triangles},
};
console.log('PICKUP_FRAMEWORK_REPORT '+JSON.stringify(result));
const s=result.reference.bounds.size;
if(Math.abs(s[0]-5.392)>.02||Math.abs(s[1]-1.814)>.02||Math.abs(s[2]-2.077)>.02)throw new Error('Reference dimensions do not match published pickup dimensions: '+JSON.stringify(s));
if(result.definitionBytes>1600)throw new Error('Pickup definition stopped being compact: '+result.definitionBytes);
if(!Number.isFinite(result.body.symmetricMeanMm)||!Number.isFinite(result.glass.symmetricMeanMm)||!Number.isFinite(result.wheels.symmetricMeanMm))throw new Error('Reference comparison produced non-finite metrics');
