import {Scene} from '../dist/scene/scene.js';
import {spawnVehicle} from '../dist/vehicles/scene-vehicle.js';
import {vehicle} from '../dist/vehicles/vehicle.js';
import {compileVehicle} from '../dist/vehicles/index.js';
import {M3_VEHICLE_DEFINITION} from '../dist/vehicles/m3.js';
import {carBlueprint} from './vehicle-runtime-fixture.mjs';
const geometry=compileVehicle(M3_VEHICLE_DEFINITION);
export function sceneFixture({wings=true,reuseDerived=true,damage=true,crash=false,wearEnergyJ=2e7}={}){
 const source=structuredClone(carBlueprint({wings,incidenceRad:0,wearEnergyJ}).source);
 for(const p of source.parts)if(p.kind==='wing')p.mountAt=[0,.25,Math.sign(p.at[2])*.85];
 const blueprint=vehicle('test-car',source);
 const scene=new Scene({version:1,entities:[],...(crash?{gravity:[0,0,0],ground:-100}:{}),environment:{temperatureC:20,humidity:0,groundMoisture:0,precipitation:'arid',snowfall:'none',sunlight:1}});
 const handle=spawnVehicle(scene,blueprint,geometry,{modelOriginM:[0,.75,0],position:[0,.75,0],paint:{color:[.20,.25,.31,1],roughness:.22,metalness:.12,clearcoat:.8,clearcoatRoughness:.18},reuseDerived,damage:damage?{skinThicknessM:.0008,radiusM:.45,maxDentM:.4,minEnergyJ:10}:false});
 if(crash){handle.vehicle.setAir({densityKgM3:0,wind:[0,0,0]});scene.add({id:'striker',mesh:{kind:'sphere',radius:.22},position:[.35,1.8,-.7],material:{kind:'steel'},body:{mass:400,velocity:[0,-15,0],shape:'sphere',restitution:0}});}
 return {scene,handle,car:handle.vehicle,blueprint,geometry};
}
