import production from '../promo/clear-day.scene.mjs';
import {makeCity} from '../promo/city.mjs';

const scene=structuredClone(production);
const {spec}=makeCity('street');
scene.entities.push(...spec.entities.filter(entity=>
  entity.id.startsWith('batch:plough-grit-')||entity.id.startsWith('batch:centre-slush-')
));
export default scene;
