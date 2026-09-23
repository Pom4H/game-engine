import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const directory=process.argv[2];
if(!directory)throw new Error('Usage: node log-preview.mjs <render-batch output directory>');
const report=JSON.parse(readFileSync(join(directory,'report.json'),'utf8'));
const id=existsSync(join(directory,'production.png'))?'production':report.best?.id;
if(!id)throw new Error('No Winter Hero PNG was retained');
const image=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',join(directory,`${id}.png`),'-vf','scale=256:-2','-frames:v','1','-q:v','12','-f','image2pipe','-vcodec','mjpeg','-'],{maxBuffer:2_000_000});
if(image.error||image.status!==0||!image.stdout.length)throw new Error(`Preview conversion failed: ${image.error??image.stderr}`);
console.log(`WINTER_HERO_PREVIEW_ID=${id}`);
console.log(`WINTER_HERO_PREVIEW_JPEG_BASE64=${image.stdout.toString('base64')}`);
