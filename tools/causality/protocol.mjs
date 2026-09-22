export const CAUSAL_COMMIT_SCHEMA='game-engine.causal-commit/v1';
export const CAUSAL_EVIDENCE_SCHEMA='game-engine.causal-evidence/v1';
export const REQUIRED_TRAILERS=[
  'Causal-Experiment',
  'Causal-Observation',
  'Causal-Hypothesis',
  'Causal-Intervention',
  'Causal-Prediction',
];

export function parseCausalCommit(message){
  const normalized=String(message??'').replace(/\r\n/g,'\n').trim();
  const lines=normalized.split('\n');
  const subject=(lines[0]??'').trim();
  const trailers=new Map();
  for(const line of lines.slice(1)){
    const match=line.match(/^(Causal-[A-Za-z0-9-]+):\s*(.+)$/);
    if(!match)continue;
    const [,key,value]=match;
    const values=trailers.get(key)??[];
    values.push(value.trim());trailers.set(key,values);
  }
  const one=key=>trailers.get(key)?.at(-1)??null;
  const many=key=>trailers.get(key)??[];
  return {
    schema:CAUSAL_COMMIT_SCHEMA,
    subject,
    experiment:one('Causal-Experiment'),
    observation:one('Causal-Observation'),
    hypothesis:one('Causal-Hypothesis'),
    intervention:one('Causal-Intervention'),
    prediction:one('Causal-Prediction'),
    targets:many('Causal-Target'),
    guards:many('Causal-Guard'),
    dependsOn:many('Causal-Depends-On'),
    supersedes:many('Causal-Supersedes'),
    trailers:Object.fromEntries([...trailers].map(([key,values])=>[key,[...values]])),
  };
}

export function validateCausalCommit(commit){
  const errors=[];
  if(!commit.subject)errors.push('Commit subject is empty');
  if(/^(?:wip|fixup!|squash!)(?:\b|:)/i.test(commit.subject))errors.push('Commit subject must describe the intervention; WIP/fixup/squash commits are not causal evidence');
  for(const key of REQUIRED_TRAILERS){
    if(!(commit.trailers[key]?.some(Boolean)))errors.push(`Missing ${key} trailer`);
  }
  return errors;
}

export function causalFingerprint(commit){
  const normalize=value=>String(value??'').toLowerCase().trim().replace(/\s+/g,' ');
  return [normalize(commit.experiment),normalize(commit.hypothesis),normalize(commit.intervention)].join('\n');
}

export function classifyEvidence({experiment,jobs={},reality=null}){
  const states=Object.values(jobs).filter(Boolean);
  if(experiment==='stanford-orb'){
    if(states.some(state=>['failure','cancelled','timed_out','action_required'].includes(state)))return 'rejected';
    if(states.some(state=>state==='skipped'))return 'incomplete';
    if(reality?.regressions?.length)return 'rejected';
    const delta=reality?.baseline?.delta,tolerance=reality?.baseline?.tolerance??0;
    if(Number.isFinite(delta)){
      if(delta < -tolerance)return 'accepted';
      if(delta > tolerance)return 'rejected';
      return 'neutral';
    }
    return 'incomplete';
  }
  return 'observed';
}
