import { scene, camera, ground, spatial } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([10, 13, 14], [0, 0, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  spatial('поиск', {
    seed: 42, count: 120, cell: 2, radius: 3, at: [0, 0.15, 0],
  }),
]);
