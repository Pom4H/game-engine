import {readFile} from 'node:fs/promises';
import {makeCity} from './city.mjs';

// Standard engine entry point. The production BrowserRuntime owns playback,
// reset, animation, snow contacts, spray and sound; no movie player is needed.
const m3=JSON.parse(await readFile(new URL('./assets/m3.json',import.meta.url),'utf8'));
export default makeCity('street',m3).spec;
