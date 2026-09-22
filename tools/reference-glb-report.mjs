import fs from 'node:fs/promises';
import {loadGLBReference,referenceReport} from './glb-reference.mjs';
const url=process.env.REFERENCE_GLB_URL||process.argv[2];if(!url)throw new Error('REFERENCE_GLB_URL or URL argument required');
const report=referenceReport(await loadGLBReference(url));
console.log('GLB_REFERENCE_REPORT '+JSON.stringify(report));
if(process.env.REFERENCE_GLB_REPORT)await fs.writeFile(process.env.REFERENCE_GLB_REPORT,JSON.stringify(report,null,2));
