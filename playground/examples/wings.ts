import { scene, camera, ground, sedan, wing } from '@rom4/game-engine/dsl';

// Общая запись: редактирование угла меняет оба крыла.
const wings = [-1, 1].map(side => wing(side < 0 ? 'левое крыло' : 'правое крыло', {
  at: [0, 0, side * 2.8],
  mountAt: [0, 0.25, side * 0.85],
  massKg: 25, spanM: 4, chordM: 1.6,
  incidenceRad: 0.2, zeroLiftRad: 0,
  control: 'flap', controlGainRad: 0.2,
}));

export default scene({
  preview: { resolutionScale: 1, maxPixelRatio: 1.5 },
  camera: camera([8, 3.8, 10], [0, 0.8, 0], 42),
  rendering: { exposure: 1, sunIntensity: 2.5, sunDirection: [0.4, 0.8, -0.3] },
  input: 'm3', follow: 'm3',
}, [
  ground('пол', { size: [32, 24], wetness: 0, snowM: 0 }),
  sedan('m3', {
    velocity: [60, 0, 0],
    controls: { throttle: 0, brake: 0, steer: 0, flap: 0 },
    paint: { color: [0.12, 0.22, 0.34, 1], roughness: 0.24, metalness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.16 },
    parts: wings,
  }),
]);
