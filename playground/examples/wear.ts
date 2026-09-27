import { scene, camera, ground, sedan } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([7, 3.2, 8], [0, 0.8, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
  input: 'm3', follow: 'm3',
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  sedan('m3', {
    velocity: [25, 0, 0], wearEnergyJ: 30000,
    controls: { throttle: 1, brake: 1, steer: 0, flap: 0 },
    paint: { color: [0.12, 0.22, 0.34, 1], roughness: 0.24, metalness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.16 },
  }),
]);
