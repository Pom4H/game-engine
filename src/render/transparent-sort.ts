import type {TransparentSortSpec} from '../scene/types.js';

export function validateTransparentSort(value:unknown):void{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('transparentSort must be a record');
 const record=value as Record<string,unknown>,anchor=record.anchor;
 if(record.phase!=='static-tail'||!Number.isSafeInteger(record.ordinal)||Number(record.ordinal)<0)throw new TypeError('transparentSort requires static-tail and a nonnegative safe ordinal');
 if(!Array.isArray(anchor)||anchor.length!==3)throw new TypeError('transparentSort.anchor must be a finite vec3');
 for(let axis=0;axis<3;axis++)if(typeof anchor[axis]!=='number'||!Number.isFinite(anchor[axis]))throw new TypeError('transparentSort.anchor must be a finite vec3');
}
export function snapshotTransparentSort(value:TransparentSortSpec|undefined):TransparentSortSpec|undefined{
 return value===undefined?undefined:Object.freeze({phase:value.phase,ordinal:value.ordinal,anchor:Object.freeze([value.anchor[0],value.anchor[1],value.anchor[2]]) as TransparentSortSpec['anchor']});
}
export function sameTransparentSort(a:TransparentSortSpec|undefined,b:TransparentSortSpec|undefined):boolean{
 if(a===undefined||b===undefined)return a===b;
 return a.phase===b.phase&&a.ordinal===b.ordinal&&Object.is(a.anchor[0],b.anchor[0])&&Object.is(a.anchor[1],b.anchor[1])&&Object.is(a.anchor[2],b.anchor[2]);
}
