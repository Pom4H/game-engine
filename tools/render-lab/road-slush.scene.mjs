import production from '../promo/clear-day.scene.mjs';

const scene=structuredClone(production);
for(const [id,position,size,seed] of [
  ['road-slush-near',[-18.0,.011,-2.18],[1.35,.045,.34],1701],
  ['road-slush-mid',[-18.8,.011,-2.72],[1.75,.055,.42],1702],
  ['road-slush-track',[-21.4,.011,-1.95],[2.3,.035,.24],1703],
])scene.entities.push({id,position,mesh:{kind:'snowdrift',size,seed,segments:24},material:{kind:'snow',color:[.76,.78,.80,1],roughness:.93}});
export default scene;
