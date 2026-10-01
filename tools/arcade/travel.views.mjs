import {camera,cameraRail} from './reference.scene.mjs';
import {cameraOnRail} from '../../dist/scene/camera-rail.js';
export default [0,20,45,70].map((time,i)=>({name:'arcade-travel-'+i,output:'artifacts/arcade-travel-'+i+'.png',camera:cameraOnRail(camera,cameraRail,time),time}));
