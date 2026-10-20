import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWindowsDawn } from './windows-napi.mjs';

if (!process.versions.bun) throw new Error('Use Bun to compile the native executable');
const root = fileURLToPath(new URL('../../', import.meta.url));
const nativeDir = resolve(root, 'tools/native');
await access(join(nativeDir, 'node_modules/@kmamal/gpu'));
await access(join(nativeDir, 'node_modules/@kmamal/sdl'));
const out = resolve(root, 'artifacts/native-app');
await mkdir(join(out, 'runtime'), { recursive: true });
const executable = join(out, process.platform === 'win32' ? 'the-engine.exe' : 'the-engine');
const result = await Bun.build({
  entrypoints: [join(nativeDir, 'main.mjs')], target: 'bun',
  compile: { outfile: executable },
  external: ['@kmamal/gpu', '@kmamal/sdl'],
  define: { __ENGINE_NATIVE_COMPILED__: 'true' },
});
if (!result.success) throw new AggregateError(result.logs, 'Native executable compilation failed');
await cp(join(nativeDir, 'package.json'), join(out, 'runtime/package.json'));
await cp(join(nativeDir, 'node_modules'), join(out, 'runtime/node_modules'), { recursive: true, dereference: true });
if (process.platform === 'win32') prepareWindowsDawn(join(nativeDir, 'node_modules/@kmamal/gpu/dist/dawn.node'), executable, join(out, 'runtime/dawn-bun.node'));
await writeFile(join(out, 'README.txt'), `The Engine native\nRun the-engine${process.platform === 'win32' ? '.exe' : ''}.\nKeep runtime/ beside the executable. Keep the Windows executable name the-engine.exe; renaming requires rebuilding its Node-API binding.\nNo browser, Node or separately installed Bun is required at runtime.\nBuilt for ${process.platform}-${process.arch}; native addons are not cross-compiled.\nWASD/Q/E: camera. Escape: quit. --help: capture options.\n`);
console.log(executable);
