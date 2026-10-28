export function rareWindGust(wind, gust, time) {
  const wx = Number.isFinite(wind[0]) ? wind[0] : 0, wz = Number.isFinite(wind[1]) ? wind[1] : 0;
  const g = Math.max(0, Math.min(1, Number.isFinite(gust) ? gust : 0));
  if (g < 0.02)
    return [wx, wz];
  const t = (Number.isFinite(time) ? Math.max(0, time) : 0) * 0.11;
  const epoch = Math.floor(t);
  let h = Math.imul(epoch ^ 2654435769, 2246822507) >>> 0;
  h = Math.imul(h ^ h >>> 13, 3266489909) >>> 0;
  const roll = (h >>> 0) / 4294967295;
  if (roll > g * 0.22)
    return [wx, wz];
  const peak = 0.12 + (h >>> 8 & 255) / 255 * 0.6;
  const width = 0.02 + (h >>> 16 & 255) / 255 * 0.07;
  const phase = t - epoch;
  const x = (phase - peak) / Math.max(width, 0.001);
  const envelope = Math.exp(-x * x * 2);
  const boost = 1 + envelope * (1.2 + g * 2.4);
  return [wx * boost, wz * boost];
}
