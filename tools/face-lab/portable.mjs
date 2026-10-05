/** Bundle the existing engine and accepted branch face lab into one portable
 * HTML document. This is not another renderer or a prerecorded animation.
 * Requires Bun at build time only. The CC0 anatomical data is imported by the
 * same scene code and bundled with it. No network/CDN/model fetch at playback.
 */
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const out=resolve(process.env.FACE_LAB_OUTPUT??'artifacts/face-portable');
const html=await readFile(resolve(here,'player.html'),'utf8');
const modules=[...html.matchAll(/<script\s+type="module">([\s\S]*?)<\/script>/g)];
if(modules.length!==1)throw new Error('Expected one face player module');
const entry=modules[0][1].replace("from '/dist/browser.js'","from '../../dist/browser.js'");
if(entry===modules[0][1])throw new Error('Face player engine import changed');
const temporary=resolve(here,'.portable-entry.mjs');
try{
  await mkdir(out,{recursive:true});await writeFile(temporary,entry,{flag:'wx'});
  const build=await Bun.build({entrypoints:[temporary],target:'browser',format:'esm',minify:true,splitting:false,sourcemap:'none'});
  if(!build.success)throw new Error(build.logs.map(String).join('\n'));
  const scripts=build.outputs.filter(output=>output.kind==='entry-point');
  if(scripts.length!==1||build.outputs.length!==1)throw new Error('Portable viewer must be a single self-contained bundle');
  const code=(await scripts[0].text()).replace(/<\/script/gi,'<\\/script');
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw new Error('Invalid source commit');
  const document=html.replace(modules[0][0],`<script type="module">${code}</script>`).replace('<head>','<head>');
  const output=`<!-- game-engine face lab; source ${sourceCommit}; silent geometry diagnostic; not an ASR or hardware acceptance result -->\n${document}`;
  const bytes=Buffer.from(output),sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(out,'face-lab.html'),bytes);
  await writeFile(resolve(out,'evidence.json'),JSON.stringify({schemaVersion:1,sourceCommit,sha256,bytes:bytes.length,renderer:'game-engine WebGPU',audio:'muted-diagnostic',bundled:true,renderValidated:false},null,2)+'\n');
  const notice=await readFile(resolve(root,'licenses/face-reference.md'),'utf8');
  await writeFile(resolve(out,'LICENSE-ASSET.md'),notice);
  await writeFile(resolve(out,'README.txt'),'Лаборатория лицевой анимации game-engine\n\nОткройте face-lab.html в браузере с WebGPU. Внутри — сам движок, сцена, два лица и 14-секундная анимация. Звука нет: речь проверяется отдельно. Кнопки: Пауза / Смотреть, Сначала.\n\nНекоторые браузеры не дают WebGPU локальным файлам. В таком случае в каталоге с HTML выполните python -m http.server 8000 и откройте http://localhost:8000/face-lab.html. На iPhone приложение «Файлы» может показывать только предпросмотр HTML: нужен запуск страницы в поддерживающем WebGPU браузере через HTTPS.\n\nСборка HTML сама по себе не доказывает работу GPU или качество анимации. Контрольная сумма и исходный коммит находятся в evidence.json. Лицензия анатомической сетки — CC0; код и анимация из game-engine.\n');
  console.log(JSON.stringify({sourceCommit,sha256,bytes:bytes.length,file:resolve(out,'face-lab.html')}));
}finally{await unlink(temporary).catch(()=>{});}
