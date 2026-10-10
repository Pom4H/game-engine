#!/usr/bin/env node
/** Pipe Codex app-server JSON-RPC notifications into Agent Office.
 *
 *   codex app-server | node tools/agent-office/codex-bridge.mjs
 *
 * Codex app-server is bidirectional: in normal operation attach this
 * observer to the notifications your *existing host* receives instead of
 * stealing app-server stdout from the host. This CLI is for an already
 * duplicated/read-only JSONL stream of notifications.
 */
import {createInterface} from 'node:readline';
import {CodexActivityAdapter} from '../../dist/observability/adapters/codex.js';
const adapter=new CodexActivityAdapter();
const endpoint=new URL(process.env.OFFICE_URL??'http://127.0.0.1:4176/api/events');
if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||
   endpoint.pathname!=='/api/events'||endpoint.username||endpoint.password)
 throw new TypeError('OFFICE_URL must be the loopback /api/events endpoint; do not ship tool events to an arbitrary host');
const headers={'content-type':'application/json'};
if(process.env.AGENT_OFFICE_TOKEN)headers.authorization='Bearer '+process.env.AGENT_OFFICE_TOKEN;
let forwarded=0,skipped=0;
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 if(!line.trim())continue;
 let message;
 try{message=JSON.parse(line);}catch{skipped++;continue;}
 // Time of receipt is a local observation timestamp, not an invented
 // upstream startedAt timestamp.
 const facts=adapter.push(message,Date.now());
 if(!facts.length)continue;
 const result=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(facts)});
 if(!result.ok)throw new Error('Agent Office ingest failed: HTTP '+result.status);
 forwarded+=facts.length;
}
console.error('Codex observer: '+forwarded+' facts forwarded, '+skipped+' invalid JSONL lines skipped');
