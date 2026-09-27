import { scene, camera, ground, softBody } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([5, 3, 6], [0, 1.3, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  softBody('структура', {
    height: 3, mass: 120,
    stiffness: 1000000, yieldStrain: 0.04,
    velocity: [0, -4, 0],
  }),
]);
