import {cityCameraAtTick} from './route.mjs';
export default [0,59,119,179].map((tick,index)=>({
 name:['sidewalk','junction','traffic','overlook'][index],
 time:tick/60,
 camera:cityCameraAtTick(tick),
 output:'artifacts/city-benchmark/view-'+index+'.png',
}));
