#!/usr/bin/env python3
import json,pathlib,re,sys,wave
import numpy as np
from faster_whisper import WhisperModel

if len(sys.argv)!=3:
    raise SystemExit("usage: whisper-batch.py WAV_DIR OUT_JSON")
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2])
model=WhisperModel("tiny.en",device="cpu",compute_type="int8")
rows=[]
for wav in sorted(root.glob("*.wav")):
    with wave.open(str(wav),"rb") as wf:
        pcm=np.frombuffer(wf.readframes(wf.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
        fs=wf.getframerate()
    if fs!=16000:
        # Batch expects the workflow to create -16k.wav copies.
        continue
    segs,info=model.transcribe(pcm,language="en",beam_size=5,vad_filter=False,temperature=0.0)
    text=" ".join(s.text for s in segs).lower().strip()
    text=" ".join(re.sub(r"[^a-z0-9\s]+"," ",text).split())
    rows.append({"file":wav.name,"recognized":text})
payload={"results":rows}
out.write_text(json.dumps(payload,indent=2),encoding="utf-8")
print(json.dumps(payload,indent=2))
