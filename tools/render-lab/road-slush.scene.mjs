import production from '../promo/clear-day.scene.mjs';

const scene=structuredClone(production);
for(const [id,position,size,seed] of [
  ['road-slush-0',[-18.0,.011,-2.18],[.55,.028,.18],1701],
  ['road-slush-1',[-18.4,.011,-2.36],[.38,.035,.20],1702],
  ['road-slush-2',[-18.8,.011,-2.72],[.45,.025,.19],1703],
  ['road-slush-3',[-19.35,.011,-2.87],[.60,.030,.21],1704],
  ['road-slush-4',[-20.0,.011,-2.15],[.34,.020,.17],1705],
  ['road-slush-5',[-21.4,.011,-1.95],[.80,.025,.20],1706],
])scene.entities.push({id,position,mesh:{kind:'snowdrift',size,seed,segments:16},material:{kind:'snow',color:[.76,.78,.80,1],roughness:.93}});
export default scene;
