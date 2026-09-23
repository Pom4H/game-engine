// Portable appearance preset. Only data is imported; never code or remote assets.
export const SCHEMA = 'game-engine/look-dev@1';
export const renderingControls = [
  ['exposure', 'Экспозиция', .1, 3, .01],
  ['sunIntensity', 'Сила солнца', 0, 8, .05],
  ['fogDensity', 'Плотность тумана', 0, .03, .0001],
  ['shadowExtent', 'Охват теней, м', 10, 100, 1],
];
export const materialControls = [
  ['roughness', 'Шероховатость', .02, 1, .01],
  ['metalness', 'Металличность', 0, 1, .01],
  ['clearcoat', 'Лак', 0, 1, .01],
  ['clearcoatRoughness', 'Шероховатость лака', .02, 1, .01],
];
const fail = message => { throw new TypeError(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const vector = (value, size, min, max) => Array.isArray(value) && value.length === size && value.every(v => number(v, min, max));
function keys(value, allowed, name) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`Недопустимые поля: ${name}`);
}
export function validatePreset(input) {
  const p = structuredClone(input);
  keys(p, ['schema', 'engineRevision', 'scene', 'seed', 'time', 'camera', 'resolution', 'rendering', 'materials', 'approvedAt'], 'preset');
  if (p.schema !== SCHEMA || !['street', 'courtyard'].includes(p.scene)) fail('Неизвестный формат или сцена');
  if (typeof p.engineRevision !== 'string' || p.engineRevision.length > 100) fail('Нет версии движка');
  if (!Number.isSafeInteger(p.seed) || p.seed !== 20260920 || !number(p.time, 0, 48)) fail('Некорректные seed/time');
  if (!vector(p.resolution, 2, 240, 3840) || p.resolution.some(v => !Number.isInteger(v)) || p.resolution[0] * 9 !== p.resolution[1] * 16) fail('Ожидается разрешение 16:9');
  keys(p.camera, ['position', 'target', 'fov', 'focusDistance', 'aperture'], 'camera');
  if (!vector(p.camera.position, 3, -1000, 1000) || !vector(p.camera.target, 3, -1000, 1000) || Math.hypot(...p.camera.position.map((v, i) => v - p.camera.target[i])) < .01 || !number(p.camera.fov, 20, 100)) fail('Некорректная камера');
  for (const [key, lo, hi] of [['focusDistance', .1, 200], ['aperture', 0, 4]]) if (p.camera[key] !== undefined && !number(p.camera[key], lo, hi)) fail(`Некорректный ${key}`);
  keys(p.rendering, [...renderingControls.map(c => c[0]), 'sunDirection', 'sunColor', 'skyColor'], 'rendering');
  for (const [key, , lo, hi] of renderingControls) if (!number(p.rendering[key], lo, hi)) fail(`Некорректный ${key}`);
  if (!vector(p.rendering.sunDirection, 3, -1, 1) || Math.hypot(...p.rendering.sunDirection) < .01) fail('Некорректное направление солнца');
  for (const key of ['sunColor', 'skyColor']) if (!vector(p.rendering[key], 3, 0, 1)) fail(`Некорректный ${key}`);
  if (!Array.isArray(p.materials) || p.materials.length > 20000) fail('Некорректные материалы');
  const ids = new Set();
  for (const rule of p.materials) {
    keys(rule, ['id', 'set'], 'material');
    if (typeof rule.id !== 'string' || !rule.id || rule.id.length > 512 || ids.has(rule.id)) fail('Некорректный или повторный ID материала');
    ids.add(rule.id);
    keys(rule.set, [...materialControls.map(c => c[0]), 'color'], 'material.set');
    for (const [key, , lo, hi] of materialControls) if (rule.set[key] !== undefined && !number(rule.set[key], lo, hi)) fail(`Некорректный ${key}`);
    if (rule.set.color !== undefined && (!vector(rule.set.color, 4, 0, 1) || rule.set.color[3] !== 1)) fail('Цвет должен быть непрозрачным RGBA');
  }
  if (p.approvedAt !== undefined && (typeof p.approvedAt !== 'string' || !Number.isFinite(Date.parse(p.approvedAt)))) fail('Некорректная дата фиксации');
  return p;
}
export function direction(azimuth, elevation) {
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
}
export function angles(v) { return [Math.atan2(v[2], v[0]) * 180 / Math.PI, Math.asin(v[1] / Math.hypot(...v)) * 180 / Math.PI]; }
export function colorHex(rgb) { return '#' + rgb.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join(''); }
export function colorRGB(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) fail('Некорректный цвет');
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}
export function sameView(a, b) {
  return a.scene === b.scene && a.seed === b.seed && Math.abs(a.time - b.time) < 1e-6 && JSON.stringify(a.camera) === JSON.stringify(b.camera) && JSON.stringify(a.resolution) === JSON.stringify(b.resolution);
}
export function applyRendering(runtime, state, values) {
  const rendering = {...state.rendering, ...values};
  validatePreset({...state, rendering});
  runtime.patchAppearance({rendering: values});
  runtime.resetProfile?.();
  state.rendering = rendering;
}
export function applyMaterial(runtime, state, ids, values) {
  const merged = new Map(state.materials.map(rule => [rule.id, structuredClone(rule)]));
  for (const id of ids) merged.set(id, {id, set: {...(merged.get(id)?.set ?? {}), ...values}});
  const materials = [...merged.values()];
  validatePreset({...state, materials});
  runtime.patchAppearance({materials: ids.map(id => ({id, set: values}))});
  // Material changes affect reflected/indirect radiance too. The current engine
  // exposes only this conservative invalidation path for those derived caches.
  runtime.scene.renderStructureRevision++;
  runtime.resetProfile?.();
  state.materials = materials;
}
export function relocateTextures(spec, baseURL) {
  for (const e of spec.entities) for (const material of [e.material, e.environmental?.snowMaterial]) {
    if (!material?.texture) continue;
    material.texture = {...material.texture};
    for (const key of ['url', 'normalUrl', 'ormUrl']) {
      const url = material.texture[key];
      if (url?.startsWith('/assets/')) material.texture[key] = new URL('tools/promo' + url, baseURL).href;
    }
  }
  return spec;
}
