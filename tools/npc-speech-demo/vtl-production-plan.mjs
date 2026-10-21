#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {planVtlNpcSpeech,serializeVtlSegmentSequence,VTL_EXTERNAL_BACKEND} from '../../dist/index.js';

const out='artifacts/npc-vtl-production';
await mkdir(out,{recursive:true});
const plan=planVtlNpcSpeech('la la');
await writeFile(out+'/la-la.seg',serializeVtlSegmentSequence(plan));
await writeFile(out+'/backend.json',JSON.stringify({
  plan,
  backend:VTL_EXTERNAL_BACKEND,
  upstreamCommit:'df30392f18dc5e175b577c3ba734caaa65a3927f',
},null,2));
console.log(JSON.stringify({segment:out+'/la-la.seg',plan},null,2));
