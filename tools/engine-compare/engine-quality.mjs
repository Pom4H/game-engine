import {Scene} from '../../dist/scene/scene.js';
import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {hash, halfToFloat} from './fixture.mjs';

// This is a renderer fixture: no game logic, no reduced quality profile.
export function reflectionScene(texture) {
  const entities = [];
  for (let n = 0; n < 96; n++) entities.push({id: 'color:' + n,
    position: [(n % 12 - 5.5) * 1.65, .6 + (n % 3) * .15, (Math.floor(n / 12) - 3.5) * 1.9],
    rotation: [.03 * (n % 4), n * .17, .02 * (n % 5)], scale: [1, .8 + (n % 7) * .17, .8 + (n % 4) * .1],
    mesh: {kind: 'box'}, material: {kind: 'steel', color: [.18 + (n % 7) * .1, .15 + (n % 5) * .16, .2 + (n % 3) * .24, 1], roughness: .35}});
  for (let n = 0; n < 8; n++) entities.push({id: 'emission:' + n, position: [(n - 3.5) * 2.5, 3.4, -9.5],
    mesh: {kind: 'sphere', radius: .45}, material: {kind: 'plastic', color: [.8, .1 + n * .08, .2, 1], emissive: [1.2, .2, .08], roughness: .25}});
  const triangle = {kind: 'triangle-mesh', positions: [-.6, 0, 0, .6, 0, 0, 0, 1.8, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], colors: [1, .2, .1, 1, .1, 1, .2, 1, .2, .1, 1, 1]};
  for (let n = 0; n < 8; n++) entities.push({id: 'vertex-color:' + n, position: [(n - 3.5) * 2, .1, 10], rotation: [0, n * .3, 0], mesh: triangle, material: {kind: 'wood', color: [1, 1, 1, 1]}});
  for (let n = 0; n < 4; n++) entities.push({id: 'texture:' + n, position: [-10, 1.1, (n - 1.5) * 2.5], mesh: {kind: 'box', size: [1.3, 2.2, 1.3]}, material: {kind: 'concrete', color: [.75, .65, .5, 1], texture: {url: texture, sizeM: 1}}});
  entities.push({id: 'label', position: [9.8, 1.4, 0], mesh: {kind: 'box', size: [1, 2.8, 3]}, material: {kind: 'steel', color: [.65, .7, .78, 1], label: 'RENDER'}});
  for (let n = 0; n < 4; n++) entities.push({id: 'glass:' + n, position: [10, 1.5, (n - 1.5) * 2.8], mesh: {kind: 'box', size: [.15, 3, 2]}, material: {kind: 'glass', color: [.7, .8, .9, .35]}});
  // These must stay out of the planar capture; the road's physical water state
  // drives its visible reflection, and its surface field keeps the ordinary path.
  entities.push({id: 'wet-road', position: [0, -.15, 0], mesh: {kind: 'box', size: [48, .3, 48]}, material: {kind: 'asphalt', color: [.13, .14, .15, 1], roughness: .2}, environmental: {surfaceUse: 'road', waterDepthM: .008, fieldCellSizeM: 2}});
  for (let n = 0; n < 4; n++) entities.push({id: 'snow:' + n, position: [-5 + n * 3, .1, -12], mesh: {kind: 'box', size: [2, .2, 1.2]}, material: {kind: 'snow', color: [.85, .9, .95, 1]}});
  for (let n = 0; n < 4; n++) entities.push({id: 'below-plane:' + n, position: [n - 1.5, -.8, 1], mesh: {kind: 'box', size: [.7, .7, .7]}, material: {kind: 'steel', color: [1, .1, .1, 1], roughness: .35}});
  return {version: 1, seed: 991, gravity: [0, -9.81, 0], entities, camera: qualityViews[0].camera,
    rendering: {sunDirection: [-.55, .48, -.35], sunIntensity: 2.4, skyColor: [.26, .34, .47], exposure: 1.1, fogDensity: .001, shadowExtent: 36},
    environment: {temperatureC: 12, humidity: .6, sunlight: .8, snowfall: 'none', precipitation: 'rare', clock: {startHour: 12, hoursPerSecond: 0}}};
}

export const qualityViews = [
  {name: 'wet-front', camera: {position: [13, 4, 18], target: [0, .8, 0], fov: 65}},
  {name: 'wet-back', camera: {position: [-14, 5, -16], target: [0, .8, 0], fov: 65}},
  {name: 'wet-low', camera: {position: [1, 1.35, 17], target: [0, 1, -1], fov: 65}},
];

