/** Source inventory, not a fabricated percentage of engine parity. */
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mappings=new Map([
  ['src/physics/dihedral.ts',{status:'candidate-port',rust:'kernels/engine-runtime/src/geometry.rs',scope:'angle and gradient; not an implicit shell solver'}],
  ['src/physics/wheel-contact.ts',{status:'candidate-port',rust:'kernels/engine-runtime/src/wheel.rs',scope:'bounded independent wheel solve; not chassis/contact scheduling'}],
  ['src/physics/structural-skin.ts',{status:'partial',rust:'kernels/engine-runtime/src/geometry.rs',scope:'apply only; bindStructuralSkin remains TypeScript'}],
  ['src/physics/deformation.ts',{status:'partial',rust:'kernels/engine-runtime/src/geometry.rs',scope:'mesh projection only; contact energy and dent lifecycle remain TypeScript'}],
  ['src/vehicles/interaction-physics.ts',{status:'partial',rust:'kernels/engine-runtime/src/geometry.rs',scope:'panel mesh projection only; panel dynamics and M3 rig remain TypeScript'}],
]);
const bridge=new Set(['src/rust.ts','src/runtime/rust-kernels.ts']);
async function walk(path){const out=[];for(const d of await readdir(path,{withFileTypes:true})){const full=resolve(path,d.name);if(d.isDirectory())out.push(...await walk(full));else if(d.name.endsWith('.ts'))out.push(full);}return out;}
const modules=[];
for(const full of (await walk(resolve(root,'src'))).sort()){
  const path=relative(root,full).replaceAll('\\','/'),source=await readFile(full);
  modules.push({path,bytes:source.length,sha256:createHash('sha256').update(source).digest('hex'),
    ...(bridge.has(path)?{status:'host-bridge'}:mappings.get(path)??{status:'not-ported-in-this-migration'})});
}
const report={schema:1,base:'2c3abdda7d34bcc1d60414a2cd129ec83a166dc6',complete:modules.every(m=>m.status==='host-bridge'||m.status==='production-native'),
  note:'Candidates are not production-enabled. Existing Rust XPBD/rigid/wave/sparse kernels are separate prior work, not proof that their TypeScript owners are migrated.',
  totals:modules.reduce((a,m)=>{a[m.status]=(a[m.status]??0)+1;return a;},{}),modules};
const directory=resolve(root,'artifacts/rust-engine');await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'migration-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.totals,null,2));
if(process.argv.includes('--require-complete')&&!report.complete){console.error('Full-engine Rust migration is NOT complete. See migration-audit.json.');process.exitCode=1;}
