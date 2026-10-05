#!/usr/bin/env python3
"""Diagnostic only: recognise every utterance independently, with no transcript
prompt and no decoder context carried from the previous utterance. The existing
full-recording intelligibility gate remains authoritative and is not relaxed.
The transcript is used exclusively AFTER recognition to calculate edit distance.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import wave
import numpy as np
from faster_whisper import WhisperModel


def normalize(text):
    return ' '.join(re.sub(r'[^a-z0-9\s]+', ' ', text.lower()).split())


def edit(a, b):
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        row = [i]
        for j, y in enumerate(b, 1):
            row.append(min(row[-1]+1, previous[j]+1, previous[j-1]+(x != y)))
        previous = row
    return previous[-1]


def main():
    if len(sys.argv) != 4:
        raise SystemExit('usage: diagnose-asr.py MONO_16K_WAV PLAN_JSON OUTPUT_JSON')
    wav, plan_path, output = map(Path, sys.argv[1:])
    plan = json.loads(plan_path.read_text())
    with wave.open(str(wav), 'rb') as reader:
        if (reader.getnchannels(), reader.getsampwidth(), reader.getframerate()) != (1, 2, 16000):
            raise ValueError('Diagnostic input must be mono signed-16 16 kHz PCM')
        pcm = np.frombuffer(reader.readframes(reader.getnframes()), dtype='<i2').astype(np.float32) / 32768
    model_name = os.environ.get('WHISPER_MODEL', 'base.en')
    model = WhisperModel(model_name, device='cpu', compute_type='int8')
    rows = []
    for turn in plan['turns']:
        start = max(0, round((turn['startS']-.05)*16000))
        duration = sum(segment['durationS'] for segment in turn['segments'])
        end = min(len(pcm), round((turn['startS']+duration+.15)*16000))
        if start >= end:
            raise ValueError('Utterance lies outside the recorded audio: '+turn['id'])
        # Silence padding, not copied/expected speech. This avoids a hard crop
        # edge being mistaken for a consonant; all utterances get the same pad.
        clip = np.pad(pcm[start:end], (4000, 4000))
        segments, _ = model.transcribe(clip, language='en', beam_size=5,
            vad_filter=False, temperature=0, initial_prompt=None,
            condition_on_previous_text=False)
        recognized = normalize(' '.join(segment.text for segment in segments))
        expected = normalize(turn['text'])
        errors = edit(expected.split(), recognized.split())
        row = {'id':turn['id'], 'speakerId':turn['speakerId'],
            'expected':expected, 'recognized':recognized,
            'wordErrors':errors, 'words':len(expected.split()),
            'wer':errors/max(1,len(expected.split()))}
        rows.append(row)
        print('NATIVE_TURN_ASR='+json.dumps(row), flush=True)
    words = sum(row['words'] for row in rows)
    errors = sum(row['wordErrors'] for row in rows)
    result = {'diagnosticOnly':True, 'model':model_name, 'initialPrompt':None,
        'conditionOnPreviousText':False, 'sampleRate':16000,
        'wavSha256':hashlib.sha256(wav.read_bytes()).hexdigest(),
        'planSha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),
        'turns':rows, 'words':words, 'wordErrors':errors,
        'aggregateWer':errors/max(1,words)}
    output.write_text(json.dumps(result, indent=2)+'\n')
    print('NATIVE_TURN_ASR_SUMMARY='+json.dumps({k:v for k,v in result.items() if k!='turns'}))


if __name__ == '__main__':
    main()