function bytes64(bytes) {
  let result = '';
  for (let n = 0; n < bytes.length; n += 32768) result += String.fromCharCode(...bytes.subarray(n, n + 32768));
  return btoa(result);
}

async function readReflection(renderer) {
  // Bounded fixture adapter. Use the texture's real extent, not a guessed scale.
  const texture = renderer.reflection, device = renderer.device;
  if (!texture || !device) throw new Error('Reflection inspection adapter needs updating');
  const width = texture.width, height = texture.height, bytesPerRow = Math.ceil(width * 8 / 256) * 256;
  const buffer = device.createBuffer({size: bytesPerRow * height, usage: 1 | 8});
  try {
    const encoder = device.createCommandEncoder({label: 'quality.reflection-readback'});
    encoder.copyTextureToBuffer({texture}, {buffer, bytesPerRow, rowsPerImage: height}, [width, height]);
    device.queue.submit([encoder.finish()]);await buffer.mapAsync(1);
    const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8Array(width * height * 8);
    for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 8), y * width * 8);
    buffer.unmap();return {width, height, pixels};
  } finally {buffer.destroy();}
}

function reflectionPreview({width, height, pixels}) {
  const canvas = document.createElement('canvas');canvas.width = width;canvas.height = height;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(width, height), values = new DataView(pixels.buffer);
  for (let n = 0; n < width * height; n++) {
    for (let c = 0; c < 3; c++) {
      const linear = halfToFloat(values.getUint16(n * 8 + c * 2, true));
      if (!Number.isFinite(linear)) throw new Error('Non-finite reflection radiance');
      // Inspection preview only, with fixed Reinhard + sRGB; the engine image
      // above remains its native TAA/tone-mapped output.
      const mapped = Math.max(0, linear) / (1 + Math.max(0, linear));
      image.data[n * 4 + c] = Math.round(255 * (mapped <= .0031308 ? mapped * 12.92 : 1.055 * mapped ** (1 / 2.4) - .055));
    }
    image.data[n * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);return canvas.toDataURL('image/png');
}

export async function captureEngineQuality(hooks, {width, height, mode = 'gpu'}) {
  const canvas = document.querySelector('canvas');
  const spec = reflectionScene('/quality-assets/brick-weathered.png'), scene = new Scene(spec);
  for (let n = 0; n < 60; n++) scene.step(1 / 60);
  const replayHash = await hash(scene.snapshot()), sourceHash = await hash(spec), captures = [];
  const renderer = await WebGPURenderer.create(canvas, {visibility: mode, profiling: false}), journal = hooks.journals.at(-1);
  try {
    renderer.setResolution(width, height);await renderer.prepareMaterials(scene);
    const copy = document.createElement('canvas');copy.width = width;copy.height = height;
    const ctx = copy.getContext('2d', {willReadFrequently: true});
    for (const view of qualityViews) {
      renderer.resetTemporalHistory();
      for (let frame = 0; frame < 32; frame++) {
        renderer.setTimelineFrame(frame);renderer.render(scene, view.camera);
        if (frame === 31) ctx.drawImage(canvas, 0, 0);
        await renderer.flush();
      }
      const pixels = ctx.getImageData(0, 0, width, height).data, reflection = await readReflection(renderer);
      captures.push({name: view.name, camera: view.camera, width, height, reflectionWidth: reflection.width, reflectionHeight: reflection.height,
        pixelHash: await hash(pixels), reflectionHash: await hash(reflection.pixels), inspect: renderer.inspect(false),
        png: copy.toDataURL('image/png'), rgba8: bytes64(pixels), reflectionPng: reflectionPreview(reflection), reflectionRgba16f: bytes64(reflection.pixels)});
    }
    await journal.flush();
    if (renderer.inspect(false).errors.length) throw new Error(renderer.inspect(false).errors.join('\n'));
    const afterHash = await hash(scene.snapshot());if (afterHash !== replayHash) throw new Error('Quality rendering mutated physics');
    const textureHash = await hash(new Uint8Array(await (await fetch('/quality-assets/brick-weathered.png')).arrayBuffer()));
    return {mode, width, height, sourceHash, textureHash, replayHash, afterHash, adapter: journal.adapter, captures};
  } finally {try {await journal.dispose();} finally {renderer.dispose();journal.device.destroy();}}
}
