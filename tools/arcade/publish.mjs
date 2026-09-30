import {spawnSync} from 'node:child_process';
const tag=process.argv[2];
if(!tag||!process.env.GITHUB_TOKEN||!process.env.GITHUB_REPOSITORY)throw new Error('Release tag and scoped repository token are required');
const files=['snowy-arcade.png','snowy-arcade-motion.png','arcade-preview.jpg','arcade-evidence.json','unit-tests.log'].map(f=>'artifacts/'+f);
const child=spawnSync(process.execPath,['tools/publish-release.mjs',tag,...files],{stdio:'inherit'});
if(child.error)throw child.error;if(child.status!==0)process.exit(child.status??1);
const api='https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY;
const headers={Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json'};
const response=await fetch(api+'/releases/tags/'+encodeURIComponent(tag),{headers});
if(!response.ok)throw new Error('Release metadata '+response.status);
const release=await response.json();
// These short-lived URLs grant access only to the requested render asset, not
// the repository token. The native PNG can then be reviewed without encoding
// a multi-megabyte image as text or relying on a lossy log preview.
for(const name of ['arcade-preview.jpg','snowy-arcade.png']){
 const asset=release.assets.find(a=>a.name===name);if(!asset)throw new Error('Missing render asset '+name);
 const result=await fetch(api+'/releases/assets/'+asset.id,{headers:{...headers,Accept:'application/octet-stream'},redirect:'manual'});
 const location=result.headers.get('location');
 if(location)console.log('RENDER_DOWNLOAD='+JSON.stringify({name,size:asset.size,digest:asset.digest,url:location}));
 else console.warn('No temporary asset redirect for '+name+': '+result.status);
}
