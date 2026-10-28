import {trianglePrism} from '../../dist/physics/triangle-prism.js';
import {withBoxBounds} from '../../dist/physics/box-overlap.js';
import {Qmul,Qrotate} from '../../dist/physics/compound.js';

// Frozen predecessor of the material-prism cache. Kept only as an independent
// numerical/query and component-cost oracle, never imported by production.
const cache=new WeakMap();
const same3=(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2],same4=(a,b)=>same3(a,b)&&a[3]===b[3];
function oldWorldTriangle(body,shape){
 let entries=cache.get(body);if(!entries){entries=new WeakMap();cache.set(body,entries);}const old=entries.get(shape),thickness=shape.thickness??.0008,source=shape.triangle;
 let same=!!old&&same3(old.p,body.p)&&same4(old.q,body.q)&&old.thickness===thickness;if(same)for(let i=0;i<9;i++)if(old.values[i]!==source[Math.floor(i/3)][i%3]){same=false;break;}if(same)return old.prism;
 const prism=trianglePrism(source.map(p=>body.point(p)),thickness);if(prism){for(const p of prism.triangle)Object.freeze(p);for(const p of prism.vertices)Object.freeze(p);for(const p of prism.normals)Object.freeze(p);for(const p of prism.edgeDirections)Object.freeze(p);for(const p of prism.planes){Object.freeze(p.n);Object.freeze(p);}Object.freeze(prism.triangle);Object.freeze(prism.vertices);Object.freeze(prism.normals);Object.freeze(prism.edgeDirections);Object.freeze(prism.planes);Object.freeze(prism.center);Object.freeze(prism.bounds);Object.freeze(prism);}
 entries.set(shape,{p:[...body.p],q:[...body.q],values:source.flatMap(p=>[...p]),thickness,prism});return prism;
}
export function oldMaterialBoxes(body){
 const axes=body.axes();return body.shapes.map(s=>{const shapeAxes=s.q?[[1,0,0],[0,1,0],[0,0,1]].map(v=>Qrotate(Qmul(body.q,s.q),v)):axes,box=withBoxBounds({body,p:body.point(s.offset??[0,0,0]),axes:shapeAxes,half:s.half,tag:s.tag??body.tag,structureNode:s.structureNode,structureBeam:s.structureBeam,...(s.triangle?{triangle:oldWorldTriangle(body,s),structureNodes:s.structureNodes}:{})});if(box.triangle)box.bounds=box.triangle.bounds;return box;});
}
