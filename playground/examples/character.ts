import { scene, camera, ground, walker } from '@rom4/game-engine/dsl';

export default scene({
  follow: 'персонаж',
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([5, 2.7, 7], [0, 1, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  walker('персонаж', {
    position: [-2, 0, 0], speed: 1.2, heading: 0, height: 1,
    color: [0.22, 0.28, 0.35, 1],
  }),
]);
