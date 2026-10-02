const BIGINT_TAG='__meshwork_bigint_v1__';
export function encodeMeshWire(value:unknown):string{return JSON.stringify(value,(_key,item)=>typeof item==='bigint'?{[BIGINT_TAG]:item.toString()}:item);}
export function decodeMeshWire<T=unknown>(text:string):T{
  return JSON.parse(text,(_key,item)=>{
    if(item&&typeof item==='object'&&Object.keys(item).length===1&&typeof item[BIGINT_TAG]==='string'&&/^-?\d+$/.test(item[BIGINT_TAG]))return BigInt(item[BIGINT_TAG]);
    return item;
  }) as T;
}
