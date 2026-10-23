import {inflateSync} from 'node:zlib';

/** Decode bounded RGB/RGBA8 PNGs produced by the owned browser's canvas.
 * Comparison uses decoded channels, independently of PNG compression/chunks. */
export function decodeCanvasPNG(bytes) {
  const data = Buffer.from(bytes);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature');
  let width, height, channels;const payload = [];
  for (let offset = 8; offset < data.length;) {
    if (offset + 12 > data.length) throw new Error('Truncated PNG chunk');
    const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8), start = offset + 8;
    if (start + length + 4 > data.length) throw new Error('Truncated PNG payload');
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('Invalid PNG header');
      width = data.readUInt32BE(start);height = data.readUInt32BE(start + 4);channels = data[start + 9] === 6 ? 4 : data[start + 9] === 2 ? 3 : 0;
      if (!width || !height || width > 4096 || height > 4096 || data[start + 8] !== 8 || !channels || data[start + 10] || data[start + 11] || data[start + 12]) throw new Error('Expected bounded noninterlaced canvas RGB/RGBA8 PNG');
    } else if (type === 'IDAT') payload.push(data.subarray(start, start + length));
    offset = start + length + 4;if (type === 'IEND') break;
  }
  if (!width || !payload.length) throw new Error('Missing PNG header/pixels');
  const stride = width * channels, source = inflateSync(Buffer.concat(payload), {maxOutputLength: (stride + 1) * height});
  if (source.length !== (stride + 1) * height) throw new Error('Invalid PNG pixel extent');
  const decoded = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);return x <= y && x <= z ? a : y <= z ? b : c;};
  for (let y = 0; y < height; y++) {
    const filter = source[y * (stride + 1)];if (filter > 4) throw new Error('Invalid PNG row filter');
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x, left = x >= channels ? decoded[offset - channels] : 0, above = y ? decoded[offset - stride] : 0, corner = y && x >= channels ? decoded[offset - stride - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, corner);
      decoded[offset] = (source[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  if (channels === 4) return {width, height, pixels: decoded};
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let n = 0; n < width * height; n++) decoded.copy(pixels, n * 4, n * 3, n * 3 + 3);
  return {width, height, pixels};
}
