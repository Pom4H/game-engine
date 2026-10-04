#!/usr/bin/env python3
import json, pathlib, re, sys, wave
from vosk import Model, KaldiRecognizer

if len(sys.argv) < 4:
    raise SystemExit("usage: rank-motor-search.py WAV_DIR MODEL_DIR EXPECTED [OUT_JSON]")
wav_dir=pathlib.Path(sys.argv[1]); model_dir=sys.argv[2]; expected=sys.argv[3].lower()
out_json=pathlib.Path(sys.argv[4]) if len(sys.argv)>4 else wav_dir/"search-results.json"

def norm(s):
    return " ".join(re.sub(r"[^a-z0-9\s]+"," ",s.lower()).split())
def edit(a,b):
    prev=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        cur=[i]
        for j,y in enumerate(b,1):
            cur.append(min(cur[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
        prev=cur
    return prev[-1]

model=Model(model_dir); ref=norm(expected); refw=ref.split(); refc=list(ref.replace(" ",""))
meta={x["id"]:x for x in json.loads((wav_dir/"candidates.json").read_text())}
rows=[]
for path in sorted(wav_dir.glob("*.wav")):
    with wave.open(str(path),"rb") as wf:
        rec=KaldiRecognizer(model,wf.getframerate())
        chunks=[]
        while True:
            data=wf.readframes(4000)
            if not data: break
            if rec.AcceptWaveform(data): chunks.append(json.loads(rec.Result()).get("text",""))
        chunks.append(json.loads(rec.FinalResult()).get("text",""))
    hyp=norm(" ".join(chunks)); hypw=hyp.split(); hypc=list(hyp.replace(" ",""))
    wer=edit(refw,hypw)/max(1,len(refw)); cer=edit(refc,hypc)/max(1,len(refc))
    row={"id":path.stem,"recognized":hyp,"wer":wer,"cer":cer,**{k:v for k,v in meta[path.stem].items() if k!="diagnostics"}}
    rows.append(row)
rows.sort(key=lambda r:(r["wer"],r["cer"],r["recognized"]=="",r["id"]))
best=rows[0]
payload={"expected":ref,"best":best,"exact_matches":[r for r in rows if r["wer"]==0],"top":rows[:20]}
out_json.write_text(json.dumps(payload,indent=2),encoding="utf-8")
print(json.dumps(payload,indent=2))
if best["wer"]!=0:
    raise SystemExit(f"no exact ASR match; best={best['recognized']!r} WER={best['wer']:.3f} CER={best['cer']:.3f}")
