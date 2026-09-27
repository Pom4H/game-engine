import { scene, camera, ground, body } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([4, 2.5, 5], [0, 1, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  body('сфера', {
    position: [0, 1.05, 0], mesh: { kind: 'sphere', radius: 1, segments: 48 },
    material: {
      kind: 'steel', color: [0.14, 0.3, 0.48, 1],
      roughness: 0.24, metalness: 0.7,
      clearcoat: 0.65, clearcoatRoughness: 0.12,
    },
  }),
]);
