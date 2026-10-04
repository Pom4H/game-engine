#!/usr/bin/env python3
import json, re, sys, wave
from vosk import Model, KaldiRecognizer

if len(sys.argv) < 4:
    raise SystemExit("usage: vosk-intelligibility.py WAV MODEL_DIR EXPECTED [MAX_WER]")

wav_path, model_dir, expected = sys.argv[1:4]
max_wer = float(sys.argv[4]) if len(sys.argv) > 4 else 0.40

def normalize(text: str) -> str:
    text = text.lower().replace("ё", "е")
    text = re.sub(r"[^а-я0-9\s]+", " ", text)
    return " ".join(text.split())

def edit_distance(a, b):
    prev = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(
                cur[-1] + 1,
                prev[j] + 1,
                prev[j-1] + (x != y),
            ))
        prev = cur
    return prev[-1]

with wave.open(wav_path, "rb") as wf:
    if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
        raise SystemExit(f"ASR WAV must be mono 16-bit 16kHz, got {wf.getnchannels()}ch/{wf.getsampwidth()*8}bit/{wf.getframerate()}Hz")
    model = Model(model_dir)
    rec = KaldiRecognizer(model, wf.getframerate())
    rec.SetWords(True)
    chunks = []
    while True:
        data = wf.readframes(4000)
        if not data:
            break
        if rec.AcceptWaveform(data):
            chunks.append(json.loads(rec.Result()).get("text", ""))
    chunks.append(json.loads(rec.FinalResult()).get("text", ""))

hyp = normalize(" ".join(chunks))
ref = normalize(expected)
ref_words, hyp_words = ref.split(), hyp.split()
distance = edit_distance(ref_words, hyp_words)
wer = distance / max(1, len(ref_words))
ref_chars = list(ref.replace(" ", ""))
hyp_chars = list(hyp.replace(" ", ""))
cer = edit_distance(ref_chars, hyp_chars) / max(1, len(ref_chars))
result = {
    "expected": ref,
    "recognized": hyp,
    "word_errors": distance,
    "words": len(ref_words),
    "wer": wer,
    "cer": cer,
    "max_wer": max_wer,
}
print(json.dumps(result, ensure_ascii=False, indent=2))
if wer > max_wer:
    raise SystemExit(f"speech intelligibility gate failed: WER={wer:.3f} > {max_wer:.3f}")
