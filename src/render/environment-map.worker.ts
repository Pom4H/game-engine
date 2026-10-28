import {type EnvironmentMapInput,type EnvironmentMapData} from './environment-map.js';
import {createEnvironmentBakeWorkerDriver} from './environment-map-worker-driver.js';
const scope=globalThis as unknown as {
  onmessage:(event:{data:EnvironmentMapInput})=>void;
  postMessage(data:EnvironmentMapData,transfer:ArrayBuffer[]):void;
};
const driver=createEnvironmentBakeWorkerDriver({
  publish:data=>scope.postMessage(data,[data.irradiance.buffer,...data.mips.map(mip=>mip.buffer)] as ArrayBuffer[]),
  fail:error=>{throw error;},
});
scope.onmessage=event=>driver.receive(event.data);
