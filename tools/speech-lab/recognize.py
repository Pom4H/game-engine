"""All fixed REAL-word cases, independent unprompted recognition.
Syllables are not language-model word tests. Their acoustic files remain in
manifest.json. The acceptance threshold is not used to select or omit clips.
"""
import hashlib,json,re,sys
from pathlib import Path
from faster_whisper import WhisperModel

def words(s):return re.sub(r'[^a-z0-9\s]',' ',s.lower()).split()
def edits(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        new=[i]
        for j,y in enumerate(b,1):new.append(min(new[-1]+1,row[j]+1,row[j-1]+(x!=y)))
        row=new
    return row[-1]

root=Path(sys.argv[1]);manifest=json.loads((root/'manifest.json').read_text());model=WhisperModel('base.en',device='cpu',compute_type='int8');rows=[]
for case in manifest['cases']:
    if case['expected'] is None:continue
    audio=root/case['file']
    if hashlib.sha256(audio.read_bytes()).hexdigest()!=case['sha256']:raise ValueError('Audio hash mismatch')
    segments,_=model.transcribe(str(audio),language='en',beam_size=5,temperature=0,vad_filter=False,initial_prompt=None,condition_on_previous_text=False)
    recognized=' '.join(s.text for s in segments);expected=case['expected'];n=len(words(expected));e=edits(words(expected),words(recognized))
    row={'id':case['id'],'expected':expected,'recognized':recognized,'words':n,'errors':e,'wer':e/n};rows.append(row);print(json.dumps(row),flush=True)
count=sum(r['words'] for r in rows);errors=sum(r['errors'] for r in rows)
report={'model':'base.en','initialPrompt':None,'conditionOnPreviousText':False,'corpusSha256':manifest['corpusSha256'],'cases':rows,'wordErrors':errors,'words':count,'wer':errors/count,'maxWer':.25,'passed':errors/count<=.25}
(root/'asr.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='cases'}))
if not report['passed']:raise SystemExit('Native short-phrase intelligibility gate failed')
