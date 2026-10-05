"""Independent, unprompted recognition of every fixed real-word case.

Non-word syllables stay in the acoustic corpus, not the word-error score.
Decode the original hashed WAV explicitly to 16 kHz mono float PCM: passing a
filename to faster-whisper 1.2.1 invokes a PyAV API removed in newer PyAV.
No trimming, denoising, prompts, omitted word cases or changed threshold.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import wave

import numpy as np


def words(text):
    return re.sub(r'[^a-z0-9\s]', ' ', text.lower()).split()


def edits(expected, recognized):
    row = list(range(len(recognized) + 1))
    for i, x in enumerate(expected, 1):
        new = [i]
        for j, y in enumerate(recognized, 1):
            new.append(min(new[-1] + 1, row[j] + 1, row[j-1] + (x != y)))
        row = new
    return row[-1]


def decode_pcm(path):
    """Downmix/resample the complete PCM WAV; return Whisper's native input."""
    path = Path(path)
    with wave.open(str(path), 'rb') as reader:
        rate, channels, width = reader.getframerate(), reader.getnchannels(), reader.getsampwidth()
        frames = reader.getnframes()
        if (reader.getcomptype() != 'NONE' or channels not in (1, 2)
                or width != 2 or not 8000 <= rate <= 96000
                or not 0 < frames <= rate * 60):
            raise ValueError('Expected a complete 1/2-channel signed-16 PCM WAV, at most 60 s')
        raw = reader.readframes(frames)
        if len(raw) != frames * channels * width:
            raise ValueError('Truncated PCM WAV')
    converted = subprocess.run([
        'ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-map', '0:a:0',
        '-ac', '1', '-ar', '16000', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1',
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
    if len(converted.stdout) % 4:
        raise ValueError('Invalid float32 PCM byte length')
    pcm = np.frombuffer(converted.stdout, dtype='<f4').copy()
    if abs(len(pcm) - frames * 16000 / rate) > 2:
        raise ValueError('Decoder changed the complete clip duration')
    if not len(pcm) or not np.isfinite(pcm).all():
        raise ValueError('Empty or nonfinite decoded PCM')
    return pcm


def recognize(root):
    # Import only during actual recognition; decoding tests need no ASR model.
    from faster_whisper import WhisperModel

    root = Path(root).resolve()
    manifest = json.loads((root / 'manifest.json').read_text())
    cases = [case for case in manifest['cases'] if case['expected'] is not None]
    if not cases or len({case['id'] for case in cases}) != len(cases):
        raise ValueError('Missing or duplicate fixed real-word cases')
    model = WhisperModel('base.en', device='cpu', compute_type='int8')
    rows = []
    for case in cases:
        audio = (root / case['file']).resolve()
        if not audio.is_relative_to(root):
            raise ValueError('Corpus audio must remain inside its directory')
        if hashlib.sha256(audio.read_bytes()).hexdigest() != case['sha256']:
            raise ValueError('Audio hash mismatch: ' + case['id'])
        pcm = decode_pcm(audio)
        segments, _ = model.transcribe(
            pcm, language='en', beam_size=5, temperature=0,
            vad_filter=False, initial_prompt=None, condition_on_previous_text=False,
        )
        recognized = ' '.join(segment.text for segment in segments)
        expected = case['expected']
        n = len(words(expected))
        if not n:
            raise ValueError('Real-word case has an empty expected transcript')
        error = edits(words(expected), words(recognized))
        row = {'id': case['id'], 'expected': expected, 'recognized': recognized,
               'words': n, 'errors': error, 'wer': error/n,
               'wavSha256': case['sha256'], 'decodedSamples': len(pcm)}
        rows.append(row)
        print(json.dumps(row), flush=True)
    count = sum(row['words'] for row in rows)
    errors = sum(row['errors'] for row in rows)
    report = {
        'model': 'base.en', 'initialPrompt': None, 'conditionOnPreviousText': False,
        'corpusSha256': manifest['corpusSha256'], 'cases': rows,
        'decoder': 'ffmpeg-mono-float32-16000', 'sampleRate': 16000,
        'wordErrors': errors, 'words': count, 'wer': errors/count,
        'maxWer': .25, 'passed': errors/count <= .25,
    }
    (root / 'asr.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'cases'}))
    return report['passed']


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: recognize.py CORPUS_DIRECTORY')
    if not recognize(sys.argv[1]):
        raise SystemExit('Native short-phrase intelligibility gate failed')
