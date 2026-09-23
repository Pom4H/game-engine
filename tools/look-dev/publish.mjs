// Publish only this app's directory, preserving gh-pages history and other files.
// No Actions artifact storage, force push, billing change or Pages reconfiguration.
import {cp,mkdtemp,readFile,rm,appendFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const repo=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA,token=process.env.GITHUB_TOKEN;
if(!repo||!sha||!token)throw new Error('Run publication in the repository Actions workflow');
const siteDir=join(root,'_site'),proof=JSON.parse(await readFile(join(siteDir,'look-dev-proof.json'),'utf8'));
if(proof.revision!==sha||proof.backend!=='webgpu'||proof.renderer.errors.length)throw new Error('Refuse publishing without matching successful GPU evidence');
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const api=async(path,method='GET')=>{
 const response=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 if(!response.ok)throw new Error(`GitHub ${method} ${path}: ${response.status} ${await response.text()}`);
 return await response.json();
};
const summary=async text=>{console.log(text);if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,text+'\n');};
const directory=await mkdtemp(join(tmpdir(),'look-dev-publish-'));
let attached=false,publishedCommit;
try{
 git(['fetch','--no-tags','origin','gh-pages:refs/remotes/origin/gh-pages']);
 git(['worktree','add','--detach',directory,'refs/remotes/origin/gh-pages']);attached=true;
 // This subdirectory is exclusively owned by this publisher. Existing videos,
 // reports and other Pages applications outside it are never removed.
 await rm(join(directory,'look-dev'),{recursive:true,force:true});
 await cp(siteDir,join(directory,'look-dev'),{recursive:true});
 await writeFile(join(directory,'.nojekyll'),'');
 git(['add','--','look-dev','.nojekyll'],directory);
 git(['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m',`Publish verified look-dev ${sha}`],directory);
 publishedCommit=git(['rev-parse','HEAD'],directory);
 git(['push','origin',`${publishedCommit}:refs/heads/gh-pages`]);
 await summary(`Verified app and real screenshot saved to gh-pages/look-dev at ${publishedCommit}; engine ${sha}.`);
}finally{
 if(attached)git(['worktree','remove','--force',directory]);
 await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
const site=await api('/pages');
console.log('PAGES_CONFIG',JSON.stringify({build_type:site.build_type,source:site.source,html_url:site.html_url}));
if(site.build_type==='workflow'||site.source?.branch!=='gh-pages'||site.source?.path!=='/'){
 throw new Error('Built app is preserved on gh-pages/look-dev. To serve without Actions artifacts, the owner must select Settings > Pages > Deploy from a branch > gh-pages / (root). Existing Pages settings were not changed.');
}
await api('/pages/builds','POST');
const url=new URL('look-dev/',site.html_url.replace(/\/?$/,'/')).href;
for(let i=0;i<90;i++){
 const build=await api('/pages/builds/latest');
 if(build.commit===publishedCommit&&build.status==='built'){
  // Verify the served revision, not merely the API's successful build status.
  for(let attempt=0;attempt<30;attempt++){
   try{const response=await fetch(new URL(`manifest.json?revision=${sha}`,url),{cache:'no-store'});if(response.ok&&(await response.json()).revision===sha){await summary(`Published and revision-verified: ${url}`);process.exit(0);}}catch{}
   await new Promise(r=>setTimeout(r,2000));
  }
  throw new Error('Pages build succeeded but served revision is not verified yet');
 }
 if(build.commit===publishedCommit&&build.status==='errored')throw new Error(build.error?.message??'Pages build failed');
 await new Promise(r=>setTimeout(r,2000));
}
throw new Error('Built app is committed, but Pages did not finish within the verification window');
