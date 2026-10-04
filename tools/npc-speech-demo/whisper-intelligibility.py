#!/usr/bin/env python3
import json,os,re,sys,wave
import numpy as np
from faster_whisper import WhisperModel

if len(sys.argv)<4:
    raise SystemExit("usage: whisper-intelligibility.py WAV EXPECTED MAX_WER [OUT_JSON]")
wav,expected,max_wer=sys.argv[1],sys.argv[2],float(sys.argv[3])
out=sys.argv[4] if len(sys.argv)>4 else None

def norm(s):
    s=s.lower().replace("ё","е")
    s=re.sub(r"[^a-zа-я0-9\s]+"," ",s)
    return " ".join(s.split())
def edit(a,b):
    prev=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        cur=[i]
        for j,y in enumerate(b,1):
            cur.append(min(cur[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
        prev=cur
    return prev[-1]

with wave.open(wav,"rb") as wf:
    if wf.getnchannels()!=1 or wf.getsampwidth()!=2 or wf.getframerate()!=16000:
        raise SystemExit(f"Whisper WAV must be mono 16-bit 16kHz, got {wf.getnchannels()}ch/{wf.getsampwidth()*8}bit/{wf.getframerate()}Hz")
    pcm=np.frombuffer(wf.readframes(wf.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
model_name=os.environ.get("WHISPER_MODEL","tiny.en")
model=WhisperModel(model_name,device="cpu",compute_type="int8")
segments,info=model.transcribe(pcm,language="en",beam_size=5,vad_filter=False,temperature=0.0,initial_prompt=None,condition_on_previous_text=False)
hyp=norm(" ".join(seg.text for seg in segments))
ref=norm(expected)
rw,hw=ref.split(),hyp.split()
wer=edit(rw,hw)/max(1,len(rw))
cer=edit(list(ref.replace(" ","")),list(hyp.replace(" ","")))/max(1,len(ref.replace(" ","")))
result={"expected":ref,"recognized":hyp,"wer":wer,"cer":cer,"max_wer":max_wer,"language":info.language,"model":model_name,"initial_prompt":None}
payload=json.dumps(result,ensure_ascii=False,indent=2)
print(payload)
if out:
    open(out,"w",encoding="utf-8").write(payload+"\n")
if wer>max_wer:
    raise SystemExit(f"Whisper intelligibility gate failed: WER={wer:.3f} > {max_wer:.3f}")

