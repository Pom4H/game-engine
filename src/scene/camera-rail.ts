import type {Vec3} from '../math.js';
import type {CameraSpec,CameraRailSpec} from './types.js';

/** Closed spline has matching position and velocity at the loop seam. */
export function cameraOnRail(camera:CameraSpec,rail:CameraRailSpec,time:number):CameraSpec{
 const keys=rail.keyframes,n=keys.length;
 const phase=((time%rail.durationSeconds)+rail.durationSeconds)%rail.durationSeconds/rail.durationSeconds*n;
 const i=Math.floor(phase),t=phase-i,t2=t*t,t3=t2*t;
 const sample=(field:'position'|'target'):Vec3=>{
  const p=[-1,0,1,2].map(offset=>keys[(i+offset+n)%n]![field]);
  return [0,1,2].map(k=>.5*(2*p[1]![k]!+(-p[0]![k]!+p[2]![k]!)*t+(2*p[0]![k]!-5*p[1]![k]!+4*p[2]![k]!-p[3]![k]!)*t2+(-p[0]![k]!+3*p[1]![k]!-3*p[2]![k]!+p[3]![k]!)*t3)) as unknown as Vec3;
 };
 return {...camera,position:sample('position'),target:sample('target')};
}
