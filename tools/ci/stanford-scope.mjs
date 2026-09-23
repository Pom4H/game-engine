import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';

// Stanford renders engine code against its own measured capture. Scene-only
// authoring and render-lab scripts cannot change those pixels.
let check=true;
try{
  const changed=execFileSync('git',['diff','--name-only','HEAD^','HEAD'],{encoding:'utf8'}).trim().split(/\r?\n/);
  check=changed.some(path=>path!=='tools/reality/winter-hero/reference.jpg'&&/^(src\/|test\/|tools\/reality\/|tools\/render-oracle\.mjs$|package\.json$|bun\.lock$)/.test(path));
}catch(error){console.warn('Commit diff unavailable; run the full Stanford guard:',error.message);}
appendFileSync(process.env.GITHUB_OUTPUT,`run=${check}\n`);
console.log(`Stanford held-out ${check?'required':'unchanged: scene or visual-target-only commit'}`);
