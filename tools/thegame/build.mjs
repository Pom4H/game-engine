import {mkdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
export async function buildThegame(root,out){
 const game=join(out,'games/thegame');await mkdir(game,{recursive:true});
 for(const file of ['index.html','style.css','app.mjs','network-worker.mjs'])await cp(join(root,'tools/thegame',file),join(game,file));
 await cp(join(root,'examples/thegame/project.ts'),join(game,'project.ts'));
}
