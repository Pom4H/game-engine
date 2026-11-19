import {bakeEnvironmentMap,type EnvironmentMapInput,type EnvironmentMapData} from './environment-map.js';
const scope=globalThis as unknown as {
  onmessage:(event:{data:EnvironmentMapInput})=>void;
  postMessage(data:EnvironmentMapData,transfer:ArrayBuffer[]):void;
};
scope.onmessage=event=>{
  const data=bakeEnvironmentMap(event.data);
  scope.postMessage(data,[data.irradiance.buffer,...data.mips.map(mip=>mip.buffer)] as ArrayBuffer[]);
};
