import production from './clear-day.scene.mjs';
import {makeCity} from './city.mjs';

const scene=structuredClone(production);
// Restore the authored car movement for an actual engine recording. The scene
// keeps the same lighting, materials, camera and ordinary WebGPU pipeline.
scene.animation={...scene.animation,vehicles:makeCity('street').spec.animation.vehicles};
export default scene;
