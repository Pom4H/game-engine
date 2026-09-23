import {readFileSync} from 'node:fs';
const file=process.argv[2];
if(!file)throw new Error('Usage: node log-video.mjs <mp4>');
const bytes=readFileSync(file);
if(bytes.length<1000||bytes.length>1_000_000)throw new Error(`Unexpected video size: ${bytes.length}`);
console.log(`WINTER_HERO_VIDEO_BYTES=${bytes.length}`);
console.log(`WINTER_HERO_VIDEO_MP4_BASE64=${bytes.toString('base64')}`);
