import { scene, camera, ground, sedan, body } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([12, 6, 12], [4, 0.8, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  sedan('m3', {
    velocity: [12, 0, 0],
    controls: { throttle: 0, brake: 0, steer: 0, flap: 0 },
    paint: { color: [0.12, 0.22, 0.34, 1], roughness: 0.24, metalness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.16 }, damage: true,
  }),
  body('стена', {
    position: [7, 1, 0], mesh: { kind: 'box', size: [0.7, 2, 4] },
    material: { kind: 'concrete', color: [0.4, 0.42, 0.44, 1] },
    body: { mass: 0 },
  }),
]);
