export type HydrologyCell=[number,number,number,number,number,number,number,number];
export type HydrologyFrame={version:1;minute:number;revision:number;tiles:{x:number;z:number;cells:HydrologyCell[]}[]};
export function validHydrologyFrame(value:unknown):value is HydrologyFrame{
 const s=value as HydrologyFrame;if(!s||s.version!==1||!Number.isFinite(s.minute)||s.minute<0||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.tiles)||s.tiles.length>9)return false;
 const owned=new Set<string>();return s.tiles.every(t=>{
  if(!t||!Number.isSafeInteger(t.x)||!Number.isSafeInteger(t.z)||Math.abs(t.x)>=1e6||Math.abs(t.z)>=1e6||!Array.isArray(t.cells)||t.cells.length>256)return false;
  const key=`${t.x}:${t.z}`;if(owned.has(key))return false;owned.add(key);const cells=new Set<number>();
  return t.cells.every(r=>{if(!Array.isArray(r)||r.length!==8||!r.every(Number.isSafeInteger)||r[0]<0||r[0]>=256||Math.abs(r[1])>=1e7||r[2]<0||r[2]>1000||r[3]<0||r[3]>1e8||r[4]<0||r[4]>1000||r[5]<0||r[5]>1000||r[6]<0||r[6]>1e8||r[7]<0||r[7]>1||cells.has(r[0]))return false;cells.add(r[0]);return true;});
 });
}
