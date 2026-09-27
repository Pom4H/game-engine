import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../package.json',import.meta.url));
const result=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.build.json'],{stdio:'inherit'});
if(result.status)process.exit(result.status??1);
await import('./build.mjs');await import('./server.mjs');
