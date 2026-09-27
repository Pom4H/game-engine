import base from './clear-day.scene.mjs';
import {compileVehicle,PICKUP_CANOPY_VEHICLE_DEFINITION} from '../../dist/vehicles/index.js';
import {m3PartMaterial} from '../../dist/vehicles/m3.js';

const spec=structuredClone(base);
const origin=[-20.55,.006,-1.38];
spec.entities=spec.entities.filter(entity=>!entity.id.startsWith('passing-'));
const vehicle=compileVehicle(PICKUP_CANOPY_VEHICLE_DEFINITION);
for(const part of vehicle.parts){
  spec.entities.push({
    id:'passing-'+part.id,
    position:[origin[0]+part.position[0],origin[1]+part.position[1],origin[2]+part.position[2]],
    mesh:part.mesh,
    material:m3PartMaterial(part,[.245,.248,.255,1],false),
    ...(part.rotation?{rotation:[...part.rotation]}:{}),
  });
}
spec.animation={...spec.animation,vehicles:[]};
spec.surfaceContacts={...spec.surfaceContacts,wheels:[]};
spec.rendering.reflectionProbe={...spec.rendering.reflectionProbe,entity:'passing-body',exclude:spec.entities.filter(entity=>entity.id.startsWith('passing-')).map(entity=>entity.id)};
export default spec;
