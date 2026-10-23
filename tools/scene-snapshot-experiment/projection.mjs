// Deliberately incomplete editor projection, never a parser or a runtime input.
// Rust validates every byte first. Only simple one-line lets/material names are
// projected; dimensional arithmetic and coupling semantics remain in worldc.
export function materialNamesFromRust(source) {
  const anchors = source.match(/\bconst\s+MATERIALS\b/g) ?? [];
  const match = source.match(/^const MATERIALS: \[&str; (\d+)\] = \[([\s\S]*?)\];\r?$/m);
  if (anchors.length !== 1 || !match || !/^\s*"[a-z]+"(?:\s*,\s*"[a-z]+")*\s*,?\s*$/.test(match[2])) {
    throw new Error('Rust MATERIALS declaration changed; update the experimental adapter');
  }
  const values = [...match[2].matchAll(/"([a-z]+)"/g)].map(value => value[1]);
  if (values.length !== Number(match[1]) || new Set(values).size !== values.length) {
    throw new Error('Rust MATERIALS extraction is incomplete');
  }
  return values;
}

export function compilerFingerprint(bytes) {
  let value = 0xcbf29ce484222325n;
  for (const byte of bytes) value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n);
  return value.toString(16).padStart(16, '0');
}

export function rustByteToUtf16(source, byteOffset) {
  const bytes = Buffer.from(source);
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset > bytes.length ||
      (byteOffset < bytes.length && (bytes[byteOffset] & 0xc0) === 0x80)) {
    throw new Error('Rust diagnostic offset is not a UTF-8 character boundary');
  }
  return bytes.subarray(0, byteOffset).toString('utf8').length;
}

const reserved = new Set('break case catch const class continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield await implements interface let package private protected public static eval arguments'.split(' '));
const tokenPattern = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:[\p{L}°²]+(?:\/[\p{L}]+\d*)?\d*)?|[A-Za-z_][A-Za-z0-9_]*|[^\s]/gu;
function supportedExpression(expression) {
  const tokens = [...expression.matchAll(tokenPattern)];
  let operand = true;
  let depth = 0;
  for (const token of tokens) {
    const raw = token[0];
    if (operand) {
      if (raw === '+' || raw === '-') continue;
      if (raw === '(') { depth++; continue; }
      if (!/^(?:\d|\.\d)/.test(raw) && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) || reserved.has(raw))) return undefined;
      operand = false;
    } else if (raw === ')' && depth > 0) depth--;
    else if (['+', '-', '*', '/'].includes(raw)) operand = true;
    else return undefined;
  }
  return !operand && depth === 0 ? tokens : undefined;
}

export function project(source, materialNames) {
  let text = 'export {};\ntype __WorldMaterial = ' + materialNames.map(JSON.stringify).join(' | ') + ';\n';
  const mappings = [];
  const append = (value, originalStart, originalLength = value.length, kind = 0) => {
    const start = text.length;
    text += value;
    mappings.push([start, value.length, originalStart, originalLength, kind]);
  };
  // Comments are erased while retaining offsets; no language evaluation here.
  const clean = source.replace(/\/\/[^\n\r]*|#[^\n\r]*/g, value => ' '.repeat(value.length));
  const declarations = [...clean.matchAll(/\blet\s+([\p{L}_][\p{L}\p{N}_-]*)\s*=\s*([^;\r\n{}]+)/gu)];
  // If even one declaration cannot be projected, leave *all* constants to Rust.
  // Otherwise later supported lines could falsely refer to an omitted binding.
  const letCount = [...clean.matchAll(/\blet\b/g)].length;
  const projectLets = letCount === declarations.length && declarations.every(match =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(match[1]) && !reserved.has(match[1]) &&
    !/[\p{L}_][\p{L}\p{N}_]*-[\p{L}\p{N}_]+/u.test(match[2]) && supportedExpression(match[2].trimEnd()));
  for (const match of projectLets ? declarations : []) {
    const name = match[1];
    const expression = match[2].trimEnd();
    // World permits hyphenated names; a tiny projection must not reinterpret
    // them as TS subtraction or manufacture false diagnostics.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || reserved.has(name) || /[\p{L}_][\p{L}\p{N}_]*-[\p{L}\p{N}_]+/u.test(expression)) continue;
    const tokens = supportedExpression(expression);
    if (!tokens) continue;
    text += 'const ';
    append(name, match.index + match[0].indexOf(name));
    text += ': number = ';
    const expressionStart = match.index + match[0].indexOf(match[2]);
    for (const token of tokens) {
      const raw = token[0];
      const numeric = /^(?:\d|\.\d)/.test(raw);
      // Values/units belong to Rust. A number placeholder also avoids treating
      // valid World spellings such as 01 as forbidden strict-JS octal syntax.
      if (numeric) append('0', expressionStart + token.index, raw.length, raw === '0' ? 0 : 1);
      else append(raw, expressionStart + token.index);
      text += ' ';
    }
    text += ';\n';
  }
  let materialIndex = 0;
  for (const match of clean.matchAll(/\bmaterial\s*:\s*([\p{L}_][\p{L}\p{N}_-]*)/gu)) {
    const originalStart = match.index + match[0].lastIndexOf(match[1]);
    text += '{ const ';
    // Assignment diagnostics point at the declaration name, so that generated
    // name also needs a mapping. Both projections can map to the same token.
    append(`__material${materialIndex++}`, originalStart, match[1].length, 2);
    text += ': __WorldMaterial = ';
    append(JSON.stringify(match[1]), originalStart, match[1].length, 1);
    text += '; }\n';
  }
  return { text, extension: '.ts', mappings };
}
