import { scene, camera, ground, body } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([8, 4, 11], [0, 0.8, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  ...Array.from({ length: 6 }, (_, index) => body(`стекло-${index}`, {
    position: [index * 1.1 - 2, 1.2, 0],
    mesh: { kind: 'box', size: [0.015, 2.2, 2.4] },
    material: { kind: 'glass', color: [0.6, 0.82, 0.9, 0.3] },
    body: { mass: 0 },
  })),
  body('шар', {
    position: [-5, 1.2, 0], mesh: { kind: 'sphere', radius: 0.2, segments: 24 },
    material: { kind: 'steel', roughness: 0.18, metalness: 0.9 },
    body: { mass: 8, velocity: [25, 0, 0] },
  }),
]);
