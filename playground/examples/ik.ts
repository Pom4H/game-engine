import { scene, camera, ground, arm } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([4, 3.2, 6], [0.6, 1.5, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  arm('манипулятор', {
    root: [0, 2.4, 0], target: [1.2, 0.8, 0], pole: [1, 0, 1],
    upper: 1, lower: 1, swing: 0.35,
  }),
]);
