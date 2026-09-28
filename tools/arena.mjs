import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Same docs server/editor/build pipeline; one opt-in authoritative room.
process.env.ARENA='1';
if(process.env.ARENA_TRANSPORT!=='sse'&&!existsSync('tools/transport/node_modules/@webtransport-bun/webtransport')){
 const child=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['install','--prefix','tools/transport','--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit',shell:process.platform==='win32'});if(child.status!==0)throw Error('Native transport installation failed');
}
await import('./docs/dev.mjs');
