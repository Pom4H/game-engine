import { scene, camera, ground, sedan } from '@rom4/game-engine/dsl';

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([7, 3.2, 8], [0, 0.8, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
  input: 'm3', follow: 'm3',
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  // Газ, руль и материал меняются без сброса физики.
  sedan('m3', {
    massKg: 1500, radiusM: 0.346,
    springNPerM: 35000, damperNsPerM: 3200,
    controls: { throttle: 0, brake: 0, steer: 0, flap: 0 },
    paint: { color: [0.12, 0.22, 0.34, 1], roughness: 0.24, metalness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.16 },
    damage: true,
  }),
]);
